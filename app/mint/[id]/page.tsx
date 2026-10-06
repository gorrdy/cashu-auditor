import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { DAY, getMintDetail, getRecentSwaps, parseRange, RANGES, type RangeKey } from '@/lib/stats';
import { prisma } from '@/lib/prisma';
import { isMintId } from '@/lib/mintUrl';
import StateBadge from '@/components/StateBadge';
import MintIcon from '@/components/MintIcon';
import UptimeStrip, { UptimeLegend } from '@/components/UptimeStrip';
import StatusBars, { StatusTable } from '@/components/StatusBars';
import LatencyChart from '@/components/LatencyChart';
import SwapTable from '@/components/SwapTable';
import CopyField from '@/components/CopyField';
import { EventsCard, IntegrityCard, LightningCard, NetworkCard, PayoutsCard, ReviewsCard, SpecCard } from '@/components/MintSections';
import { getMintExtras } from '@/lib/stats-extra';
import { computeScore } from '@/lib/score';
import ScoreTrend from '@/components/ScoreTrend';
import { fmtAgo, fmtDate, fmtDateTime, fmtDayKey, fmtDuration, fmtHour, fmtMs, fmtPct, fmtSat, hostOf, mintLabel } from '@/components/format';
import { mintPage, SITE_URL } from '@/lib/site';

export const revalidate = 60;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ range?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const mint = isMintId(id) ? await prisma.mint.findUnique({ where: { id }, select: { name: true, url: true } }) : null;
  return { title: mint ? mintLabel(mint) : 'Mint not found' };
}

