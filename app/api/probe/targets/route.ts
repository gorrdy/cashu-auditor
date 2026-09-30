import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorized } from '@/lib/auth';

export async function GET(request: Request) {
  if (!authorized(request, 'PROBE_SECRET')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const mints = await prisma.mint.findMany({ select: { id: true, url: true } });
  return NextResponse.json({ mints: mints.filter(m => m.url.startsWith('https://') && !/\s/.test(m.url)) });
}
