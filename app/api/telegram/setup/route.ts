import { NextResponse } from 'next/server';
import { authorized } from '@/lib/auth';
import { SITE_URL } from '@/lib/site';
import { telegramApi } from '@/lib/notify/channels';

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_WEBHOOK_SECRET) return NextResponse.json({ error: 'Telegram is not configured' }, { status: 400 });
  try {
    await telegramApi('setWebhook', { url: `${SITE_URL}/api/telegram/webhook`, secret_token: process.env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message'] });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 502 });
  }
}
