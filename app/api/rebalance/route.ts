import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorized } from '@/lib/auth';
import { withWalletLock } from '@/lib/lock';
import { homeMintUrl } from '@/lib/consolidate';
import { transfer } from '@/lib/transfer';
import { swappableMints, trustState, unspentBalance } from '@/lib/eligible';
import { recentlyFailing } from '@/lib/blame';
import { SLOW_BELOW, totalBalance } from '@/lib/budget';
import { loadBackoff } from '@/lib/backoff';

const LOW = 250;
const TARGET = 500;
const HIGH = 650;
const HOME_RESERVE = 1_500;
const MIN_MOVE = 50;

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const homeUrl = homeMintUrl();
  if (!homeUrl) return NextResponse.json({ error: 'HOME_MINT_URL not set' }, { status: 500 });

  const result = await withWalletLock('rebalance', async () => {
    const home = await prisma.mint.findUnique({ where: { url: homeUrl }, select: { id: true, url: true } });
    if (!home) return { error: 'Home mint not tracked' };
    const now = Date.now();
    const failing = recentlyFailing(
      await prisma.swap.findMany({
        where: { timestamp: { gte: new Date(now - 7 * 86_400_000) } },
        select: { status: true, stage: true, error: true, preimageOk: true, sourceMintId: true, destMintId: true, timestamp: true },
      }),
      now
    );
    const backoff = await loadBackoff(now);
    const trust = await trustState(now);
    const foreign = (await swappableMints()).filter(m => m.url !== homeUrl && !failing.has(m.id));
    const balances = new Map(await Promise.all(foreign.map(async m => [m.id, await unspentBalance(m.id)] as const)));
    const moves = [];

    for (const m of foreign.filter(m => (balances.get(m.id) ?? 0) > HIGH && backoff.canSend(m.id))) {
      const r = await transfer({ source: m, dest: home, amount: balances.get(m.id)! - TARGET });
      moves.push({ from: m.url, to: home.url, amount: r.amount, status: r.status, fee: r.fee, error: r.error });
    }

    let homeBalance = await unspentBalance(home.id);
    if (homeBalance < HOME_RESERVE) {
      const donors = foreign.filter(m => (balances.get(m.id) ?? 0) - TARGET >= MIN_MOVE && backoff.canSend(m.id)).sort((a, b) => balances.get(b.id)! - balances.get(a.id)!);
      for (const m of donors) {
        if (homeBalance >= HOME_RESERVE) break;
        const r = await transfer({ source: m, dest: home, amount: balances.get(m.id)! - TARGET });
        moves.push({ from: m.url, to: home.url, amount: r.amount, status: r.status, fee: r.fee, error: r.error });
        homeBalance = await unspentBalance(home.id);
      }
    }

    const unreachable = new Set(
      (await prisma.swap.findMany({
        where: { sourceMintId: home.id, status: 'failed', stage: 'melt', timestamp: { gte: new Date(now - 86_400_000) } },
        select: { destMintId: true },
      })).map(r => r.destMintId)
    );
    if ((await totalBalance()) >= SLOW_BELOW) {
      for (const m of foreign.filter(m => (balances.get(m.id) ?? 0) < LOW && !unreachable.has(m.id) && backoff.canReceive(m.id) && backoff.canPair(home.id, m.id) && trust.mature(m.id) && trust.proven(m.id))) {
        const need = TARGET - (balances.get(m.id) ?? 0);
        if (!trust.canHoldMore(m.id, need)) continue;
        if (homeBalance - need < HOME_RESERVE) break;
        const r = await transfer({ source: home, dest: m, amount: need });
        moves.push({ from: home.url, to: m.url, amount: r.amount, status: r.status, fee: r.fee, error: r.error });
        homeBalance = await unspentBalance(home.id);
      }
    }
    return { skipped: failing.size, moves, homeBalance };
  });

  if (!result) return NextResponse.json({ error: 'Wallet busy' }, { status: 409 });
  return NextResponse.json(result);
}
