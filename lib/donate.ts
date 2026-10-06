import QRCode from 'qrcode';
import { Amount, getTokenMetadata, PaymentRequest, PaymentRequestTransportType, type ProofLike } from '@cashu/cashu-ts';
import { prisma } from './prisma';
import { createWallet, restoreProofs } from './wallet';
import { consolidateToHomeMint, homeMintUrl } from './consolidate';
import { withWalletLock } from './lock';
import { assertPublicMintUrl, normalizeMintUrl } from './mintUrl';
import { errorMessage, storeProofs, withTimeout } from './transfer';
import { publish } from './events';
import { DAY, HOUR } from './constants';
import { SITE_URL } from './site';

export type DonateResult = { ok?: string; error?: string };

export const INVOICE_MIN = 100;
export const INVOICE_MAX = 1_000_000;
const MAX_OPEN_INVOICES = 20;
const PAY_URL = `${SITE_URL}/api/v1/pay`;
const BUSY = 'The auditor wallet is busy with a swap. Try again in a minute.';

export function qrSvg(text: string) {
  return QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
}

export function cashuPaymentRequest() {
  return new PaymentRequest(
    [{ type: PaymentRequestTransportType.POST, target: PAY_URL }],
    undefined,
    undefined,
    'sat',
    undefined,
    'Fund Cashu Mints Auditor',
    false
  ).toEncodedCreqA();
}

let requestQr: Promise<{ request: string; qr: string }> | null = null;

export function cashuRequestWithQr() {
  return (requestQr ??= (async () => {
    const request = cashuPaymentRequest();
    return { request, qr: await qrSvg(`cashu:${request}`) };
  })());
}

async function redeem(mintUrl: string, token: string | ProofLike[]): Promise<DonateResult> {
  const result = await withWalletLock('donate', async (): Promise<DonateResult> => {
    try {
      await assertPublicMintUrl(mintUrl);
      const wallet = createWallet(mintUrl);
      await withTimeout(wallet.loadMint());
      const proofs = await withTimeout(wallet.receive(token), 30_000);
      const mint = await prisma.mint.upsert({ where: { url: mintUrl }, update: {}, create: { url: mintUrl, source: 'donation' } });
      const amount = proofs.reduce((s, p) => s.add(p.amount), Amount.zero()).toNumber();
      await storeProofs(mint.id, proofs);
      await prisma.donation.create({ data: { mintId: mint.id, amount } });
      publish('donation', { amount });

      let note = '';
      try {
        const moved = await consolidateToHomeMint(mint.id);
        if (moved?.status === 'success') note = ` Moved ${moved.amount} sat to the home mint.`;
      } catch (error) {
        console.error('consolidateToHomeMint failed:', error);
      }
      return { ok: `Thank you. Received ${amount} sat at ${mintUrl}.${note}` };
    } catch (error) {
      const known = await prisma.mint.findUnique({ where: { url: mintUrl }, select: { id: true, url: true } });
      const restored = known ? await restoreProofs(known).catch(() => null) : null;
      if (restored?.recovered) {
        await prisma.donation.create({ data: { mintId: known!.id, amount: restored.recovered } });
        return { ok: `Thank you. Received ${restored.recovered} sat at ${mintUrl} (recovered after an error).` };
      }
      return { error: `Could not redeem token: ${errorMessage(error)}` };
    }
  });
  return result ?? { error: BUSY };
}

export async function redeemToken(raw: string): Promise<DonateResult> {
  if (!raw) return { error: 'Paste a Cashu token.' };
  let meta;
  try {
    meta = getTokenMetadata(raw);
  } catch {
    return { error: 'Not a valid Cashu token.' };
  }
  const mintUrl = normalizeMintUrl(meta.mint ?? '');
  if (!mintUrl) return { error: 'Token has no valid https mint URL.' };
  if ((meta.unit ?? 'sat') !== 'sat') return { error: 'Only sat tokens are accepted.' };
  return redeem(mintUrl, raw);
}

type PayloadProof = { id: string; amount: number; secret: string; C: string };

function isProof(p: unknown): p is PayloadProof {
  if (!p || typeof p !== 'object') return false;
  const { id, amount, secret, C } = p as Record<string, unknown>;
  return typeof id === 'string' && id.length <= 66 && Number.isSafeInteger(amount) && (amount as number) > 0 &&
    typeof secret === 'string' && secret.length <= 2048 && typeof C === 'string' && C.length <= 130;
}

