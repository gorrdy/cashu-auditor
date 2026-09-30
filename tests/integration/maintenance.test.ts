import { beforeAll, describe, expect, inject, it } from 'vitest';

const HOUR = 3_600_000;

describe('hourly rollups and raw retention', () => {
  let prisma: typeof import('@/lib/prisma').prisma;
  let rollupHours: typeof import('@/lib/maintenance').rollupHours;
  let pruneRaw: typeof import('@/lib/maintenance').pruneRaw;
  let mintId: string;
  const now = Date.now();
  const base = Math.floor(now / HOUR) * HOUR - 40 * 24 * HOUR;

  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl');
    ({ prisma } = await import('@/lib/prisma'));
    ({ rollupHours, pruneRaw } = await import('@/lib/maintenance'));
    await prisma.auditHourly.deleteMany();
    mintId = (await prisma.mint.create({ data: { url: 'https://rollup.example' } })).id;
    const rows = [];
    for (let i = 0; i < 12; i++) rows.push({ mintId, location: 'prague', status: i === 0 ? 'offline' : 'online', latency: 100 + i * 10, timestamp: new Date(base + i * 5 * 60_000) });
    rows.push({ mintId, location: 'frankfurt', status: 'online', latency: 300, timestamp: new Date(base + 60_000) });
    rows.push({ mintId, location: 'prague', status: 'online', latency: 50, timestamp: new Date(now - HOUR) });
    await prisma.auditLog.createMany({ data: rows });
  });

  it('rolls raw checks into hourly buckets per location', async () => {
    await rollupHours(now);
    const prague = await prisma.auditHourly.findUniqueOrThrow({ where: { mintId_location_hour: { mintId, location: 'prague', hour: new Date(base) } } });
    expect(prague).toMatchObject({ checks: 12, up: 11, p50: 160, p95: 210 });
    const fra = await prisma.auditHourly.findUniqueOrThrow({ where: { mintId_location_hour: { mintId, location: 'frankfurt', hour: new Date(base) } } });
    expect(fra).toMatchObject({ checks: 1, up: 1, p50: 300 });
  });

  it('deletes raw rows past retention only after they are rolled up', async () => {
    const r = await pruneRaw(now);
    expect(r.deleted).toBe(13);
    expect(await prisma.auditLog.count({ where: { mintId } })).toBe(1);
    expect(await prisma.auditHourly.count({ where: { mintId } })).toBeGreaterThanOrEqual(2);
  });
});
