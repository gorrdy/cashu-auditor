import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorized } from '@/lib/auth';
import { withWalletLock } from '@/lib/lock';
import { homeMintUrl } from '@/lib/consolidate';
import { transfer } from '@/lib/transfer';
import { MIN_AGE_MS, swappableMints, trustState, unspentBalance as balance } from '@/lib/eligible';

const FEE_BUFFER = 10;

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const target = Math.min(1000, Math.max(20, Number(params.get('fund') ?? 500)));
  const back = Math.min(target / 2, Math.max(5, Number(params.get('back') ?? 20)));
  const onlyNew = params.get('new') === '1';
  const probeIn = Math.min(100, Math.max(10, Number(params.get('in') ?? 20)));
  const homeUrl = homeMintUrl();
  if (!homeUrl) return NextResponse.json({ error: 'HOME_MINT_URL not set' }, { status: 500 });

  const result = await withWalletLock('init-round', async () => {
    const home = await prisma.mint.findUnique({ where: { url: homeUrl }, select: { id: true, url: true } });
    if (!home) return { error: 'Home mint not tracked' };
    const now = Date.now();
    const eligible = (await swappableMints()).filter(m => m.url !== homeUrl && (!onlyNew || now - m.addedAt.getTime() < MIN_AGE_MS));
    const trust = onlyNew ? await trustState(now) : null;

    const out = [];
    for (const mint of eligible) {
      const have = await balance(mint.id);
      const need = target - have;
      const row: Record<string, unknown> = { mint: mint.url, had: have };
      if (mint.isTest) {
        out.push({ ...row, skipped: 'test mint' });
        continue;
      }
      if (onlyNew) {
        if (trust!.canHoldMore(mint.id, probeIn)) {
          const r = await transfer({ source: home, dest: mint, amount: probeIn });
          row.receive = { status: r.status, amount: r.amount, fee: r.fee, ms: r.duration, stage: r.stage, error: r.error };
        } else row.receive = { skipped: 'operator limit' };
      } else if (need >= target * 0.2) {
        if ((await balance(home.id)) < need + FEE_BUFFER) {
          out.push({ ...row, skipped: 'home balance too low' });
          break;
        }
        const fund = await transfer({ source: home, dest: mint, amount: need });
        row.fund = { status: fund.status, amount: fund.amount, fee: fund.fee, ms: fund.duration, stage: fund.stage, error: fund.error };
        if (fund.status !== 'success') { out.push(row); continue; }
      }
      const payout = await transfer({ source: mint, dest: home, amount: back });
      row.payout = { status: payout.status, amount: payout.amount, fee: payout.fee, ms: payout.duration, stage: payout.stage, error: payout.error };
      row.now = await balance(mint.id);
      out.push(row);
    }
    return { eligible: eligible.length, target, back, results: out, homeLeft: await balance(home.id) };
  });

  if (!result) return NextResponse.json({ error: 'Wallet busy' }, { status: 409 });
  return NextResponse.json(result);
}
