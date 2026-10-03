import { NextResponse } from 'next/server';
import { authorized } from '@/lib/auth';
import { mapLimit } from '@/lib/probe';
import { trackMint } from '@/lib/track';
import { publish } from '@/lib/events';

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { urls?: unknown; source?: unknown } | null;
  const urls = Array.isArray(body?.urls) ? body.urls.filter((u): u is string => typeof u === 'string').slice(0, 200) : [];
  const source = typeof body?.source === 'string' ? body.source.slice(0, 40) : 'import';
  if (!urls.length) return NextResponse.json({ error: 'No urls' }, { status: 400 });
  const results = await mapLimit(urls, 4, u => trackMint(u, source));
  if (results.some(r => r.status === 'added')) publish('mints');
  return NextResponse.json({ results });
}
