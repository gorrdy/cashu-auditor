import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorized } from '@/lib/auth';
import { withWalletLock } from '@/lib/lock';
import { recoverPendingSwaps, transfer } from '@/lib/transfer';
import { homeMintUrl } from '@/lib/consolidate';

const MIN_SWAP = 10;
const MAX_BALANCE_FRACTION = 0.1;
const FEE_BUFFER = 3;
const MAX_DEST_ATTEMPTS = 3;
const MAX_SWAP = 100;
const UNPROVEN_DEST_MAX = 5;
const MAX_EXPOSURE = 600;
const FOREIGN_SOURCE_SHARE = 0.5;
const DEST_MIN_AGE_MS = 3 * 86_400_000;
const DEST_MIN_UPTIME = 0.95;
const DEST_MIN_CHECKS = 12;

async function uptime24h(now: number) {
  const rows = await prisma.$queryRaw<{ mintId: string; total: bigint; up: bigint }[]>`
    SELECT mintId, COUNT(*) AS total, SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) AS up
    FROM AuditLog WHERE location = 'prague' AND timestamp >= ${now - 86_400_000} GROUP BY mintId`;
  return new Map(rows.map(r => [r.mintId, { total: Number(r.total), up: Number(r.up) }]));
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

    const now = Date.now();
    const [status, uptime] = await Promise.all([latestStatuses(), uptime24h(now)]);
    const mints = await prisma.mint.findMany({ select: { id: true, url: true, addedAt: true } });
    const online = mints.filter(m => status.get(m.id) === 'online');

    const balances = await prisma.proof.groupBy({ by: ['mintId'], where: { state: 'unspent' }, _sum: { amount: true } });
    const balanceOf = new Map(balances.map(b => [b.mintId, b._sum.amount ?? 0]));
    const total = [...balanceOf.values()].reduce((s, b) => s + b, 0);

    const home = homeMintUrl();
    const sources = online.filter(m => (balanceOf.get(m.id) ?? 0) >= MIN_SWAP + FEE_BUFFER);
    if (sources.length === 0) return { recovered, error: `No online mint holds ${MIN_SWAP + FEE_BUFFER} sat` };
    const foreign = sources.filter(m => m.url !== home);
    const pool = foreign.length > 0 && (Math.random() < FOREIGN_SOURCE_SHARE || foreign.length === sources.length) ? foreign : sources.filter(m => m.url === home);
    const source = pool[Math.floor(Math.random() * pool.length)];

    const maxSwap = Math.max(MIN_SWAP, Math.min(MAX_SWAP, Math.floor(total * MAX_BALANCE_FRACTION), (balanceOf.get(source.id) ?? 0) - FEE_BUFFER));
    const amount = MIN_SWAP + Math.floor(Math.random() * (maxSwap - MIN_SWAP + 1));

    const recent = await prisma.swap.groupBy({
      by: ['destMintId'],
      where: { destMintId: { in: online.map(m => m.id) } },
      _max: { timestamp: true },
    });
    const lastAt = new Map(recent.map(r => [r.destMintId, r._max.timestamp?.getTime() ?? 0]));
    const proven = new Set(
      (await prisma.swap.groupBy({ by: ['sourceMintId'], where: { status: 'success' } })).map(r => r.sourceMintId)
    );
    const dests = online
      .filter(m => {
        const u = uptime.get(m.id);
        return (
          m.id !== source.id &&
          (m.url === home || (balanceOf.get(m.id) ?? 0) + amount <= MAX_EXPOSURE) &&
          now - m.addedAt.getTime() >= DEST_MIN_AGE_MS &&
          !!u && u.total >= DEST_MIN_CHECKS && u.up / u.total >= DEST_MIN_UPTIME
        );
      })
      .sort((a, b) => (lastAt.get(a.id) ?? 0) - (lastAt.get(b.id) ?? 0));
    if (dests.length === 0) return { recovered, error: 'No eligible destination mint' };

    const attempts = [];
    for (const dest of dests.slice(0, MAX_DEST_ATTEMPTS)) {
      const r = await transfer({ source, dest, amount: proven.has(dest.id) ? amount : Math.min(amount, UNPROVEN_DEST_MAX) });
      attempts.push({ dest: dest.url, ...r });
      if (r.status !== 'failed' || r.fundsMoved || r.stage !== 'mint_quote') break;
    }
    return { recovered, source: source.url, amount, attempts };
  });

  if (!result) return NextResponse.json({ error: 'Wallet busy' }, { status: 409 });
  return NextResponse.json(result);
}
