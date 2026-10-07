import { prisma } from './prisma';
import { BLAME_SELECT, makeBlame } from './blame';
import { computeScore } from './score';
import { COUNTED_SWAP } from './counted';
import { bus } from './events';
import { latestAudits } from './eligible';
import { newestVersions, versionStatus } from './versions';
import { FEE_BUDGET_PER_DAY, STOP_BELOW } from './budget';
import { DAY, FEE_BUFFER, HOUR, MIN_AGE_MS, MIN_SWAP } from './constants';

export { HOUR, DAY } from './constants';
export const TZ = 'Europe/Prague';

export type MintState = 'ok' | 'warn' | 'error' | 'unknown';

export const RANGES = {
  '24h': { label: '24 hours', ms: DAY, bucket: HOUR / 2 },
  '7d': { label: '7 days', ms: 7 * DAY, bucket: 2 * HOUR },
  '30d': { label: '30 days', ms: 30 * DAY, bucket: 6 * HOUR },
} as const;
export type RangeKey = keyof typeof RANGES;

export function parseRange(value: string | undefined): RangeKey {
  return value && value in RANGES ? (value as RangeKey) : '7d';
}

const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export const dayKey = (t: number) => dayFormatter.format(t);

export function lastDays(n: number, now: number): string[] {
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = dayKey(now - i * DAY);
    if (keys[keys.length - 1] !== k) keys.push(k);
  }
  return keys;
}

function median(values: number[]) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

const pct = (up: number, total: number) => (total > 0 ? (up / total) * 100 : null);

type UptimeRow = { mintId: string; t1: bigint; u1: bigint; lat1: number | null; t7: bigint; u7: bigint; t30: bigint; u30: bigint };
type Uptime = { total: number; up: number; avgLatency: number | null };

async function uptimeWindows(now: number) {
  const rows = await prisma.$queryRaw<UptimeRow[]>`
    SELECT mintId,
           SUM(CASE WHEN timestamp >= ${now - DAY} THEN 1 ELSE 0 END) AS t1,
           SUM(CASE WHEN timestamp >= ${now - DAY} AND status != 'offline' THEN 1 ELSE 0 END) AS u1,
           AVG(CASE WHEN timestamp >= ${now - DAY} AND status != 'offline' THEN latency END) AS lat1,
           SUM(CASE WHEN timestamp >= ${now - 7 * DAY} THEN 1 ELSE 0 END) AS t7,
           SUM(CASE WHEN timestamp >= ${now - 7 * DAY} AND status != 'offline' THEN 1 ELSE 0 END) AS u7,
           COUNT(*) AS t30,
           SUM(CASE WHEN status != 'offline' THEN 1 ELSE 0 END) AS u30
    FROM AuditLog WHERE location = 'prague' AND timestamp >= ${now - 30 * DAY} GROUP BY mintId`;
  const window = (total: bigint, up: bigint, avgLatency: number | null = null): Uptime | undefined =>
    Number(total) ? { total: Number(total), up: Number(up), avgLatency } : undefined;
  return new Map(rows.map(r => [r.mintId, { d1: window(r.t1, r.u1, r.lat1), d7: window(r.t7, r.u7), d30: window(r.t30, r.u30) }]));
}

function stateFor(opts: {
  latestStatus?: string;
  uptime24h: number | null;
  lastSwapFailed: boolean;
  pendingSwaps: number;
}): { state: MintState; reasons: string[] } {
  if (!opts.latestStatus) return { state: 'unknown', reasons: ['Not audited yet'] };
  if (opts.latestStatus === 'offline') return { state: 'error', reasons: ['Offline at last check'] };
  const reasons: string[] = [];
  if (opts.latestStatus === 'degraded') reasons.push('Info responds, keysets do not');
  if (opts.uptime24h !== null && opts.uptime24h < 99) reasons.push(`Uptime ${opts.uptime24h.toFixed(1)} % in 24 h`);
  if (opts.lastSwapFailed) reasons.push('Recent swap failure attributed to this mint');
  if (opts.pendingSwaps > 0) reasons.push(`${opts.pendingSwaps} swap(s) pending`);
  return { state: reasons.length ? 'warn' : 'ok', reasons };
}

