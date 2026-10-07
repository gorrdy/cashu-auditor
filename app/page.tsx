import Link from 'next/link';
import { getOverview, getRecentSwaps, LONG_OFFLINE_DAYS, type MintState } from '@/lib/stats';
import { GraphLegend } from '@/components/GraphLegend';
import MintNetwork from '@/components/MintNetworkLazy';
import StateBadge from '@/components/StateBadge';
import MintIcon from '@/components/MintIcon';
import SearchBox from '@/components/SearchBox';
import HourStrip from '@/components/HourStrip';
import { Suspense } from 'react';
import { UptimeLegend } from '@/components/UptimeStrip';
import StatusBars, { StatusTable } from '@/components/StatusBars';
import SwapTable from '@/components/SwapTable';
import { AddMintButton } from '@/components/Forms';
import { DonateButton } from '@/components/Donate';
import { BoltIcon, CoinIcon } from '@/components/icons';
import { fmtAgo, fmtDate, fmtDayKey, fmtDuration, fmtMs, fmtPct, fmtSat, hostOf, mintLabel, HOUR_MS } from '@/components/format';

export const revalidate = 60;

const RUNWAY_SCALE_DAYS = 60;
const TOP_MINTS = 6;
const STATE_ORDER: Record<MintState, number> = { ok: 0, warn: 1, unknown: 2, error: 3 };

const COLUMNS = {
  state: ['State', 'State'],
  score: ['Score', 'Score'],
  name: ['Mint', 'Mint'],
  uptime: ['Uptime 30 d', '30 d'],
  latency: ['Latency', 'ms'],
  payout: ['Payout', 'Payout'],
  balance: ['Balance', 'Balance'],
  errors: ['Errors', 'Errors'],
} as const;
type SortKey = keyof typeof COLUMNS;
const SORT_FIRST: Record<SortKey, 'asc' | 'desc'> = { state: 'asc', name: 'asc', score: 'desc', uptime: 'desc', latency: 'asc', payout: 'asc', balance: 'desc', errors: 'asc' };

type Row = Awaited<ReturnType<typeof getOverview>>['mints'][number];

