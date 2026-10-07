import { NextResponse } from 'next/server';
import { authorized } from '@/lib/auth';
import { withWalletLock } from '@/lib/lock';
import { runPayout } from '@/lib/operator/payout';

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await withWalletLock('payout', runPayout);
  if (!result) return NextResponse.json({ error: 'Wallet busy' }, { status: 409 });
  return NextResponse.json(result);
}
