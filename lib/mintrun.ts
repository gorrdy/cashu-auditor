import { createHash, randomBytes } from 'node:crypto';
import type { MintRun } from './generated/prisma/client';
import { prisma } from './prisma';
import { Amount, getTokenMetadata, PaymentRequest, PaymentRequestTransportType, type ProofLike } from '@cashu/cashu-ts';
import { createHomeQuote, homeMint, qrSvg, redeem, refundToken, settleQuote, type DonateResult, type QuoteStore } from './donate';
import { normalizeMintUrl } from './mintUrl';
import { SITE_URL } from './site';
import { lnurlInvoice, resolvePayout, sendPayout } from './operator/payout';
import { getOverview } from './stats';
import { loadBackoff } from './backoff';
import { withWalletLock } from './lock';
import { publish } from './events';
import { errorMessage, transfer } from './transfer';
import { DAY, HELD_RUN_STATUSES } from './constants';

export const RUN_MIN = 10_000;
export const RUN_MAX = 100_000;
const MAX_OPEN = 3;
const FAILS_BEFORE_HOME = 3;
const GIVE_UP_FAILS = FAILS_BEFORE_HOME + 96;
const RETRY_MS = 15 * 60_000;
const PAY_ATTEMPTS = 3;

export const ACTIVE_STATUSES = ['running', 'paying'];

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
const route = (run: MintRun) => JSON.parse(run.route) as string[];

export async function createRun(input: { amount: number; returnTo?: string; donate: boolean }) {
  const amount = Math.round(Number(input.amount));
  if (!Number.isSafeInteger(amount) || amount < RUN_MIN || amount > RUN_MAX) return { error: `Choose between ${RUN_MIN.toLocaleString('en')} and ${RUN_MAX.toLocaleString('en')} sat.` };
  const returnTo = input.donate ? null : (input.returnTo ?? '').trim().toLowerCase();
  if (!input.donate) {
    if (!returnTo || !/^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(returnTo)) return { error: 'Enter a Lightning address like name@wallet.com, or choose to donate.' };
    try {
      await lnurlInvoice(returnTo, Math.min(amount, 1000));
    } catch (error) {
      return { error: `That Lightning address does not work: ${errorMessage(error)}` };
    }
  }
  const open = await prisma.mintRun.count({ where: { OR: [{ status: 'invoice', expiresAt: { gt: new Date() } }, { status: { in: HELD_RUN_STATUSES } }] } });
  if (open >= MAX_OPEN) return { error: 'Several runs are already waiting. Try again later.' };
  const home = await homeMint();
  if (!home) return { error: 'Mint runs are not available.' };
  try {
    const quote = await createHomeQuote(home.url, amount);
    const key = randomBytes(18).toString('base64url');
    const run = await prisma.mintRun.create({
      data: { amount, value: amount, status: 'invoice', donate: input.donate, returnTo, keyHash: hashKey(key), quoteId: quote.quote, request: quote.request, expiresAt: quote.expiresAt },
    });
    return { id: run.id, key };
  } catch (error) {
    return { error: `Could not create an invoice: ${errorMessage(error)}` };
  }
}

const runStore: QuoteStore = {
  status: async id => ((await prisma.mintRun.findUnique({ where: { id }, select: { status: true } }))?.status === 'invoice' ? 'unpaid' : 'issued'),
  expire: id => prisma.mintRun.updateMany({ where: { id, status: 'invoice' }, data: { status: 'expired' } }),
  issue: async (inv, amount) => {
    await prisma.mintRun.updateMany({ where: { id: inv.id, status: 'invoice' }, data: { status: 'queued', amount, value: amount } });
    publish('swap', { status: 'queued', amount });
  },
};

const asInvoice = (run: MintRun) => ({ id: run.id, quoteId: run.quoteId, amount: run.amount, status: run.status === 'invoice' ? 'unpaid' : 'issued', expiresAt: run.expiresAt });