export default async function MintPage({ params, searchParams }: Props) {
  const { id } = await params;
  if (!isMintId(id)) notFound();
  const alias = await prisma.mint.findUnique({ where: { id }, select: { aliasOfId: true } });
  if (alias?.aliasOfId) permanentRedirect(`/mint/${alias.aliasOfId}`);
  const range: RangeKey = parseRange((await searchParams).range);
  const [d, swaps, x] = await Promise.all([getMintDetail(id, range), getRecentSwaps({ mintId: id, take: 30 }), getMintExtras(id, range)]);
  if (!d) notFound();

  const { mint, now } = d;
  const label = mintLabel(mint);
  const r = RANGES[range];
  const stats = d.swapStats;
  const bars = d.swapsPerBucket.map(b => ({
    label: d.swapBucket === DAY ? fmtDayKey(new Date(b.t).toISOString().slice(0, 10)) : `${fmtHour(b.t)}–${fmtHour(b.t + d.swapBucket)}`,
    success: b.success,
    failed: b.failed,
    pending: b.pending,
  }));

  const closed = d.incidents.filter(i => i.end !== null);
  const downMs = d.incidents.reduce((sum, i) => sum + ((i.end ?? now) - Math.max(i.start, now - r.ms)), 0);
  const observedMs = d.firstAuditAt ? now - Math.max(d.firstAuditAt, now - r.ms) : 0;
  const mttr = closed.length ? closed.reduce((sum, i) => sum + (i.end! - i.start), 0) / closed.length : null;
  const mtbf = d.incidents.length && observedMs && observedMs - downMs >= 3_600_000 ? (observedMs - downMs) / d.incidents.length : null;
  const ongoing = d.incidents.some(i => i.end === null);
  const lastEnd = closed.length ? Math.max(...closed.map(i => i.end!)) : null;
  const sd = x.swapDetail;
  const { score, parts: scoreParts } = computeScore({ ...d.scoreInput, reviewAvg: x.reviews.average, reviewCount: x.reviews.rated });

  return (
    <>
      <p className="small"><Link href="/">← All mints</Link></p>

      <section style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start', justifyContent: 'space-between', marginTop: 12 }}>
        <div style={{ display: 'flex', gap: 16, minWidth: 0 }}>
          <MintIcon id={mint.id} hash={mint.iconHash} label={mint.name ?? mint.url} size={56} />
          <div style={{ minWidth: 0 }}>
            <p className="eyebrow">{mint.isTest ? 'Test mint' : 'Mint'}</p>
            <h1 className="h1" style={{ overflowWrap: 'anywhere' }}>{label}</h1>
            <p className="mono soft" style={{ margin: '6px 0 0', overflowWrap: 'anywhere' }}>{mint.url}</p>
            {x.aliases.length > 0 && (
              <p className="small soft" style={{ margin: '4px 0 0', overflowWrap: 'anywhere' }}>
                Also reachable as {x.aliases.map((a, i) => <span key={a.id}>{i ? ', ' : ''}<span className="mono">{hostOf(a.url)}</span>{a.name && a.name !== mint.name ? ` (${a.name})` : ''}</span>)} · <a href="#addresses">same mint</a>
              </p>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="hero-num" style={{ fontSize: 40, lineHeight: '44px' }}>{score ?? '—'}<span className="soft" style={{ fontSize: 16, fontWeight: 500 }}> / 100</span></div>
          <div className="small muted" style={{ marginBottom: 8 }}><a href="#score">Audit score</a></div>
          <StateBadge kind={d.state} />
          <div className="small soft" style={{ marginTop: 6 }}>
            {d.reasons.length ? d.reasons.join(' · ') : 'Answering and paying'}
          </div>
          <div className="small muted">Last check {fmtAgo(now, d.lastAudit?.timestamp ?? null)}</div>
        </div>
      </section>

      {mint.description && <p className="soft" style={{ maxWidth: 720, marginTop: 16 }}>{mint.description}</p>}
      {mint.isTest && (
        <p className="small" style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <StateBadge kind="warn" label="Test mint" />
          Describes itself as a test mint, so its ecash may be unbacked. It is checked like any other mint but never receives swaps.
        </p>
      )}
      {mint.motd && (
        <p className="small" style={{ marginTop: 12, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', display: 'flex', gap: 8, maxWidth: 720 }}>
          <span className="eyebrow" style={{ flex: 'none' }}>MOTD</span>
          <span style={{ overflowWrap: 'anywhere' }}>{mint.motd}</span>
        </p>
      )}

      <section className="section card">
        <div className="card-head">
          <div>
            <h2 className="h2">Availability</h2>
            <p className="small soft" style={{ margin: 0 }}>Share of 5-minute checks where <span className="mono">/v1/info</span> answered, per day, last 90 days</p>
          </div>
          <UptimeLegend />
        </div>
        <UptimeStrip
          ariaLabel={`Daily availability of ${label} over the last 90 days`}
          cells={d.days.map(x => ({ uptime: x.uptime, label: fmtDayKey(x.day), detail: `${x.checks} checks` }))}
        />
        <div className="x-axis"><span>90 days ago</span><span>Today</span></div>
        <div className="tiles" style={{ marginTop: 20 }}>
          {(['24h', '7d', '30d', '90d'] as const).map(k => (
            <div key={k} className="tile" style={{ background: 'var(--surface-2)', borderColor: 'transparent' }}>
              <div className="tile-label">Uptime {k.replace('h', ' h').replace('d', ' d')}</div>
              <div className="tile-value">{fmtPct(d.uptime[k], 2)}</div>
            </div>
          ))}
        </div>
        <div className="tiles" style={{ marginTop: 12 }}>
          <div><div className="tile-label">Since last outage</div><div className="tile-value">{ongoing ? 'Down now' : lastEnd ? fmtDuration(now - lastEnd) : 'No outage'}</div><div className="tile-sub">in the last {r.label}</div></div>
          <div><div className="tile-label">Time to recover (MTTR)</div><div className="tile-value">{mttr != null ? fmtDuration(mttr) : '—'}</div><div className="tile-sub">{closed.length} closed outage{closed.length === 1 ? '' : 's'}</div></div>
          <div><div className="tile-label">Time between outages (MTBF)</div><div className="tile-value">{mtbf != null ? fmtDuration(mtbf) : '—'}</div><div className="tile-sub">{d.incidents.length} outage{d.incidents.length === 1 ? '' : 's'} in {r.label}</div></div>
          <div><div className="tile-label">Uptime from Frankfurt</div><div className="tile-value">{fmtPct(x.frankfurtUptime, 2)}</div><div className="tile-sub">{x.frankfurtChecks} checks in {r.label}</div></div>
        </div>
      </section>

      <section className="section" aria-label="Range">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="small soft">Showing</span>
          <nav className="segmented" aria-label="Time range">
            {(Object.keys(RANGES) as RangeKey[]).map(k => (
              <Link key={k} href={`/mint/${mint.id}?range=${k}`} aria-current={k === range ? 'page' : undefined} scroll={false} prefetch={false}>
                {RANGES[k].label}
              </Link>
            ))}
          </nav>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div>
            <h2 className="h2">Response time</h2>
            <p className="small soft" style={{ margin: 0 }}>
              <span className="mono">GET /v1/info</span> · lines are medians, the band reaches the Prague 95th percentile
            </p>
          </div>
          <div className="legend">
            <span><i className="line" style={{ background: 'var(--series-1)' }} />Prague</span>
            <span><i className="wash" style={{ background: 'var(--series-1)', opacity: 0.25 }} />Prague p95</span>
            <span><i className="line" style={{ background: 'var(--series-2)' }} />Frankfurt</span>
          </div>
        </div>
        <div className="tiles" style={{ marginBottom: 16 }}>
          <div><div className="tile-label">Median</div><div className="tile-value">{fmtMs(d.latencyStats.p50)}</div></div>
          <div><div className="tile-label">95th percentile</div><div className="tile-value">{fmtMs(d.latencyStats.p95)}</div></div>
          <div><div className="tile-label">Slowest</div><div className="tile-value">{fmtMs(d.latencyStats.max)}</div></div>
          <div><div className="tile-label">Successful checks</div><div className="tile-value">{d.latencyStats.samples}</div></div>
        </div>
        <LatencyChart points={d.latency} bucketMs={r.bucket} spanMs={r.ms} secondary={x.frankfurtLatency} />
        <details className="table-view">
          <summary>Show table</summary>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>From</th><th className="r">Prague</th><th className="r c-sm">Prague p95</th><th className="r">Frankfurt</th><th className="r c-md">Keysets avg</th><th className="r c-md">Checks</th></tr></thead>
              <tbody>
                {d.latency.map((p, i) => ({ p, k: d.keysetLatency[i], f: x.frankfurtLatency[i] })).reverse().map(({ p, k, f }) => (
                  <tr key={p.t}>
                    <td className="nowrap">{fmtDateTime(p.t)}</td>
                    <td className="r">{fmtMs(p.p50)}</td>
                    <td className="r c-sm">{fmtMs(p.p95)}</td>
                    <td className="r">{fmtMs(f)}</td>
                    <td className="r c-md">{fmtMs(k)}</td>
                    <td className="r c-md">{p.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="section card">
        <div className="card-head">
          <div>
            <h2 className="h2">Lightning swaps</h2>
            <p className="small soft" style={{ margin: 0 }}>Swaps where this mint paid out (melt) or received (mint), last {r.label}</p>
            {x.backoff && (x.backoff.pending || x.backoff.banned || x.backoff.until > now) && (
              <p className="small" style={{ margin: '8px 0 0', display: 'flex', gap: 6, alignItems: 'center' }}>
                <StateBadge kind="warn" label={x.backoff.banned ? 'Payouts stopped' : x.backoff.pending ? 'Payouts paused' : 'Swaps paused'} />
                {x.backoff.banned
                  ? 'This mint reported a payment as paid with an invalid preimage in the last 7 days; it is not used as a source.'
                  : x.backoff.pending
                  ? 'A payout from this mint is still pending; it is not used as a source until it resolves.'
                  : `After ${x.backoff.failures} attributed failure${x.backoff.failures === 1 ? '' : 's'} in a row, next attempt after ${fmtDateTime(x.backoff.until)}.`}
              </p>
            )}
          </div>
        </div>
        <div className="tiles" style={{ marginBottom: 20 }}>
          <div><div className="tile-label">Success rate</div><div className="tile-value">{fmtPct(stats.all.successRate)}</div><div className="tile-sub">{stats.all.success} paid · {stats.all.failed} failed</div></div>
          <div><div className="tile-label">Melts (paid out)</div><div className="tile-value">{stats.asSource.success}<small>/ {stats.asSource.total}</small></div><div className="tile-sub">{fmtSat(stats.asSource.amount)} · fees {fmtSat(stats.asSource.fees)}</div></div>
          <div><div className="tile-label">Mints (received)</div><div className="tile-value">{stats.asDest.success}<small>/ {stats.asDest.total}</small></div><div className="tile-sub">{fmtSat(stats.asDest.amount)}</div></div>
          <div><div className="tile-label">Average swap time</div><div className="tile-value">{fmtMs(stats.all.avgMs)}</div><div className="tile-sub">{stats.errorsBlamed} failure{stats.errorsBlamed === 1 ? '' : 's'} attributed here</div></div>
        </div>
        <div className="tiles" style={{ marginBottom: 20 }}>
          <div><div className="tile-label">Lightning fee (melts)</div><div className="tile-value">{sd.feePct != null ? `${sd.feePct.toFixed(1)} %` : '—'}</div><div className="tile-sub">avg {sd.avgFee != null ? `${sd.avgFee.toFixed(1)} sat` : '—'} kept of {sd.avgFeeReserve != null ? `${sd.avgFeeReserve.toFixed(1)} sat` : '—'} reserved</div></div>
          <div><div className="tile-label">Quotes</div><div className="tile-value">{fmtMs(sd.quoteMs)}</div><div className="tile-sub">median, both mints</div></div>
          <div><div className="tile-label">Lightning payment</div><div className="tile-value">{fmtMs(sd.meltMs)}</div><div className="tile-sub">median melt when paying out</div></div>
          <div><div className="tile-label">Minting</div><div className="tile-value">{fmtMs(sd.mintMs)}</div><div className="tile-sub">median when receiving</div></div>
        </div>
        <StatusBars
          buckets={bars}
          ariaLabel={`Swaps involving ${label} per ${d.swapBucket === DAY ? 'day' : 'hour'}`}
          firstLabel={bars[0]?.label ?? ''}
          lastLabel={d.swapBucket === DAY ? 'Today' : 'Now'}
        />
        <StatusTable buckets={bars} head={d.swapBucket === DAY ? 'Day' : 'Hour'} />
      </section>

      <section className="section">
        <PayoutsCard rows={x.payouts} rangeLabel={r.label} />
      </section>

      <section className="section two-col">
        <div className="card">
          <h2 className="h2">Outages</h2>
          <p className="small soft" style={{ margin: '0 0 12px' }}>Consecutive failed checks, last {r.label}</p>
          {d.incidents.length === 0 ? (
            <p className="small muted" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>No outages recorded in this range.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Started</th><th className="r">Duration</th><th>Error</th></tr></thead>
                <tbody>
                  {d.incidents.slice(0, 50).map(i => (
                    <tr key={i.start}>
                      <td className="nowrap">{fmtDateTime(i.start)}</td>
                      <td className="r nowrap">{i.end ? fmtDuration(i.end - i.start) : <StateBadge kind="error" label="Ongoing" />}</td>
                      <td className="small soft cell-wrap">{i.error ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <EventsCard events={x.events} />
      </section>

      {x.aliases.length > 0 && (
        <section className="section card" id="addresses">
          <h2 className="h2">Addresses</h2>
          <p className="small soft" style={{ margin: '0 0 12px' }}>
            These URLs lead to the same mint: a quote created at one is visible at the other. Each address is checked separately; balance, swaps and score are shared.
          </p>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Address</th><th className="c-sm">Name</th><th>State</th><th className="r">Uptime 24 h</th><th className="r c-sm">Latency</th></tr></thead>
              <tbody>
                <tr>
                  <td className="mono cell-wrap">{hostOf(mint.url)} <span className="chip">primary</span></td>
                  <td className="c-sm">{mint.name ?? '—'}</td>
                  <td><StateBadge kind={d.lastAudit?.status === 'offline' ? 'error' : d.lastAudit?.status === 'degraded' ? 'degraded' : d.lastAudit ? 'ok' : 'unknown'} /></td>
                  <td className="r">{fmtPct(d.uptime['24h'], 2)}</td>
                  <td className="r c-sm">{fmtMs(d.lastAudit && d.lastAudit.status !== 'offline' ? d.lastAudit.latency : null)}</td>
                </tr>
                {x.aliases.map(a => (
                  <tr key={a.id}>
                    <td className="mono cell-wrap">{hostOf(a.url)}</td>
                    <td className="c-sm">{a.name ?? '—'}</td>
                    <td><StateBadge kind={a.status === 'offline' ? 'error' : a.status === 'degraded' ? 'degraded' : a.status ? 'ok' : 'unknown'} title={a.error ?? undefined} /></td>
                    <td className="r">{fmtPct(a.uptime24h, 2)}</td>
                    <td className="r c-sm">{fmtMs(a.latency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="section two-col">
        <IntegrityCard
          now={now}
          checks={x.checks}
          lost={x.lost}
          dleq={sd.dleq}
          tlsIssuer={mint.tlsIssuer}
          tlsExpiresAt={mint.tlsExpiresAt}
          pubkey={mint.pubkey}
          clockSkewMs={x.clockSkewMs ?? mint.clockSkewMs}
        />
        <NetworkCard mint={mint} tor={x.checks.tor} timings={x.timings} />
      </section>

      <section className="section">
        <LightningCard ln={x.lightning.node} peers={x.lightning.peers} maxReceived={x.lightning.maxReceived} incoming={x.lightning.incoming} />
      </section>

      <section className="section two-col">
        <SpecCard mint={mint} />
        <div className="card">
          <h2 className="h2">Audit account</h2>
          <dl className="kv" style={{ marginTop: 12 }}>
            <dt>Host</dt><dd className="mono">{hostOf(mint.url)}</dd>
            <dt>Software</dt><dd className="mono">{mint.version ?? '—'}</dd>
            <dt>Tracked since</dt><dd>{fmtDate(mint.addedAt)} · via {mint.source}</dd>
            <dt>Audit balance</dt><dd>{fmtSat(d.balance)}{d.reserved ? ` · ${fmtSat(d.reserved)} in flight` : ''}</dd>
            <dt>Donated here</dt><dd>{fmtSat(d.donated)}</dd>
          </dl>
          <p className="small soft" style={{ margin: '20px 0 8px' }}>Uptime badge</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/badge/${mint.id}.svg`} alt="Cashu Audit badge" height={20} />
          <details className="table-view">
            <summary>Embed on your site</summary>
            <p className="small soft" style={{ margin: '8px 0 0' }}>
              For mint operators: paste one of these into your website or README to show this badge, linked to this page. It updates every few minutes.
            </p>
            <CopyField label="HTML" value={`<a href="${mintPage(mint.id)}"><img src="${SITE_URL}/badge/${mint.id}.svg" alt="Cashu Audit"></a>`} />
            <CopyField label="Markdown" value={`[![Cashu Audit](${SITE_URL}/badge/${mint.id}.svg)](${mintPage(mint.id)})`} />
          </details>
          <p className="small muted" style={{ margin: '8px 0 0' }}>Data for this mint: <a href={`/api/v1/mints/${mint.id}`}>JSON</a></p>
        </div>
      </section>

      <section className="section">
        <ReviewsCard reviews={x.reviews} />
      </section>

      <section className="section card" id="score">
        <h2 className="h2">Audit score</h2>
        <p className="small soft" style={{ margin: '0 0 12px' }}>Weighted from measurements; parts without enough data are left out and the weights rescaled. <Link href="/methodology#score" prefetch={false}>How it is computed</Link> · <Link href={`/compare?m=${mint.id}`} prefetch={false}>Compare with other mints</Link></p>
        <div style={{ marginBottom: 16 }}><ScoreTrend points={x.scoreHistory} /></div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Part</th><th className="r">Weight</th><th className="r">Points</th><th className="c-sm">Based on</th></tr></thead>
            <tbody>
              {scoreParts.map(p => (
                <tr key={p.key}>
                  <td>{p.label}</td>
                  <td className="r">{p.weight}</td>
                  <td className="r">{p.score == null ? <span className="muted">—</span> : Math.round(p.score)}</td>
                  <td className="small soft cell-wrap c-sm">{p.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="h2">Swaps through this mint</h2></div>
        <SwapTable swaps={swaps} emptyText="No swaps through this mint yet." />
      </section>
    </>
  );
}
