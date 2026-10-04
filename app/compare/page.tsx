import type { Metadata } from 'next';
import Link from 'next/link';
import { getMintDetail, getOverview } from '@/lib/stats';
import { getMintExtras } from '@/lib/stats-extra';
import { isMintId } from '@/lib/mintUrl';
import StateBadge from '@/components/StateBadge';
import UptimeStrip from '@/components/UptimeStrip';
import { fmtDate, fmtDayKey, fmtMs, fmtPct, fmtSat, hostOf, mintLabel } from '@/components/format';
import { fmtPpk, keysetVersion } from '@/components/MintSections';

export const metadata: Metadata = { title: 'Compare mints' };

const SLOTS = 3;

export default async function Compare({ searchParams }: { searchParams: Promise<{ m?: string | string[] }> }) {
  const raw = (await searchParams).m;
  const ids = [...new Set((Array.isArray(raw) ? raw : raw ? [raw] : []).filter(isMintId))].slice(0, SLOTS);
  const { mints } = await getOverview();
  const options = [...mints].filter(m => !m.longOffline).sort((a, b) => mintLabel(a).localeCompare(mintLabel(b)));
  const picked = ids.map(id => mints.find(m => m.id === id)).filter((m): m is (typeof mints)[number] => !!m);
  const details = await Promise.all(picked.map(async m => ({ m, d: await getMintDetail(m.id, '30d'), x: await getMintExtras(m.id, '30d') })));

  const rows: { label: string; cell: (c: (typeof details)[number]) => React.ReactNode }[] = [
    { label: 'State', cell: c => <StateBadge kind={c.m.state} title={c.m.reasons.join(' · ')} /> },
    { label: 'Audit score', cell: c => (c.m.score == null ? '—' : <strong>{c.m.score}</strong>) },
    { label: 'Uptime 24 h', cell: c => fmtPct(c.d?.uptime['24h'] ?? null, 2) },
    { label: 'Uptime 30 d', cell: c => fmtPct(c.d?.uptime['30d'] ?? null, 2) },
    { label: 'Uptime from Frankfurt', cell: c => fmtPct(c.x.frankfurtUptime, 2) },
    { label: 'Median response', cell: c => fmtMs(c.d?.latencyStats.p50 ?? null) },
    { label: 'Swap success', cell: c => fmtPct(c.d?.swapStats.all.successRate ?? null) },
    { label: 'Payouts / receipts', cell: c => `${c.d?.swapStats.asSource.success ?? 0} / ${c.d?.swapStats.asDest.success ?? 0}` },
    { label: 'Lightning fee', cell: c => (c.x.swapDetail.feePct == null ? '—' : `${c.x.swapDetail.feePct.toFixed(1)} %`) },
    { label: 'Failures attributed', cell: c => c.d?.swapStats.errorsBlamed ?? 0 },
    { label: 'Input fee', cell: c => fmtPpk(c.d?.mint.inputFeePpk ?? null) },
    { label: 'Software', cell: c => <span className="mono">{c.m.version ?? '—'}</span> },
    { label: 'Keyset', cell: c => keysetVersion(c.d?.mint.activeKeysetId ?? null) },
    { label: 'NUTs', cell: c => c.d?.mint.nuts.length ?? 0 },
    { label: 'WebSockets', cell: c => (c.m.websockets ? 'yes' : 'no') },
    { label: 'Reviews', cell: c => (c.x.reviews.average == null ? '—' : `${c.x.reviews.average.toFixed(1)} / 5 (${c.x.reviews.rated})`) },
    { label: 'TLS expires', cell: c => (c.d?.mint.tlsExpiresAt ? fmtDate(c.d.mint.tlsExpiresAt) : '—') },
    { label: 'Audit balance', cell: c => fmtSat(c.m.balance) },
  ];

  return (
    <>
      <p className="eyebrow">Compare</p>
      <h1 className="h1" style={{ marginTop: 8 }}>Compare mints</h1>
      <p className="soft" style={{ margin: '8px 0 0' }}>Up to three mints side by side, last 30 days.</p>

      <form method="get" action="/compare" className="filters" style={{ marginTop: 20 }}>
        {Array.from({ length: SLOTS }, (_, i) => (
          <label key={i} className="small soft" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <span className="sr-only">Mint {i + 1}</span>
            <select name="m" className="field compare-select" defaultValue={ids[i] ?? ''}>
              <option value="">— choose a mint —</option>
              {options.map(o => <option key={o.id} value={o.id}>{mintLabel(o)}</option>)}
            </select>
          </label>
        ))}
        <button type="submit" className="btn">Compare</button>
      </form>

      {details.length === 0 ? (
        <p className="small muted" style={{ marginTop: 24 }}>Choose at least one mint.</p>
      ) : (
        <section className="section">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th />
                  {details.map(c => (
                    <th key={c.m.id} className="cell-wrap">
                      <Link href={`/mint/${c.m.id}`} prefetch={false}>{mintLabel(c.m)}</Link>
                      <div className="mono muted c-sm" style={{ fontWeight: 400 }}>{hostOf(c.m.url)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.label}>
                    <td className="soft">{r.label}</td>
                    {details.map(c => <td key={c.m.id} className="cell-wrap">{r.cell(c)}</td>)}
                  </tr>
                ))}
                <tr className="c-lg">
                  <td className="soft nowrap">Last 30 days</td>
                  {details.map(c => (
                    <td key={c.m.id} style={{ minWidth: 160 }}>
                      <UptimeStrip
                        variant="compact"
                        ariaLabel={`Daily availability of ${mintLabel(c.m)}`}
                        cells={(c.d?.days ?? []).slice(-30).map(x => ({ uptime: x.uptime, label: fmtDayKey(x.day) }))}
                      />
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