export const LONG_OFFLINE_DAYS = 30;

async function onlineHistory() {
  const [raw, hourly] = await Promise.all([
    prisma.$queryRaw<{ mintId: string; lastUp: number | null; first: number }[]>`
      SELECT mintId, MAX(CASE WHEN status != 'offline' THEN timestamp END) AS lastUp, MIN(timestamp) AS first
      FROM AuditLog WHERE location = 'prague' AND timestamp >= ${Date.now() - 2 * DAY} GROUP BY mintId`,
    prisma.$queryRaw<{ mintId: string; lastUp: number | null; first: number }[]>`
      SELECT mintId, MAX(CASE WHEN up > 0 THEN hour END) AS lastUp, MIN(hour) AS first
      FROM AuditHourly WHERE location = 'prague' GROUP BY mintId`,
  ]);
  const out = new Map<string, { lastUp: number | null; first: number }>();
  for (const r of [...raw, ...hourly]) {
    const prev = out.get(r.mintId);
    const lastUp = r.lastUp != null ? Number(r.lastUp) : null;
    out.set(r.mintId, {
      lastUp: prev?.lastUp != null && lastUp != null ? Math.max(prev.lastUp, lastUp) : prev?.lastUp ?? lastUp,
      first: prev ? Math.min(prev.first, Number(r.first)) : Number(r.first),
    });
  }
  return out;
}

const OVERVIEW_TTL_MS = 60_000;
let overviewCache: { at: number; value: ReturnType<typeof computeOverview> } | null = null;
bus.on('event', () => {
  overviewCache = null;
});

export function getOverview(now?: number) {
  if (now !== undefined) return computeOverview(now);
  if (!overviewCache || Date.now() - overviewCache.at > OVERVIEW_TTL_MS) {
    const value = computeOverview(Date.now());
    overviewCache = { at: Date.now(), value };
    value.catch(() => {
      if (overviewCache?.value === value) overviewCache = null;
    });
  }
  return overviewCache.value;
}

