import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SITE_URL } from '@/lib/site';
import { consumeChallenge, createSession } from '@/lib/operator/session';

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const back = (status: string) => NextResponse.redirect(`${SITE_URL}/operators?status=${status}`, 303);
  if (!/^[\w-]{20,64}$/.test(token)) return back('invalid-link');

  const login = await consumeChallenge(token, 'email-login');
  if (login?.email) {
    const operator = await prisma.operator.upsert({ where: { email: login.email }, update: {}, create: { email: login.email } });
    await prisma.notifyChannel.upsert({
      where: { operatorId_kind_target: { operatorId: operator.id, kind: 'email', target: login.email } },
      update: {},
      create: { operatorId: operator.id, kind: 'email', target: login.email, label: login.email },
    });
    await createSession(operator.id);
    return back('signed-in');
  }

  return back('invalid-link');
}
