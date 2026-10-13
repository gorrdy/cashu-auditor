import { getTokenMetadata } from '@cashu/cashu-ts';
import { prisma } from '../prisma';
import { DAY } from '../constants';
import { withWalletLock } from '../lock';
import { errorMessage } from '../transfer';
import { createHomeQuote, homeMint, qrSvg, redeemToken, settleQuote, type QuoteStore } from '../donate';
import { homeMintUrl } from '../consolidate';
import { normalizeMintUrl } from '../mintUrl';
import { SITE_URL } from '../site';
import { sendToChannel } from '../notify/channels';
import { recordRevenue } from './payout';

export const PRICE_PER_MONTH = 1000;
export const DAY_MSAT = BigInt(Math.round((PRICE_PER_MONTH * 1000) / 30));
export const TOPUP_MIN = 1000;
export const TOPUP_MAX = 1_000_000;
const LOW_DAYS = 3;

const THOUSAND = BigInt(1000);

export const msatToSat = (msat: bigint) => Number(msat / THOUSAND);

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export async function credit(operatorId: string, sat: number, kind: string, note: string, source: 'lightning' | 'token', claim?: (tx: Tx) => Promise<boolean>) {
  const done = await prisma.$transaction(async tx => {
    if (claim && !(await claim(tx))) return false;
    await tx.operator.update({ where: { id: operatorId }, data: { balanceMsat: { increment: BigInt(sat) * THOUSAND }, lowNotifiedAt: null, pausedNotifiedAt: null } });
    await tx.balanceEntry.create({ data: { operatorId, amountMsat: BigInt(sat) * THOUSAND, kind, note } });
    return true;
  });
  if (!done) return;
  await recordRevenue(null, sat, source);
  await chargeDue(Date.now(), operatorId);
}

const topupStore: QuoteStore = {
  status: async id => (await prisma.topupInvoice.findUnique({ where: { id }, select: { status: true } }))?.status,
  expire: id => prisma.topupInvoice.update({ where: { id }, data: { status: 'expired' } }),
  issue: async inv => {
    const row = await prisma.topupInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    await credit(row.operatorId, row.amount, 'topup', 'Lightning top-up', 'lightning', async tx =>
      (await tx.topupInvoice.updateMany({ where: { id: inv.id, status: { not: 'issued' } }, data: { status: 'issued' } })).count === 1);
  },
};

export async function createTopupInvoice(operatorId: string, amount: number) {
  if (!Number.isSafeInteger(amount) || amount < TOPUP_MIN || amount > TOPUP_MAX) return { error: `Top up between ${TOPUP_MIN.toLocaleString('en')} and ${TOPUP_MAX.toLocaleString('en')} sat.` };
  const home = homeMintUrl();
  if (!home) return { error: 'Payments are not available.' };
  const open = await prisma.topupInvoice.count({ where: { operatorId, status: 'unpaid', expiresAt: { gt: new Date() } } });
  if (open >= 5) return { error: 'Too many open invoices. Pay or wait for one to expire.' };
  try {
    const quote = await createHomeQuote(home, amount);
    const row = await prisma.topupInvoice.create({ data: { operatorId, quoteId: quote.quote, amount, request: quote.request, expiresAt: quote.expiresAt } });
    return { id: row.id, request: quote.request, amount, qr: await qrSvg(`lightning:${quote.request}`.toUpperCase()), expiresAt: quote.expiresAt.getTime() };
  } catch (error) {
    return { error: `Could not create an invoice: ${errorMessage(error)}` };
  }
}

export async function checkTopupInvoice(operatorId: string, id: string): Promise<'unpaid' | 'paid' | 'expired' | 'unknown'> {
  const inv = await prisma.topupInvoice.findUnique({ where: { id } });
  const home = await homeMint();
  if (!inv || !home || inv.operatorId !== operatorId) return 'unknown';
  if (inv.status === 'issued') return 'paid';
  if (inv.status === 'expired') return 'expired';
  try {
    const state = await settleQuote(inv, home, false, topupStore);
    if (state === 'paid') await withWalletLock('topup', () => settleQuote(inv, home, true, topupStore)).catch(() => null);
    return state;
  } catch {
    return 'unpaid';
  }
}

export async function settleTopupInvoices() {
  const home = await homeMint();
  if (!home) return 0;
  const open = await prisma.topupInvoice.findMany({ where: { status: 'unpaid', createdAt: { gte: new Date(Date.now() - 7 * DAY) } }, orderBy: { createdAt: 'asc' }, take: 20 });
  let settled = 0;
  for (const inv of open) {
    try {
      if ((await settleQuote(inv, home, true, topupStore)) === 'paid') settled++;
    } catch (error) {
      console.error('settleTopupInvoices:', errorMessage(error));
    }
  }
  return settled;
}

