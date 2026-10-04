'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { GraphEdge, MintState } from '@/lib/stats';
import { forceLayout } from '@/lib/graphLayout';

type Node = { id: string; label: string; state: MintState };
type Range = '24h' | '7d' | '30d';
type Kind = 'all' | 'paid' | 'failed';

const W = 960;
const H = 640;
const MIN_SCALE = 0.6;
const MAX_SCALE = 6;
const STATE_LABEL: Record<MintState, string> = { ok: 'OK', warn: 'Warning', error: 'Offline', unknown: 'Not checked' };
const RANGES: { key: Range; label: string }[] = [{ key: '24h', label: '24 h' }, { key: '7d', label: '7 d' }, { key: '30d', label: '30 d' }];

const pct = (v: number) => (v >= 99.95 ? '100 %' : `${v.toFixed(1)} %`);
const sat = (v: number) => `${v.toLocaleString('en-US')} sat`;
const ms = (v: number | null) => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function edgeClass(e: GraphEdge) {
  const done = e.paid + e.failed;
  if (done === 0) return 'warning';
  const rate = e.paid / done;
  return rate >= 0.9 ? 'good' : rate >= 0.5 ? 'warning' : 'critical';
}

export default function MintNetwork({ nodes, edgesByRange }: { nodes: Node[]; edgesByRange: Record<Range, GraphEdge[]> }) {
  const [range, setRange] = useState<Range>('30d');
  const [kind, setKind] = useState<Kind>('all');
  const [minSwaps, setMinSwaps] = useState(1);
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  const byId = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  const edges = useMemo(
    () =>
      edgesByRange[range].filter(e => {
        const total = e.paid + e.failed + e.pending;
        if (total < minSwaps) return false;
        if (kind === 'paid') return e.paid > 0;
        if (kind === 'failed') return e.failed + e.pending > 0;
        return true;
      }),
    [edgesByRange, range, kind, minSwaps]
  );

  const { shown, pos, volume } = useMemo(() => {
    const ids = new Set(edges.flatMap(e => [e.source, e.dest]));
    const shown = nodes.filter(n => ids.has(n.id)).sort((a, b) => a.id.localeCompare(b.id));
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
    return { shown, pos: forceLayout(shown.map(n => n.id), links, W, H, { x: 110, y: 40 }), volume };
  }, [edges, nodes]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return new Set<string>();
    return new Set(shown.filter(n => n.label.toLowerCase().includes(q)).map(n => n.id));
  }, [query, shown]);

  const focus = selected ?? hover;
  const neighbours = useMemo(() => {
    if (!focus) return null;
    const set = new Set([focus]);
    for (const e of edges) {
      if (e.source === focus) set.add(e.dest);
      if (e.dest === focus) set.add(e.source);
    }
    return set;
  }, [focus, edges]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * W;
      const py = ((e.clientY - rect.top) / rect.height) * H;
      setView(v => {
        const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.k * Math.exp(-e.deltaY * 0.0025)));
        return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const zoom = (factor: number) =>
    setView(v => {
      const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.k * factor));
      return { k, x: W / 2 - ((W / 2 - v.x) * k) / v.k, y: H / 2 - ((H / 2 - v.y) * k) / v.k };
    });
  const reset = () => {
    setView({ x: 0, y: 0, k: 1 });
    setSelected(null);
    setQuery('');
  };

  const radius = (id: string) => (5 + Math.min(13, Math.sqrt(volume.get(id) ?? 0) * 1.4)) / Math.sqrt(view.k);
  const labelCount = Math.round(16 * view.k * view.k);
  const cx = shown.length ? [...pos.values()].reduce((s, p) => s + p.x, 0) / pos.size : W / 2;

  const labels = useMemo(() => {
    const placed: { x1: number; y1: number; x2: number; y2: number }[] = shown.map(n => {
      const p = pos.get(n.id)!;
      const sx = p.x * view.k + view.x, sy = p.y * view.k + view.y;
      const r = (5 + Math.min(13, Math.sqrt(volume.get(n.id) ?? 0) * 1.4)) * Math.sqrt(view.k);
      return { x1: sx - r, y1: sy - r, x2: sx + r, y2: sy + r };
    });
    const out = new Map<string, { x: number; y: number; anchor: 'start' | 'end'; text: string }>();
    const order = [...shown].sort((a, b) => {
      const pri = (id: string) => (id === focus ? 3 : matches.has(id) ? 2 : neighbours?.has(id) ? 1 : 0);
      return pri(b.id) - pri(a.id) || (volume.get(b.id) ?? 0) - (volume.get(a.id) ?? 0);
    });
    for (const n of order) {
      if (out.size >= labelCount && n.id !== focus && !matches.has(n.id)) break;
      const p = pos.get(n.id)!;
      const sx = p.x * view.k + view.x, sy = p.y * view.k + view.y;
      if (sx < -50 || sx > W + 50 || sy < -20 || sy > H + 20) continue;
      const r = (5 + Math.min(13, Math.sqrt(volume.get(n.id) ?? 0) * 1.4)) * Math.sqrt(view.k);
      const text = truncate(n.label, 22), w = text.length * 6.6;
      for (const right of [p.x >= cx, p.x < cx]) {
        const x = sx + (right ? r + 6 : -(r + 6));
        const box = { x1: right ? x : x - w, y1: sy - 9, x2: right ? x + w : x, y2: sy + 7 };
        if (box.x1 < 0 || box.x2 > W) continue;
        if (placed.some(b => b.x1 < box.x2 && box.x1 < b.x2 && b.y1 < box.y2 && box.y1 < b.y2)) continue;
        placed.push(box);
        out.set(n.id, { x, y: sy + 4, anchor: right ? 'start' : 'end', text });
        break;
      }
    }
    return out;
  }, [shown, pos, volume, view, labelCount, focus, matches, neighbours, cx]);

  const sel = selected ? byId.get(selected) : null;
  const selStats = useMemo(() => {
    if (!selected) return null;
    const out = edges.filter(e => e.source === selected);
    const inc = edges.filter(e => e.dest === selected);
    const sum = (list: GraphEdge[], k: 'paid' | 'failed' | 'pending' | 'amount') => list.reduce((s, e) => s + e[k], 0);
    return {
      paidOut: sum(out, 'paid'), failedOut: sum(out, 'failed') + sum(out, 'pending'),
      received: sum(inc, 'paid'), failedIn: sum(inc, 'failed') + sum(inc, 'pending'),
      moved: sum(out, 'amount') + sum(inc, 'amount'), peers: new Set([...out.map(e => e.dest), ...inc.map(e => e.source)]).size,
    };
  }, [selected, edges]);

  const dimmed = (id: string) => (neighbours ? !neighbours.has(id) : matches.size > 0 && !matches.has(id));

  return (
    <div className="network">
      <div className="network-bar" role="toolbar" aria-label="Network filters">
        <div className="segmented" role="group" aria-label="Period">
          {RANGES.map(r => (
            <button key={r.key} type="button" aria-pressed={range === r.key} onClick={() => setRange(r.key)}>{r.label}</button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Connections">
          {([['all', 'All'], ['paid', 'Paid'], ['failed', 'Failures']] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>
          ))}
        </div>
        <label className="small soft network-min">
          Min swaps
          <select className="field" value={minSwaps} onChange={e => setMinSwaps(Number(e.target.value))}>
            {[1, 2, 3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <input className="field network-search" type="search" placeholder="Find a mint…" value={query} onChange={e => {
          const q = e.target.value;
          setQuery(q);
          const hits = q.trim() ? shown.filter(n => n.label.toLowerCase().includes(q.trim().toLowerCase())) : [];
          const p = hits.length === 1 ? pos.get(hits[0].id) : undefined;
          if (!p) return;
          setSelected(hits[0].id);
          setView(v => {
            const k = Math.max(v.k, 2);
            return { k, x: W / 2 - p.x * k, y: H / 2 - p.y * k };
          });
        }} aria-label="Find a mint in the network" />
        <span className="small muted">{shown.length} mints · {edges.length} links</span>
      </div>

      <div className="network-stage">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="graph network-graph"
          role="img"
          aria-label="Swap network between mints"
          onPointerDown={e => {
            if ((e.target as Element).closest('.node')) return;
            (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
          }}
          onPointerMove={e => {
            const d = drag.current;
            if (!d) return;
            const rect = svgRef.current!.getBoundingClientRect();
            const dx = ((e.clientX - d.x) / rect.width) * W, dy = ((e.clientY - d.y) / rect.height) * H;
            if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
            setView(v => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
          }}
          onPointerUp={() => {
            const d = drag.current;
            drag.current = null;
            if (d && !d.moved) setSelected(null);
          }}
        >
          <defs>
            {(['good', 'warning', 'critical'] as const).map(c => (
              <marker key={c} id={`net-arrow-${c}`} viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M0 1L9 5L0 9z" fill={`var(--${c})`} />
              </marker>
            ))}
          </defs>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {edges.map(e => {
              const s = pos.get(e.source), d = pos.get(e.dest);
              if (!s || !d) return null;
              const dx = d.x - s.x, dy = d.y - s.y;
              const len = Math.hypot(dx, dy) || 1;
              const bend = Math.min(40, 0.12 * len);
              const qx = (s.x + d.x) / 2 + (-dy / len) * bend, qy = (s.y + d.y) / 2 + (dx / len) * bend;
              const tx = d.x - qx, ty = d.y - qy, tl = Math.hypot(tx, ty) || 1;
              const rd = radius(e.dest) + 3 / view.k;
              const ex = d.x - (tx / tl) * rd, ey = d.y - (ty / tl) * rd;
              const cls = edgeClass(e);
              const total = e.paid + e.failed + e.pending;
              const done = e.paid + e.failed;
              const lit = focus ? e.source === focus || e.dest === focus : true;
              const from = byId.get(e.source)?.label ?? '?', to = byId.get(e.dest)?.label ?? '?';
              const tip = `${total} swap${total === 1 ? '' : 's'} · ${done ? pct((e.paid / done) * 100) : '—'} paid\n${from} → ${to}\nPaid ${e.paid} · Failed ${e.failed}${e.pending ? ` · Pending ${e.pending}` : ''}\n${sat(e.amount)} moved${e.avgMs != null ? ` · avg ${ms(e.avgMs)}` : ''}`;
              const path = `M${s.x.toFixed(1)},${s.y.toFixed(1)} Q${qx.toFixed(1)},${qy.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
              return (
                <g key={`${e.source}>${e.dest}`} className="edge" data-tip={tip} style={{ opacity: lit ? 1 : 0.08 }}>
                  <path d={path} fill="none" stroke="transparent" strokeWidth={12 / view.k} />
                  <path d={path} fill="none" stroke={`var(--${cls})`} strokeWidth={(1 + Math.min(3, Math.log2(total + 1) * 0.7)) / Math.sqrt(view.k)} strokeLinecap="round" markerEnd={`url(#net-arrow-${cls})`} opacity={focus && lit ? 0.95 : 0.6} />
                </g>
              );
            })}
            {shown.map(n => {
              const p = pos.get(n.id)!;
              const r = radius(n.id);
              const isSel = n.id === selected;
              return (
                <g
                  key={n.id}
                  className="node"
                  role="button"
                  tabIndex={0}
                  aria-label={`${n.label}, ${STATE_LABEL[n.state]}`}
                  data-tip={`${n.label}\n${STATE_LABEL[n.state]} · ${volume.get(n.id) ?? 0} swaps\nClick to focus`}
                  style={{ opacity: dimmed(n.id) ? 0.2 : 1, cursor: 'pointer' }}
                  onPointerEnter={() => setHover(n.id)}
                  onPointerLeave={() => setHover(h => (h === n.id ? null : h))}
                  onClick={() => setSelected(s => (s === n.id ? null : n.id))}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(s => (s === n.id ? null : n.id)); } }}
                >
                  <circle cx={p.x} cy={p.y} r={r + 8 / view.k} fill="transparent" />
                  <circle cx={p.x} cy={p.y} r={r} fill="var(--surface)" stroke={isSel || matches.has(n.id) ? 'var(--copper)' : 'var(--ink-2)'} strokeWidth={(isSel ? 3 : 2) / Math.sqrt(view.k)} />
                  {n.state === 'error' && <circle cx={p.x} cy={p.y} r={Math.max(1.5, r * 0.55)} fill="var(--critical)" />}
                  {n.state === 'warn' && <circle cx={p.x} cy={p.y} r={Math.max(1.5, r * 0.55)} fill="var(--warning)" />}
                </g>
              );
            })}
          </g>
          {shown.map(n => {
            const l = labels.get(n.id);
            if (!l) return null;
            return (
              <text key={n.id} x={l.x} y={l.y} textAnchor={l.anchor} className="node-label" style={{ opacity: dimmed(n.id) ? 0.25 : 1, fontWeight: n.id === focus ? 600 : 400 }} pointerEvents="none">
                {l.text}
              </text>
            );
          })}
          {shown.length === 0 && (
            <text x={W / 2} y={H / 2} textAnchor="middle" className="node-label">No swaps match these filters.</text>
          )}
        </svg>

        <div className="network-zoom" role="group" aria-label="Zoom">
          <button type="button" className="btn secondary" onClick={() => zoom(1.4)} aria-label="Zoom in">+</button>
          <button type="button" className="btn secondary" onClick={() => zoom(1 / 1.4)} aria-label="Zoom out">−</button>
          <button type="button" className="btn secondary" onClick={reset}>Reset</button>
        </div>

        {sel && selStats && (
          <aside className="network-panel" aria-live="polite">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ overflowWrap: 'anywhere' }}>{sel.label}</strong>
              <button type="button" className="network-close" onClick={() => setSelected(null)} aria-label="Close">×</button>
            </div>
            <div className="small soft">{STATE_LABEL[sel.state]} · {selStats.peers} peer{selStats.peers === 1 ? '' : 's'} in {RANGES.find(r => r.key === range)!.label}</div>
            <dl className="kv small" style={{ marginTop: 8 }}>
              <dt>Paid out</dt><dd>{selStats.paidOut} ok · {selStats.failedOut} not</dd>
              <dt>Received</dt><dd>{selStats.received} ok · {selStats.failedIn} not</dd>
              <dt>Moved</dt><dd>{sat(selStats.moved)}</dd>
            </dl>
            <Link href={`/mint/${sel.id}`} prefetch={false} className="small">Open mint →</Link>
          </aside>
        )}
      </div>
      <p className="small muted" style={{ margin: '6px 0 0' }}>Drag to pan · Ctrl + scroll or pinch to zoom · click a mint to focus · Esc to clear</p>

      <details className="table-view">
        <summary>Show table ({edges.length} links)</summary>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>From</th><th>To</th><th className="r c-sm">Paid</th><th className="r c-sm">Failed</th><th className="r c-md">Pending</th><th className="r">Success</th><th className="r c-md">Moved</th><th className="r c-lg">Avg time</th></tr></thead>
            <tbody>
              {[...edges].sort((a, b) => b.paid + b.failed + b.pending - (a.paid + a.failed + a.pending)).map(e => {
                const done = e.paid + e.failed;
                return (
                  <tr key={`${e.source}>${e.dest}`}>
                    <td className="cell-wrap">{byId.get(e.source)?.label}</td>
                    <td className="cell-wrap">{byId.get(e.dest)?.label}</td>
                    <td className="r c-sm">{e.paid}</td>
                    <td className="r c-sm">{e.failed}</td>
                    <td className="r c-md">{e.pending}</td>
                    <td className="r">{done ? pct((e.paid / done) * 100) : '—'}</td>
                    <td className="r nowrap c-md">{sat(e.amount)}</td>
                    <td className="r c-lg">{ms(e.avgMs)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
