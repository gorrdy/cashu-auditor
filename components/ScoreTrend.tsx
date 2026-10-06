import { fmtDayKey } from './format';

export default function ScoreTrend({ points }: { points: { day: string; score: number | null }[] }) {
  const pts = points.filter(p => p.score != null) as { day: string; score: number }[];
  if (pts.length === 0) return <p className="small muted">Score history starts with the first daily snapshot.</p>;
  const idx = new Map(points.map((p, i) => [p.day, i]));
  const x = (day: string) => (points.length <= 1 ? 100 : (idx.get(day)! / (points.length - 1)) * 100);
  const path = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.day).toFixed(2)},${(100 - p.score).toFixed(2)}`).join('');
  return (
    <div className="trend" role="img" aria-label="Audit score per day">
      <div className="trend-plot">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {[0, 50, 100].map(t => (
            <line key={t} x1="0" x2="100" y1={100 - t} y2={100 - t} stroke={t === 0 ? 'var(--line-strong)' : 'var(--line)'} strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          {pts.length > 1 && <path d={path} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        </svg>
        {[0, 50, 100].map(t => <span key={t} className="trend-y" style={{ top: `${100 - t}%` }}>{t}</span>)}
        {pts.map(p => (
          <span key={p.day} className="trend-dot" style={{ left: `${x(p.day)}%`, top: `${100 - p.score}%` }} data-tip={`${p.score} / 100\n${fmtDayKey(p.day)}`} />
        ))}
      </div>
      <div className="trend-x"><span>{fmtDayKey(points[0].day)}</span><span>Today</span></div>
    </div>
  );
}
