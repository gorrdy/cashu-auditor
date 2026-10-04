import { fmtDayKey } from './format';

const W = 720;
const H = 140;
const PAD = { l: 36, r: 12, t: 10, b: 22 };

export default function ScoreTrend({ points }: { points: { day: string; score: number | null }[] }) {
  const pts = points.filter(p => p.score != null) as { day: string; score: number }[];
  if (pts.length === 0) return <p className="small muted">Score history starts with the first daily snapshot.</p>;
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (points.length <= 1 ? iw : (i / (points.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - (v / 100) * ih;
  const idx = new Map(points.map((p, i) => [p.day, i]));
  const path = pts.map((p, k) => `${k ? 'L' : 'M'}${x(idx.get(p.day)!).toFixed(1)},${y(p.score).toFixed(1)}`).join('');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Audit score per day">
      {[0, 50, 100].map(t => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--line-strong)' : 'var(--line)'} strokeWidth="1" />
          <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">{t}</text>
        </g>
      ))}
      {pts.length > 1 && <path d={path} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
      {pts.map(p => (
        <g key={p.day} data-tip={`${p.score} / 100\n${fmtDayKey(p.day)}`}>
          <circle cx={x(idx.get(p.day)!)} cy={y(p.score)} r="10" fill="transparent" />
          <circle cx={x(idx.get(p.day)!)} cy={y(p.score)} r="4" fill="var(--series-1)" stroke="var(--surface)" strokeWidth="2" />
        </g>
      ))}
      <text x={PAD.l} y={H - 4} fontSize="11" fill="var(--ink-3)">{fmtDayKey(points[0].day)}</text>
      <text x={W - PAD.r} y={H - 4} fontSize="11" fill="var(--ink-3)" textAnchor="end">Today</text>
    </svg>
  );
}
