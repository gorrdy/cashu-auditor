import { beforeAll, describe, expect, inject, it, vi } from 'vitest';

const sent: string[] = [];
vi.mock('@/lib/notify/channels', () => ({
  sendToChannel: async (_ch: unknown, m: { title: string }) => {
    sent.push(m.title);
    return { ok: true };
  },
}));

const MIN = 60_000;

describe('alert notifications', () => {
  let prisma: typeof import('@/lib/prisma').prisma;
  let runNotifications: typeof import('@/lib/notify/events').runNotifications;
  const now = Date.now();
  let degraded: string;
  let failing: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl');
    ({ prisma } = await import('@/lib/prisma'));
    ({ runNotifications } = await import('@/lib/notify/events'));
    degraded = await watched('https://degraded.example');
    failing = await watched('https://swapfail.example');
    await prisma.auditLog.createMany({ data: [
      { mintId: degraded, status: 'degraded', latency: 100, timestamp: new Date(now - MIN) },
      { mintId: failing, status: 'online', latency: 100, timestamp: new Date(now - MIN) },
    ] });
  });

  async function watched(url: string) {
    const mint = await prisma.mint.create({ data: { url, name: url } });
    const op = await prisma.operator.create({ data: {} });
    await prisma.notifyChannel.create({ data: { operatorId: op.id, kind: 'nostr', target: 'x' } });
    await prisma.mintClaim.create({ data: { operatorId: op.id, mintId: mint.id, method: 'dns', code: 'c', verifiedAt: new Date(now), alerts: true, paidUntil: new Date(now + 86_400_000) } });
    return mint.id;
  }

  it('waits for the offline delay before a keyset alert', async () => {
    sent.length = 0;
    await runNotifications(now);
    expect(sent).toEqual([]);
    await runNotifications(now + 11 * MIN);
    expect(sent).toEqual(['No active sat keyset: https://degraded.example']);
  });

  it('uses each operator\'s own delay and sends once per operator', async () => {
    const op = await prisma.operator.create({ data: {} });
    await prisma.notifyChannel.create({ data: { operatorId: op.id, kind: 'nostr', target: 'y' } });
    await prisma.mintClaim.create({ data: { operatorId: op.id, mintId: degraded, method: 'dns', code: 'd', verifiedAt: new Date(now), alerts: true, paidUntil: new Date(now + 86_400_000), prefs: JSON.stringify({ offlineMinutes: 60 }) } });
    sent.length = 0;
    await runNotifications(now + 12 * MIN);
    expect(sent).toEqual([]);
    await runNotifications(now + 61 * MIN);
    expect(sent).toEqual(['No active sat keyset: https://degraded.example']);
  });

  it('keeps a swap failure alert until a swap at the mint succeeds', async () => {
    const id = failing;
    await prisma.notifyState.create({ data: { mintId: id, event: 'swapfail', since: new Date(now - 60 * MIN), notifiedAt: new Date(now - 60 * MIN) } });
    const claim = await prisma.mintClaim.findFirstOrThrow({ where: { mintId: id }, include: { operator: { include: { channels: true } } } });
    await prisma.notifyLog.create({ data: { claimId: claim.id, channelId: claim.operator.channels[0].id, event: 'swapfail', ok: true, timestamp: new Date(now - 59 * MIN) } });
    sent.length = 0;
    await runNotifications(now);
    expect(await prisma.notifyState.count({ where: { mintId: id, event: 'swapfail' } })).toBe(1);
    expect(sent).toEqual([]);

    const other = (await prisma.mint.create({ data: { url: 'https://other.example' } })).id;
    await prisma.swap.create({ data: { sourceMintId: id, destMintId: other, amount: 10, status: 'success', timestamp: new Date(now - MIN) } });
    await runNotifications(now);
    expect(await prisma.notifyState.count({ where: { mintId: id, event: 'swapfail' } })).toBe(0);
    expect(sent).toEqual(['Resolved: https://swapfail.example']);
  });
});
