import Link from 'next/link';
import { getOverview, getRecentSwaps, LONG_OFFLINE_DAYS, type MintState } from '@/lib/stats';
import { GraphLegend } from '@/components/MintGraph';
import MintNetwork from '@/components/MintNetworkLazy';
import StateBadge from '@/components/StateBadge';
import MintIcon from '@/components/MintIcon';
import SearchBox from '@/components/SearchBox';
import HourStrip from '@/components/HourStrip';
import { Suspense } from 'react';
import { UptimeLegend } from '@/components/UptimeStrip';
import StatusBars, { StatusTable } from '@/components/StatusBars';
import SwapTable from '@/components/SwapTable';
import { AddMintForm } from '@/components/Forms';
import { BoltIcon, CoinIcon, DonateButton } from '@/components/Donate';
import { fmtAgo, fmtDate, fmtDayKey, fmtDuration, fmtMs, fmtPct, fmtSat, hostOf, mintLabel, HOUR_MS } from '@/components/format';

export const revalidate = 60;

const STATE_ORDER: Record<MintState, number> = { ok: 0, warn: 0, unknown: 1, error: 2 };

const COLUMNS = {
  state: ['State', 'State'],
  score: ['Score', 'Score'],
  name: ['Mint', 'Mint'],
  uptime: ['Uptime 30 d', '30 d'],
  latency: ['Latency', 'ms'],
  balance: ['Balance', 'Balance'],
  errors: ['Errors', 'Errors'],
} as const;
type SortKey = keyof typeof COLUMNS;

type Row = Awaited<ReturnType<typeof getOverview>>['mints'][number];

const compare: Record<SortKey, (a: Row, b: Row) => number> = {
  state: (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state],
  score: (a, b) => (a.score ?? -1) - (b.score ?? -1),
  name: (a, b) => mintLabel(a).localeCompare(mintLabel(b)),
  uptime: (a, b) => (a.uptime30d ?? -1) - (b.uptime30d ?? -1),
  latency: (a, b) => (a.avgLatency24h ?? Infinity) - (b.avgLatency24h ?? Infinity),
  balance: (a, b) => a.balance - b.balance,
  errors: (a, b) => a.errors - b.errors,
};

