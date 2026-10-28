import { beforeAll, describe, expect, inject, it, vi } from 'vitest';

const ids: Record<string, string> = {};
const failing = new Set<string>();

vi.mock('@/lib/donate', () => ({
  homeMint: async () => ({ id: ids.home, url: 'https://home.example' }),
  createHomeQuote: async () => ({ quote: `q-${Math.random()}`, request: 'lnbc1', expiresAt: new Date(Date.now() + 3_600_000) }),
  qrSvg: async () => '<svg/>',
  refundToken: async () => 'cashuBtoken',
  settleQuote: async () => 'unpaid',
  redeem: async () => ({}),
}));

vi.mock('@/lib/stats', () => ({
  getOverview: async () => ({
    mints: ['a', 'b', 'c'].map(k => ({ id: ids[k], recommended: true, isTest: false, latestStatus: 'online' })),
  }),
}));

vi.mock('@/lib/backoff', () => ({ loadBackoff: async () => ({ canSend: () => true, canReceive: () => true }) }));

vi.mock('@/lib/operator/payout', async () => {
  const { prisma } = await import('@/lib/prisma');
  return {
    lnurlInvoice: async () => 'lnbc1',
    resolvePayout: async () => ({ status: 'paid' }),
    sendPayout: async (address: string, amount: number, opts: { runId: string }) => {
      await prisma.payout.create({ data: { address, amount, invoice: 'lnbc1', meltQuoteId: 'm', status: 'paid', fee: 3, runId: opts.runId } });
      return { status: 'paid', amount, fee: 3 };
    },
  };
});

vi.mock('@/lib/transfer', async () => {
  const { prisma } = await import('@/lib/prisma');
  return {
    errorMessage: (e: unknown) => String(e),
    recoverSwap: async () => ({}),
    transfer: async (o: { source: { id: string }; dest: { id: string }; budget: number; kind: string; runId: string }) => {
      const fail = failing.has(o.dest.id);
      const swap = await prisma.swap.create({
        data: {
          kind: o.kind, runId: o.runId, sourceMintId: o.source.id, destMintId: o.dest.id, amount: o.budget - 50,
          status: fail ? 'failed' : 'success', stage: fail ? 'mint_quote' : null, fee: fail ? 0 : 10, error: fail ? 'no quote' : null,
        },
      });
      return { status: swap.status, swapId: swap.id, amount: swap.amount, fee: swap.fee, duration: 0, fundsMoved: !fail };
    },
  };
});

describe('mint run', () => {
  let prisma: typeof import('@/lib/prisma').prisma;
  let mintrun: typeof import('@/lib/mintrun');

  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl');
    ({ prisma } = await import('@/lib/prisma'));
    mintrun = await import('@/lib/mintrun');
    for (const k of ['home', 'a', 'b', 'c']) ids[k] = (await prisma.mint.create({ data: { url: `https://run-${k}.example` } })).id;
    failing.add(ids.b);
  });

  it('passes the amount through every recommended mint, skips a failing one and pays back the rest', async () => {
    const run = await prisma.mintRun.create({
      data: { amount: 10_000, value: 10_000, status: 'queued', returnTo: 'me@wallet.example', keyHash: 'x', quoteId: 'run-q1', request: 'lnbc1', expiresAt: new Date() },
    });
    await mintrun.advanceRuns();
    const done = await prisma.mintRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(done.status).toBe('done');
    const hops = await prisma.swap.findMany({ where: { runId: run.id }, orderBy: { timestamp: 'asc' } });
    expect(hops.filter(h => h.status === 'success')).toHaveLength(3);
    expect(hops.at(-1)!.destMintId).toBe(ids.home);
    expect(hops.filter(h => h.status === 'failed').map(h => h.destMintId)).toEqual([ids.b]);
    expect(done.returned).toBe(10_000 - 30 - 2);
    expect(done.value).toBe(10_000 - 30 - 3);
  });

  it('starts a run funded with ecash at the mint that issued it', async () => {
    const run = await prisma.mintRun.create({
      data: { amount: 10_000, value: 10_000, status: 'queued', currentMintId: ids.c, donate: true, keyHash: 'z', quoteId: 'run-q3', request: 'lnbc1', expiresAt: new Date() },
    });
    await mintrun.advanceRuns();
    const hops = await prisma.swap.findMany({ where: { runId: run.id }, orderBy: { timestamp: 'asc' } });
    expect(hops[0].sourceMintId).toBe(ids.c);
    expect(hops.some(h => h.destMintId === ids.c)).toBe(false);
    expect((await prisma.mintRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('done');
  });

  it('runs a queued run while another one waits on a stuck payment', async () => {
    const stuckSwap = await prisma.swap.create({ data: { kind: 'run', sourceMintId: ids.a, destMintId: ids.c, amount: 9_000, status: 'pending', stage: 'melt' } });
    const stuck = await prisma.mintRun.create({
      data: { amount: 10_000, value: 9_500, status: 'running', currentMintId: ids.a, lastSwapId: stuckSwap.id, route: JSON.stringify([ids.c]), donate: true, keyHash: 's', quoteId: 'run-q4', request: 'lnbc1', expiresAt: new Date() },
    });
    const next = await prisma.mintRun.create({
      data: { amount: 10_000, value: 10_000, status: 'queued', donate: true, keyHash: 'n', quoteId: 'run-q5', request: 'lnbc1', expiresAt: new Date() },
    });
    await mintrun.advanceRuns();
    expect((await prisma.mintRun.findUniqueOrThrow({ where: { id: next.id } })).status).toBe('done');
    expect((await prisma.mintRun.findUniqueOrThrow({ where: { id: stuck.id } })).status).toBe('running');
    await prisma.mintRun.update({ where: { id: stuck.id }, data: { status: 'stuck' } });
  });

  it('keeps the run out of the audit balance while it holds sats', async () => {
    const { totalBalance } = await import('@/lib/budget');
    const before = await totalBalance();
    await prisma.mintRun.create({ data: { amount: 20_000, value: 20_000, status: 'queued', keyHash: 'y', quoteId: 'run-q2', request: 'lnbc1', expiresAt: new Date(), donate: true } });
    expect(await totalBalance()).toBe(Math.max(0, before - 20_000));
  });
});
