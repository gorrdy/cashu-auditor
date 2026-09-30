import { nip19 } from 'nostr-tools';
import { prisma } from './prisma';
import { RANGES, type RangeKey } from './stats';
import { loadBackoff } from './backoff';

const median = (values: (number | null | undefined)[]) => {
  const v = values.filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
  return v.length ? v[Math.floor((v.length - 1) / 2)] : null;
};

const phases = (rows: { dnsMs: number | null; connectMs: number | null; tlsMs: number | null; ttfbMs: number | null }[]) => ({
  dns: median(rows.map(r => r.dnsMs)),
  connect: median(rows.map(r => r.connectMs)),
  tls: median(rows.map(r => r.tlsMs)),
  ttfb: median(rows.map(r => r.ttfbMs)),
  samples: rows.length,
});

export type CheckSummary = { ok: boolean; ms: number | null; timestamp: number; detail: Record<string, unknown>; recentOk: number; recentFail: number };

export async function getMintExtras(id: string, range: RangeKey, now = Date.now()) {
  const { ms: rangeMs, bucket: bucketMs } = RANGES[range];
  const since = now - rangeMs;

  const [prague, frankfurt, events, checks, reviews, swaps, lost, backoff] = await Promise.all([
    prisma.auditLog.findMany({
      where: { mintId: id, location: 'prague', status: { not: 'offline' }, timestamp: { gte: new Date(since) } },
      select: { dnsMs: true, connectMs: true, tlsMs: true, ttfbMs: true, clockSkewMs: true },
    }),
    prisma.auditLog.findMany({
      where: { mintId: id, location: 'frankfurt', timestamp: { gte: new Date(since) } },
      orderBy: { timestamp: 'asc' },
      select: { timestamp: true, status: true, latency: true, dnsMs: true, connectMs: true, tlsMs: true, ttfbMs: true },
    }),
    prisma.mintEvent.findMany({ where: { mintId: id }, orderBy: { timestamp: 'desc' }, take: 30 }),
    prisma.mintCheck.findMany({ where: { mintId: id, timestamp: { gte: new Date(now - 30 * 86_400_000) } }, orderBy: { timestamp: 'desc' } }),
    prisma.mintReview.findMany({ where: { mintId: id }, orderBy: { createdAt: 'desc' } }),
    prisma.swap.findMany({
      where: { OR: [{ sourceMintId: id }, { destMintId: id }], timestamp: { gte: new Date(since) }, status: 'success', kind: 'swap' },
      select: { sourceMintId: true, destMintId: true, amount: true, fee: true, feeReserve: true, quoteMs: true, meltMs: true, mintMs: true, dleq: true },
    }),
    prisma.proof.aggregate({ where: { mintId: id, state: 'spent_external' }, _sum: { amount: true }, _count: true }),
    loadBackoff(now),
  ]);

  const bucketCount = Math.ceil(rangeMs / bucketMs) + 1;
  const firstBucket = Math.floor(since / bucketMs);
  const buckets: number[][] = Array.from({ length: bucketCount }, () => []);
  for (const a of frankfurt) {
    if (a.status === 'offline') continue;
    const idx = Math.floor(a.timestamp.getTime() / bucketMs) - firstBucket;
    if (idx >= 0 && idx < bucketCount) buckets[idx].push(a.latency);
  }

  const latestChecks: Record<string, CheckSummary> = {};
  for (const c of checks) {
    const entry = latestChecks[c.kind];
    if (!entry) {
      latestChecks[c.kind] = {
        ok: c.ok,
        ms: c.ms,
        timestamp: c.timestamp.getTime(),
        detail: c.detail ? (JSON.parse(c.detail) as Record<string, unknown>) : {},
        recentOk: c.ok ? 1 : 0,
        recentFail: c.ok ? 0 : 1,
      };
    } else if (c.ok) entry.recentOk++;
    else entry.recentFail++;
  }

  const melts = swaps.filter(s => s.sourceMintId === id);
  const mints = swaps.filter(s => s.destMintId === id);
  const meltAmount = melts.reduce((s, x) => s + x.amount, 0);
  const meltFees = melts.reduce((s, x) => s + x.fee, 0);
  const rated = reviews.filter(r => r.rating !== null);
  const fraUp = frankfurt.filter(a => a.status !== 'offline').length;

  return {
    backoff: backoff.map.get(id) ?? null,
    timings: { prague: phases(prague), frankfurt: phases(frankfurt.filter(a => a.status !== 'offline')) },
    clockSkewMs: median(prague.map(r => r.clockSkewMs)),
    frankfurtLatency: buckets.map(v => median(v)),
    frankfurtUptime: frankfurt.length ? (fraUp / frankfurt.length) * 100 : null,
    frankfurtChecks: frankfurt.length,
    events: events.map(e => ({ kind: e.kind, previous: e.previous, value: e.value, timestamp: e.timestamp.getTime() })),
    checks: latestChecks,
    lost: { sat: lost._sum.amount ?? 0, proofs: lost._count },
    swapDetail: {
      melts: melts.length,
      feePct: meltAmount ? (meltFees / meltAmount) * 100 : null,
      avgFee: melts.length ? meltFees / melts.length : null,
      avgFeeReserve: melts.length ? melts.reduce((s, x) => s + (x.feeReserve ?? 0), 0) / melts.length : null,
      quoteMs: median(swaps.map(s => s.quoteMs)),
      meltMs: median(melts.map(s => s.meltMs)),
      mintMs: median(mints.map(s => s.mintMs)),
      dleq: {
        valid: mints.filter(s => s.dleq === 'valid').length,
        invalid: mints.filter(s => s.dleq === 'invalid').length,
        missing: mints.filter(s => s.dleq === 'missing').length,
      },
    },
    reviews: {
      count: reviews.length,
      rated: rated.length,
      average: rated.length ? rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length : null,
      latest: reviews.slice(0, 6).map(r => ({
        id: r.id,
        rating: r.rating,
        content: r.content,
        createdAt: r.createdAt.getTime(),
        author: nip19.npubEncode(r.author),
      })),
    },
  };
}
