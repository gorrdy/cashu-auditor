import type { GraphEdge, MintState } from '@/lib/stats';
import { fmtMs, fmtPct, fmtSat } from './format';
import { forceLayout } from '@/lib/graphLayout';

type Node = { id: string; label: string; state: MintState };

const W = 960;
const H = 640;
const LABELLED = 16;

const STATE_LABEL: Record<MintState, string> = { ok: 'OK', warn: 'Warning', error: 'Offline', unknown: 'Not checked' };

function edgeClass(e: GraphEdge) {
  const done = e.paid + e.failed;
  if (done === 0) return 'warning';
  const rate = e.paid / done;
  return rate >= 0.9 ? 'good' : rate >= 0.5 ? 'warning' : 'critical';
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export default function MintGraph({ nodes, edges }: { nodes: Node[]; edges: GraphEdge[] }) {
  const ids = new Set(edges.flatMap(e => [e.source, e.dest]));
  const shown = nodes.filter(n => ids.has(n.id)).sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(nodes.map(n => [n.id, n]));

  if (shown.length === 0) {
    return <p className="small muted" style={{ padding: '32px 0', textAlign: 'center' }}>No swaps in the last 30 days yet. The network appears after the first swaps.</p>;
  }

  const volume = new Map<string, number>();
  const pair = new Map<string, number>();
  for (const e of edges) {
    const n = e.paid + e.failed + e.pending;
    volume.set(e.source, (volume.get(e.source) ?? 0) + n);
    volume.set(e.dest, (volume.get(e.dest) ?? 0) + n);
    const key = [e.source, e.dest].sort().join('|');
    pair.set(key, (pair.get(key) ?? 0) + n);
  }
  const links = [...pair].map(([key, weight]) => {
    const [a, b] = key.split('|');
    return { a, b, weight };
  });
  const pos = forceLayout(shown.map(n => n.id), links, W, H, { x: 110, y: 40 });
  const radius = (id: string) => 5 + Math.min(13, Math.sqrt(volume.get(id) ?? 0) * 1.4);
  const cx = [...pos.values()].reduce((s, p) => s + p.x, 0) / pos.size;
  const placed: { x1: number; y1: number; x2: number; y2: number }[] = shown.map(n => {
    const p = pos.get(n.id)!, r = radius(n.id);
    return { x1: p.x - r, y1: p.y - r, x2: p.x + r, y2: p.y + r };
  });
  const labels = new Map<string, { x: number; y: number; anchor: 'start' | 'end'; text: string }>();
  for (const n of [...shown].sort((a, b) => (volume.get(b.id) ?? 0) - (volume.get(a.id) ?? 0))) {
    if (labels.size >= LABELLED) break;
    const p = pos.get(n.id)!, r = radius(n.id), text = truncate(n.label, 20), w = text.length * 6.6;
    const preferRight = p.x >= cx;
    for (const right of [preferRight, !preferRight]) {
      const x = p.x + (right ? r + 6 : -(r + 6));
      const box = { x1: right ? x : x - w, y1: p.y - 9, x2: right ? x + w : x, y2: p.y + 7 };
      if (box.x1 < 0 || box.x2 > W) continue;
      if (placed.some(b => b.x1 < box.x2 && box.x1 < b.x2 && b.y1 < box.y2 && box.y1 < b.y2)) continue;
      placed.push(box);
      labels.set(n.id, { x, y: p.y + 4, anchor: right ? 'start' : 'end', text });
      break;
    }
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="graph" role="img" aria-label="Swap network between mints over the last 30 days">
      <defs>
        {(['good', 'warning', 'critical'] as const).map(c => (
          <marker key={c} id={`arrow-${c}`} viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M0 1L9 5L0 9z" fill={`var(--${c})`} />
          </marker>
        ))}
      </defs>

      {edges.map(e => {
        const s = pos.get(e.source), d = pos.get(e.dest);
        if (!s || !d) return null;
        const dx = d.x - s.x, dy = d.y - s.y;
        const len = Math.hypot(dx, dy) || 1;
        const bend = Math.min(40, 0.12 * len);
        const cx2 = (s.x + d.x) / 2 + (-dy / len) * bend;
        const cy2 = (s.y + d.y) / 2 + (dx / len) * bend;
        const tx = d.x - cx2, ty = d.y - cy2, tl = Math.hypot(tx, ty) || 1;
        const rd = radius(e.dest) + 3;
        const ex = d.x - (tx / tl) * rd, ey = d.y - (ty / tl) * rd;
        const cls = edgeClass(e);
        const total = e.paid + e.failed + e.pending;
        const done = e.paid + e.failed;
        const from = byId.get(e.source)?.label ?? '?', to = byId.get(e.dest)?.label ?? '?';
        const tip = `${total} swap${total === 1 ? '' : 's'} · ${done ? fmtPct((e.paid / done) * 100) : '—'} paid\n${from} → ${to}\nPaid ${e.paid} · Failed ${e.failed}${e.pending ? ` · Pending ${e.pending}` : ''}\n${fmtSat(e.amount)} moved${e.avgMs != null ? ` · avg ${fmtMs(e.avgMs)}` : ''}`;
        const path = `M${s.x.toFixed(1)},${s.y.toFixed(1)} Q${cx2.toFixed(1)},${cy2.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
        return (
          <g key={`${e.source}>${e.dest}`} className="edge" data-tip={tip}>
            <path d={path} fill="none" stroke="transparent" strokeWidth="12" />
            <path d={path} fill="none" stroke={`var(--${cls})`} strokeWidth={1 + Math.min(3, Math.log2(total + 1) * 0.7)} strokeLinecap="round" markerEnd={`url(#arrow-${cls})`} opacity="0.6" />
          </g>
        );
      })}

      {shown.map(n => {
        const p = pos.get(n.id)!;
        const r = radius(n.id);
        return (
          <a key={n.id} href={`/mint/${n.id}`} className="node" data-tip={`${n.label}\n${STATE_LABEL[n.state]} · ${volume.get(n.id) ?? 0} swaps in 30 days\nClick for details`}>
            <circle cx={p.x} cy={p.y} r={r + 8} fill="transparent" />
            <circle cx={p.x} cy={p.y} r={r} fill="var(--surface)" stroke="var(--ink-2)" strokeWidth="2" />
            {n.state === 'error' && <circle cx={p.x} cy={p.y} r={Math.max(2, r - 4)} fill="var(--critical)" />}
            {n.state === 'warn' && <circle cx={p.x} cy={p.y} r={Math.max(2, r - 4)} fill="var(--warning)" />}
            {labels.has(n.id) && (
              <text x={labels.get(n.id)!.x} y={labels.get(n.id)!.y} textAnchor={labels.get(n.id)!.anchor} className="node-label">{labels.get(n.id)!.text}</text>
            )}
          </a>
        );
      })}
    </svg>
  );
}

export function GraphLegend() {
  return (
    <div className="legend">
      <span><i className="line" style={{ background: 'var(--good)' }} />≥ 90 % paid</span>
      <span><i className="line" style={{ background: 'var(--warning)' }} />50–90 % or pending</span>
      <span><i className="line" style={{ background: 'var(--critical)' }} />&lt; 50 % paid</span>
      <span>Arrow points to the receiving mint · thicker = more swaps · bigger = busier mint · filled = Warning / Offline</span>
    </div>
  );
}

export function GraphTable({ nodes, edges }: { nodes: Node[]; edges: GraphEdge[] }) {
  const label = new Map(nodes.map(n => [n.id, n.label]));
  const sorted = [...edges].sort((a, b) => b.paid + b.failed + b.pending - (a.paid + a.failed + a.pending));
  return (
    <details className="table-view">
      <summary>Show table</summary>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>From</th><th>To</th><th className="r c-sm">Paid</th><th className="r c-sm">Failed</th><th className="r c-md">Pending</th><th className="r">Success</th><th className="r c-md">Moved</th><th className="r c-lg">Avg time</th></tr></thead>
          <tbody>
            {sorted.map(e => {
              const done = e.paid + e.failed;
              return (
                <tr key={`${e.source}>${e.dest}`}>
                  <td className="cell-wrap">{label.get(e.source)}</td>
                  <td className="cell-wrap">{label.get(e.dest)}</td>
                  <td className="r c-sm">{e.paid}</td>
                  <td className="r c-sm">{e.failed}</td>
                  <td className="r c-md">{e.pending}</td>
                  <td className="r">{done ? fmtPct((e.paid / done) * 100) : '—'}</td>
                  <td className="r nowrap c-md">{fmtSat(e.amount)}</td>
                  <td className="r c-lg">{fmtMs(e.avgMs)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
