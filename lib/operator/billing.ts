import { getTokenMetadata } from '@cashu/cashu-ts';
import { prisma } from '../prisma';
import { DAY } from '../constants';
import { withWalletLock } from '../lock';
import { errorMessage } from '../transfer';
import { createHomeQuote, homeMint, qrSvg, redeemToken, settleQuote, type QuoteStore } from '../donate';
import { homeMintUrl } from '../consolidate';

export const PRICE_PER_MONTH = 1000;
export const PERIODS = [1, 3, 6, 12];
const MONTH_MS = 30 * DAY;

async function extend(claimId: string, months: number) {
  const claim = await prisma.mintClaim.findUnique({ where: { id: claimId }, select: { paidUntil: true } });
  const from = Math.max(Date.now(), claim?.paidUntil?.getTime() ?? 0);
  return prisma.mintClaim.update({ where: { id: claimId }, data: { paidUntil: new Date(from + months * MONTH_MS) } });
}

const claimStore: QuoteStore = {
  status: async id => (await prisma.claimInvoice.findUnique({ where: { id }, select: { status: true } }))?.status,
  expire: id => prisma.claimInvoice.update({ where: { id }, data: { status: 'expired' } }),
  issue: async inv => {
    const row = await prisma.claimInvoice.update({ where: { id: inv.id }, data: { status: 'issued' } });
    await extend(row.claimId, row.months);
  },
};

async function ownedVerifiedClaim(operatorId: string, claimId: string) {
  const claim = await prisma.mintClaim.findUnique({ where: { id: claimId } });
  return claim && claim.operatorId === operatorId && claim.verifiedAt ? claim : null;
}

export async function createClaimInvoice(operatorId: string, claimId: string, months: number) {
  if (!PERIODS.includes(months)) return { error: 'Invalid period' };
  if (!(await ownedVerifiedClaim(operatorId, claimId))) return { error: 'Verify the mint first.' };
  const home = homeMintUrl();
  if (!home) return { error: 'Payments are not available.' };
  try {
    const amount = months * PRICE_PER_MONTH;
    const quote = await createHomeQuote(home, amount);
    const row = await prisma.claimInvoice.create({ data: { claimId, quoteId: quote.quote, amount, months, request: quote.request, expiresAt: quote.expiresAt } });
    return { id: row.id, request: quote.request, amount, qr: await qrSvg(`lightning:${quote.request}`.toUpperCase()), expiresAt: quote.expiresAt.getTime() };
  } catch (error) {
    return { error: `Could not create an invoice: ${errorMessage(error)}` };
  }
}

export async function checkClaimInvoice(operatorId: string, id: string): Promise<'unpaid' | 'paid' | 'expired' | 'unknown'> {
  const inv = await prisma.claimInvoice.findUnique({ where: { id }, include: { claim: { select: { operatorId: true } } } });
  const home = await homeMint();
  if (!inv || !home || inv.claim.operatorId !== operatorId) return 'unknown';
  if (inv.status === 'issued') return 'paid';
  if (inv.status === 'expired') return 'expired';
  try {
    const state = await settleQuote(inv, home, false, claimStore);
    if (state === 'paid') await withWalletLock('subscription', () => settleQuote(inv, home, true, claimStore)).catch(() => null);
    return state;
  } catch {
    return 'unpaid';
  }
}

export async function settleClaimInvoices() {
  const home = await homeMint();
  if (!home) return 0;
  const open = await prisma.claimInvoice.findMany({ where: { status: 'unpaid', createdAt: { gte: new Date(Date.now() - 7 * DAY) } }, orderBy: { createdAt: 'asc' }, take: 20 });
  let settled = 0;
  for (const inv of open) {
    try {
      if ((await settleQuote(inv, home, true, claimStore)) === 'paid') settled++;
    } catch (error) {
      console.error('settleClaimInvoices:', errorMessage(error));
    }
  }
  return settled;
}

export async function payClaimWithToken(operatorId: string, claimId: string, raw: string) {
  if (!(await ownedVerifiedClaim(operatorId, claimId))) return { error: 'Verify the mint first.' };
  let amount = 0;
  try {
    amount = Number(getTokenMetadata(raw.trim()).amount);
  } catch {
    return { error: 'Not a valid Cashu token.' };
  }
  if (amount < PRICE_PER_MONTH) return { error: `A month costs ${PRICE_PER_MONTH} sat; this token holds ${amount} sat.` };
  return redeemToken(raw.trim(), async (mintId, received) => {
    const months = Math.floor(received / PRICE_PER_MONTH);
    const extra = received - months * PRICE_PER_MONTH;
    if (months > 0) await extend(claimId, months);
    if (extra > 0) await prisma.donation.create({ data: { mintId, amount: extra } });
    return `Received ${received} sat: ${months} month${months === 1 ? '' : 's'} added${extra ? `, ${extra} sat kept as a donation` : ''}.`;
  });
}