export async function redeemPayment(payload: unknown): Promise<DonateResult> {
  if (!payload || typeof payload !== 'object') return { error: 'Invalid payload' };
  const { mint, unit, proofs } = payload as Record<string, unknown>;
  if ((unit ?? 'sat') !== 'sat') return { error: 'Only sat is accepted' };
  const mintUrl = typeof mint === 'string' ? normalizeMintUrl(mint) : null;
  if (!mintUrl) return { error: 'Invalid mint URL' };
  if (!Array.isArray(proofs) || proofs.length === 0 || proofs.length > 200 || !proofs.every(isProof)) return { error: 'Invalid proofs' };
  return redeem(mintUrl, proofs);
}

export async function createDonationInvoice(amount: number) {
  if (!Number.isSafeInteger(amount) || amount < INVOICE_MIN || amount > INVOICE_MAX) {
    return { error: `Choose between ${INVOICE_MIN} and ${INVOICE_MAX.toLocaleString('en')} sat.` };
  }
  const home = homeMintUrl();
  if (!home) return { error: 'Lightning donations are not available.' };
  const open = await prisma.donationInvoice.count({ where: { status: 'unpaid', expiresAt: { gt: new Date() } } });
  if (open >= MAX_OPEN_INVOICES) return { error: 'Too many open invoices. Try again in a few minutes.' };
  try {
    const wallet = createWallet(home);
    await withTimeout(wallet.loadMint());
    const quote = await withTimeout(wallet.createMintQuoteBolt11(amount));
    const expiresAt = new Date(quote.expiry ? quote.expiry * 1000 : Date.now() + HOUR);
    const row = await prisma.donationInvoice.create({ data: { quoteId: quote.quote, amount, request: quote.request, expiresAt } });
    return { id: row.id, request: quote.request, qr: await qrSvg(`lightning:${quote.request}`.toUpperCase()), expiresAt: expiresAt.getTime() };
  } catch (error) {
    return { error: `Could not create an invoice: ${errorMessage(error)}` };
  }
}

type Invoice = { id: string; quoteId: string; amount: number; status: string; expiresAt: Date };

async function settleInvoice(inv: Invoice, home: { id: string; url: string }, locked: boolean): Promise<'unpaid' | 'paid' | 'expired'> {
  if (inv.status === 'issued') return 'paid';
  const wallet = createWallet(home.url);
  await withTimeout(wallet.loadMint());
  const quote = await withTimeout(wallet.checkMintQuoteBolt11(inv.quoteId));
  if (quote.state === 'UNPAID') {
    if (inv.expiresAt.getTime() > Date.now()) return 'unpaid';
    await prisma.donationInvoice.update({ where: { id: inv.id }, data: { status: 'expired' } });
    return 'expired';
  }
  if (!locked) return 'paid';

  const fresh = await prisma.donationInvoice.findUnique({ where: { id: inv.id }, select: { status: true } });
  if (fresh?.status === 'issued') return 'paid';
  let amount = inv.amount;
  if (quote.state === 'PAID') {
    const proofs = await withTimeout(wallet.mintProofsBolt11(inv.amount, quote), 30_000);
    await storeProofs(home.id, proofs);
  } else {
    amount = (await restoreProofs(home)).recovered;
  }
  await prisma.$transaction([
    prisma.donationInvoice.update({ where: { id: inv.id }, data: { status: 'issued' } }),
    prisma.donation.create({ data: { mintId: home.id, amount } }),
  ]);
  publish('donation', { amount });
  return 'paid';
}

async function homeMint() {
  const url = homeMintUrl();
  return url ? prisma.mint.findUnique({ where: { url }, select: { id: true, url: true } }) : null;
}

export async function checkDonationInvoice(id: string): Promise<'unpaid' | 'paid' | 'expired' | 'unknown'> {
  const [inv, home] = await Promise.all([prisma.donationInvoice.findUnique({ where: { id } }), homeMint()]);
  if (!inv || !home) return 'unknown';
  if (inv.status === 'issued') return 'paid';
  if (inv.status === 'expired') return 'expired';
  try {
    const state = await settleInvoice(inv, home, false);
    if (state === 'paid') await withWalletLock('donate', () => settleInvoice(inv, home, true)).catch(() => null);
    return state;
  } catch {
    return 'unpaid';
  }
}

export async function settleDonationInvoices() {
  const home = await homeMint();
  if (!home) return 0;
  const open = await prisma.donationInvoice.findMany({
    where: { status: 'unpaid', createdAt: { gte: new Date(Date.now() - 7 * DAY) } },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });
  let settled = 0;
  for (const inv of open) {
    try {
      if ((await settleInvoice(inv, home, true)) === 'paid') settled++;
    } catch (error) {
      console.error('settleDonationInvoices:', errorMessage(error));
    }
  }
  return settled;
}
