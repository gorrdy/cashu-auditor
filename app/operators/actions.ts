'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { SITE_URL } from '@/lib/site';
import { isMintId } from '@/lib/mintUrl';
import { consumeChallenge, createChallenge, createSession, currentOperator, endSession } from '@/lib/operator/session';
import { toHexPubkey, verifyLoginEvent } from '@/lib/operator/nostr';
import { METHODS, startClaim, verifyClaim, type ClaimMethod } from '@/lib/operator/claims';
import { checkClaimInvoice, createClaimInvoice, payClaimWithToken } from '@/lib/operator/billing';
import { emailEnabled, sendEmail } from '@/lib/notify/email';
import { channelsAvailable } from '@/lib/notify/channels';
import { DEFAULT_PREFS, EVENTS, parsePrefs, sendTest, type EventKey } from '@/lib/notify/events';

type Result = { ok?: string; error?: string };

async function requireOperator() {
  const op = await currentOperator();
  if (!op) throw new Error('Not signed in');
  return op;
}

async function ownClaim(operatorId: string, claimId: string) {
  const claim = await prisma.mintClaim.findUnique({ where: { id: claimId } });
  return claim?.operatorId === operatorId ? claim : null;
}

export async function getNostrChallenge() {
  return createChallenge('nostr-login', {}, 5 * 60_000);
}

export async function loginWithNostr(challenge: string, event: unknown): Promise<Result> {
  if (!(await consumeChallenge(challenge, 'nostr-login'))) return { error: 'The sign-in request expired. Try again.' };
  const pubkey = verifyLoginEvent(event, challenge);
  if (!pubkey) return { error: 'The signature could not be verified.' };
  const operator = await prisma.operator.upsert({ where: { pubkey }, update: {}, create: { pubkey } });
  if (channelsAvailable().nostr) {
    await prisma.notifyChannel.upsert({
      where: { operatorId_kind_target: { operatorId: operator.id, kind: 'nostr', target: pubkey } },
      update: {},
      create: { operatorId: operator.id, kind: 'nostr', target: pubkey, label: 'Your npub' },
    });
  }
  await createSession(operator.id);
  revalidatePath('/operators');
  return { ok: 'Signed in.' };
}

export async function requestEmailLogin(_prev: Result | null, form: FormData): Promise<Result> {
  if (!emailEnabled()) return { error: 'Email sign-in is not available yet.' };
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return { error: 'Enter a valid email address.' };
  const recent = await prisma.loginChallenge.count({ where: { kind: 'email-login', email, createdAt: { gt: new Date(Date.now() - 10 * 60_000) } } });
  if (recent >= 3) return { error: 'Too many requests. Try again in a few minutes.' };
  const token = await createChallenge('email-login', { email }, 30 * 60_000);
  await sendEmail(email, 'Sign in to Cashu Mints Auditor', `Sign in here (valid 30 minutes):\n${SITE_URL}/api/operator/verify-email?token=${token}\n\nIf you did not ask for this, ignore this email.`);
  return { ok: `We sent a sign-in link to ${email}.` };
}

export async function logout() {
  await endSession();
  revalidatePath('/operators');
}

export async function claimMint(mintId: string): Promise<Result> {
  const op = await requireOperator();
  if (!isMintId(mintId)) return { error: 'Choose a mint.' };
  const count = await prisma.mintClaim.count({ where: { operatorId: op.id } });
  if (count >= 20) return { error: 'Too many claims on one account.' };
  const r = await startClaim(op.id, mintId);
  revalidatePath('/operators');
  return r.error ? { error: r.error } : { ok: 'Claim started.' };
}

export async function verifyClaimAction(claimId: string, method: string, email?: string): Promise<Result> {
  const op = await requireOperator();
  if (!METHODS.includes(method as ClaimMethod)) return { error: 'Unknown method' };
  const r = await verifyClaim(op.id, claimId, method as ClaimMethod, email);
  revalidatePath('/operators');
  return r;
}

