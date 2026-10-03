import { NextResponse } from 'next/server';
import { authorized } from '@/lib/auth';
import { withWalletLock } from '@/lib/lock';
import { homeMintUrl } from '@/lib/consolidate';
import { recoverPendingSwaps, transfer } from '@/lib/transfer';
import { swappableMints, trustState, unspentBalance } from '@/lib/eligible';
import { loadBackoff } from '@/lib/backoff';

const FEE_BUFFER = 15;
const MAX_EXPOSURE = 600;

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const amount = Math.min(200, Math.max(10, Number(new URL(request.url).searchParams.get('amount') ?? 50)));
  const home = homeMintUrl();

  const result = await withWalletLock('swap-round', async () => {
    const recovered = await recoverPendingSwaps();
    const backoff = await loadBackoff();
    const trust = await trustState();
    const ring = await swappableMints();
    for (let i = ring.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ring[i], ring[j]] = [ring[j], ring[i]];
    }

    const results = [];
    for (let i = 0; i < ring.length; i++) {
      const source = ring[i];
      const dest = ring[(i + 1) % ring.length];
      const row = { from: source.url, to: dest.url };
      if (!backoff.canSend(source.id)) {
        results.push({ ...row, skipped: 'source backed off' });
        continue;
      }
      if (!backoff.canReceive(dest.id)) {
        results.push({ ...row, skipped: 'destination backed off' });
        continue;
      }
      if ((await unspentBalance(source.id)) < amount + FEE_BUFFER) {
        results.push({ ...row, skipped: 'source balance too low' });
        continue;
      }
      const sendAmount = trust.proven(dest.id) ? amount : Math.min(amount, 5);
      if (dest.url !== home && !trust.mature(dest.id)) {
        results.push({ ...row, skipped: 'destination tracked for less than 3 days' });
        continue;
      }
      if (dest.url !== home && ((await unspentBalance(dest.id)) + sendAmount > MAX_EXPOSURE || !trust.canHoldMore(dest.id, sendAmount))) {
        results.push({ ...row, skipped: 'destination exposure limit' });
        continue;
      }
      const r = await transfer({ source, dest, amount: sendAmount });
      results.push({ ...row, status: r.status, amount: r.amount, fee: r.fee, ms: r.duration, stage: r.stage, error: r.error });
    }
    return { mints: ring.length, amount, recovered: recovered.length, results };
  });

  if (!result) return NextResponse.json({ error: 'Wallet busy' }, { status: 409 });
  return NextResponse.json(result);
}
