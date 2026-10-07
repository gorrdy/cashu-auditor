import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { LNURL_COOKIE } from '@/lib/operator/lnurl';
import { createSession } from '@/lib/operator/session';

const reply = (state: string) => Response.json({ state }, { headers: { 'Cache-Control': 'no-store' } });

export async function GET() {
  const store = await cookies();
  const k1 = store.get(LNURL_COOKIE)?.value ?? '';
  if (!/^[0-9a-f]{64}$/.test(k1)) return reply('expired');
  const challenge = await prisma.loginChallenge.findUnique({ where: { id: k1 } });
  if (!challenge || challenge.kind !== 'lnurl-auth' || challenge.usedAt || challenge.expiresAt.getTime() < Date.now()) return reply('expired');
  if (!challenge.lnKey) return reply('waiting');
  const { count } = await prisma.loginChallenge.updateMany({ where: { id: k1, usedAt: null }, data: { usedAt: new Date() } });
  if (!count) return reply('expired');
  const operator = await prisma.operator.upsert({ where: { lnKey: challenge.lnKey }, update: {}, create: { lnKey: challenge.lnKey } });
  await createSession(operator.id);
  store.delete(LNURL_COOKIE);
  return reply('ok');
}