async function computeOverview(now: number) {
  const [mints, latest, uptime, strips, balances, donations, swapTotals, allSwaps, mintedBy, meltedBy, reviews, history, swapFees7d, otherFees7d] = await Promise.all([
    prisma.mint.findMany({ select: { id: true, url: true, name: true, version: true, iconHash: true, source: true, inputFeePpk: true, websockets: true, onionUrl: true, units: true, offlineSince: true, aliasOfId: true, isTest: true, addedAt: true } }),
    latestAudits(now),
    uptimeWindows(now),
    prisma.$queryRaw<{ mintId: string; hour: bigint; total: bigint; up: bigint }[]>`
      SELECT mintId, timestamp / 3600000 AS hour, COUNT(*) AS total,
             SUM(CASE WHEN status != 'offline' THEN 1 ELSE 0 END) AS up
      FROM AuditLog WHERE location = 'prague' AND timestamp >= ${now - DAY} GROUP BY mintId, hour`,
    prisma.proof.groupBy({ by: ['mintId', 'state'], _sum: { amount: true } }),
    prisma.donation.groupBy({ by: ['mintId'], _sum: { amount: true } }),
    prisma.swap.groupBy({ by: ['status'], where: COUNTED_SWAP, _count: { _all: true }, _sum: { amount: true, fee: true, duration: true } }),
    prisma.swap.findMany({
      where: { AND: [COUNTED_SWAP, { OR: [{ timestamp: { gte: new Date(now - 30 * DAY) } }, { status: 'pending' }] }] },
      select: { status: true, stage: true, error: true, preimageOk: true, sourceMintId: true, destMintId: true, amount: true, fee: true, duration: true, timestamp: true },
      orderBy: { timestamp: 'desc' },
    }),
    prisma.swap.groupBy({ by: ['destMintId'], where: { status: 'success' }, _count: { _all: true } }),
    prisma.swap.groupBy({ by: ['sourceMintId'], where: { status: 'success' }, _count: { _all: true } }),
    prisma.mintReview.groupBy({ by: ['mintId'], where: { rating: { not: null } }, _avg: { rating: true }, _count: { rating: true } }),
    onlineHistory(),
    prisma.swap.aggregate({ where: { kind: 'swap', status: 'success', timestamp: { gte: new Date(now - 7 * DAY) } }, _avg: { fee: true } }),
    prisma.swap.aggregate({ where: { kind: { not: 'swap' }, timestamp: { gte: new Date(now - 7 * DAY) } }, _sum: { fee: true } }),
  ]);

  const reviewBy = new Map(reviews.map(r => [r.mintId, { avg: r._avg.rating, count: r._count.rating }]));
  const month = new Map<string, { ok: number; blamed: number }>();
  const monthOf = (id: string) => {
    let m = month.get(id);
    if (!m) month.set(id, (m = { ok: 0, blamed: 0 }));
    return m;
  };

  const latestBy = new Map(latest.map(l => [l.mintId, l]));
  const donatedBy = new Map(donations.map(d => [d.mintId, d._sum.amount ?? 0]));
  const balanceBy = new Map<string, { unspent: number; reserved: number }>();
  for (const b of balances) {
    const entry = balanceBy.get(b.mintId) ?? { unspent: 0, reserved: 0 };
    if (b.state === 'unspent') entry.unspent += b._sum.amount ?? 0;
    else entry.reserved += b._sum.amount ?? 0;
    balanceBy.set(b.mintId, entry);
  }

  const currentHour = Math.floor(now / HOUR);
  const stripBy = new Map<string, (number | null)[]>();
  for (const s of strips) {
    const idx = 23 - (currentHour - Number(s.hour));
    if (idx < 0 || idx > 23) continue;
    const arr = stripBy.get(s.mintId) ?? Array<number | null>(24).fill(null);
    arr[idx] = pct(Number(s.up), Number(s.total));
    stripBy.set(s.mintId, arr);
  }

  const mintedCount = new Map(mintedBy.map(r => [r.destMintId, r._count._all]));
  const meltedCount = new Map(meltedBy.map(r => [r.sourceMintId, r._count._all]));
  const payoutDurations = new Map<string, number[]>();
  const blame = makeBlame(allSwaps, now);
  const swapCounts = new Map<string, { mints: number; melts: number; errors: number; pending: number; lastOkAt: number; lastBlamedAt: number }>();
  const counts = (id: string) => {
    let c = swapCounts.get(id);
    if (!c) swapCounts.set(id, (c = { mints: 0, melts: 0, errors: 0, pending: 0, lastOkAt: 0, lastBlamedAt: 0 }));
    return c;
  };
  for (const s of allSwaps) {
    const t = s.timestamp.getTime();
    const inMonth = now - t < 30 * DAY;
    if (s.status === 'success') {
      if (inMonth) {
        const list = payoutDurations.get(s.sourceMintId);
        if (list) list.push(s.duration);
        else payoutDurations.set(s.sourceMintId, [s.duration]);
        monthOf(s.sourceMintId).ok++;
        monthOf(s.destMintId).ok++;
      }
      for (const id of [s.sourceMintId, s.destMintId]) counts(id).lastOkAt = Math.max(counts(id).lastOkAt, t);
      continue;
    }
    const blamed = blame(s);
    if (!blamed) continue;
    const c = counts(blamed);
    if (s.status === 'pending') c.pending++;
    else {
      c.errors++;
      if (inMonth) monthOf(blamed).blamed++;
    }
    c.lastBlamedAt = Math.max(c.lastBlamedAt, t);
  }

  const rows = mints.map(m => {
    const l = latestBy.get(m.id);
    const u = uptime.get(m.id), u24 = u?.d1, u7 = u?.d7, u30 = u?.d30;
    const uptime24h = u24 ? pct(u24.up, u24.total) : null;
    const c = swapCounts.get(m.id) ?? { mints: 0, melts: 0, errors: 0, pending: 0, lastOkAt: 0, lastBlamedAt: 0 };
    c.mints = mintedCount.get(m.id) ?? 0;
    c.melts = meltedCount.get(m.id) ?? 0;
    const recentFailure = now - c.lastBlamedAt < DAY && c.lastBlamedAt > c.lastOkAt;
    const mo = month.get(m.id) ?? { ok: 0, blamed: 0 };
    const rv = reviewBy.get(m.id);
    const uptime30d = u30 ? pct(u30.up, u30.total) : null;
    const { score, parts: scoreParts } = computeScore({
      uptime30d,
      swapOk: mo.ok,
      swapBlamed: mo.blamed,
      latencyMs: u24?.avgLatency ?? null,
      reviewAvg: rv?.avg ?? null,
      reviewCount: rv?.count ?? 0,
    });
    const bal = balanceBy.get(m.id) ?? { unspent: 0, reserved: 0 };
    const h = history.get(m.id);
    const measured = l?.status === 'offline' && h ? (h.lastUp ?? h.first) : null;
    const offlineSince = l?.status === 'offline' ? Math.min(measured ?? Infinity, m.offlineSince?.getTime() ?? Infinity) : null;
    return {
      ...m,
      offlineSince: offlineSince === Infinity ? null : offlineSince,
      lastOnlineAt: h?.lastUp ?? null,
      isNew: now - m.addedAt.getTime() < 7 * DAY,
      longOffline: offlineSince != null && offlineSince !== Infinity && now - offlineSince > LONG_OFFLINE_DAYS * DAY,
      latestStatus: l?.status,
      latestLatency: l && l.status !== 'offline' ? l.latency : null,
      latestError: l?.error ?? null,
      checkedAt: l ? Number(l.timestamp) : null,
      uptime24h,
      uptime7d: u7 ? pct(u7.up, u7.total) : null,
      uptime30d,
      score,
      scoreParts,
      units: m.units ? (JSON.parse(m.units) as string[]) : [],
      avgLatency24h: u24?.avgLatency ? Math.round(u24.avgLatency) : null,
      payoutMs: median(payoutDurations.get(m.id) ?? []),
      strip: stripBy.get(m.id) ?? Array<number | null>(24).fill(null),
      balance: bal.unspent,
      reserved: bal.reserved,
      donated: donatedBy.get(m.id) ?? 0,
      ...c,
      ...stateFor({ latestStatus: l?.status, uptime24h, lastSwapFailed: recentFailure, pendingSwaps: c.pending }),
    };
  });

  const byStatus = (status: string) => swapTotals.find(t => t.status === status);
  const total = swapTotals.reduce((n, t) => n + t._count._all, 0);
  const pending = byStatus('pending')?._count._all ?? 0;
  const ok = byStatus('success');
  const okCount = ok?._count._all ?? 0;
  const days = lastDays(30, now);
  const perDay = new Map(days.map(d => [d, { success: 0, failed: 0, pending: 0 }]));
  for (const s of allSwaps) {
    const bucket = perDay.get(dayKey(s.timestamp.getTime()));
    if (bucket) bucket[s.status as 'success' | 'failed' | 'pending']++;
  }

  const newest = newestVersions(rows.filter(r => !r.aliasOfId && !r.longOffline).map(r => r.version));
  const aliasRows = rows.filter(r => r.aliasOfId);
  const primaries = rows
    .filter(r => !r.aliasOfId)
    .map(r => ({
      ...r,
      versionStatus: versionStatus(r.version, newest),
      aliases: aliasRows
        .filter(a => a.aliasOfId === r.id)
        .map(a => ({ id: a.id, url: a.url, name: a.name, latestStatus: a.latestStatus, latency: a.latestLatency, uptime24h: a.uptime24h })),
    }));

  const balance = primaries.filter(r => !r.isTest).reduce((s, r) => s + r.balance, 0);
  const online = primaries.filter(r => r.latestStatus === 'online');
  const senders = online.filter(r => r.balance >= MIN_SWAP + FEE_BUFFER).length;
  const receivers = online.filter(r => !r.isTest && now - r.addedAt.getTime() >= MIN_AGE_MS).length;
  const feePerSwap = swapFees7d._avg.fee ?? 0;
  const feesPerDay = Math.min(FEE_BUDGET_PER_DAY, feePerSwap * Math.max(senders, receivers) + (otherFees7d._sum.fee ?? 0) / 7);

  return {
    now,
    mints: primaries,
    totals: {
      balance,
      feesPerDay: Math.round(feesPerDay),
      runwayDays: feesPerDay > 0 ? Math.max(0, balance - STOP_BELOW) / feesPerDay : null,
      reserved: primaries.reduce((s, r) => s + r.reserved, 0),
      donated: primaries.reduce((s, r) => s + r.donated, 0),
      online: primaries.filter(r => r.latestStatus && r.latestStatus !== 'offline').length,
      audited: primaries.filter(r => r.latestStatus).length,
      tracked: primaries.length,
      swaps: total,
      swaps24h: allSwaps.filter(s => now - s.timestamp.getTime() < DAY).length,
      pending,
      successRate: total - pending ? (okCount / (total - pending)) * 100 : null,
      swapped: ok?._sum.amount ?? 0,
      fees: ok?._sum.fee ?? 0,
      avgSwapMs: okCount ? Math.round((ok?._sum.duration ?? 0) / okCount) : null,
      lastCheck: latest.length ? Math.max(...latest.map(l => Number(l.timestamp))) : null,
    },
    swapsPerDay: days.map(d => ({ day: d, ...perDay.get(d)! })),
  };
}

