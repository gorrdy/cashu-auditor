import type { CheckSummary } from '@/lib/stats-extra';
import type { PaymentMethod } from '@/lib/probe';
import StateBadge, { StateIcon } from './StateBadge';
import { fmtDate, fmtDateTime, fmtMs, fmtSat } from './format';

type Timing = { dns: number | null; connect: number | null; tls: number | null; ttfb: number | null; samples: number };

const DAY = 86_400_000;

export function fmtPpk(ppk: number | null) {
  if (ppk == null) return '—';
  if (ppk === 0) return 'Free';
  return `${ppk} ppk · ${(ppk / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 })} sat per input`;
}

export function keysetVersion(id: string | null) {
  if (!id) return '—';
  if (id.startsWith('01')) return 'v2';
  if (id.startsWith('00')) return 'v1';
  return 'legacy';
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function Check({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <StateIcon kind={ok === null ? 'unknown' : ok ? 'ok' : 'failed'} />
      {label}
    </span>
  );
}

function ContactValue({ method, info }: { method: string; info: string }) {
  const m = method.toLowerCase();
  if (m === 'email' && /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(info)) return <a href={`mailto:${info}`}>{info}</a>;
  if ((m === 'twitter' || m === 'x') && /^@?[A-Za-z0-9_]{1,15}$/.test(info)) {
    const handle = info.replace(/^@/, '');
    return <a href={`https://x.com/${handle}`} rel="nofollow noopener" target="_blank">@{handle}</a>;
  }
  if (m === 'nostr' && /^npub1[02-9ac-hj-np-z]{58}$/.test(info)) {
    return <a className="mono" href={`https://njump.me/${info}`} rel="nofollow noopener" target="_blank">{info.slice(0, 14)}…{info.slice(-6)}</a>;
  }
  return <span style={{ overflowWrap: 'anywhere' }}>{info}</span>;
}

export function SpecCard({ mint }: {
  mint: {
    methods: string | null; units: string | null; inputFeePpk: number | null; activeKeysetId: string | null; keysetCount: number | null;
    mintDisabled: boolean | null; meltDisabled: boolean | null; authRequired: boolean | null; websockets: boolean | null;
    cachedResponses: boolean | null; batchMax: number | null; maxArrayLength: number | null; contact: string | null;
    tosUrl: string | null; onionUrl: string | null; nuts: string[];
  };
}) {
  const methods = mint.methods ? (JSON.parse(mint.methods) as PaymentMethod[]) : [];
  const contact = mint.contact ? (JSON.parse(mint.contact) as { method: string; info: string }[]) : [];
  return (
    <div className="card">
      <h2 className="h2">Specification</h2>
      <p className="small soft" style={{ margin: '0 0 12px' }}>What the mint advertises in <span className="mono">/v1/info</span> and <span className="mono">/v1/keysets</span></p>

      {methods.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 16 }}>
          <table className="data">
            <thead><tr><th>Operation</th><th>Method</th><th>Unit</th><th className="r">Min</th><th className="r">Max</th></tr></thead>
            <tbody>
              {methods.map((m, i) => (
                <tr key={i}>
                  <td>{m.op === 'mint' ? 'Deposit (mint)' : 'Withdraw (melt)'}</td>
                  <td className="mono">{m.method}</td>
                  <td className="mono">{m.unit}</td>
                  <td className="r">{m.min != null ? m.min.toLocaleString('en-US') : '—'}</td>
                  <td className="r">{m.max != null ? m.max.toLocaleString('en-US') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <dl className="kv">
        <Row label="Deposits">{mint.mintDisabled == null ? '—' : <Check ok={!mint.mintDisabled} label={mint.mintDisabled ? 'Disabled' : 'Enabled'} />}</Row>
        <Row label="Withdrawals">{mint.meltDisabled == null ? '—' : <Check ok={!mint.meltDisabled} label={mint.meltDisabled ? 'Disabled' : 'Enabled'} />}</Row>
        <Row label="Input fee">{fmtPpk(mint.inputFeePpk)}</Row>
        <Row label="Active keyset">
          {mint.activeKeysetId ? (
            <span><span className="chip">{keysetVersion(mint.activeKeysetId)}</span> <span className="mono">{mint.activeKeysetId.slice(0, 16)}…</span> · {mint.keysetCount ?? '?'} keysets total</span>
          ) : '—'}
        </Row>
        <Row label="Authentication">{mint.authRequired == null ? '—' : mint.authRequired ? <StateBadge kind="warn" label="Required (NUT-21/22)" /> : 'Not required'}</Row>
        <Row label="Wallet features">
          <span className="chips">
            <span className="chip">WebSockets {mint.websockets ? 'yes' : 'no'}</span>
            <span className="chip">Cached responses {mint.cachedResponses ? 'yes' : 'no'}</span>
            <span className="chip">Batch {mint.batchMax ?? '—'}</span>
            <span className="chip">Max array {mint.maxArrayLength ?? '—'}</span>
          </span>
        </Row>
        {contact.map((c, i) => (
          <Row key={i} label={i === 0 ? 'Contact' : ''}><span className="soft">{c.method}</span> <ContactValue {...c} /></Row>
        ))}
        {mint.tosUrl && <Row label="Terms"><a href={mint.tosUrl} rel="nofollow noopener" target="_blank">{mint.tosUrl.replace(/^https:\/\//, '')}</a></Row>}
        {mint.onionUrl && <Row label="Onion"><span className="mono" style={{ overflowWrap: 'anywhere' }}>{mint.onionUrl}</span></Row>}
      </dl>

      {mint.nuts.length > 0 && (
        <>
          <p className="small soft" style={{ margin: '16px 0 6px' }}>Supported NUTs ({mint.nuts.length})</p>
          <div className="chips">{mint.nuts.map(n => <span key={n} className="chip">NUT-{n.padStart(2, '0')}</span>)}</div>
        </>
      )}
    </div>
  );
}

function checkLabel(c: CheckSummary | undefined, now: number) {
  if (!c) return <span className="muted">Not run yet</span>;
  return <span className="soft small">{fmtDateTime(c.timestamp)} · last 30 days {c.recentOk} ok, {c.recentFail} failed{c.ms != null ? ` · ${fmtMs(c.ms)}` : ''}{now - c.timestamp > 2 * DAY ? ' · stale' : ''}</span>;
}

export function IntegrityCard({ now, checks, lost, dleq, tlsIssuer, tlsExpiresAt, pubkey, clockSkewMs }: {
  now: number;
  checks: Record<string, CheckSummary>;
  lost: { sat: number; proofs: number };
  dleq: { valid: number; invalid: number; missing: number };
  tlsIssuer: string | null;
  tlsExpiresAt: Date | null;
  pubkey: string | null;
  clockSkewMs: number | null;
}) {
  const ps = checks.proof_state;
  const st = checks.swap_test;
  const tlsDays = tlsExpiresAt ? Math.floor((tlsExpiresAt.getTime() - now) / DAY) : null;
  const skewS = clockSkewMs != null ? clockSkewMs / 1000 : null;
  const dleqTotal = dleq.valid + dleq.invalid + dleq.missing;
  return (
    <div className="card">
      <h2 className="h2">Integrity</h2>
      <p className="small soft" style={{ margin: '0 0 12px' }}>Checks only an auditor holding ecash at the mint can run</p>
      <dl className="kv">
        <Row label="Our proofs">
          {ps ? (
            <div>
              <Check ok={ps.ok} label={ps.ok ? `All ${String(ps.detail.checked ?? '?')} unspent at the mint` : `${String(ps.detail.spent ?? '?')} marked spent by the mint`} />
              <div>{checkLabel(ps, now)}</div>
            </div>
          ) : checkLabel(undefined, now)}
        </Row>
        {lost.sat > 0 && <Row label="Lost"><StateBadge kind="error" label={`${fmtSat(lost.sat)} in ${lost.proofs} proofs spent without us`} /></Row>}
        <Row label="Internal swap">
          {st ? (
            <div>
              <Check ok={st.ok} label={st.ok ? `Swapped ${String(st.detail.amount ?? '?')} sat, fee ${String(st.detail.fee ?? 0)} sat` : String(st.detail.error ?? 'Failed')} />
              <div>{checkLabel(st, now)}</div>
            </div>
          ) : checkLabel(undefined, now)}
        </Row>
        <Row label="DLEQ proofs">
          {dleqTotal === 0 ? <span className="muted">No minted swaps in range</span> : (
            <Check ok={dleq.invalid === 0 && dleq.missing === 0} label={`${dleq.valid} valid · ${dleq.invalid} invalid · ${dleq.missing} missing (NUT-12)`} />
          )}
        </Row>
        <Row label="TLS certificate">
          {tlsDays == null ? '—' : <Check ok={tlsDays >= 14} label={`${tlsIssuer ?? 'Unknown issuer'} · expires ${fmtDate(tlsExpiresAt!)} (${tlsDays} days)`} />}
        </Row>
        <Row label="Clock">
          {skewS == null ? '—' : <Check ok={Math.abs(skewS) < 5} label={`${skewS >= 0 ? '+' : ''}${skewS.toFixed(1)} s against the auditor (1 s resolution)`} />}
        </Row>
        <Row label="Pubkey"><span className="mono" style={{ overflowWrap: 'anywhere' }}>{pubkey ?? '—'}</span></Row>
      </dl>
    </div>
  );
}

export function NetworkCard({ mint, tor, timings }: {
  mint: { ip: string | null; ipv4: boolean | null; ipv6: boolean | null; asn: number | null; asName: string | null; country: string | null; netCheckedAt: Date | null; onionUrl: string | null };
  tor: CheckSummary | undefined;
  timings: { prague: Timing; frankfurt: Timing };
}) {
  const rows: [string, keyof Omit<Timing, 'samples'>][] = [['DNS lookup', 'dns'], ['TCP connect', 'connect'], ['TLS handshake', 'tls'], ['Server response', 'ttfb']];
  return (
    <div className="card">
      <h2 className="h2">Network</h2>
      <p className="small soft" style={{ margin: '0 0 12px' }}>Where the mint is hosted and where its response time goes</p>
      <dl className="kv">
        <Row label="Address"><span className="mono">{mint.ip ?? '—'}</span></Row>
        <Row label="IP versions"><span style={{ display: 'inline-flex', gap: 14 }}><Check ok={mint.ipv4} label="IPv4" /><Check ok={mint.ipv6} label="IPv6" /></span></Row>
        <Row label="Network">{mint.asn ? <>AS{mint.asn} · {mint.asName ?? '—'}</> : '—'}</Row>
        <Row label="Registry country">{mint.country ?? '—'} <span className="muted small">(where the IP block is registered)</span></Row>
        <Row label="Tor">
          {!mint.onionUrl ? <span className="muted">No onion address advertised</span> : tor ? (
            <Check ok={tor.ok} label={tor.ok ? `Reachable in ${fmtMs(tor.ms)}` : tor.detail.status ? `Onion answers HTTP ${String(tor.detail.status)}` : String(tor.detail.error ?? 'Unreachable')} />
          ) : <span className="muted">Not checked yet</span>}
        </Row>
        {mint.netCheckedAt && <Row label="Checked">{fmtDateTime(mint.netCheckedAt)}</Row>}
      </dl>
      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table className="data">
          <thead><tr><th>Median</th><th className="r">Prague</th><th className="r">Frankfurt</th></tr></thead>
          <tbody>
            {rows.map(([label, key]) => (
              <tr key={key}><td>{label}</td><td className="r">{fmtMs(timings.prague[key])}</td><td className="r">{fmtMs(timings.frankfurt[key])}</td></tr>
            ))}
            <tr><td className="soft">Samples</td><td className="r soft">{timings.prague.samples}</td><td className="r soft">{timings.frankfurt.samples}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  version: 'Software updated',
  pubkey: 'Mint pubkey changed',
  activeKeysetId: 'Keyset rotated',
  inputFeePpk: 'Input fee changed',
  motd: 'Message of the day',
  mintDisabled: 'Deposits switched',
  meltDisabled: 'Withdrawals switched',
};

function eventValue(kind: string, v: string | null) {
  if (v == null) return '—';
  if (kind === 'activeKeysetId' || kind === 'pubkey') return `${v.slice(0, 12)}…`;
  if (kind === 'inputFeePpk') return fmtPpk(Number(v));
  if (kind === 'mintDisabled' || kind === 'meltDisabled') return v === 'true' ? 'off' : 'on';
  return v;
}

export function EventsCard({ events }: { events: { kind: string; previous: string | null; value: string | null; timestamp: number }[] }) {
  return (
    <div className="card">
      <h2 className="h2">Changes</h2>
      <p className="small soft" style={{ margin: '0 0 12px' }}>Software, keys, fees and notices as observed by the audit</p>
      {events.length === 0 ? <p className="small muted">No changes recorded yet.</p> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>When</th><th>Change</th><th>From → to</th></tr></thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i}>
                  <td className="nowrap">{fmtDateTime(e.timestamp)}</td>
                  <td className="nowrap">{e.kind === 'pubkey' ? <StateBadge kind="warn" label={EVENT_LABEL[e.kind]} /> : EVENT_LABEL[e.kind] ?? e.kind}</td>
                  <td className="small cell-wrap"><span className="mono soft">{eventValue(e.kind, e.previous)}</span> → <span className="mono">{eventValue(e.kind, e.value)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ReviewsCard({ reviews }: { reviews: { count: number; rated: number; average: number | null; latest: { id: string; rating: number | null; content: string; createdAt: number; author: string }[] } }) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2 className="h2">Reviews on Nostr</h2>
          <p className="small soft" style={{ margin: 0 }}>NIP-87 recommendations signed by their authors · latest per author</p>
        </div>
        {reviews.average != null && (
          <div style={{ textAlign: 'right' }}>
            <div className="tile-value" style={{ marginTop: 0 }}>{reviews.average.toFixed(1)}<small>/ 5</small></div>
            <div className="small muted">{reviews.rated} ratings · {reviews.count} reviews</div>
          </div>
        )}
      </div>
      {reviews.latest.length === 0 ? <p className="small muted">No reviews found on the relays we read.</p> : (
        <div style={{ display: 'grid', gap: 12 }}>
          {reviews.latest.map(r => (
            <div key={r.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <div className="small soft" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span className="num" style={{ color: 'var(--ink)', fontWeight: 600 }}>{r.rating != null ? `${r.rating}/5` : 'No rating'}</span>
                <a className="mono" href={`https://njump.me/${r.author}`} rel="nofollow noopener" target="_blank">{r.author.slice(0, 12)}…{r.author.slice(-4)}</a>
                <span>{fmtDate(r.createdAt)}</span>
              </div>
              {r.content && <p style={{ margin: '4px 0 0', overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>{r.content.slice(0, 500)}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
