import type { Metadata } from 'next';
import Link from 'next/link';
import { getMintDetail, getOverview } from '@/lib/stats';
import { getMintExtras } from '@/lib/stats-extra';
import { isMintId } from '@/lib/mintUrl';
import StateBadge from '@/components/StateBadge';
import UptimeStrip from '@/components/UptimeStrip';
import MintIcon from '@/components/MintIcon';
import CompareForm from '@/components/CompareForm';
import { fmtDate, fmtDayKey, fmtMs, fmtPct, fmtSat, hostOf, mintLabel } from '@/components/format';
import { fmtPpk, keysetVersion } from '@/components/MintSections';

export const metadata: Metadata = { title: 'Compare mints' };

const MAX_MINTS = 5;

type Overview = Awaited<ReturnType<typeof getOverview>>['mints'][number];
type Column = { m: Overview; d: Awaited<ReturnType<typeof getMintDetail>>; x: Awaited<ReturnType<typeof getMintExtras>> };
type Row = { label: string; value: (c: Column) => React.ReactNode; num?: (c: Column) => number | null | undefined; better?: 'high' | 'low' };

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: 'Availability',
    rows: [
      { label: 'Uptime 24 h', value: c => fmtPct(c.d?.uptime['24h'] ?? null, 2), num: c => c.d?.uptime['24h'], better: 'high' },
      { label: 'Uptime 30 d', value: c => fmtPct(c.d?.uptime['30d'] ?? null, 2), num: c => c.d?.uptime['30d'], better: 'high' },
      { label: 'Uptime from Frankfurt', value: c => fmtPct(c.x.frankfurtUptime, 2), num: c => c.x.frankfurtUptime, better: 'high' },
      { label: 'Median response', value: c => fmtMs(c.d?.latencyStats.p50 ?? null), num: c => c.d?.latencyStats.p50, better: 'low' },
      { label: 'TLS certificate expires', value: c => (c.d?.mint.tlsExpiresAt ? fmtDate(c.d.mint.tlsExpiresAt) : '—') },
    ],
  },
  {
    title: 'Swaps',
    rows: [
      { label: 'Swap success', value: c => fmtPct(c.d?.swapStats.all.successRate ?? null), num: c => c.d?.swapStats.all.successRate, better: 'high' },
      { label: 'Payout time', value: c => fmtMs(c.m.payoutMs), num: c => c.m.payoutMs, better: 'low' },
      { label: 'Payouts / receipts', value: c => `${c.d?.swapStats.asSource.success ?? 0} / ${c.d?.swapStats.asDest.success ?? 0}` },
      { label: 'Failures attributed', value: c => c.d?.swapStats.errorsBlamed ?? 0, num: c => c.d?.swapStats.errorsBlamed, better: 'low' },
      { label: 'Audit balance', value: c => fmtSat(c.m.balance) },
    ],
  },
  {
    title: 'Mint',
    rows: [
      { label: 'Input fee', value: c => fmtPpk(c.d?.mint.inputFeePpk ?? null), num: c => c.d?.mint.inputFeePpk, better: 'low' },
      {
        label: 'Software',
        value: c => (
          <span className="cmp-software">
            <span className="mono">{c.m.version ? c.m.version.split('/').map((part, i) => <span key={i}>{i > 0 && <>/<wbr /></>}{part}</span>) : '—'}</span>
            {c.m.versionStatus?.outdated && <span className="outdated">outdated</span>}
          </span>
        ),
      },
      { label: 'Keyset', value: c => keysetVersion(c.d?.mint.activeKeysetId ?? null) },
      { label: 'Supported NUTs', value: c => c.d?.mint.nuts.length ?? 0, num: c => c.d?.mint.nuts.length, better: 'high' },
      { label: 'WebSockets', value: c => (c.m.websockets ? 'Yes' : 'No') },
      { label: 'Nostr reviews', value: c => (c.x.reviews.average == null ? '—' : `${c.x.reviews.average.toFixed(1)} / 5 (${c.x.reviews.rated})`), num: c => (c.x.reviews.rated >= 3 ? c.x.reviews.average : null), better: 'high' },
    ],
  },
];