function SortHeader({ col, sort, dir, align, className, query, first = 'asc' }: { col: SortKey; sort: SortKey; dir: 'asc' | 'desc'; align?: 'r'; className?: string; query: string; first?: 'asc' | 'desc' }) {
  const active = col === sort;
  const next = active ? (dir === 'asc' ? 'desc' : 'asc') : first;
  return (
    <th className={[align, className].filter(Boolean).join(' ') || undefined} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <Link className="sort" href={`/?${query}${query ? '&' : ''}sort=${col}&dir=${next}`} aria-current={active} scroll={false} prefetch={false}>
        <span className="lbl-long">{COLUMNS[col][0]}</span>
        <span className="lbl-short">{COLUMNS[col][1]}</span>
        <span aria-hidden="true" style={{ fontSize: 10, color: active ? 'var(--copper)' : 'var(--ink-3)' }}>
          {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </Link>
    </th>
  );
}

const FILTERS = [
  { key: 'online', label: 'Online' },
  { key: 'free', label: 'No input fee' },
  { key: 'ws', label: 'WebSockets' },
  { key: 'onion', label: 'Onion' },
] as const;

type Params = { sort?: string; dir?: string; online?: string; free?: string; ws?: string; onion?: string; unit?: string; q?: string };

function filterQuery(p: Params, change: Partial<Record<keyof Params, string | undefined>> = {}, keepSort = true) {
  const q = new URLSearchParams();
  const merged = { ...p, ...change };
  for (const k of ['q', 'online', 'free', 'ws', 'onion', 'unit'] as const) if (merged[k]) q.set(k, merged[k]!);
  if (keepSort) for (const k of ['sort', 'dir'] as const) if (merged[k]) q.set(k, merged[k]!);
  return q.toString();
}

export default async function Overview({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const sort: SortKey = params.sort && params.sort in COLUMNS ? (params.sort as SortKey) : 'state';
  const dir = params.dir === 'desc' ? 'desc' : 'asc';

  const [{ mints, totals, swapsPerDay, now }, recent] = await Promise.all([getOverview(), getRecentSwaps({ take: 20 })]);
  const graphNodes = mints.map(m => ({ id: m.id, label: mintLabel(m), state: m.state }));

  const terms = (params.q ?? '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const matches = (m: (typeof mints)[number]) => {
    if (!terms.length) return true;
    const hay = [m.name, m.url, m.version, mintLabel(m), ...m.aliases.flatMap(a => [a.url, a.name])].filter(Boolean).join(' ').toLowerCase();
    return terms.every(t => hay.includes(t));
  };
  const allActive = mints.filter(m => !m.longOffline);
  const active = allActive.filter(matches);
  const archivedAll = mints.filter(m => m.longOffline);
  const archived = archivedAll.filter(matches).sort((a, b) => (b.offlineSince ?? 0) - (a.offlineSince ?? 0));
  const allUnits = [...new Set(allActive.flatMap(m => m.units))].filter(u => u !== 'sat').sort();
  const filtered = active.filter(m =>
    (!params.online || (m.latestStatus && m.latestStatus !== 'offline')) &&
    (!params.free || m.inputFeePpk === 0) &&
    (!params.ws || m.websockets) &&
    (!params.onion || !!m.onionUrl) &&
    (!params.unit || m.units.includes(params.unit))
  );
  const query = filterQuery(params, {}, false);
  const rows = [...filtered].sort((a, b) => {
    const c = compare[sort](a, b) || compare.state(a, b) || compare.latency(a, b) || compare.name(a, b);
    return dir === 'asc' ? c : -c;
  });

  const firstActive = swapsPerDay.findIndex(d => d.success + d.failed + d.pending > 0);
  const bars = swapsPerDay
    .slice(firstActive < 0 ? 0 : Math.max(0, Math.min(firstActive, swapsPerDay.length - 7)))
    .map(d => ({ label: fmtDayKey(d.day), success: d.success, failed: d.failed, pending: d.pending }));
  const currentHour = Math.floor(now / HOUR_MS);

  return (
    <>
      <section>
        <p className="eyebrow">Cashu mint audit</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, marginTop: 8 }}>
          <div style={{ maxWidth: 640 }}>
            <h1 className="h1">Do Cashu mints actually pay?</h1>
            <p className="soft" style={{ margin: '10px 0 0' }}>
              Every 5 minutes we check each mint&apos;s API. Several times a day we move real sats between mints over
              Lightning and record what happened. No ratings, only measurements.
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="hero-num">{totals.online}<span className="soft" style={{ fontSize: 28, fontWeight: 500 }}> / {allActive.length}</span></div>
            <div className="small soft">mints answering now · checked {fmtAgo(now, totals.lastCheck)}</div>
          </div>
        </div>
      </section>

      <section className="section tiles" aria-label="Summary">
        <div className="tile">
          <div className="tile-label">Swap success</div>
          <div className="tile-value">{fmtPct(totals.successRate)}</div>
          <div className="tile-sub">{totals.swaps} swaps · {totals.swaps24h} in 24 h{totals.pending ? ` · ${totals.pending} pending` : ''}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Moved over Lightning</div>
          <div className="tile-value">{totals.swapped.toLocaleString('en-US')}<small>sat</small></div>
          <div className="tile-sub">Fees paid {fmtSat(totals.fees)}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Average swap time</div>
          <div className="tile-value">{fmtMs(totals.avgSwapMs)}</div>
          <div className="tile-sub">Quote to minted proofs</div>
        </div>
        <div className="tile">
          <div className="tile-label">Audit balance</div>
          <div className="tile-value">{totals.balance.toLocaleString('en-US')}<small>sat</small></div>
          <div className="tile-sub">Donated {fmtSat(totals.donated)}{totals.reserved ? ` · ${fmtSat(totals.reserved)} in flight` : ''}</div>
        </div>
      </section>

      <section className="fund-strip" aria-label="Fund the audit">
        <div className="fund-text">
          <p className="fund-title">Keep the swaps running</p>
          <p className="soft small" style={{ margin: 0 }}>Each swap spends real sats on Lightning fees. Donations fund the next ones.</p>
        </div>
        <div className="fund-actions">
          <DonateButton className="btn"><BoltIcon /> Lightning</DonateButton>
          <DonateButton tab="ecash" className="btn secondary"><CoinIcon /> Ecash</DonateButton>
        </div>
      </section>

      <section className="section" id="mints">
        <div className="section-head">
          <h2 className="h2">Mints</h2>
          <UptimeLegend />
        </div>
        <nav className="filters" aria-label="Filter mints">
          <Suspense fallback={null}><SearchBox /></Suspense>
          {(() => {
            const options = [
              ...FILTERS.map(f => ({ key: f.key, label: f.label, on: !!params[f.key], href: `/?${filterQuery(params, { [f.key]: params[f.key] ? undefined : '1' })}` })),
              ...allUnits.map(u => ({ key: `unit-${u}`, label: `Unit ${u.toUpperCase()}`, on: params.unit === u, href: `/?${filterQuery(params, { unit: params.unit === u ? undefined : u })}` })),
            ];
            const count = options.filter(o => o.on).length;
            return (
              <details className="filter-menu">
                <summary>Filters{count ? ` · ${count}` : ''}</summary>
                <div className="filter-list" role="menu">
                  {options.map(o => (
                    <Link key={o.key} role="menuitemcheckbox" aria-checked={o.on} href={o.href} scroll={false} prefetch={false}>
                      <span className="check" aria-hidden="true">{o.on ? '✓' : ''}</span>{o.label}
                    </Link>
                  ))}
                  {count > 0 && (
                    <Link className="filter-clear" href={`/?${filterQuery({ sort: params.sort, dir: params.dir, q: params.q })}`} scroll={false} prefetch={false}>Clear filters</Link>
                  )}
                </div>
              </details>
            );
          })()}
          <span className="small muted">{rows.length} of {allActive.length} mints{terms.length && archivedAll.length ? ` · ${archived.length} of ${archivedAll.length} long offline` : ''}</span>
        </nav>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <SortHeader col="state" sort={sort} dir={dir} query={query} />
                <SortHeader col="name" sort={sort} dir={dir} query={query} />
                <SortHeader col="score" sort={sort} dir={dir} align="r" className="c-sm" query={query} first="desc" />
                <th className="c-lg">Last 24 h</th>
                <SortHeader col="uptime" sort={sort} dir={dir} query={query} align="r" />
                <SortHeader col="latency" sort={sort} dir={dir} query={query} align="r" />
                <th className="c-xl">Version</th>
                <SortHeader col="balance" sort={sort} dir={dir} query={query} align="r" className="c-lg" />
                <SortHeader col="errors" sort={sort} dir={dir} query={query} align="r" className="c-md" />
              </tr>
            </thead>
            <tbody>
              {rows.map(m => (
                <tr key={m.id}>
                  <td><StateBadge kind={m.state} title={m.reasons.join(' · ')} /></td>
                  <td>
                    <div className="mint-cell">
                      <MintIcon id={m.id} hash={m.iconHash} label={mintLabel(m)} />
                      <div style={{ minWidth: 0 }}>
                        <Link className="rowlink" href={`/mint/${m.id}`} title={mintLabel(m)} prefetch={false}>{mintLabel(m)}</Link>
                        {m.name && <div className="url" title={m.url}>{hostOf(m.url)}</div>}
                        {m.isTest && <div className="url" title="Test mint: may issue unbacked ecash. Checked, but not used as a swap destination.">test mint</div>}
                        {m.aliases.length > 0 && <div className="url" title={m.aliases.map(a => a.url).join('\n')}>also {m.aliases.map(a => hostOf(a.url)).join(', ')}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="r nowrap c-sm" title={m.scoreParts.map(p => `${p.label}: ${p.score == null ? '—' : Math.round(p.score)} (${p.detail})`).join('\n')}>
                    {m.score == null ? <span className="muted">—</span> : <strong className="num">{m.score}</strong>}
                  </td>
                  <td className="c-lg">
                    <HourStrip values={m.strip.map(v => (v == null ? null : Math.round(v * 100) / 100))} firstHour={currentHour - 23} label={`Hourly availability of ${mintLabel(m)} in the last 24 hours`} />
                  </td>
                  <td className="r nowrap" title={`24 h ${fmtPct(m.uptime24h)} · 7 d ${fmtPct(m.uptime7d)}`}>{fmtPct(m.uptime30d)}</td>
                  <td className="r nowrap">{fmtMs(m.avgLatency24h)}</td>
                  <td className="mono soft nowrap c-xl"><span className="cell-clip" title={m.version ?? undefined}>{m.version ?? '—'}</span></td>
                  <td className="r nowrap c-lg">{m.balance ? fmtSat(m.balance) : <span className="muted">—</span>}</td>
                  <td className="r nowrap c-md">{m.errors || <span className="muted">0</span>}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 32 }}>{mints.length ? (archived.length ? 'No active mint matches. See long offline mints below.' : 'No mint matches these filters.') : 'No mints tracked yet.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {archived.length > 0 && (
          <details className="table-view archive" open={terms.length > 0}>
            <summary>Offline for more than {LONG_OFFLINE_DAYS} days ({archived.length}{terms.length ? ` of ${archivedAll.length}` : ''})</summary>
            <p className="small soft" style={{ margin: '8px 0 0' }}>Still checked every 5 minutes. A mint that answers again moves back to the table above.</p>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Mint</th><th className="c-sm">Last online</th><th className="r">Offline for</th><th className="c-md">Last error</th></tr></thead>
                <tbody>
                  {archived.map(m => (
                    <tr key={m.id}>
                      <td>
                        <div className="mint-cell">
                          <MintIcon id={m.id} hash={m.iconHash} label={mintLabel(m)} />
                          <div style={{ minWidth: 0 }}>
                            <Link className="rowlink" href={`/mint/${m.id}`} title={mintLabel(m)} prefetch={false}>{mintLabel(m)}</Link>
                            {m.name && <div className="url" title={m.url}>{hostOf(m.url)}</div>}
                            {m.aliases.length > 0 && <div className="url" title={m.aliases.map(a => a.url).join('\n')}>also {m.aliases.map(a => hostOf(a.url)).join(', ')}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="nowrap soft c-sm">{m.lastOnlineAt ? fmtDate(m.lastOnlineAt) : 'Never seen online'}</td>
                      <td className="r nowrap">{m.offlineSince ? fmtDuration(now - m.offlineSince) : '—'}</td>
                      <td className="small soft cell-wrap c-md">{m.latestError ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
        <p className="small muted" style={{ marginTop: 8 }}>
          Latency is the 24-hour average of <span className="mono">GET /v1/info</span> from Prague. Errors count failed swaps attributed to the mint.
        </p>
      </section>

      <section className="section card" id="swaps">
        <div className="card-head">
          <div>
            <h2 className="h2">Swaps per day</h2>
            <p className="small soft" style={{ margin: 0 }}>Last {bars.length} days · a swap melts ecash at one mint and mints it at another</p>
          </div>
        </div>
        <StatusBars buckets={bars} ariaLabel="Swaps per day over the last 30 days, split into paid, failed and pending" firstLabel={bars[0]?.label ?? ''} lastLabel="Today" />
        <StatusTable buckets={bars} head="Day" />
      </section>

      <section className="section card" id="network">
        <div className="card-head">
          <div>
            <h2 className="h2">Swap network</h2>
            <p className="small soft" style={{ margin: 0 }}>Which mints paid which</p>
          </div>
          <GraphLegend />
        </div>
        <MintNetwork nodes={graphNodes} />
      </section>

      <section className="section">
        <div className="section-head"><h2 className="h2">Recent swaps</h2></div>
        <SwapTable swaps={recent} emptyText="No swaps yet. They start once the audit wallet holds ecash." />
      </section>

      <section className="section two-col">
        <AddMintForm />
      </section>
    </>
  );
}
