import { timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { consumeChallenge } from '@/lib/operator/session';
import { telegramApi } from '@/lib/notify/channels';

const ok = () => new Response('ok');

function authorized(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const given = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  return !!secret && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

export async function POST(request: Request) {
  if (!authorized(request)) return new Response('Unauthorized', { status: 401 });
  const update = (await request.json().catch(() => null)) as { message?: { text?: string; chat?: { id?: number; type?: string }; from?: { username?: string } } } | null;
  const message = update?.message;
  const chatId = message?.chat?.id;
  const text = message?.text?.trim() ?? '';
  if (!chatId || message?.chat?.type !== 'private') return ok();

  const start = text.match(/^\/start\s+([\w-]{20,64})$/);
  if (start) {
    const challenge = await consumeChallenge(start[1], 'telegram-link');
    if (!challenge?.operatorId) {
      await telegramApi('sendMessage', { chat_id: chatId, text: 'This link has expired. Open the operator page and connect Telegram again.' }).catch(() => null);
      return ok();
    }
    await prisma.notifyChannel.upsert({
      where: { operatorId_kind_target: { operatorId: challenge.operatorId, kind: 'telegram', target: String(chatId) } },
      update: {},
      create: { operatorId: challenge.operatorId, kind: 'telegram', target: String(chatId), label: message?.from?.username ? `@${message.from.username}` : 'Telegram' },
    });
    await telegramApi('sendMessage', { chat_id: chatId, text: 'Connected. Alerts for your mints will arrive here. Send /stop to disconnect.' }).catch(() => null);
    return ok();
  }
  if (text === '/stop') {
    await prisma.notifyChannel.deleteMany({ where: { kind: 'telegram', target: String(chatId) } });
    await telegramApi('sendMessage', { chat_id: chatId, text: 'Disconnected. You will not get alerts here any more.' }).catch(() => null);
    return ok();
  }
  await telegramApi('sendMessage', { chat_id: chatId, text: 'Connect this chat from the operator page at https://audit.cashu.cz/operators.' }).catch(() => null);
  return ok();
}