const compare: Record<SortKey, (a: Row, b: Row) => number> = {
  state: (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state],
  score: (a, b) => (a.score ?? -1) - (b.score ?? -1),
  name: (a, b) => mintLabel(a).localeCompare(mintLabel(b)),
  uptime: (a, b) => (a.uptime30d ?? -1) - (b.uptime30d ?? -1),
  latency: (a, b) => (a.avgLatency24h ?? Infinity) - (b.avgLatency24h ?? Infinity),
  payout: (a, b) => (a.payoutMs ?? Infinity) - (b.payoutMs ?? Infinity),
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
        <span aria-hidden="true" style={{ fontSize: 10, color: active ? 'var(--accent)' : 'var(--ink-3)' }}>
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

type Params = { sort?: string; dir?: string; online?: string; free?: string; ws?: string; onion?: string; unit?: string; q?: string; view?: string; all?: string };

function filterQuery(p: Params, change: Partial<Record<keyof Params, string | undefined>> = {}, keepSort = true) {
  const q = new URLSearchParams();
  const merged = { ...p, ...change };
  for (const k of ['q', 'online', 'free', 'ws', 'onion', 'unit', 'view', 'all'] as const) if (merged[k]) q.set(k, merged[k]!);
  if (keepSort) for (const k of ['sort', 'dir'] as const) if (merged[k]) q.set(k, merged[k]!);
  return q.toString();
}

export default async function Overview({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const sort: SortKey = params.sort && params.sort in COLUMNS ? (params.sort as SortKey) : 'score';
  const dir = params.dir === 'desc' || params.dir === 'asc' ? params.dir : SORT_FIRST[sort];
  const view = params.view === 'table' ? 'table' : 'cards';

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
  const sorted = [...filtered].sort((a, b) =>
    (dir === 'asc' ? 1 : -1) * compare[sort](a, b) || compare.state(a, b) || compare.latency(a, b) || compare.name(a, b)
  );
  const showAll = params.all === '1' || terms.length > 0 || sorted.length <= TOP_MINTS + 2;
  const rows = showAll ? sorted : sorted.slice(0, TOP_MINTS);
  const moreLink = (
    <div className="show-more">
      {showAll && params.all === '1' ? (
        <Link href={`/?${filterQuery(params, { all: undefined })}#mints`} scroll={false} prefetch={false} className="btn secondary">Show top {TOP_MINTS}</Link>
      ) : !showAll ? (
        <Link href={`/?${filterQuery(params, { all: '1' })}`} scroll={false} prefetch={false} className="btn secondary">Show all {sorted.length} mints</Link>
      ) : null}
    </div>
  );

  const runway = totals.runwayDays;
  const runwayLevel = runway == null ? 'good' : runway < 10 ? 'critical' : runway < 30 ? 'warning' : 'good';
  const firstActive = swapsPerDay.findIndex(d => d.success + d.failed + d.pending > 0);
  const bars = swapsPerDay
    .slice(firstActive < 0 ? 0 : Math.max(0, Math.min(firstActive, swapsPerDay.length - 7)))
    .map(d => ({ label: fmtDayKey(d.day), success: d.success, failed: d.failed, pending: d.pending }));
  const currentHour = Math.floor(now / HOUR_MS);

  return (
    <>
      <section>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, marginTop: 8 }}>
          <div style={{ maxWidth: 640 }}>
            <h1 className="h1 hero-title">Do Cashu mints <span className="h1-accent">actually pay?</span></h1>
            <p className="soft" style={{ margin: '10px 0 0' }}>
              Every 5 minutes we check each mint&apos;s API. Every day each mint pays out and receives real sats over
              Lightning, and we record what happened. No ratings, only measurements.
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
          {runway == null ? (
            <>
              <p className="fund-title">Keep the swaps running</p>
              <p className="soft small" style={{ margin: 0 }}>Each swap spends real sats on Lightning fees. Donations fund the next ones.</p>
            </>
          ) : (
            <>
              <p className="fund-title">
                {runway < 1 ? 'Swaps are funded for less than a day' : <>Swaps are funded for <b className={`runway-days runway-${runwayLevel}`}>{Math.floor(runway)} more {Math.floor(runway) === 1 ? 'day' : 'days'}</b></>}
              </p>
              <div className="runway" role="img" aria-label={`About ${Math.floor(runway)} days of swaps left`}>
                <i className={`runway-${runwayLevel}`} style={{ width: `${Math.min(100, (runway / RUNWAY_SCALE_DAYS) * 100)}%` }} />
              </div>
              <p className="soft small" style={{ margin: 0 }}>
                At an estimated {fmtSat(totals.feesPerDay)} a day in Lightning fees for one payout and one receipt per mint. Every donation adds days.
              </p>
            </>
          )}
        </div>
        <div className="fund-actions">
          <DonateButton className="btn"><BoltIcon /> Lightning</DonateButton>
          <DonateButton tab="ecash" className="btn secondary"><CoinIcon /> Ecash</DonateButton>
        </div>
      </section>

      <section className="section" id="mints">
        <div className="section-head">
          <div className="title-row">
            <h2 className="h2">Mints</h2>
            <AddMintButton />
          </div>
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
                <div className="filter-list">
                  {options.map(o => (
                    <Link key={o.key} href={o.href} scroll={false} prefetch={false}>
                      <span className="check" aria-hidden="true">{o.on ? '✓' : ''}</span>{o.label}{o.on && <span className="sr-only"> (on)</span>}
                    </Link>
                  ))}
                  {count > 0 && (
                    <Link className="filter-clear" href={`/?${filterQuery({ sort: params.sort, dir: params.dir, q: params.q })}`} scroll={false} prefetch={false}>Clear filters</Link>
                  )}
                </div>
              </details>
            );
          })()}
          <details className={`filter-menu sort-menu${view === 'cards' ? ' always' : ''}`}>
            <summary>Sort: {COLUMNS[sort][0]}</summary>
            <div className="filter-list">
              {(Object.keys(COLUMNS) as SortKey[]).map(k => {
                const d = k === sort ? (dir === 'asc' ? 'desc' : 'asc') : SORT_FIRST[k];
                return (
                  <Link key={k} href={`/?${query}${query ? '&' : ''}sort=${k}&dir=${d}`} scroll={false} prefetch={false}>
                    <span className="check" aria-hidden="true">{k === sort ? (dir === 'asc' ? '▲' : '▼') : ''}</span>{COLUMNS[k][0]}
                  </Link>
                );
              })}
            </div>
          </details>
          <div className="segmented view-switch" role="group" aria-label="View">
            <Link href={`/?${filterQuery(params, { view: undefined })}`} aria-current={view === 'cards' ? 'page' : undefined} scroll={false} prefetch={false}>Cards</Link>
            <Link href={`/?${filterQuery(params, { view: 'table' })}`} aria-current={view === 'table' ? 'page' : undefined} scroll={false} prefetch={false}>Table</Link>
          </div>
          <span className="small muted">{sorted.length} of {allActive.length} mints{terms.length && archivedAll.length ? ` · ${archived.length} of ${archivedAll.length} long offline` : ''}</span>
        </nav>
        {view === 'cards' ? (
          <ul className="mint-cards">
            {rows.map(m => (
              <li key={m.id} className="mint-card">
                <Link className="mint-card-link" href={`/mint/${m.id}`} prefetch={false} aria-label={mintLabel(m)} />
                <div className="mc-head">
                  <MintIcon id={m.id} hash={m.iconHash} label={mintLabel(m)} size={40} />
                  <div className="mc-name">
                    <span className="mc-title" title={mintLabel(m)}>{mintLabel(m)}</span>
                    <span className="url" title={m.url}>{hostOf(m.url)}</span>
                  </div>
                  <span className="mc-state"><StateBadge kind={m.state} title={m.reasons.join(' · ')} /></span>
                </div>
                {(m.versionStatus?.outdated || m.isTest || m.aliases.length > 0) && (
                  <div className="mc-tags">
                    {m.versionStatus?.outdated && <span className="outdated" title={`${m.version} · newest seen in the audit: ${m.versionStatus.newest}`}>outdated software</span>}
                    {m.isTest && <span className="mc-tag">test mint</span>}
                    {m.aliases.length > 0 && <span className="mc-tag" title={m.aliases.map(a => a.url).join('\n')}>also {m.aliases.map(a => hostOf(a.url)).join(', ')}</span>}
                  </div>
                )}
                <div className="mc-strip">
                  <HourStrip values={m.strip.map(v => (v == null ? null : Math.round(v * 100) / 100))} firstHour={currentHour - 23} label={`Hourly availability of ${mintLabel(m)} in the last 24 hours`} />
                </div>
                <dl className="mc-metrics">
                  <div title={m.scoreParts.map(p => `${p.label}: ${p.score == null ? '—' : Math.round(p.score)} (${p.detail})`).join('\n')}><dt>Score</dt><dd>{m.score ?? '—'}</dd></div>
                  <div title={`30 d ${fmtPct(m.uptime30d)} · 7 d ${fmtPct(m.uptime7d)} · 24 h ${fmtPct(m.uptime24h)}`}><dt>Uptime</dt><dd>{fmtPct(m.uptime30d)}</dd></div>
                  <div><dt>Latency</dt><dd>{fmtMs(m.avgLatency24h)}</dd></div>
                  <div title="Median time of a successful payout from this mint, 30 days"><dt>Payout</dt><dd>{m.payoutMs == null ? '—' : fmtMs(m.payoutMs)}</dd></div>
                </dl>
                <p className="mc-foot">
                  <span>{m.balance ? `${fmtSat(m.balance)} held` : 'No balance'}</span>
                  <span>{m.errors ? `${m.errors} error${m.errors === 1 ? '' : 's'}` : 'No errors'}</span>
                  {m.version && <span className="mono" title={m.version}>{m.version}</span>}
                </p>
              </li>
            ))}
            {rows.length === 0 && <li className="mint-card mc-empty muted">{mints.length ? (archived.length ? 'No active mint matches. See long offline mints below.' : 'No mint matches these filters.') : 'No mints tracked yet.'}</li>}
          </ul>
        ) : (
        <div className="table-wrap mints-wrap">
          <table className="data mints-table">
            <thead>
              <tr>
                <SortHeader col="state" sort={sort} dir={dir} query={query} className="col-state" />
                <SortHeader col="name" sort={sort} dir={dir} query={query} className="col-mint" />
                <SortHeader col="score" sort={sort} dir={dir} align="r" className="col-score" query={query} first="desc" />
                <th className="col-strip">Last 24 h</th>
                <SortHeader col="uptime" sort={sort} dir={dir} query={query} align="r" className="col-uptime" />
                <SortHeader col="latency" sort={sort} dir={dir} query={query} align="r" className="col-latency" />
                <SortHeader col="payout" sort={sort} dir={dir} query={query} align="r" className="col-payout" />
                <th className="col-version">Version</th>
                <SortHeader col="balance" sort={sort} dir={dir} query={query} align="r" className="col-balance" />
                <SortHeader col="errors" sort={sort} dir={dir} query={query} align="r" className="col-errors" />
              </tr>
            </thead>
            <tbody>
              {rows.map(m => (
                <tr key={m.id}>
                  <td className="col-state"><StateBadge kind={m.state} title={m.reasons.join(' · ')} /></td>
                  <td className="col-mint">
                    <div className="mint-cell">
                      <MintIcon id={m.id} hash={m.iconHash} label={mintLabel(m)} />
                      <div style={{ minWidth: 0 }}>
                        <Link className="rowlink" href={`/mint/${m.id}`} title={mintLabel(m)} prefetch={false}>{mintLabel(m)}</Link>
                        {m.name && <div className="url" title={m.url}>{hostOf(m.url)}</div>}
                        {m.versionStatus?.outdated && <div><span className="outdated" title={`${m.version} · newest seen in the audit: ${m.versionStatus.newest}`}>outdated software</span></div>}
                        {m.isTest && <div className="url" title="Test mint: may issue unbacked ecash. Checked, but not used as a swap destination.">test mint</div>}
                        {m.aliases.length > 0 && <div className="url" title={m.aliases.map(a => a.url).join('\n')}>also {m.aliases.map(a => hostOf(a.url)).join(', ')}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="r nowrap col-score" data-label="Score" title={m.scoreParts.map(p => `${p.label}: ${p.score == null ? '—' : Math.round(p.score)} (${p.detail})`).join('\n')}>
                    {m.score == null ? <span className="muted">—</span> : <strong className="num">{m.score}</strong>}
                  </td>
                  <td className="col-strip">
                    <HourStrip values={m.strip.map(v => (v == null ? null : Math.round(v * 100) / 100))} firstHour={currentHour - 23} label={`Hourly availability of ${mintLabel(m)} in the last 24 hours`} />
                  </td>
                  <td className="r nowrap col-uptime" data-label="Uptime 30 d" title={`24 h ${fmtPct(m.uptime24h)} · 7 d ${fmtPct(m.uptime7d)}`}>{fmtPct(m.uptime30d)}</td>
                  <td className="r nowrap col-latency" data-label="Latency">{fmtMs(m.avgLatency24h)}</td>
                  <td className="r nowrap col-payout" data-label="Payout" title="Median time of a successful payout from this mint, 30 days">{m.payoutMs == null ? <span className="muted">—</span> : fmtMs(m.payoutMs)}</td>
                  <td className="mono soft nowrap col-version"><span className="cell-clip" title={m.version ?? undefined}>{m.version ?? '—'}</span></td>
                  <td className="r nowrap col-balance">{m.balance ? fmtSat(m.balance) : <span className="muted">—</span>}</td>
                  <td className="r nowrap col-errors">{m.errors || <span className="muted">0</span>}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={10} className="muted empty-row" style={{ textAlign: 'center', padding: 32 }}>{mints.length ? (archived.length ? 'No active mint matches. See long offline mints below.' : 'No mint matches these filters.') : 'No mints tracked yet.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        )}
        {moreLink}
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
          Latency is the 24-hour average of <span className="mono">GET /v1/info</span> from Prague. Payout is the median time of a successful swap paid out by the mint, 30 days. Errors count failed swaps attributed to the mint in the last 30 days. Outdated means two or more minor versions behind the newest release of the same software seen in the audit.
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

    </>
  );
}
