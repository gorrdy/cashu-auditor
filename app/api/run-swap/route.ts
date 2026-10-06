import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorized } from '@/lib/auth';
import { withWalletLock } from '@/lib/lock';
import { recoverPendingSwaps, transfer } from '@/lib/transfer';
import { homeMintUrl } from '@/lib/consolidate';
import { budgetState } from '@/lib/budget';
import { loadBackoff } from '@/lib/backoff';
import { trustState } from '@/lib/eligible';
import { settleDonationInvoices } from '@/lib/donate';
import { COUNTED_SWAP as COUNTED } from '@/lib/counted';

const MIN_SWAP = 10;
const MAX_BALANCE_FRACTION = 0.1;
const FEE_BUFFER = 12;
const MAX_DEST_ATTEMPTS = 3;
const MAX_SWAP = 100;
const UNPROVEN_DEST_MAX = 5;
const MAX_EXPOSURE = 600;
const TARGET_PER_DAY = 10;
const SOURCE_TRIES = 5;
const DEST_MIN_AGE_MS = 3 * 86_400_000;
const DEST_MIN_UPTIME = 0.95;
const DEST_MIN_CHECKS = 12;

async function uptime24h(now: number) {
  const rows = await prisma.$queryRaw<{ mintId: string; total: bigint; up: bigint }[]>`
    SELECT mintId, COUNT(*) AS total, SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) AS up
    FROM AuditLog WHERE location = 'prague' AND timestamp >= ${now - 86_400_000} GROUP BY mintId`;
  return new Map(rows.map(r => [r.mintId, { total: Number(r.total), up: Number(r.up) }]));
}

function bolt11Min(methods: string | null, op: 'mint' | 'melt') {
  const list = methods ? (JSON.parse(methods) as { op: string; method: string; unit: string; min?: number }[]) : [];
  return list.find(m => m.op === op && m.method === 'bolt11' && m.unit === 'sat')?.min ?? 1;
}