export async function checkRunInvoice(run: MintRun) {
  if (run.status !== 'invoice') return;
  const home = await homeMint();
  if (!home) return;
  try {
    const state = await settleQuote(asInvoice(run), home, false, runStore);
    if (state === 'paid') await withWalletLock('mint-run', () => settleQuote(asInvoice(run), home, true, runStore)).catch(() => null);
  } catch {}
}

export function runPaymentRequest(run: { id: string; amount: number }) {
  return new PaymentRequest([{ type: PaymentRequestTransportType.POST, target: `${SITE_URL}/api/v1/pay` }], run.id, run.amount, 'sat', undefined, 'Cashu mint run', true).toEncodedCreqA();
}

export async function fundRun(id: string, mintUrl: string, token: string | ProofLike[]): Promise<DonateResult> {
  const run = await prisma.mintRun.findUnique({ where: { id }, select: { status: true } });
  if (!run) return { error: 'Unknown payment request' };
  if (run.status !== 'invoice') return { error: 'This run is already funded or expired.' };
  const amount = Array.isArray(token) ? token.reduce((s, p) => s + Amount.from(p.amount).toNumber(), 0) : getTokenMetadata(token).amount.toNumber();
  if (amount < RUN_MIN || amount > RUN_MAX) return { error: `A run needs ${RUN_MIN.toLocaleString('en')} to ${RUN_MAX.toLocaleString('en')} sat, this token has ${amount.toLocaleString('en')} sat.` };
  return redeem(mintUrl, token, async (mintId, received) => {
    const r = await prisma.mintRun.updateMany({ where: { id, status: 'invoice' }, data: { status: 'queued', amount: received, value: received, currentMintId: mintId } });
    if (!r.count) {
      await prisma.donation.create({ data: { mintId, amount: received } });
      return `This run was already funded, so ${received} sat were kept as a donation.`;
    }
    publish('swap', { status: 'queued', amount: received });
    return `Received ${received.toLocaleString('en')} sat. The run starts within a minute.`;
  }, false);
}

export async function fundRunWithToken(id: string, raw: string): Promise<DonateResult> {
  let meta;
  try {
    meta = getTokenMetadata(raw);
  } catch {
    return { error: 'Not a valid Cashu token.' };
  }
  const mintUrl = normalizeMintUrl(meta.mint ?? '');
  if (!mintUrl) return { error: 'Token has no valid https mint URL.' };
  if ((meta.unit ?? 'sat') !== 'sat') return { error: 'Only sat tokens are accepted.' };
  return fundRun(id, mintUrl, raw);
}

export async function invoiceQr(run: { request: string }) {
  return qrSvg(`lightning:${run.request}`.toUpperCase());
}

export async function runOwner(id: string, key: string) {
  const run = await prisma.mintRun.findUnique({ where: { id } });
  return run && key && run.keyHash === hashKey(key) ? run : null;
}

export async function runHeld() {
  return (await prisma.mintRun.aggregate({ where: { status: { in: HELD_RUN_STATUSES } }, _sum: { value: true } }))._sum.value ?? 0;
}

export async function activeRunMints() {
  const runs = await prisma.mintRun.findMany({ where: { status: { in: HELD_RUN_STATUSES } }, select: { currentMintId: true } });
  return new Set(runs.map(r => r.currentMintId).filter((id): id is string => !!id));
}

