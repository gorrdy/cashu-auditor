import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorized } from '@/lib/auth';
import { withWalletLock } from '@/lib/lock';
import { recoverPendingSwaps, transfer } from '@/lib/transfer';
import { homeMintUrl } from '@/lib/consolidate';
import { budgetState } from '@/lib/budget';
import { loadBackoff } from '@/lib/backoff';
import { latestStatuses, trustState } from '@/lib/eligible';
import { startOfDay } from '@/lib/time';
import { mintFreshness, pairKey, pairPriority, pairStates } from '@/lib/pairSchedule';
import { settleDonationInvoices } from '@/lib/donate';
import { COUNTED_SWAP as COUNTED } from '@/lib/counted';
import { DAY, FEE_BUFFER, MAX_SWAP, MIN_AGE_MS as DEST_MIN_AGE_MS, MIN_SWAP, OPERATOR_EXPOSURE as MAX_EXPOSURE, UNPROVEN_DEST_MAX } from '@/lib/constants';

const MAX_BALANCE_FRACTION = 0.1;
const MAX_DEST_ATTEMPTS = 3;
const DEST_MIN_UPTIME = 0.95;
const DEST_MIN_CHECKS = 12;
const HISTORY_DAYS = 90;

async function uptime24h(now: number) {
  const rows = await prisma.$queryRaw<{ mintId: string; total: bigint; up: bigint }[]>`
    SELECT mintId, COUNT(*) AS total, SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) AS up
    FROM AuditLog WHERE location = 'prague' AND timestamp >= ${now - DAY} GROUP BY mintId`;
  return new Map(rows.map(r => [r.mintId, { total: Number(r.total), up: Number(r.up) }]));
}

function bolt11Min(methods: string | null, op: 'mint' | 'melt') {
  const list = methods ? (JSON.parse(methods) as { op: string; method: string; unit: string; min?: number }[]) : [];
  return list.find(m => m.op === op && m.method === 'bolt11' && m.unit === 'sat')?.min ?? 1;
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
    const [history, provenRows] = await Promise.all([
      prisma.swap.findMany({
        where: { kind: 'swap', timestamp: { gte: new Date(now - HISTORY_DAYS * DAY) }, ...COUNTED },
        select: { sourceMintId: true, destMintId: true, status: true, timestamp: true },
        orderBy: { timestamp: 'desc' },
      }),
      prisma.swap.groupBy({ by: ['sourceMintId'], where: { status: 'success' } }),
    ]);
    const proven = new Set(provenRows.map(r => r.sourceMintId));
    const states = pairStates(history);
    const fresh = mintFreshness(history, now);
    const today = startOfDay(now);
    const pairedToday = new Set(history.filter(h => h.timestamp.getTime() >= today).map(h => pairKey(h.sourceMintId, h.destMintId)));
    const outCount = new Map<string, number>();
    for (const h of history) if (now - h.timestamp.getTime() < DAY) outCount.set(h.sourceMintId, (outCount.get(h.sourceMintId) ?? 0) + 1);

    const sources = online.filter(
      m => (balanceOf.get(m.id) ?? 0) >= Math.max(MIN_SWAP, bolt11Min(m.methods, 'melt')) + FEE_BUFFER && backoff.canSend(m.id)
    );
    if (sources.length === 0) return { recovered, error: `No online mint holds ${MIN_SWAP + FEE_BUFFER} sat` };
    const receivers = online.filter(m => {
      const u = uptime.get(m.id);
      return !m.isTest && backoff.canReceive(m.id) && now - m.addedAt.getTime() >= DEST_MIN_AGE_MS && !!u && u.total >= DEST_MIN_CHECKS && u.up / u.total >= DEST_MIN_UPTIME;
    });

    const candidates: { source: (typeof sources)[number]; dest: (typeof receivers)[number]; amount: number; priority: number }[] = [];
    for (const source of sources) {
      const available = (balanceOf.get(source.id) ?? 0) - FEE_BUFFER;
      const maxSwap = Math.max(MIN_SWAP, Math.min(MAX_SWAP, Math.floor(total * MAX_BALANCE_FRACTION), available));
      const amount = MIN_SWAP + Math.floor(Math.random() * (maxSwap - MIN_SWAP + 1));
      for (const dest of receivers) {
        if (dest.id === source.id || pairedToday.has(pairKey(source.id, dest.id)) || !backoff.canPair(source.id, dest.id)) continue;
        const priority = pairPriority(source.id, dest.id, states, fresh, now);
        if (priority === null) continue;
        if (Math.max(bolt11Min(source.methods, 'melt'), bolt11Min(dest.methods, 'mint')) > Math.min(proven.has(dest.id) ? MAX_SWAP : UNPROVEN_DEST_MAX, available)) continue;
        if (dest.url !== home && ((balanceOf.get(dest.id) ?? 0) + amount > MAX_EXPOSURE || !trust.canHoldMore(dest.id, amount))) continue;
        candidates.push({ source, dest, amount, priority: priority - (outCount.get(source.id) ?? 0) / 1000 + Math.random() / 1e6 });
      }
    }
    if (candidates.length === 0) return { recovered, skipped: 'No pair is due' };
    candidates.sort((a, b) => b.priority - a.priority);
    const { source, amount } = candidates[0];
    const dests = candidates.filter(c => c.source.id === source.id).map(c => c.dest);

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
