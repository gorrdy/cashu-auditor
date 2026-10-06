import webpush from 'web-push';
import { SimplePool } from 'nostr-tools/pool';
import { getPublicKey } from 'nostr-tools/pure';
import { wrapEvent } from 'nostr-tools/nip17';
import { prisma } from '../prisma';
import { emailEnabled, sendEmail } from './email';

export type Message = { title: string; body: string; url: string };
export type ChannelKind = 'nostr' | 'telegram' | 'push' | 'email';

const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.0xchat.com'];

const nostrKey = () => {
  const hex = process.env.NOSTR_SECRET_KEY;
  return hex && /^[0-9a-f]{64}$/i.test(hex) ? Uint8Array.from(Buffer.from(hex, 'hex')) : null;
};

export const channelsAvailable = () => ({
  nostr: !!nostrKey(),
  telegram: !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_BOT_USERNAME,
  push: !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY,
  email: emailEnabled(),
});

export const auditorNpubHex = () => {
  const key = nostrKey();
  return key ? getPublicKey(key) : null;
};

let pool: SimplePool | null = null;

async function sendNostr(pubkey: string, m: Message) {
  const key = nostrKey();
  if (!key) throw new Error('Nostr is not configured');
  pool ??= new SimplePool();
  const list = await pool.querySync(DEFAULT_RELAYS, { kinds: [10050], authors: [pubkey], limit: 1 }, { maxWait: 4000 }).catch(() => []);
  const own = (list[0]?.tags ?? []).filter(t => t[0] === 'relay' && /^wss:\/\//.test(t[1] ?? '')).map(t => t[1]).slice(0, 5);
  const relays = own.length ? own : DEFAULT_RELAYS;
  const event = wrapEvent(key, { publicKey: pubkey }, `${m.title}\n\n${m.body}\n\n${m.url}`);
  const results = await Promise.allSettled(pool.publish(relays, event));
  if (!results.some(r => r.status === 'fulfilled')) throw new Error('No relay accepted the message');
}

export async function telegramApi(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (!data?.ok) throw new Error(`Telegram: ${data?.description ?? res.status}`);
  return data;
}

async function sendTelegram(chatId: string, m: Message) {
  await telegramApi('sendMessage', { chat_id: chatId, text: `${m.title}\n\n${m.body}\n${m.url}`, disable_web_page_preview: true });
}

let vapidReady = false;

async function sendPush(subscription: string, m: Message) {
  if (!vapidReady) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'https://audit.cashu.cz', process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
    vapidReady = true;
  }
  await webpush.sendNotification(JSON.parse(subscription), JSON.stringify(m), { TTL: 24 * 3600 });
}

export async function sendToChannel(channel: { id: string; kind: string; target: string }, m: Message) {
  try {
    if (channel.kind === 'nostr') await sendNostr(channel.target, m);
    else if (channel.kind === 'telegram') await sendTelegram(channel.target, m);
    else if (channel.kind === 'push') await sendPush(channel.target, m);
    else if (channel.kind === 'email') await sendEmail(channel.target, m.title, `${m.body}\n\n${m.url}`);
    else throw new Error('Unknown channel');
    return { ok: true as const };
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (channel.kind === 'push' && (status === 404 || status === 410)) await prisma.notifyChannel.delete({ where: { id: channel.id } }).catch(() => null);
    return { ok: false as const, error: error instanceof Error ? error.message.slice(0, 200) : 'Send failed' };
  }
}
