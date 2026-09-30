import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorized } from '@/lib/auth';
import { withWalletLock } from '@/lib/lock';
import { restoreProofs } from '@/lib/wallet';
import { errorMessage } from '@/lib/transfer';

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const only = params.get('mint');
  const full = params.get('full') === '1';

  const result = await withWalletLock('restore', async () => {
    const mints = await prisma.mint.findMany({ where: only ? { url: only } : undefined, select: { id: true, url: true } });
    const out = [];
    for (const mint of mints) {
      try {
        out.push({ mint: mint.url, ...(await restoreProofs(mint, { full })) });
      } catch (error) {
        out.push({ mint: mint.url, error: errorMessage(error) });
      }
    }
    return out;
  });

  if (!result) return NextResponse.json({ error: 'Wallet busy' }, { status: 409 });
  return NextResponse.json({ success: true, results: result });
}
