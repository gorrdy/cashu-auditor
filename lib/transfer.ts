import { Amount, hasValidDleq, Wallet, type AmountLike, type Proof as CashuProof, type ProofLike } from '@cashu/cashu-ts';
import type { Proof as StoredProof, Swap } from './generated/prisma/client';
import { prisma } from './prisma';
import { createWallet, restoreProofs } from './wallet';
import { publish } from './events';
import { paymentHashOf, preimageMatches } from './bolt11';

const OP_TIMEOUT_MS = 15_000;
const MELT_TIMEOUT_MS = 60_000;
const MINT_TIMEOUT_MS = 30_000;
const MAX_RECOVERY_ATTEMPTS = 48;
const RECOVERY_INTERVAL_MS = 5 * 60_000;
const MAX_FEE_RESERVE_SAT = 10;

export type MintRef = { id: string; url: string };

export type TransferResult = {
  status: 'success' | 'failed' | 'pending';
  swapId?: string;
  amount: number;
  fee: number;
  duration: number;
  stage?: string;
  error?: string;
  fundsMoved: boolean;
};

export function withTimeout<T>(p: Promise<T>, ms = OP_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout after ${ms / 1000}s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const INTERNAL_ERROR = /prisma|invocation|sqlite|\/srv\/|\/home\/|\/etc\/|\/opt\/|node_modules|\bat (async )?[\w.<>]+ \(|TypeError|ReferenceError|RangeError|SyntaxError|Cannot read prop/i;

export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (INTERNAL_ERROR.test(raw)) {
    console.error('Internal error:', error);
    return 'Internal auditor error';
  }
  return (error instanceof Error ? error.message : raw).split('\n')[0].slice(0, 300);
}

async function walletFor(url: string) {
  const wallet = createWallet(url);
  await withTimeout(wallet.loadMint());
  return wallet;
}

const num = (a: AmountLike) => Amount.from(a).toNumber();
export function dleqStatus(wallet: Wallet, proofs: CashuProof[]): 'valid' | 'invalid' | 'missing' | null {
  if (proofs.length === 0) return null;
  const withDleq = proofs.filter(p => p.dleq);
  if (withDleq.length === 0) return 'missing';
  try {
    return withDleq.every(p => hasValidDleq(p, wallet.keyChain.getKeyset(p.id), { require: false })) ? 'valid' : 'invalid';
  } catch {
    return 'invalid';
  }
}

const toCashu = (p: StoredProof): ProofLike => ({ id: p.keysetId, amount: p.amount, secret: p.secret, C: p.C });
const sum = (proofs: { amount: AmountLike }[]) => proofs.reduce((s, p) => s + num(p.amount), 0);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function storeProofs(mintId: string, proofs: CashuProof[]) {
  for (const p of proofs) {
    await prisma.proof.upsert({
      where: { secret: p.secret },
      update: {},
      create: { mintId, keysetId: p.id, amount: num(p.amount), secret: p.secret, C: p.C },
    });
  }
}

async function releaseReserved(swapId: string) {
  await prisma.proof.updateMany({ where: { swapId, state: 'reserved' }, data: { state: 'unspent', swapId: null } });
}

export const FAKE_PREIMAGE = 'Source reported the payment as paid with a preimage that does not match the invoice';

async function settleMelt(swap: Swap, change: CashuProof[], preimage?: unknown) {
  const reserved = await prisma.proof.findMany({ where: { swapId: swap.id, state: 'reserved' } });
  const spent = sum(reserved);
  await prisma.proof.deleteMany({ where: { swapId: swap.id, state: 'reserved' } });
  await storeProofs(swap.sourceMintId, change);
  const fee = Math.max(0, spent - swap.amount - sum(change));
  return prisma.swap.update({ where: { id: swap.id }, data: { stage: 'mint', fee, preimageOk: preimageMatches(swap.paymentHash, preimage) } });
}

type MeltOutcome = 'paid' | 'unpaid' | 'pending';

async function resolveMelt(wallet: Wallet, swap: Swap): Promise<{ outcome: MeltOutcome; swap: Swap }> {
  let state: string;
  let preimage: unknown;
  try {
    const quote = await withTimeout(wallet.checkMeltQuoteBolt11(swap.meltQuoteId!));
    state = quote.state;
    preimage = quote.payment_preimage;
  } catch {
    return { outcome: 'pending', swap };
  }
  if (state === 'PAID') return { outcome: 'paid', swap: await settleMelt(swap, [], preimage) };
  if (state !== 'UNPAID') return { outcome: 'pending', swap };

  const reserved = await prisma.proof.findMany({ where: { swapId: swap.id, state: 'reserved' } });
  let states;
  try {
    states = await withTimeout(wallet.checkProofsStates(reserved.map(toCashu)));
  } catch {
    return { outcome: 'pending', swap };
  }
  if (states.some(s => s.state === 'PENDING')) return { outcome: 'pending', swap };
  const spentSecrets = reserved.filter((_, i) => states[i]?.state === 'SPENT').map(p => p.secret);
  if (spentSecrets.length) await prisma.proof.deleteMany({ where: { secret: { in: spentSecrets } } });
  await releaseReserved(swap.id);
  return { outcome: 'unpaid', swap };
}

async function destConfirmsPayment(destUrl: string, swap: Swap) {
  try {
    const wallet = createWallet(destUrl);
    const state = (await withTimeout(wallet.checkMintQuoteBolt11(swap.mintQuoteId!))).state;
    return state === 'PAID' || state === 'ISSUED';
  } catch {
    return false;
  }
}

async function completeMint(wallet: Wallet, swap: Swap, destUrl: string): Promise<{ status: 'success' | 'failed' | 'pending'; error?: string }> {
  let quoteState = 'UNPAID';
  for (let i = 0; i < 5; i++) {
    try {
      quoteState = (await withTimeout(wallet.checkMintQuoteBolt11(swap.mintQuoteId!))).state;
    } catch (error) {
      return { status: 'pending', error: `Check mint quote: ${errorMessage(error)}` };
    }
    if (quoteState !== 'UNPAID') break;
    await sleep(2_000);
  }
  if (quoteState === 'ISSUED') {
    try {
      const { recovered } = await restoreProofs({ id: swap.destMintId, url: destUrl });
      if (recovered >= swap.amount) return { status: 'success' };
      return { status: 'failed', error: `Mint quote issued, restored only ${recovered} of ${swap.amount} sat` };
    } catch (error) {
      return { status: 'pending', error: `Restore: ${errorMessage(error)}` };
    }
  }
  if (quoteState !== 'PAID') {
    if (swap.preimageOk === false) {
      await prisma.swap.update({ where: { id: swap.id }, data: { stage: 'melt' } });
      return { status: 'failed', error: FAKE_PREIMAGE };
    }
    return { status: 'pending', error: 'Invoice paid but mint quote still UNPAID' };
  }

  try {
    const started = Date.now();
    const proofs = await withTimeout(wallet.mintProofsBolt11(swap.amount, swap.mintQuoteId!), MINT_TIMEOUT_MS);
    await storeProofs(swap.destMintId, proofs);
    await prisma.swap.update({ where: { id: swap.id }, data: { mintMs: Date.now() - started, dleq: dleqStatus(wallet, proofs) } });
    return { status: 'success' };
  } catch (error) {
    return { status: 'pending', error: `Mint: ${errorMessage(error)}` };
  }
}

async function finish(swap: Swap, status: 'success' | 'failed' | 'pending', error?: string): Promise<TransferResult> {
  const duration = Date.now() - swap.timestamp.getTime();
  const updated = await prisma.swap.update({
    where: { id: swap.id },
    data: {
      status,
      error: status === 'success' ? null : error ?? swap.error,
      duration,
      ...(status === 'success' ? { stage: null } : {}),
    },
  });
  publish('swap', { status, amount: swap.amount });
  return {
    status,
    swapId: swap.id,
    amount: swap.amount,
    fee: updated.fee,
    duration,
    stage: updated.stage ?? undefined,
    error: updated.error ?? undefined,
    fundsMoved: true,
  };
}

async function amountLimits(sourceId: string, destId: string) {
  const rows = await prisma.mint.findMany({ where: { id: { in: [sourceId, destId] } }, select: { id: true, methods: true } });
  const methods = (id: string) => {
    const raw = rows.find(r => r.id === id)?.methods;
    return raw ? (JSON.parse(raw) as { op: string; method: string; unit: string; min?: number; max?: number }[]) : [];
  };
  const mintSide = methods(destId).find(m => m.op === 'mint' && m.method === 'bolt11' && m.unit === 'sat');
  const meltSide = methods(sourceId).find(m => m.op === 'melt' && m.method === 'bolt11' && m.unit === 'sat');
  return {
    min: Math.max(mintSide?.min ?? 1, meltSide?.min ?? 1),
    max: Math.min(mintSide?.max ?? Infinity, meltSide?.max ?? Infinity),
  };
}

export async function transfer(opts: {
  source: MintRef;
  dest: MintRef;
  amount?: number;
  maxAmount?: number;
  kind?: 'swap' | 'consolidate';
}): Promise<TransferResult> {
  const { source, dest, kind = 'swap' } = opts;
  const started = Date.now();
  let stage = 'mint_quote';
  let target = opts.amount ?? 0;

  const fail = async (error: string): Promise<TransferResult> => {
    const duration = Date.now() - started;
    const swap = await prisma.swap.create({
      data: { kind, sourceMintId: source.id, destMintId: dest.id, amount: target, status: 'failed', stage, duration, error },
    });
    publish('swap', { status: 'failed', amount: target });
    return { status: 'failed', swapId: swap.id, amount: target, fee: 0, duration, stage, error, fundsMoved: false };
  };

  let destWallet: Wallet, sourceWallet: Wallet;
  let quoteStarted = Date.now();
  let mintQuote, meltQuote, send: CashuProof[] = [];
  try {
    destWallet = await walletFor(dest.url);
    stage = 'melt_quote';
    sourceWallet = await walletFor(source.url);

    const stored = await prisma.proof.findMany({ where: { mintId: source.id, state: 'unspent' } });
    const proofs = stored.map(toCashu);
    const balance = sum(proofs);
    if (opts.amount === undefined) target = balance - Math.max(2, Math.ceil(balance * 0.02));
    const limits = await amountLimits(source.id, dest.id);
    if (target > limits.max) target = limits.max;
    if (target < limits.min) {
      if (limits.min > (opts.maxAmount ?? target) || limits.min > balance) {
        stage = 'limits';
        return fail(`Amount ${target} sat is below the mint minimum of ${limits.min} sat`);
      }
      target = limits.min;
    }

    quoteStarted = Date.now();
    for (let attempt = 0; attempt < 4; attempt++) {
      if (target < 1) {
        stage = 'balance';
        return fail(`Balance ${balance} sat too low`);
      }
      stage = 'mint_quote';
      mintQuote = await withTimeout(destWallet.createMintQuoteBolt11(target));
      stage = 'melt_quote';
      meltQuote = await withTimeout(sourceWallet.createMeltQuoteBolt11(mintQuote.request));
      if (num(meltQuote.amount) !== target) {
        stage = 'mint_quote';
        return fail(`Destination invoice is for ${num(meltQuote.amount)} sat, requested ${target} sat`);
      }
      if (num(meltQuote.fee_reserve) > Math.max(MAX_FEE_RESERVE_SAT, Math.ceil(target * 0.05))) {
        return fail(`Fee reserve ${num(meltQuote.fee_reserve)} sat is too high for ${target} sat`);
      }
      const base = num(meltQuote.amount) + num(meltQuote.fee_reserve);
      send = balance >= base ? sourceWallet.selectProofsToSend(proofs, base, true).send : [];
      const needed = base + (send.length ? num(sourceWallet.getFeesForProofs(send)) : 0);
      if (send.length && sum(send) >= needed) break;
      if (opts.amount !== undefined || attempt === 3) {
        stage = 'balance';
        return fail(`Insufficient balance: need ${needed} sat, have ${balance} sat`);
      }
      target -= Math.max(1, needed - balance + 1);
      send = [];
    }
  } catch (error) {
    return fail(errorMessage(error));
  }

  let swap = await prisma.swap.create({
    data: {
      kind,
      sourceMintId: source.id,
      destMintId: dest.id,
      amount: target,
      feeReserve: num(meltQuote!.fee_reserve),
      status: 'pending',
      stage: 'melt',
      mintQuoteId: mintQuote!.quote,
      paymentHash: paymentHashOf(mintQuote!.request),
      meltQuoteId: meltQuote!.quote,
      timestamp: new Date(started),
      quoteMs: Date.now() - quoteStarted,
    },
  });
  const secrets = send.map(p => p.secret);
  const reserved = await prisma.proof.updateMany({
    where: { secret: { in: secrets }, state: 'unspent' },
    data: { state: 'reserved', swapId: swap.id },
  });
  if (reserved.count !== secrets.length) {
    await releaseReserved(swap.id);
    await prisma.swap.update({ where: { id: swap.id }, data: { status: 'failed', stage: 'reserve', error: 'Proofs changed during planning' } });
    return { status: 'failed', swapId: swap.id, amount: target, fee: 0, duration: Date.now() - started, stage: 'reserve', fundsMoved: false };
  }

  let meltError: string | undefined;
  let outcome: MeltOutcome;
  const meltStarted = Date.now();
  try {
    const res = await withTimeout(sourceWallet.meltProofsBolt11(meltQuote!, send), MELT_TIMEOUT_MS);
    if (res.quote.state === 'PAID') {
      await prisma.swap.update({ where: { id: swap.id }, data: { meltMs: Date.now() - meltStarted } });
      swap = await settleMelt(swap, res.change ?? [], res.quote.payment_preimage);
      outcome = 'paid';
    } else {
      meltError = `Melt state ${res.quote.state}`;
      ({ outcome, swap } = await resolveMelt(sourceWallet, swap));
    }
  } catch (error) {
    meltError = errorMessage(error);
    ({ outcome, swap } = await resolveMelt(sourceWallet, swap));
  }

  if (outcome === 'unpaid') return { ...(await finish(swap, 'failed', meltError ?? 'Melt not paid')), fundsMoved: false };
  if (outcome === 'pending' && (await destConfirmsPayment(dest.url, swap))) {
    swap = await settleMelt(swap, []);
    outcome = 'paid';
  }
  if (outcome === 'pending') return finish(swap, 'pending', meltError ?? 'Melt pending');

  const minted = await completeMint(destWallet, swap, dest.url);
  return finish(swap, minted.status, minted.error);
}

export async function recoverPendingSwaps() {
  const pending = await prisma.swap.findMany({
    where: { status: 'pending', updatedAt: { lt: new Date(Date.now() - RECOVERY_INTERVAL_MS) } },
    include: { sourceMint: { select: { url: true } }, destMint: { select: { url: true } } },
    orderBy: { timestamp: 'asc' },
  });
  const results = [];
  for (const { sourceMint, destMint, ...row } of pending) {
    let swap: Swap = await prisma.swap.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    const giveUp = swap.attempts >= MAX_RECOVERY_ATTEMPTS;
    try {
      if (swap.stage === 'melt') {
        const wallet = await walletFor(sourceMint.url);
        const resolved = await resolveMelt(wallet, swap);
        swap = resolved.swap;
        if (resolved.outcome === 'unpaid') {
          results.push(await finish(swap, 'failed', swap.error ?? 'Melt not paid'));
          continue;
        }
        if (resolved.outcome === 'pending') {
          if (await destConfirmsPayment(destMint.url, swap)) {
            swap = await settleMelt(swap, []);
          } else {
            results.push(await finish(swap, giveUp ? 'failed' : 'pending', giveUp ? 'Melt stuck pending' : undefined));
            continue;
          }
        }
      }
      const wallet = await walletFor(destMint.url);
      const minted = await completeMint(wallet, swap, destMint.url);
      const status = minted.status === 'pending' && giveUp ? 'failed' : minted.status;
      results.push(await finish(swap, status, minted.error));
    } catch (error) {
      results.push(await finish(swap, giveUp ? 'failed' : 'pending', errorMessage(error)));
    }
  }
  return results;
}