export async function getRecentSwaps(opts: { mintId?: string; take?: number } = {}) {
  return prisma.swap.findMany({
    where: opts.mintId ? { AND: [{ OR: [{ sourceMintId: opts.mintId }, { destMintId: opts.mintId }] }, COUNTED_SWAP] } : COUNTED_SWAP,
    orderBy: { timestamp: 'desc' },
    take: opts.take ?? 25,
    include: {
      sourceMint: { select: { id: true, name: true, url: true } },
      destMint: { select: { id: true, name: true, url: true } },
    },
  });
}

export type Incident = { start: number; end: number | null; checks: number; error: string | null };

export async function getMintDetail(id: string, range: RangeKey, now = Date.now()) {
  const mint = await prisma.mint.findUnique({ where: { id }, omit: { iconData: true } });
  if (!mint) return null;

  const since90 = now - 90 * DAY;
  const { ms: rangeMs, bucket: bucketMs } = RANGES[range];
  const since = now - rangeMs;

  const [audits, swaps, balance, donated, evidence, hourly] = await Promise.all([
    prisma.auditLog.findMany({
      where: { mintId: id, location: 'prague', timestamp: { gte: new Date(now - 31 * DAY) } },
      orderBy: { timestamp: 'asc' },
      select: { timestamp: true, status: true, latency: true, keysetsMs: true, error: true, version: true },
    }),
    prisma.swap.findMany({
      where: { AND: [{ OR: [{ sourceMintId: id }, { destMintId: id }] }, COUNTED_SWAP] },
      select: { status: true, stage: true, error: true, preimageOk: true, sourceMintId: true, destMintId: true, amount: true, fee: true, duration: true, timestamp: true },
    }),
    prisma.proof.groupBy({ by: ['state'], where: { mintId: id }, _sum: { amount: true } }),
    prisma.donation.aggregate({ where: { mintId: id }, _sum: { amount: true } }),
    prisma.swap.findMany({
      where: { timestamp: { gte: new Date(now - 7 * DAY) }, ...COUNTED_SWAP },
      select: BLAME_SELECT,
    }),
    prisma.auditHourly.findMany({
      where: { mintId: id, location: 'prague', hour: { gte: new Date(since90) } },
      select: { hour: true, checks: true, up: true },
    }),
  ]);
  const rolledUntil = hourly.reduce((m, h) => Math.max(m, h.hour.getTime() + HOUR), 0);
  const blame = makeBlame(evidence, now);

  const days = lastDays(90, now);
  const dayMap = new Map(days.map(d => [d, { total: 0, up: 0 }]));
  const windows = { '24h': { total: 0, up: 0 }, '7d': { total: 0, up: 0 }, '30d': { total: 0, up: 0 }, '90d': { total: 0, up: 0 } };
  const windowMs = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY, '90d': 90 * DAY };
  const incidents: Incident[] = [];
  const versions: { version: string; since: number }[] = [];
  let open: Incident | null = null;

  const bucketCount = Math.ceil(rangeMs / bucketMs) + 1;
  const firstBucket = Math.floor(since / bucketMs);
  const latencyBuckets: number[][] = Array.from({ length: bucketCount }, () => []);
  const keysetBuckets: number[][] = Array.from({ length: bucketCount }, () => []);
  const rangeLatencies: number[] = [];

  for (const a of audits) {
    const t = a.timestamp.getTime();
    const isUp = a.status !== 'offline';
    if (t >= rolledUntil) {
      const d = dayMap.get(dayKey(t));
      if (d) { d.total++; if (isUp) d.up++; }
      if (now - t <= windowMs['90d']) { windows['90d'].total++; if (isUp) windows['90d'].up++; }
    }
    for (const k of ['24h', '7d', '30d'] as const) {
      if (now - t <= windowMs[k]) { windows[k].total++; if (isUp) windows[k].up++; }
    }
    if (!isUp) {
      if (!open) open = { start: t, end: null, checks: 0, error: a.error };
      open.checks++;
    } else if (open) {
      open.end = t;
      incidents.push(open);
      open = null;
    }
    if (a.version && versions[versions.length - 1]?.version !== a.version) versions.push({ version: a.version, since: t });
    if (t >= since && isUp) {
      const idx = Math.floor(t / bucketMs) - firstBucket;
      if (idx >= 0 && idx < bucketCount) {
        latencyBuckets[idx].push(a.latency);
        if (a.keysetsMs != null) keysetBuckets[idx].push(a.keysetsMs);
      }
      rangeLatencies.push(a.latency);
    }
  }
  if (open) incidents.push(open);
  for (const h of hourly) {
    const d = dayMap.get(dayKey(h.hour.getTime()));
    if (d) { d.total += h.checks; d.up += h.up; }
    windows['90d'].total += h.checks;
    windows['90d'].up += h.up;
  }

  const latency = latencyBuckets.map((vals, i) => {
    const sorted = [...vals].sort((a, b) => a - b);
    return { t: (firstBucket + i) * bucketMs, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), n: vals.length };
  });
  rangeLatencies.sort((a, b) => a - b);

  const swapBuckets = range === '24h' ? HOUR : DAY;
  const swapKeys: { key: string; t: number }[] = [];
  if (range === '24h') {
    const h0 = Math.floor(now / HOUR) - 23;
    for (let h = 0; h < 24; h++) swapKeys.push({ key: String(h0 + h), t: (h0 + h) * HOUR });
  } else {
    for (const d of lastDays(rangeMs / DAY, now)) swapKeys.push({ key: d, t: Date.parse(d + 'T12:00:00Z') });
  }
  const swapMap = new Map(swapKeys.map(k => [k.key, { t: k.t, success: 0, failed: 0, pending: 0 }]));
  const inRange = swaps.filter(s => s.timestamp.getTime() >= since);
  for (const s of inRange) {
    const t = s.timestamp.getTime();
    const key = swapBuckets === HOUR ? String(Math.floor(t / HOUR)) : dayKey(t);
    const b = swapMap.get(key);
    if (b) b[s.status as 'success' | 'failed' | 'pending']++;
  }

  const summarize = (list: typeof swaps) => {
    const done = list.filter(s => s.status !== 'pending');
    const ok = done.filter(s => s.status === 'success');
    return {
      total: list.length,
      success: ok.length,
      failed: done.length - ok.length,
      successRate: done.length ? (ok.length / done.length) * 100 : null,
      amount: ok.reduce((s, x) => s + x.amount, 0),
      fees: ok.reduce((s, x) => s + x.fee, 0),
      avgMs: ok.length ? Math.round(ok.reduce((s, x) => s + x.duration, 0) / ok.length) : null,
    };
  };

  const errorsBlamed = inRange.filter(s => s.status === 'failed' && blame(s) === id).length;
  let lastOkAt = 0, lastBlamedAt = 0;
  const month = { ok: 0, blamed: 0 };
  for (const s of swaps) {
    const t = s.timestamp.getTime();
    if (now - t < 30 * DAY) {
      if (s.status === 'success') month.ok++;
      else if (s.status === 'failed' && blame(s) === id) month.blamed++;
    }
    if (s.status === 'success') lastOkAt = Math.max(lastOkAt, t);
    else if (blame(s) === id) lastBlamedAt = Math.max(lastBlamedAt, t);
  }
  const lastAudit = audits[audits.length - 1];
  const uptime24h = pct(windows['24h'].up, windows['24h'].total);

  return {
    now,
    mint: { ...mint, nuts: mint.nuts ? (JSON.parse(mint.nuts) as string[]) : [] },
    ...stateFor({
      latestStatus: lastAudit?.status,
      uptime24h,
      lastSwapFailed: now - lastBlamedAt < DAY && lastBlamedAt > lastOkAt,
      pendingSwaps: swaps.filter(s => s.status === 'pending' && blame(s) === id).length,
    }),
    lastAudit: lastAudit ? { ...lastAudit, timestamp: lastAudit.timestamp.getTime() } : null,
    uptime: Object.fromEntries(
      Object.entries(windows).map(([k, v]) => [k, pct(v.up, v.total)])
    ) as Record<keyof typeof windows, number | null>,
    days: days.map(d => ({ day: d, uptime: pct(dayMap.get(d)!.up, dayMap.get(d)!.total), checks: dayMap.get(d)!.total })),
    latency,
    keysetLatency: keysetBuckets.map(v => (v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null)),
    latencyStats: {
      p50: percentile(rangeLatencies, 0.5),
      p95: percentile(rangeLatencies, 0.95),
      max: rangeLatencies.length ? rangeLatencies[rangeLatencies.length - 1] : null,
      samples: rangeLatencies.length,
    },
    incidents: incidents.filter(i => (i.end ?? now) >= since).reverse(),
    versions: versions.reverse(),
    swapsPerBucket: [...swapMap.values()],
    swapBucket: swapBuckets,
    swapStats: {
      all: summarize(inRange),
      asSource: summarize(inRange.filter(s => s.sourceMintId === id)),
      asDest: summarize(inRange.filter(s => s.destMintId === id)),
      errorsBlamed,
    },
    balance: balance.find(b => b.state === 'unspent')?._sum.amount ?? 0,
    reserved: balance.find(b => b.state === 'reserved')?._sum.amount ?? 0,
    donated: donated._sum.amount ?? 0,
    firstAuditAt: audits[0]?.timestamp.getTime() ?? null,
    scoreInput: {
      uptime30d: pct(windows['30d'].up, windows['30d'].total),
      swapOk: month.ok,
      swapBlamed: month.blamed,
      latencyMs: (() => {
        const v = audits.filter(a => a.status !== 'offline' && now - a.timestamp.getTime() < DAY).map(a => a.latency);
        return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
      })(),
    },
  };
}

export type GraphEdge = { source: string; dest: string; paid: number; failed: number; pending: number; amount: number; avgMs: number | null };

export async function getSwapGraph(days = 30, now = Date.now()) {
  const rows = await prisma.swap.groupBy({
    by: ['sourceMintId', 'destMintId', 'status'],
    where: { timestamp: { gte: new Date(now - days * DAY) }, kind: 'swap', ...COUNTED_SWAP },
    _count: { _all: true },
    _sum: { amount: true },
    _avg: { duration: true },
  });
  const edges = new Map<string, GraphEdge>();
  for (const r of rows) {
    const key = `${r.sourceMintId}>${r.destMintId}`;
    const e = edges.get(key) ?? { source: r.sourceMintId, dest: r.destMintId, paid: 0, failed: 0, pending: 0, amount: 0, avgMs: null };
    if (r.status === 'success') {
      e.paid += r._count._all;
      e.amount += r._sum.amount ?? 0;
      e.avgMs = r._avg.duration != null ? Math.round(r._avg.duration) : null;
    } else if (r.status === 'failed') e.failed += r._count._all;
    else e.pending += r._count._all;
    edges.set(key, e);
  }
  return [...edges.values()];
}