export async function removeClaim(claimId: string) {
  const op = await requireOperator();
  if (await ownClaim(op.id, claimId)) await prisma.mintClaim.delete({ where: { id: claimId } });
  revalidatePath('/operators');
}

export async function savePrefs(claimId: string, events: Partial<Record<EventKey, boolean>>, offlineMinutes: number): Promise<Result> {
  const op = await requireOperator();
  if (!(await ownClaim(op.id, claimId))) return { error: 'Claim not found' };
  const clean = Object.fromEntries((Object.keys(EVENTS) as EventKey[]).map(k => [k, events[k] ?? DEFAULT_PREFS.events[k]]));
  const prefs = parsePrefs(JSON.stringify({ events: clean, offlineMinutes }));
  await prisma.mintClaim.update({ where: { id: claimId }, data: { prefs: JSON.stringify(prefs) } });
  revalidatePath('/operators');
  return { ok: 'Saved.' };
}

export async function createSubscriptionInvoice(claimId: string, months: number) {
  const op = await requireOperator();
  return createClaimInvoice(op.id, claimId, months);
}

export async function checkSubscriptionInvoice(id: string) {
  const op = await requireOperator();
  const state = await checkClaimInvoice(op.id, id);
  if (state === 'paid') revalidatePath('/operators');
  return state;
}

export async function paySubscriptionWithToken(claimId: string, token: string): Promise<Result> {
  const op = await requireOperator();
  const r = await payClaimWithToken(op.id, claimId, token);
  revalidatePath('/operators');
  return r;
}

export async function addNostrChannel(npub: string): Promise<Result> {
  const op = await requireOperator();
  if (!channelsAvailable().nostr) return { error: 'Nostr messages are not available yet.' };
  const hex = toHexPubkey(npub);
  if (!hex) return { error: 'Enter an npub.' };
  await prisma.notifyChannel.upsert({ where: { operatorId_kind_target: { operatorId: op.id, kind: 'nostr', target: hex } }, update: {}, create: { operatorId: op.id, kind: 'nostr', target: hex } });
  revalidatePath('/operators');
  return { ok: 'Nostr channel added.' };
}

export async function telegramLink(): Promise<Result & { url?: string }> {
  const op = await requireOperator();
  if (!channelsAvailable().telegram) return { error: 'Telegram is not available yet.' };
  const token = await createChallenge('telegram-link', { operatorId: op.id }, 30 * 60_000);
  return { url: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${token}` };
}

export async function savePushSubscription(subscription: string): Promise<Result> {
  const op = await requireOperator();
  if (!channelsAvailable().push) return { error: 'Push is not available yet.' };
  let parsed: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  try {
    parsed = JSON.parse(subscription);
  } catch {
    return { error: 'Invalid subscription' };
  }
  if (typeof parsed.endpoint !== 'string' || !parsed.endpoint.startsWith('https://') || subscription.length > 2000 || typeof parsed.keys?.p256dh !== 'string' || typeof parsed.keys?.auth !== 'string') return { error: 'Invalid subscription' };
  const target = JSON.stringify({ endpoint: parsed.endpoint, keys: { p256dh: parsed.keys.p256dh, auth: parsed.keys.auth } });
  await prisma.notifyChannel.upsert({ where: { operatorId_kind_target: { operatorId: op.id, kind: 'push', target } }, update: {}, create: { operatorId: op.id, kind: 'push', target, label: 'This device' } });
  revalidatePath('/operators');
  return { ok: 'Push notifications are on for this device.' };
}

export async function removeChannel(id: string) {
  const op = await requireOperator();
  await prisma.notifyChannel.deleteMany({ where: { id, operatorId: op.id } });
  revalidatePath('/operators');
}

export async function sendTestNotification() {
  const op = await requireOperator();
  return sendTest(op.id);
}