async function planRoute(value: number, homeId: string) {
  const [{ mints }, backoff] = await Promise.all([getOverview(), loadBackoff()]);
  const methods = new Map((await prisma.mint.findMany({ select: { id: true, methods: true } })).map(m => [m.id, m.methods]));
  const fits = (id: string) => {
    const list = JSON.parse(methods.get(id) ?? '[]') as { op: string; method: string; unit: string; min?: number; max?: number }[];
    return ['mint', 'melt'].every(op => {
      const m = list.find(x => x.op === op && x.method === 'bolt11' && x.unit === 'sat');
      return !m || ((m.min ?? 0) <= value && (m.max ?? Infinity) >= value);
    });
  };
  const ids = mints
    .filter(m => m.recommended && !m.isTest && m.id !== homeId && m.latestStatus === 'online' && fits(m.id) && backoff.canSend(m.id) && backoff.canReceive(m.id))
    .map(m => m.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

async function update(run: MintRun, data: Partial<MintRun>) {
  const next = await prisma.mintRun.update({ where: { id: run.id }, data });
  publish('swap', { status: next.status, amount: next.value });
  return next;
}

async function applyLastHop(run: MintRun, homeId: string): Promise<MintRun | null> {
  if (!run.lastSwapId) return run;
  const swap = await prisma.swap.findUnique({ where: { id: run.lastSwapId } });
  if (!swap) return update(run, { lastSwapId: null });
  if (swap.status === 'pending') return null;
  const toHome = swap.destMintId === homeId;
  if (swap.status === 'success') {
    const value = run.value - swap.fee;
    if (toHome) return update(run, { lastSwapId: null, value, currentMintId: homeId, failStreak: 0, status: 'paying' });
    return update(run, { lastSwapId: null, value, currentMintId: swap.destMintId, failStreak: 0, position: run.position + 1 });
  }
  if (swap.stage === 'mint') {
    return update(run, { lastSwapId: null, status: 'stuck', finishedAt: new Date(), error: 'The receiving mint was paid but did not issue the ecash' });
  }
  const failStreak = run.failStreak + 1;
  if (failStreak >= GIVE_UP_FAILS) {
    return update(run, { lastSwapId: null, failStreak, status: 'stuck', finishedAt: new Date(), error: 'The mint holding the run could not pay out for a day' });
  }
  return update(run, {
    lastSwapId: null,
    failStreak,
    position: toHome ? run.position : run.position + 1,
    nextAt: failStreak >= FAILS_BEFORE_HOME ? new Date(Date.now() + RETRY_MS) : null,
  });
}

async function pay(run: MintRun, home: { id: string; url: string }): Promise<MintRun> {
  if (run.donate) {
    await prisma.donation.create({ data: { mintId: home.id, amount: run.value } });
    publish('donation', { amount: run.value });
    return update(run, { status: 'done', finishedAt: new Date() });
  }
  if (run.payoutId) {
    const payout = await prisma.payout.findUnique({ where: { id: run.payoutId } });
    if (payout?.status === 'pending') await resolvePayout(payout);
    const now = await prisma.payout.findUnique({ where: { id: run.payoutId } });
    if (now?.status === 'paid') return update(run, { status: 'done', returned: now.amount, value: run.value - now.fee, finishedAt: new Date() });
    if (now?.status === 'pending') return run;
    return update(run, { payoutId: null, error: now?.error ?? 'Payment failed', nextAt: new Date(Date.now() + RETRY_MS) });
  }
  if (run.payAttempts >= PAY_ATTEMPTS) {
    try {
      const token = await refundToken(home, run.value);
      return update(run, { status: 'claim', token, finishedAt: new Date() });
    } catch (error) {
      return update(run, { error: `Could not create a refund token: ${errorMessage(error)}`, nextAt: new Date(Date.now() + RETRY_MS) });
    }
  }
  const before = new Date();
  const r = await sendPayout(run.returnTo!, run.value - 2, { runId: run.id, maxSpend: run.value });
  const created = await prisma.payout.findFirst({ where: { runId: run.id, createdAt: { gte: before } }, select: { id: true } });
  run = await update(run, {
    payAttempts: run.payAttempts + 1,
    payoutId: created?.id ?? null,
    error: created ? null : 'error' in r ? r.error ?? null : null,
    nextAt: created ? null : new Date(Date.now() + RETRY_MS),
  });
  return created ? pay(run, home) : run;
}

async function step(run: MintRun, home: { id: string; url: string }): Promise<MintRun | null> {
  if (run.nextAt && run.nextAt.getTime() > Date.now()) return null;
  const applied = await applyLastHop(run, home.id);
  if (!applied) return null;
  run = applied;
  if (run.status === 'paying') {
    const paid = await pay(run, home);
    return paid.status === 'paying' ? null : paid;
  }
  if (run.status !== 'running') return null;

  const planned = route(run);
  const goHome = run.position >= planned.length || run.failStreak >= FAILS_BEFORE_HOME;
  const destId = goHome ? home.id : planned[run.position];
  const [source, dest] = await Promise.all([
    prisma.mint.findUnique({ where: { id: run.currentMintId! }, select: { id: true, url: true } }),
    prisma.mint.findUnique({ where: { id: destId }, select: { id: true, url: true } }),
  ]);
  if (!source || !dest) return update(run, { position: run.position + 1 });
  if (source.id === dest.id) return update(run, goHome ? { status: 'paying' } : { position: run.position + 1 });
  const r = await transfer({ source, dest, budget: run.value, kind: 'run', runId: run.id });
  return update(run, { lastSwapId: r.swapId ?? null });
}

export async function advanceRuns(deadline = Date.now() + 45_000) {
  const home = await homeMint();
  if (!home) return null;
  for (const inv of await prisma.mintRun.findMany({ where: { status: 'invoice', createdAt: { gte: new Date(Date.now() - DAY) } } })) {
    await settleQuote(asInvoice(inv), home, true, runStore).catch(() => null);
  }
  let run = await prisma.mintRun.findFirst({ where: { status: { in: ACTIVE_STATUSES } }, orderBy: { createdAt: 'asc' } });
  if (!run) {
    const queued = await prisma.mintRun.findFirst({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' } });
    if (!queued) return null;
    const start = queued.currentMintId ?? home.id;
    run = await update(queued, { status: 'running', route: JSON.stringify((await planRoute(queued.value, home.id)).filter(m => m !== start)), currentMintId: start, startedAt: new Date() });
  }
  const log: string[] = [];
  while (run && Date.now() < deadline) {
    try {
      run = await step(run, home);
    } catch (error) {
      log.push(errorMessage(error));
      break;
    }
  }
  const now = await prisma.mintRun.findFirst({ where: { status: { in: [...ACTIVE_STATUSES, 'queued'] } }, orderBy: { createdAt: 'asc' }, select: { id: true, status: true, position: true, value: true } });
  return { run: now, errors: log };
}

export async function getRun(id: string) {
  const run = await prisma.mintRun.findUnique({ where: { id }, omit: { keyHash: true, token: true, returnTo: true } });
  if (!run) return null;
  const [swaps, names] = await Promise.all([
    prisma.swap.findMany({
      where: { runId: id },
      orderBy: { timestamp: 'asc' },
      include: { sourceMint: { select: { id: true, name: true, url: true } }, destMint: { select: { id: true, name: true, url: true } } },
    }),
    prisma.mint.findMany({ where: { id: { in: route(run as MintRun) } }, select: { id: true, name: true, url: true } }),
  ]);
  const byId = new Map(names.map(n => [n.id, n]));
  return { now: Date.now(), run, swaps, route: route(run as MintRun).map(r => byId.get(r)).filter(r => !!r) };
}

export async function recentRuns(take = 10) {
  return prisma.mintRun.findMany({
    where: { status: { notIn: ['invoice', 'expired'] } },
    orderBy: { createdAt: 'desc' },
    take,
    select: { id: true, amount: true, value: true, status: true, route: true, position: true, createdAt: true, startedAt: true, finishedAt: true },
  });
}

export const RUN_STATUS: Record<string, string> = {
  invoice: 'Waiting for payment',
  expired: 'Invoice expired',
  queued: 'Queued',
  running: 'Running',
  paying: 'Paying back',
  done: 'Finished',
  claim: 'Finished, refund token ready',
  stuck: 'Stuck',
};