export async function topupWithToken(operatorId: string, raw: string) {
  let amount = 0;
  let mint = '';
  try {
    const meta = getTokenMetadata(raw.trim());
    amount = Number(meta.amount);
    mint = normalizeMintUrl(meta.mint ?? '') ?? '';
  } catch {
    return { error: 'Not a valid Cashu token.' };
  }
  const home = homeMintUrl();
  if (!home || mint !== home) return { error: `Only tokens from ${home ? new URL(home).hostname : 'the home mint'} are accepted. Use Lightning for any other mint.` };
  if (amount < 100) return { error: 'Top up at least 100 sat.' };
  return redeemToken(raw.trim(), async (_mintId, received) => {
    await credit(operatorId, received, 'topup', 'Cashu token top-up', 'token');
    return `Added ${received.toLocaleString('en')} sat to your balance.`;
  });
}

async function tell(operatorId: string, title: string, body: string) {
  const channels = await prisma.notifyChannel.findMany({ where: { operatorId } });
  for (const ch of channels) await sendToChannel(ch, { title, body, url: `${SITE_URL}/operators` });
}

export async function chargeDue(now = Date.now(), operatorId?: string) {
  const claims = await prisma.mintClaim.findMany({
    where: { verifiedAt: { not: null }, alerts: true, ...(operatorId ? { operatorId } : {}), OR: [{ paidUntil: null }, { paidUntil: { lt: new Date(now + 3_600_000) } }] },
    include: { operator: { select: { id: true, balanceMsat: true, lowNotifiedAt: true } } },
    orderBy: { createdAt: 'asc' },
  });
  let charged = 0;
  const paused = new Set<string>();
  for (const claim of claims) {
    const op = await prisma.operator.findUniqueOrThrow({ where: { id: claim.operatorId }, select: { balanceMsat: true } });
    if (op.balanceMsat < DAY_MSAT) {
      if (claim.paidUntil && claim.paidUntil.getTime() <= now) paused.add(claim.operatorId);
      continue;
    }
    const from = Math.max(now, claim.paidUntil?.getTime() ?? 0);
    const ok = await prisma.$transaction(async tx => {
      const moved = await tx.mintClaim.updateMany({ where: { id: claim.id, paidUntil: claim.paidUntil }, data: { paidUntil: new Date(from + DAY) } });
      if (moved.count !== 1) return false;
      const paid = await tx.operator.updateMany({ where: { id: claim.operatorId, balanceMsat: { gte: DAY_MSAT } }, data: { balanceMsat: { decrement: DAY_MSAT } } });
      if (paid.count !== 1) throw new Error('balance changed');
      await tx.balanceEntry.create({ data: { operatorId: claim.operatorId, amountMsat: -DAY_MSAT, kind: 'charge', claimId: claim.id, note: 'Alerts for one day' } });
      return true;
    }).catch(() => false);
    if (ok) charged++;
  }

  const active = { verifiedAt: { not: null }, alerts: true };
  const operators = await prisma.operator.findMany({
    where: { claims: { some: active }, ...(operatorId ? { id: operatorId } : {}) },
    select: { id: true, balanceMsat: true, lowNotifiedAt: true, pausedNotifiedAt: true, claims: { where: active, select: { paidUntil: true } } },
  });
  for (const op of operators) {
    if (paused.has(op.id)) {
      if (op.pausedNotifiedAt) continue;
      await tell(op.id, 'Alerts paused', 'Your balance is empty, so alerts for your mints are paused. Top up to turn them back on.');
      await prisma.operator.update({ where: { id: op.id }, data: { pausedNotifiedAt: new Date(now) } });
      continue;
    }
    const ends = op.claims.flatMap(c => (c.paidUntil ? [c.paidUntil.getTime()] : []));
    if (op.lowNotifiedAt || !ends.length) continue;
    const fundedDays = Number(op.balanceMsat / (DAY_MSAT * BigInt(op.claims.length)));
    if (Math.min(...ends) + fundedDays * DAY < now + LOW_DAYS * DAY) {
      await tell(op.id, 'Balance running low', `Your balance of ${msatToSat(op.balanceMsat)} sat keeps alerts running for less than ${LOW_DAYS} more days. Top up to keep them running.`);
      await prisma.operator.update({ where: { id: op.id }, data: { lowNotifiedAt: new Date(now) } });
    }
  }
  return { charged, paused: paused.size };
}
