'use server';

import { revalidatePath } from 'next/cache';
import { Amount, getTokenMetadata } from '@cashu/cashu-ts';
import { createWallet, restoreProofs } from '@/lib/wallet';
import { prisma } from '@/lib/prisma';
import { consolidateToHomeMint } from '@/lib/consolidate';
import { withWalletLock } from '@/lib/lock';
import { assertPublicMintUrl, normalizeMintUrl } from '@/lib/mintUrl';
import { errorMessage, withTimeout } from '@/lib/transfer';
import { publish } from '@/lib/events';
import { trackMint } from '@/lib/track';

export type FormResult = { ok?: string; error?: string } | null;

export async function addMint(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const r = await trackMint(String(formData.get('url') ?? ''), 'manual');
  switch (r.status) {
    case 'added':
      revalidatePath('/');
      publish('mints');
      return { ok: `Added ${r.name ?? r.url}. First audit within 5 minutes.` };
    case 'exists':
      return { ok: `${r.url} is already tracked.` };
    case 'alias':
      return { ok: `This mint is already tracked as ${r.existing}.` };
    default:
      return { error: r.error };
  }
}

export async function donateToken(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const raw = String(formData.get('token') ?? '').trim();
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

  const result = await withWalletLock('donate', async (): Promise<FormResult> => {
    try {
      await assertPublicMintUrl(mintUrl);
      const wallet = createWallet(mintUrl);
      await withTimeout(wallet.loadMint());
      const mint = await prisma.mint.upsert({ where: { url: mintUrl }, update: {}, create: { url: mintUrl, source: 'donation' } });
      const proofs = await withTimeout(wallet.receive(raw), 30_000);
      const amount = proofs.reduce((s, p) => s.add(p.amount), Amount.zero()).toNumber();

      for (const p of proofs) {
        await prisma.proof.create({ data: { mintId: mint.id, keysetId: p.id, amount: Amount.from(p.amount).toNumber(), secret: p.secret, C: p.C } });
      }
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
        revalidatePath('/');
        return { ok: `Thank you. Received ${restored.recovered} sat at ${mintUrl} (recovered after an error).` };
      }
      return { error: `Could not redeem token: ${errorMessage(error)}` };
    }
  });

  revalidatePath('/');
  return result ?? { error: 'The auditor wallet is busy with a swap. Try again in a minute.' };
}
