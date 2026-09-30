import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorized } from '@/lib/auth';
import { publish } from '@/lib/events';

const LOCATIONS = new Set(['frankfurt']);

type Result = { id: unknown; ok: unknown; code: unknown; dns: unknown; connect: unknown; tls: unknown; ttfb: unknown; total: unknown; error: unknown };

const sec = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 120 ? v : null);
const ms = (v: number | null) => (v === null ? null : Math.round(v * 1000));
const phase = (a: number | null, b: number | null) => (a !== null && b !== null && a >= b && a > 0 ? Math.round((a - b) * 1000) : null);

export async function POST(request: Request) {
  if (!authorized(request, 'PROBE_SECRET')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const location = new URL(request.url).searchParams.get('location') ?? 'frankfurt';
  if (!LOCATIONS.has(location)) return NextResponse.json({ error: 'Unknown location' }, { status: 400 });

  const body = (await request.json().catch(() => null)) as { results?: Result[] } | null;
  if (!body || !Array.isArray(body.results) || body.results.length > 1000) return NextResponse.json({ error: 'Bad payload' }, { status: 400 });

  const known = new Set((await prisma.mint.findMany({ select: { id: true } })).map(m => m.id));
  const timestamp = new Date();
  let stored = 0;
  for (const r of body.results) {
    if (typeof r?.id !== 'string' || !known.has(r.id)) continue;
    const dns = sec(r.dns), connect = sec(r.connect), tls = sec(r.tls), ttfb = sec(r.ttfb), total = sec(r.total);
    const ok = r.ok === true;
    await prisma.auditLog.create({
      data: {
        mintId: r.id,
        location,
        status: ok ? 'online' : 'offline',
        latency: ms(total) ?? 0,
        httpStatus: typeof r.code === 'number' && r.code > 0 ? r.code : null,
        dnsMs: ms(dns),
        connectMs: phase(connect, dns),
        tlsMs: phase(tls, connect),
        ttfbMs: phase(ttfb, tls),
        error: ok ? null : typeof r.error === 'string' ? r.error.slice(0, 300) : 'Failed',
        timestamp,
      },
    });
    stored++;
  }
  publish('audit', { location, stored });
  return NextResponse.json({ success: true, stored });
}