function bestIndex(row: Row, cols: Column[]) {
  if (!row.num || !row.better || cols.length < 2) return -1;
  const vals = cols.map(c => row.num!(c) ?? null);
  const known = vals.filter((v): v is number => v != null);
  if (known.length < 2) return -1;
  const target = row.better === 'high' ? Math.max(...known) : Math.min(...known);
  if (known.every(v => v === target)) return -1;
  return vals.filter(v => v === target).length === 1 ? vals.indexOf(target) : -1;
}

function quickPicks(mints: Overview[]) {
  const pool = mints.filter(m => !m.longOffline && !m.isTest && m.state !== 'error');
  const top = (key: (m: Overview) => number | null, dir: 1 | -1) =>
    [...pool].filter(m => key(m) != null).sort((a, b) => dir * (key(a)! - key(b)!)).slice(0, MAX_MINTS).map(m => m.id);
  return [
    { label: 'Highest audit score', ids: top(m => m.score, -1) },
    { label: 'Fastest payouts', ids: top(m => m.payoutMs, 1) },
    { label: 'Fastest response', ids: top(m => m.avgLatency24h, 1) },
  ].filter(p => p.ids.length >= 2);
}

export default async function Compare({ searchParams }: { searchParams: Promise<{ m?: string | string[] }> }) {
  const raw = (await searchParams).m;
  const ids = [...new Set((Array.isArray(raw) ? raw : raw ? [raw] : []).filter(isMintId))].slice(0, MAX_MINTS);
  const { mints } = await getOverview();
  const options = [...mints].filter(m => !m.longOffline).sort((a, b) => mintLabel(a).localeCompare(mintLabel(b)));
  const picked = ids.map(id => mints.find(m => m.id === id)).filter((m): m is Overview => !!m);
  const cols: Column[] = await Promise.all(picked.map(async m => ({ m, d: await getMintDetail(m.id, '30d'), x: await getMintExtras(m.id, '30d') })));
  const style = { '--cmp-cols': cols.length } as React.CSSProperties;

  return (
    <>
      <p className="eyebrow">Compare</p>
      <h1 className="h1" style={{ marginTop: 8 }}>Compare mints</h1>
      <p className="soft" style={{ margin: '8px 0 0' }}>Up to five mints side by side over the last 30 days. The best value in each row is highlighted.</p>

      <CompareForm options={options.map(o => ({ id: o.id, label: mintLabel(o) }))} selected={picked.map(m => m.id)} max={MAX_MINTS} presets={quickPicks(mints)} />

      {cols.length === 0 ? (
        <p className="small muted" style={{ marginTop: 24 }}>Choose at least one mint, or start from a quick pick.</p>
      ) : (
        <section className="section cmp" style={style} data-cols={cols.length}>
          <div className="cmp-row cmp-heads">
            <div className="cmp-label" aria-hidden="true" />
            {cols.map(c => (
              <div key={c.m.id} className="cmp-head">
                <div className="cmp-head-top">
                  <MintIcon id={c.m.id} hash={c.m.iconHash} label={mintLabel(c.m)} size={36} />
                  <StateBadge kind={c.m.state} title={c.m.reasons.join(' · ')} />
                </div>
                <Link href={`/mint/${c.m.id}`} prefetch={false} className="cmp-name">{mintLabel(c.m)}</Link>
                <span className="url">{hostOf(c.m.url)}</span>
                <div className="cmp-score"><b>{c.m.score ?? '—'}</b><span>/ 100</span></div>
                <UptimeStrip
                  variant="compact"
                  ariaLabel={`Daily availability of ${mintLabel(c.m)}`}
                  cells={(c.d?.days ?? []).slice(-30).map(x => ({ uptime: x.uptime, label: fmtDayKey(x.day) }))}
                />
              </div>
            ))}
          </div>
          {GROUPS.map(g => (
            <div key={g.title} className="cmp-group">
              <h2 className="cmp-group-title">{g.title}</h2>
              {g.rows.map(r => {
                const best = bestIndex(r, cols);
                return (
                  <div key={r.label} className="cmp-row">
                    <div className="cmp-label">{r.label}</div>
                    {cols.map((c, i) => (
                      <div key={c.m.id} className={`cmp-cell${i === best ? ' is-best' : ''}`}>
                        {r.value(c)}
                        {i === best && <span className="sr-only"> (best)</span>}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
