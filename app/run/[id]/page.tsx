import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isMintId } from '@/lib/mintUrl';
import { getRun, invoiceQr, runPaymentRequest, RUN_STATUS } from '@/lib/mintrun';
import { qrSvg } from '@/lib/donate';
import SwapTable from '@/components/SwapTable';
import StateBadge from '@/components/StateBadge';
import { RunInvoice, RunOwner, RunRefresh } from '@/components/RunLive';
import { fmtDuration, fmtMs, fmtSat, mintLabel } from '@/components/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: 'Mint run', robots: { index: false }, alternates: { canonical: `/run/${id}` } };
}

const BADGE: Record<string, 'success' | 'failed' | 'pending' | 'warn'> = {
  done: 'success',
  claim: 'success',
  stuck: 'failed',
  expired: 'failed',
};

export default async function RunDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = isMintId(id) ? await getRun(id) : null;
  if (!data) notFound();
  const { now, run, swaps, route } = data;
  const hops = [...swaps].reverse();
  const feeMap = new Map<string, { id: string; name: string | null; url: string; fee: number; sent: number }>();
  for (const h of swaps.filter(x => x.status === 'success')) {
    const e = feeMap.get(h.sourceMintId) ?? { ...h.sourceMint, fee: 0, sent: 0 };
    e.fee += h.fee;
    e.sent += h.amount + h.fee;
    feeMap.set(h.sourceMintId, e);
  }
  const byMint = [...feeMap.values()].sort((a, b) => b.fee - a.fee);
  const fees = run.status === 'invoice' || run.status === 'expired' ? 0 : run.amount - (run.status === 'done' && run.returned ? run.returned : run.value);
  const passed = new Set(swaps.filter(s => s.status === 'success').flatMap(s => [s.sourceMintId, s.destMintId]));
  const failedAt = new Map<string, string>();
  for (const s of swaps) {
    if (s.status !== 'failed') continue;
    const blamedId = s.stage === 'melt' || s.stage === 'melt_quote' || s.stage === 'split' ? s.sourceMintId : s.destMintId;
    if (!passed.has(blamedId)) failedAt.set(blamedId, s.error ?? 'Failed');
  }
  const end = run.finishedAt?.getTime() ?? (['running', 'paying'].includes(run.status) ? now : null);
  const elapsed = run.startedAt && end ? end - run.startedAt.getTime() : null;
  const label = RUN_STATUS[run.status] ?? run.status;
  const creq = runPaymentRequest(run);

  return (
    <>
      <RunRefresh id={run.id} status={run.status} />
      <p className="eyebrow"><Link href="/run">Mint run</Link></p>
      <div className="section-head" style={{ marginTop: 8 }}>
        <h1 className="h1">{fmtSat(run.amount)} run</h1>
        <StateBadge kind={BADGE[run.status] ?? 'pending'} label={label} />
      </div>
      {run.error && run.status !== 'done' && <p className="soft small">{run.error}</p>}

      <div className="run-top">
        {run.status === 'invoice' ? (
          <RunInvoice id={run.id} request={run.request} qr={await invoiceQr(run)} creq={creq} creqQr={await qrSvg(`cashu:${creq}`)} amount={run.amount} msLeft={Math.max(0, run.expiresAt.getTime() - now)} />
        ) : (
          <div className="tiles run-tiles">
            <div className="tile"><div className="tile-label">Paid in</div><div className="tile-value">{run.amount.toLocaleString('en')}<small>sat</small></div></div>
            <div className="tile"><div className="tile-label">{run.status === 'done' && run.returned ? 'Paid back' : 'Left'}</div><div className="tile-value">{(run.status === 'done' && run.returned ? run.returned : run.value).toLocaleString('en')}<small>sat</small></div></div>
            <div className="tile"><div className="tile-label">Fees and reserves</div><div className="tile-value">{fees.toLocaleString('en')}<small>sat</small></div><div className="tile-sub">{run.amount ? ((fees / run.amount) * 100).toFixed(2) : 0} % of the amount</div></div>
            <div className="tile"><div className="tile-label">Mints passed</div><div className="tile-value">{route.filter(m => passed.has(m.id)).length}<small>/ {route.length}</small></div><div className="tile-sub">{elapsed != null ? fmtDuration(elapsed) : 'Not started'}</div></div>
          </div>
        )}
        <RunOwner id={run.id} />
      </div>

      {route.length > 0 && (
        <section className="section card">
          <div className="card-head"><h2 className="h2">Route</h2><span className="small soft">Recommended mints in random order, ending at the home mint</span></div>
          <ol className="run-route">
            {route.map((m, i) => {
              const state = passed.has(m.id) ? 'success' : failedAt.has(m.id) ? 'failed' : i === run.position && run.status === 'running' ? 'pending' : null;
              return (
                <li key={m.id} className={state ? `is-${state}` : ''}>
                  <Link href={`/mint/${m.id}`}>{mintLabel(m)}</Link>
                  {state ? <StateBadge kind={state} label={state === 'success' ? 'Passed' : state === 'failed' ? 'Failed' : 'Now'} /> : <span className="small muted">Waiting</span>}
                  {state === 'failed' && <span className="small soft run-error">{failedAt.get(m.id)}</span>}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2 className="h2">Hops</h2>
          <span className="small soft">Reserve is what the paying mint locks for Lightning fees, fee is what it actually kept.</span>
        </div>
        {hops.length === 0 ? (
          <SwapTable swaps={hops} emptyText={run.status === 'invoice' ? 'The run starts once the invoice is paid.' : 'Waiting for the first hop.'} />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Result</th><th>From</th><th>To</th><th className="r">Arrived</th><th className="r c-sm">Reserve</th><th className="r">Fee</th><th className="r c-md">Unused reserve</th><th className="r c-lg">Time</th><th className="c-lg">Detail</th>
                </tr>
              </thead>
              <tbody>
                {hops.map(h => {
                  const ok = h.status === 'success';
                  return (
                    <tr key={h.id}>
                      <td><StateBadge kind={h.status as 'success' | 'failed' | 'pending'} title={h.error ?? undefined} /></td>
                      <td className="cell-wrap"><Link href={`/mint/${h.sourceMint.id}`} prefetch={false}>{mintLabel(h.sourceMint)}</Link></td>
                      <td className="cell-wrap"><Link href={`/mint/${h.destMint.id}`} prefetch={false}>{mintLabel(h.destMint)}</Link></td>
                      <td className="r nowrap">{ok ? fmtSat(h.amount) : '—'}</td>
                      <td className="r nowrap c-sm">{h.feeReserve != null ? fmtSat(h.feeReserve) : '—'}</td>
                      <td className="r nowrap">{ok ? fmtSat(h.fee) : '—'}</td>
                      <td className="r nowrap c-md">{ok && h.feeReserve != null ? fmtSat(Math.max(0, h.feeReserve - h.fee)) : '—'}</td>
                      <td className="r nowrap c-lg">{h.status === 'pending' ? '—' : fmtMs(h.duration)}</td>
                      <td className="small soft cell-wrap c-lg">{ok ? '' : `${h.stage ?? ''}${h.error ? `: ${h.error}` : ''}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {byMint.length > 0 && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-head"><h2 className="h2">Fees by mint</h2><span className="small soft">What each paying mint kept from the run</span></div>
            <ol className="run-fees">
              {byMint.map(m => (
                <li key={m.id}>
                  <Link href={`/mint/${m.id}`}>{mintLabel(m)}</Link>
                  <span className="nowrap">{fmtSat(m.fee)} <span className="muted">· {((m.fee / m.sent) * 100).toFixed(2)} %</span></span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>
    </>
  );
}
