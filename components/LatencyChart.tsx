'use client';

import { useEffect, useRef, useState } from 'react';
import { DAY } from '@/lib/constants';

export type LatencyPoint = { t: number; p50: number | null; p95: number | null; n: number };

const TZ = 'Europe/Prague';
const H = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 48 };

function niceMax(v: number) {
  if (v <= 0) return 100;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

const fmtMs = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);

export default function LatencyChart({ points, bucketMs, spanMs, secondary }: { points: LatencyPoint[]; bucketMs: number; spanMs: number; secondary?: (number | null)[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tick = new Intl.DateTimeFormat('en-GB', spanMs <= DAY
    ? { timeZone: TZ, hour: '2-digit', minute: '2-digit' }
    : { timeZone: TZ, day: 'numeric', month: 'short' });
  const full = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const highs = [...points.map(p => p.p95 ?? 0), ...(secondary ?? []).map(v => v ?? 0)].filter(v => v > 0).sort((a, b) => a - b);
  const typical = highs.length ? highs[Math.floor((highs.length - 1) * 0.97)] : 0;
  const max = niceMax(Math.max(typical, ...points.map(p => p.p50 ?? 0)) * 1.1);
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (Math.min(v, max) / max) * innerH;

  const segments: { i: number; p: LatencyPoint }[][] = [];
  points.forEach((p, i) => {
    if (p.p50 == null) return;
    const last = segments[segments.length - 1];
    if (last && last[last.length - 1].i === i - 1) last.push({ i, p });
    else segments.push([{ i, p }]);
  });

  const second: { i: number; v: number }[][] = [];
  (secondary ?? []).forEach((v, i) => {
    if (v == null || i >= points.length) return;
    const last = second[second.length - 1];
    if (last && last[last.length - 1].i === i - 1) last.push({ i, v });
    else second.push([{ i, v }]);
  });

  const line = (seg: { i: number; p: LatencyPoint }[]) => seg.map(({ i, p }, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.p50!).toFixed(1)}`).join('');
  const band = (seg: { i: number; p: LatencyPoint }[]) =>
    seg.map(({ i, p }, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.p95!).toFixed(1)}`).join('') +
    [...seg].reverse().map(({ i, p }) => `L${x(i).toFixed(1)},${y(p.p50!).toFixed(1)}`).join('') + 'Z';

  const yTicks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const xTickCount = Math.max(2, Math.min(7, Math.floor(innerW / 110)));
  const xTicks = Array.from({ length: xTickCount }, (_, k) => Math.round((k / (xTickCount - 1)) * (points.length - 1)));

  const pick = (clientX: number) => {
    const rect = box.current!.getBoundingClientRect();
    const rel = (clientX - rect.left - PAD.left) / innerW;
    setActive(Math.max(0, Math.min(points.length - 1, Math.round(rel * (points.length - 1)))));
  };

  const a = active != null ? points[active] : null;
  const hasData = segments.length > 0 || second.length > 0;

  return (
    <div ref={box} className="chart" style={{ height: H }}>
      <svg
        width={width}
        height={H}
        role="img"
        aria-label="Latency of /v1/info, median and 95th percentile"
        tabIndex={0}
        style={{ display: 'block', touchAction: 'pan-y' }}
        onPointerMove={e => pick(e.clientX)}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={e => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          setActive(i => Math.max(0, Math.min(points.length - 1, (i ?? points.length - 1) + (e.key === 'ArrowLeft' ? -1 : 1))));
        }}
      >
        {yTicks.map(t => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--line-strong)' : 'var(--line)'} strokeWidth="1" shapeRendering="crispEdges" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--ink-3)" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMs(t)}</text>
          </g>
        ))}
        {xTicks.map((i, k) => (
          <text key={k} x={x(i)} y={H - 8} textAnchor={k === 0 ? 'start' : k === xTicks.length - 1 ? 'end' : 'middle'} fontSize="12" fill="var(--ink-3)">
            {tick.format(points[i]?.t ?? 0)}
          </text>
        ))}
        {segments.map((seg, k) => (
          <path key={`b${k}`} d={band(seg)} fill="var(--series-1)" opacity="0.14" />
        ))}
        {segments.map((seg, k) =>
          seg.length === 1 ? (
            <circle key={`l${k}`} cx={x(seg[0].i)} cy={y(seg[0].p.p50!)} r="4" fill="var(--series-1)" stroke="var(--surface)" strokeWidth="2" />
          ) : (
            <path key={`l${k}`} d={line(seg)} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          )
        )}
        {second.map((seg, k) =>
          seg.length === 1 ? (
            <circle key={`s${k}`} cx={x(seg[0].i)} cy={y(seg[0].v)} r="4" fill="var(--series-2)" stroke="var(--surface)" strokeWidth="2" />
          ) : (
            <path key={`s${k}`} d={seg.map(({ i, v }, j) => `${j ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')} fill="none" stroke="var(--series-2)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          )
        )}
        {!hasData && (
          <text x={PAD.left + innerW / 2} y={PAD.top + innerH / 2} textAnchor="middle" fontSize="13" fill="var(--ink-3)">No successful checks in this range yet</text>
        )}
        {a && active != null && (
          <g pointerEvents="none">
            <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--ink-3)" strokeWidth="1" />
            {a.p50 != null && <circle cx={x(active)} cy={y(a.p50)} r="4.5" fill="var(--series-1)" stroke="var(--surface)" strokeWidth="2" />}
            {secondary?.[active] != null && <circle cx={x(active)} cy={y(secondary[active]!)} r="4.5" fill="var(--series-2)" stroke="var(--surface)" strokeWidth="2" />}
          </g>
        )}
      </svg>
      {a && active != null && (
        <div
          className="tip"
          style={{
            position: 'absolute',
            top: 0,
            left: Math.min(width - 212, Math.max(0, x(active) + (x(active) > width / 2 ? -222 : 12))),
            width: 210,
          }}
        >
          <strong>{a.p50 != null ? `${fmtMs(a.p50)} Prague median` : 'No data from Prague'}</strong>
          {a.p95 != null && <span>{fmtMs(a.p95)} p95 · {a.n} checks</span>}
          {secondary && <span>{secondary[active] != null ? `${fmtMs(secondary[active]!)} Frankfurt median` : 'No data from Frankfurt'}</span>}
          <span>{full.format(a.t)} – {full.format(a.t + bucketMs)}</span>
        </div>
      )}
    </div>
  );
}
