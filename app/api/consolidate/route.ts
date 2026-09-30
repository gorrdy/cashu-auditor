import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { consolidateToHomeMint, homeMintUrl } from '@/lib/consolidate';
import { withWalletLock } from '@/lib/lock';
import { authorized } from '@/lib/auth';

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const homeUrl = homeMintUrl();
  if (!homeUrl) return NextResponse.json({ error: 'HOME_MINT_URL not set' }, { status: 500 });

  const result = await withWalletLock('consolidate', async () => {
    const mints = await prisma.mint.findMany({
      where: { url: { not: homeUrl }, proofs: { some: { state: 'unspent' } } },
      select: { id: true, url: true },
    });
    const results = [];
    for (const mint of mints) {
      results.push({ mint: mint.url, ...((await consolidateToHomeMint(mint.id)) ?? { skipped: true }) });
    }
    return results;
  });

  if (!result) return NextResponse.json({ error: 'Wallet busy' }, { status: 409 });
  return NextResponse.json({ success: true, results: result });
}
