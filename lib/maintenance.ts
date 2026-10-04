import { prisma } from './prisma';
import { dayKey, getOverview } from './stats';

const HOUR = 3_600_000;
export const RAW_RETENTION_DAYS = 35;

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

export async function rollupHours(now = Date.now()) {
  const currentHour = Math.floor(now / HOUR) * HOUR;
  const hasRollups = (await prisma.auditHourly.count()) > 0;
  const first = await prisma.auditLog.findFirst({ orderBy: { timestamp: 'asc' }, select: { timestamp: true } });
  if (!first) return { hours: 0 };
  const from = hasRollups ? currentHour - 3 * HOUR : Math.floor(first.timestamp.getTime() / HOUR) * HOUR;

  let hours = 0;
  for (let start = from; start < currentHour; start += HOUR) {
    const rows = await prisma.auditLog.findMany({
      where: { timestamp: { gte: new Date(start), lt: new Date(start + HOUR) } },
      select: { mintId: true, location: true, status: true, latency: true },
    });
    const groups = new Map<string, { mintId: string; location: string; checks: number; up: number; lat: number[] }>();
    for (const r of rows) {
      const key = `${r.mintId}|${r.location}`;
      const g = groups.get(key) ?? { mintId: r.mintId, location: r.location, checks: 0, up: 0, lat: [] };
      g.checks++;
      if (r.status !== 'offline') {
        g.up++;
        g.lat.push(r.latency);
      }
      groups.set(key, g);
    }
    const hour = new Date(start);
    for (const g of groups.values()) {
      g.lat.sort((a, b) => a - b);
      const data = { checks: g.checks, up: g.up, p50: percentile(g.lat, 0.5), p95: percentile(g.lat, 0.95) };
      await prisma.auditHourly.upsert({
        where: { mintId_location_hour: { mintId: g.mintId, location: g.location, hour } },
        update: data,
        create: { mintId: g.mintId, location: g.location, hour, ...data },
      });
    }
    hours++;
  }
  return { hours };
}

export async function pruneRaw(now = Date.now()) {
  const cutoff = new Date(now - RAW_RETENTION_DAYS * 86_400_000);
  const rolled = await prisma.auditHourly.findFirst({ where: { hour: { lt: cutoff } }, select: { hour: true } });
  const oldest = await prisma.auditLog.findFirst({ where: { timestamp: { lt: cutoff } }, select: { timestamp: true } });
  if (oldest && !rolled) return { deleted: 0, skipped: 'old rows not rolled up yet' };
  const { count } = await prisma.auditLog.deleteMany({ where: { timestamp: { lt: cutoff } } });
  await prisma.$executeRawUnsafe('PRAGMA optimize');
  return { deleted: count };
}

export async function snapshotScores(now = Date.now()) {
  const { mints } = await getOverview(now);
  const day = dayKey(now);
  for (const m of mints) {
    const swaps = m.scoreParts.find(p => p.key === 'swaps')?.score ?? null;
    const data = { score: m.score, uptime: m.uptime30d, latency: m.avgLatency24h, swapRate: swaps };
    await prisma.scoreDaily.upsert({ where: { mintId_day: { mintId: m.id, day } }, update: data, create: { mintId: m.id, day, ...data } });
  }
  return { mints: mints.length, day };
}
