import type { Metadata } from 'next';
import Link from 'next/link';
import { getInfrastructure, type Bucket, type InfraMint } from '@/lib/infra';
import { StateIcon } from '@/components/StateBadge';
import { fmtCapacity, NodeName, reachability } from '@/components/MintSections';

export const metadata: Metadata = { title: 'Infrastructure' };

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

function MintChips({ mints }: { mints: InfraMint[] }) {
  return (
    <span className="infra-mints">
      {mints.map(m => (
        <Link key={m.id} href={`/mint/${m.id}`} prefetch={false} className="infra-mint">
          <StateIcon kind={m.state} size={12} />
          {m.label}
        </Link>
      ))}
    </span>
  );
}

function BarList({ title, sub, items, total, unit = 'mints', limit = 8 }: { title: string; sub: string; items: Bucket[]; total: number; unit?: string; limit?: number }) {
  const shown = items.slice(0, limit);
  const rest = items.slice(limit).reduce((n, b) => n + b.mints.length, 0);
  return (
    <div className="card">
      <h2 className="h2">{title}</h2>
      <p className="small soft" style={{ margin: '0 0 16px' }}>{sub}</p>
      {shown.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No data yet.</p> : (
        <ul className="hbars">
          {shown.map(b => (
            <li key={b.key}>
              <div className="hbars-head">
                <span className="hbars-label" title={b.key}>{b.key}</span>
                <span className="hbars-value">{b.mints.length} {unit} · {pct(b.mints.length, total)} %</span>
              </div>
              <div className="hbars-track"><i style={{ width: `${Math.max(2, pct(b.mints.length, total))}%` }} /></div>
              <MintChips mints={b.mints} />
            </li>
          ))}
        </ul>
      )}
      {rest > 0 && <p className="small muted" style={{ margin: '12px 0 0' }}>{rest} more {unit} elsewhere</p>}
    </div>
  );
}

export default async function Infrastructure() {
  const d = await getInfrastructure();
  const topHost = d.webHosting[0];
  const topNodeHost = d.nodeHosting[0];
  return (
    <>
      <p className="eyebrow">Infrastructure</p>
      <h1 className="h1" style={{ marginTop: 8 }}>Where the mints run</h1>
      <p className="soft" style={{ margin: '10px 0 0', maxWidth: 720 }}>
        Mints that share a Lightning node or a hosting provider fail together. This page shows how concentrated the{' '}
        {d.total} active mints are, from their web servers, the Lightning nodes behind their invoices and the software they run.
      </p>

      <section className="section tiles" aria-label="Summary">
        <div className="tile">
          <div className="tile-label">Lightning nodes</div>
          <div className="tile-value">{d.distinctNodes}</div>
          <div className="tile-sub">behind {d.withNode} mints with a readable invoice</div>
        </div>
        <div className="tile">
          <div className="tile-label">Mints sharing a node</div>
          <div className="tile-value">{d.sharingMints}</div>
          <div className="tile-sub">in {d.sharedNodes.length} groups</div>
        </div>
        <div className="tile">
          <div className="tile-label">Largest web host</div>
          <div className="tile-value">{topHost ? `${pct(topHost.mints.length, d.total)} %` : '—'}</div>
          <div className="tile-sub">{topHost ? `${topHost.key}, ${topHost.mints.length} mints` : 'No data'}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Outdated software</div>
          <div className="tile-value">{d.outdated}</div>
          <div className="tile-sub">two or more minor versions behind</div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="h2">Shared Lightning nodes</h2>
          <span className="small soft">An outage or stuck channel on one node hits every mint on it</span>
        </div>
        {d.sharedNodes.length === 0 ? <p className="small muted">No shared nodes found.</p> : (
          <div className="infra-grid">
            {d.sharedNodes.map(g => {
              const r = reachability({ checkedAt: 0, node: g.node, via: g.via }, true);
              return (
                <div className="card" key={g.node.pubkey}>
                  <p className="infra-node">
                    {g.node.public ? <NodeName node={g.node} /> : <span className="mono">{g.node.pubkey.slice(0, 16)}…</span>}
                    <span className="small soft">{g.node.public ? `${g.node.channels ?? 0} channels · ${fmtCapacity(g.node.capacity)}` : 'not in the public graph'}</span>
                  </p>
                  <p className="node-verdict small"><StateIcon kind={r.kind === 'error' ? 'failed' : r.kind} />{r.text}</p>
                  <MintChips mints={g.mints} />
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="section two-col">
        <BarList title="Web hosting" sub="Network (AS) of each mint's API server" items={d.webHosting} total={d.total} />
        <BarList title="Lightning node hosting" sub="Network of the public Lightning node behind each mint" items={d.nodeHosting} total={d.withNode} />
      </section>

      <section className="section two-col">
        <BarList title="Liquidity providers" sub="Public nodes in the route hints of mint invoices, usually an LSP" items={d.liquidity} total={d.withNode} />
        <BarList title="Countries" sub="Where the API server's IP block is registered" items={d.countries} total={d.total} />
      </section>

      <section className="section">
        <div className="section-head"><h2 className="h2">Software</h2></div>
        <div className="infra-grid">
          {d.software.map(s => (
            <div className="card" key={s.impl}>
              <p className="infra-node"><strong>{s.impl}</strong><span className="small soft">{s.count} mints</span></p>
              <ul className="hbars">
                {s.versions.map(v => (
                  <li key={v.version}>
                    <div className="hbars-head">
                      <span className="hbars-label mono">{v.version}{v.outdated && <span className="outdated" style={{ marginLeft: 8 }}>outdated</span>}</span>
                      <span className="hbars-value">{v.mints.length}</span>
                    </div>
                    <div className="hbars-track"><i className={v.outdated ? 'is-old' : undefined} style={{ width: `${Math.max(3, pct(v.mints.length, s.count))}%` }} /></div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <p className="small muted" style={{ marginTop: 24 }}>
        {topNodeHost && <>The most common host of public Lightning nodes is {topNodeHost.key} ({topNodeHost.mints.length} mints). </>}
        Lightning data is read once a day from an unpaid invoice of each mint and looked up on mempool.space and 1ML. Test mints and mints offline for more than 30 days are left out.
      </p>
    </>
  );
}
