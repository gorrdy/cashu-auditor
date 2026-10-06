import { prisma } from './prisma';
import { makeBlame } from './blame';
import { computeScore } from './score';
import { COUNTED_SWAP } from './counted';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
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

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

const pct = (up: number, total: number) => (total > 0 ? (up / total) * 100 : null);

type UptimeRow = { mintId: string; total: bigint; up: bigint; avgLatency: number | null };

async function uptimeSince(since: number) {
  const rows = await prisma.$queryRaw<UptimeRow[]>`
    SELECT mintId, COUNT(*) AS total,
           SUM(CASE WHEN status != 'offline' THEN 1 ELSE 0 END) AS up,
           AVG(CASE WHEN status != 'offline' THEN latency END) AS avgLatency
    FROM AuditLog WHERE location = 'prague' AND timestamp >= ${since} GROUP BY mintId`;
  return new Map(rows.map(r => [r.mintId, { total: Number(r.total), up: Number(r.up), avgLatency: r.avgLatency }]));
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
      FROM AuditLog WHERE location = 'prague' GROUP BY mintId`,
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

export async function getOverview(now = Date.now()) {
  const [mints, latest, up24, up7, up30, strips, balances, donations, swaps30, allSwaps, reviews, history] = await Promise.all([
    prisma.mint.findMany({ select: { id: true, url: true, name: true, version: true, iconHash: true, source: true, inputFeePpk: true, websockets: true, onionUrl: true, units: true, offlineSince: true, aliasOfId: true, isTest: true } }),
    prisma.$queryRaw<{ mintId: string; status: string; latency: number; timestamp: number; error: string | null }[]>`
      SELECT a.mintId, a.status, a.latency, a.timestamp, a.error FROM AuditLog a
      JOIN (SELECT mintId, MAX(timestamp) ts FROM AuditLog WHERE location = 'prague' GROUP BY mintId) l
        ON l.mintId = a.mintId AND l.ts = a.timestamp AND a.location = 'prague'`,
    uptimeSince(now - DAY),
    uptimeSince(now - 7 * DAY),
    uptimeSince(now - 30 * DAY),
    prisma.$queryRaw<{ mintId: string; hour: bigint; total: bigint; up: bigint }[]>`
      SELECT mintId, timestamp / 3600000 AS hour, COUNT(*) AS total,
             SUM(CASE WHEN status != 'offline' THEN 1 ELSE 0 END) AS up
      FROM AuditLog WHERE location = 'prague' AND timestamp >= ${now - DAY} GROUP BY mintId, hour`,
    prisma.proof.groupBy({ by: ['mintId', 'state'], _sum: { amount: true } }),
    prisma.donation.groupBy({ by: ['mintId'], _sum: { amount: true } }),
    prisma.swap.findMany({
      where: { timestamp: { gte: new Date(now - 30 * DAY) }, ...COUNTED_SWAP },
      select: { status: true, timestamp: true, amount: true },
    }),
    prisma.swap.findMany({
      where: COUNTED_SWAP,
      select: { status: true, stage: true, error: true, preimageOk: true, sourceMintId: true, destMintId: true, amount: true, fee: true, duration: true, timestamp: true },
      orderBy: { timestamp: 'desc' },
    }),
    prisma.mintReview.groupBy({ by: ['mintId'], where: { rating: { not: null } }, _avg: { rating: true }, _count: { rating: true } }),
    onlineHistory(),
  ]);

  const reviewBy = new Map(reviews.map(r => [r.mintId, { avg: r._avg.rating, count: r._count.rating }]));
  const month = new Map<string, { ok: number; blamed: number; meltAmount: number; meltFee: number }>();
  const monthOf = (id: string) => {
    let m = month.get(id);
    if (!m) month.set(id, (m = { ok: 0, blamed: 0, meltAmount: 0, meltFee: 0 }));
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
      counts(s.destMintId).mints++;
      counts(s.sourceMintId).melts++;
      if (inMonth) {
        monthOf(s.sourceMintId).ok++;
        monthOf(s.destMintId).ok++;
        monthOf(s.sourceMintId).meltAmount += s.amount;
        monthOf(s.sourceMintId).meltFee += s.fee;
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
    const u24 = up24.get(m.id), u7 = up7.get(m.id), u30 = up30.get(m.id);
    const uptime24h = u24 ? pct(u24.up, u24.total) : null;
    const c = swapCounts.get(m.id) ?? { mints: 0, melts: 0, errors: 0, pending: 0, lastOkAt: 0, lastBlamedAt: 0 };
    const recentFailure = now - c.lastBlamedAt < DAY && c.lastBlamedAt > c.lastOkAt;
    const mo = month.get(m.id) ?? { ok: 0, blamed: 0, meltAmount: 0, meltFee: 0 };
    const rv = reviewBy.get(m.id);
    const uptime30d = u30 ? pct(u30.up, u30.total) : null;
    const { score, parts: scoreParts } = computeScore({
      uptime30d,
      swapOk: mo.ok,
      swapBlamed: mo.blamed,
      latencyMs: u24?.avgLatency ?? null,
      feePct: mo.meltAmount ? (mo.meltFee / mo.meltAmount) * 100 : null,
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
      strip: stripBy.get(m.id) ?? Array<number | null>(24).fill(null),
      balance: bal.unspent,
      reserved: bal.reserved,
      donated: donatedBy.get(m.id) ?? 0,
      ...c,
      ...stateFor({ latestStatus: l?.status, uptime24h, lastSwapFailed: recentFailure, pendingSwaps: c.pending }),
    };
  });

  const done = allSwaps.filter(s => s.status !== 'pending');
  const ok = done.filter(s => s.status === 'success');
  const days = lastDays(30, now);
  const perDay = new Map(days.map(d => [d, { success: 0, failed: 0, pending: 0 }]));
  for (const s of swaps30) {
    const bucket = perDay.get(dayKey(s.timestamp.getTime()));
    if (bucket) bucket[s.status as 'success' | 'failed' | 'pending']++;
  }

  const aliasRows = rows.filter(r => r.aliasOfId);
  const primaries = rows
    .filter(r => !r.aliasOfId)
    .map(r => ({
      ...r,
      aliases: aliasRows
        .filter(a => a.aliasOfId === r.id)
        .map(a => ({ id: a.id, url: a.url, name: a.name, latestStatus: a.latestStatus, latency: a.latestLatency, uptime24h: a.uptime24h })),
    }));

  return {
    now,
    mints: primaries,
    totals: {
      balance: primaries.filter(r => !r.isTest).reduce((s, r) => s + r.balance, 0),
      reserved: primaries.reduce((s, r) => s + r.reserved, 0),
      donated: primaries.reduce((s, r) => s + r.donated, 0),
      online: primaries.filter(r => r.latestStatus && r.latestStatus !== 'offline').length,
      audited: primaries.filter(r => r.latestStatus).length,
      tracked: primaries.length,
      swaps: allSwaps.length,
      swaps24h: allSwaps.filter(s => now - s.timestamp.getTime() < DAY).length,
      pending: allSwaps.length - done.length,
      successRate: done.length ? (ok.length / done.length) * 100 : null,
      swapped: ok.reduce((s, x) => s + x.amount, 0),
      fees: ok.reduce((s, x) => s + x.fee, 0),
      avgSwapMs: ok.length ? Math.round(ok.reduce((s, x) => s + x.duration, 0) / ok.length) : null,
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
      select: { status: true, stage: true, error: true, preimageOk: true, sourceMintId: true, destMintId: true, timestamp: true },
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
  const month = { ok: 0, blamed: 0, meltAmount: 0, meltFee: 0 };
  for (const s of swaps) {
    const t = s.timestamp.getTime();
    if (now - t < 30 * DAY) {
      if (s.status === 'success') {
        month.ok++;
        if (s.sourceMintId === id) { month.meltAmount += s.amount; month.meltFee += s.fee; }
      } else if (s.status === 'failed' && blame(s) === id) month.blamed++;
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
      feePct: month.meltAmount ? (month.meltFee / month.meltAmount) * 100 : null,
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
