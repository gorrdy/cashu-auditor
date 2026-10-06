'use server';

import { revalidatePath } from 'next/cache';
import { publish } from '@/lib/events';
import { trackMint } from '@/lib/track';
import { createDonationInvoice, redeemToken } from '@/lib/donate';

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
  const result = await redeemToken(String(formData.get('token') ?? '').trim());
  if (result.ok) revalidatePath('/');
  return result;
}

export async function createInvoice(amount: number) {
  return createDonationInvoice(Math.round(Number(amount)));
}
