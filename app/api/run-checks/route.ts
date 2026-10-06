import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorized } from '@/lib/auth';
import { withWalletLock } from '@/lib/lock';
import { mapLimit } from '@/lib/probe';
import { checkProofStates, swapTest, torCheck } from '@/lib/checks';
import { publish } from '@/lib/events';
import { reconcileAbandonedSwaps } from '@/lib/transfer';
import { checkLnNode } from '@/lib/lnnode';
import { latestStatuses } from '@/lib/eligible';

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const only = new URL(request.url).searchParams.get('only');
  const mints = await prisma.mint.findMany({ select: { id: true, url: true, inputFeePpk: true, onionUrl: true } });

  const tor = only && only !== 'tor' ? [] : await mapLimit(mints.filter(m => m.onionUrl), 3, async m => ({ mint: m.url, ...(await torCheck(m)) }));
  if (only === 'tor') return NextResponse.json({ success: true, tor });
  if (only === 'ln' || !only) {
    const status = await latestStatuses();
    const online = await prisma.mint.findMany({ where: { aliasOfId: null }, select: { id: true, url: true, methods: true } });
    const ln = await mapLimit(online.filter(m => status.get(m.id) === 'online'), 4, async m => ({ mint: m.url, ...(await checkLnNode(m)) }));
    if (only === 'ln') return NextResponse.json({ success: true, ln });
  }
  if (only === 'abandoned') {
    const abandoned = await withWalletLock('reconcile', reconcileAbandonedSwaps);
    return abandoned ? NextResponse.json({ success: true, abandoned }) : NextResponse.json({ error: 'Wallet busy' }, { status: 409 });
  }

  const wallet = await withWalletLock('checks', async () => {
    const withBalance = await prisma.mint.findMany({
      where: { proofs: { some: { state: 'unspent' } } },
      select: { id: true, url: true, inputFeePpk: true, onionUrl: true },
    });
    const abandoned = await reconcileAbandonedSwaps();
    const out: unknown[] = [{ abandoned }];
    for (const m of withBalance) {
      const proofState = await checkProofStates(m);
      const swap = await swapTest(m);
      out.push({ mint: m.url, proofState, swap });
    }
    return out;
  });
  if (!wallet) return NextResponse.json({ error: 'Wallet busy', tor }, { status: 409 });
  publish('checks');
  return NextResponse.json({ success: true, tor, wallet });
}
