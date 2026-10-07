import { Amount, type Proof as CashuProof } from '@cashu/cashu-ts';
import type { Payout } from '../generated/prisma/client';
import { prisma } from '../prisma';
import { createWallet, restoreProofs } from '../wallet';
import { errorMessage, storeProofs, toCashu, withTimeout } from '../transfer';
import { amountMsat } from '../bolt11';
import { homeMint } from '../donate';
import { USER_AGENT } from '../site';

export const MIN_PAYOUT = 1000;
const MAX_ATTEMPTS = 48;
const num = (a: unknown) => Amount.from(a as number).toNumber();

export async function recordRevenue(claimId: string | null, amount: number, source: 'lightning' | 'token') {
  if (amount > 0) await prisma.revenueEntry.create({ data: { claimId, amount, source } });
}

async function lnurlInvoice(address: string, amount: number) {
  const [user, domain] = address.split('@');
  if (!user || !domain || !/^[a-z0-9.-]+$/i.test(domain)) throw new Error('Invalid Lightning address');
  const get = async (url: string) => {
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !body || body.status === 'ERROR') throw new Error(`LNURL: ${String(body?.reason ?? res.status)}`);
    return body;
  };
  const params = await get(`https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`);
  const msat = amount * 1000;
  if (params.tag !== 'payRequest' || typeof params.callback !== 'string' || !params.callback.startsWith('https://')) throw new Error('Not a Lightning address');
  if (msat < Number(params.minSendable) || msat > Number(params.maxSendable)) throw new Error(`Amount outside ${params.minSendable}-${params.maxSendable} msat`);
  const cb = new URL(params.callback);
  cb.searchParams.set('amount', String(msat));
  const pay = await get(cb.toString());
  const pr = String(pay.pr ?? '');
  if (amountMsat(pr) !== msat) throw new Error('Invoice amount does not match');
  return pr;
}

async function settle(payout: Payout, change: CashuProof[]) {
  const home = await homeMint();
  const reserved = await prisma.proof.findMany({ where: { swapId: payout.id, state: 'reserved' } });
  const spent = reserved.reduce((s, p) => s + p.amount, 0);
  await prisma.proof.deleteMany({ where: { swapId: payout.id, state: 'reserved' } });
  if (home && change.length) await storeProofs(home.id, change);
  const fee = Math.max(0, spent - payout.amount - change.reduce((s, p) => s + num(p.amount), 0));
  await prisma.payout.update({ where: { id: payout.id }, data: { status: 'paid', fee, error: null } });
  return { status: 'paid', amount: payout.amount, fee };
}

async function fail(payout: Payout, error: string) {
  await prisma.proof.updateMany({ where: { swapId: payout.id, state: 'reserved' }, data: { state: 'unspent', swapId: null } });
  await prisma.revenueEntry.updateMany({ where: { payoutId: payout.id }, data: { payoutId: null } });
  await prisma.payout.update({ where: { id: payout.id }, data: { status: 'failed', error: error.slice(0, 300) } });
  return { status: 'failed', error };
}

async function resolve(payout: Payout) {
  const home = await homeMint();
  if (!home) return { status: 'pending', error: 'Home mint missing' };
  const p = await prisma.payout.update({ where: { id: payout.id }, data: { attempts: { increment: 1 } } });
  try {
    const wallet = createWallet(home.url);
    await withTimeout(wallet.loadMint());
    const quote = await withTimeout(wallet.checkMeltQuoteBolt11(p.meltQuoteId));
    if (quote.state === 'PAID') {
      const done = await settle(p, []);
      await restoreProofs(home).catch(() => null);
      return done;
    }
    if (quote.state === 'UNPAID') {
      const reserved = await prisma.proof.findMany({ where: { swapId: p.id, state: 'reserved' } });
      const states = reserved.length ? await withTimeout(wallet.checkProofsStates(reserved.map(toCashu))) : [];
      if (states.some(s => s.state === 'PENDING')) return { status: 'pending' };
      const spentSecrets = reserved.filter((_, i) => states[i]?.state === 'SPENT').map(r => r.secret);
      if (spentSecrets.length) await prisma.proof.deleteMany({ where: { secret: { in: spentSecrets } } });
      return fail(p, 'Payment did not go through');
    }
    if (p.attempts >= MAX_ATTEMPTS) await prisma.payout.update({ where: { id: p.id }, data: { error: 'Payment pending for a long time' } });
    return { status: 'pending' };
  } catch (error) {
    return { status: 'pending', error: errorMessage(error) };
  }
}

export async function runPayout() {
  const address = process.env.PAYOUT_LN_ADDRESS?.trim();
  if (!address) return { skipped: 'No payout address configured' };
  const pending = await prisma.payout.findFirst({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' } });
  if (pending) return resolve(pending);

  const entries = await prisma.revenueEntry.findMany({ where: { payoutId: null }, select: { id: true, amount: true } });
  const amount = entries.reduce((s, e) => s + e.amount, 0);
  if (amount < MIN_PAYOUT) return { skipped: `${amount} sat due, minimum ${MIN_PAYOUT}` };
  const home = await homeMint();
  if (!home) return { error: 'Home mint missing' };

  let payout: Payout;
  let send: CashuProof[] = [];
  const wallet = createWallet(home.url);
  try {
    await withTimeout(wallet.loadMint());
    const invoice = await lnurlInvoice(address, amount);
    const quote = await withTimeout(wallet.createMeltQuoteBolt11(invoice));
    const need = num(quote.amount) + num(quote.fee_reserve);
    const proofs = await prisma.proof.findMany({ where: { mintId: home.id, state: 'unspent' } });
    const selected = wallet.selectProofsToSend(proofs.map(toCashu), need, true).send as CashuProof[];
    if (selected.reduce((s, p) => s + num(p.amount), 0) < need + num(wallet.getFeesForProofs(selected))) return { error: `Home mint holds too little for ${need} sat` };
    send = selected;
    payout = await prisma.payout.create({ data: { address, amount, invoice, meltQuoteId: quote.quote, feeReserve: num(quote.fee_reserve), status: 'pending' } });
    await prisma.revenueEntry.updateMany({ where: { id: { in: entries.map(e => e.id) } }, data: { payoutId: payout.id } });
    const reserved = await prisma.proof.updateMany({ where: { secret: { in: send.map(p => p.secret) }, state: 'unspent' }, data: { state: 'reserved', swapId: payout.id } });
    if (reserved.count !== send.length) return fail(payout, 'Proofs changed during planning');
    try {
      const res = await withTimeout(wallet.meltProofsBolt11(quote, send), 60_000);
      if (res.quote.state === 'PAID') return settle(payout, res.change ?? []);
    } catch {}
    return resolve(payout);
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