async function latestStatuses() {
  const rows = await prisma.$queryRaw<{ mintId: string; status: string }[]>`
    SELECT a.mintId, a.status FROM AuditLog a
    JOIN (SELECT mintId, MAX(timestamp) ts FROM AuditLog WHERE location = 'prague' GROUP BY mintId) l
      ON l.mintId = a.mintId AND l.ts = a.timestamp AND a.location = 'prague'`;
  return new Map(rows.map(r => [r.mintId, r.status]));
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await withWalletLock('run-swap', async () => {
    const recovered = await recoverPendingSwaps();
    await settleDonationInvoices().catch(error => console.error('settleDonationInvoices failed:', error));
    const budget = await budgetState();
    if (!budget.allowed) return { recovered, budget: budget.reason };

    const now = Date.now();
    const [status, uptime] = await Promise.all([latestStatuses(), uptime24h(now)]);
    const mints = await prisma.mint.findMany({ where: { aliasOfId: null }, select: { id: true, url: true, addedAt: true, isTest: true, methods: true } });
    const online = mints.filter(m => status.get(m.id) === 'online');

    const balances = await prisma.proof.groupBy({ by: ['mintId'], where: { state: 'unspent' }, _sum: { amount: true } });
    const balanceOf = new Map(balances.map(b => [b.mintId, b._sum.amount ?? 0]));
    const total = [...balanceOf.values()].reduce((s, b) => s + b, 0);

    const home = homeMintUrl();
    const backoff = await loadBackoff(now);
    const trust = await trustState(now);
    const since = new Date(now - 86_400_000);
    const [outRows, inRows, pairRows, lastRows, provenRows] = await Promise.all([
      prisma.swap.groupBy({ by: ['sourceMintId'], where: { kind: 'swap', timestamp: { gte: since }, ...COUNTED }, _count: { _all: true } }),
      prisma.swap.groupBy({ by: ['destMintId'], where: { kind: 'swap', timestamp: { gte: since }, ...COUNTED }, _count: { _all: true } }),
      prisma.swap.groupBy({ by: ['sourceMintId', 'destMintId'], where: { kind: 'swap', timestamp: { gte: new Date(now - 7 * 86_400_000) } } }),
      prisma.swap.groupBy({ by: ['destMintId'], _max: { timestamp: true } }),
      prisma.swap.groupBy({ by: ['sourceMintId'], where: { status: 'success' } }),
    ]);
    const outCount = new Map(outRows.map(r => [r.sourceMintId, r._count._all]));
    const inCount = new Map(inRows.map(r => [r.destMintId, r._count._all]));
    const triedPair = new Set(pairRows.map(r => `${r.sourceMintId}>${r.destMintId}`));
    const lastAt = new Map(lastRows.map(r => [r.destMintId, r._max.timestamp?.getTime() ?? 0]));
    const proven = new Set(provenRows.map(r => r.sourceMintId));

    const sources = online
      .filter(m => (balanceOf.get(m.id) ?? 0) >= Math.max(MIN_SWAP, bolt11Min(m.methods, 'melt')) + FEE_BUFFER && backoff.canSend(m.id))
      .sort((a, b) => (outCount.get(a.id) ?? 0) - (outCount.get(b.id) ?? 0) || Math.random() - 0.5);
    if (sources.length === 0) return { recovered, error: `No online mint holds ${MIN_SWAP + FEE_BUFFER} sat` };
    const receivers = online.filter(m => {
      const u = uptime.get(m.id);
      return !m.isTest && backoff.canReceive(m.id) && now - m.addedAt.getTime() >= DEST_MIN_AGE_MS && !!u && u.total >= DEST_MIN_CHECKS && u.up / u.total >= DEST_MIN_UPTIME;
    });
    const minOut = outCount.get(sources[0].id) ?? 0;
    const minIn = Math.min(...receivers.map(m => inCount.get(m.id) ?? 0));
    if (minOut >= TARGET_PER_DAY && minIn >= TARGET_PER_DAY) return { recovered, skipped: `Coverage met: every mint has ${TARGET_PER_DAY}+ swaps each way in 24 h` };

    let source = sources[0];
    let amount = 0;
    let dests: typeof receivers = [];
    for (const candidate of sources.slice(0, SOURCE_TRIES)) {
      const maxSwap = Math.max(MIN_SWAP, Math.min(MAX_SWAP, Math.floor(total * MAX_BALANCE_FRACTION), (balanceOf.get(candidate.id) ?? 0) - FEE_BUFFER));
      const a = MIN_SWAP + Math.floor(Math.random() * (maxSwap - MIN_SWAP + 1));
      const d = receivers
        .filter(m =>
          m.id !== candidate.id &&
          backoff.canPair(candidate.id, m.id) &&
          Math.max(bolt11Min(candidate.methods, 'melt'), bolt11Min(m.methods, 'mint')) <=
            Math.min(proven.has(m.id) ? MAX_SWAP : UNPROVEN_DEST_MAX, (balanceOf.get(candidate.id) ?? 0) - FEE_BUFFER) &&
          (m.url === home || ((balanceOf.get(m.id) ?? 0) + a <= MAX_EXPOSURE && trust.canHoldMore(m.id, a)))
        )
        .sort((x, y) =>
          (inCount.get(x.id) ?? 0) - (inCount.get(y.id) ?? 0) ||
          Number(triedPair.has(`${candidate.id}>${x.id}`)) - Number(triedPair.has(`${candidate.id}>${y.id}`)) ||
          (lastAt.get(x.id) ?? 0) - (lastAt.get(y.id) ?? 0)
        );
      if (d.length) {
        source = candidate;
        amount = a;
        dests = d;
        break;
      }
    }
    if (dests.length === 0) return { recovered, error: 'No eligible destination mint' };

    const attempts = [];
    for (const dest of dests.slice(0, MAX_DEST_ATTEMPTS)) {
      const r = await transfer({ source, dest, amount: proven.has(dest.id) ? amount : Math.min(amount, UNPROVEN_DEST_MAX), maxAmount: proven.has(dest.id) ? MAX_SWAP : UNPROVEN_DEST_MAX });
      attempts.push({ dest: dest.url, ...r });
      if (r.status !== 'failed' || r.fundsMoved || r.stage !== 'mint_quote') break;
    }
    return { recovered, source: source.url, amount, attempts };
  });

  if (!result) return NextResponse.json({ error: 'Wallet busy' }, { status: 409 });
  return NextResponse.json(result);
}
