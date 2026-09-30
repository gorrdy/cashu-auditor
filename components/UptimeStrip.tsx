import { fmtPct, uptimeClass } from './format';

export type StripCell = { label: string; uptime: number | null; detail?: string };

export default function UptimeStrip({ cells, variant = 'tall', ariaLabel }: { cells: StripCell[]; variant?: 'tall' | 'compact'; ariaLabel: string }) {
  return (
    <div className={`strip ${variant}`} role="img" aria-label={ariaLabel}>
      {cells.map((c, i) => (
        <span
          key={i}
          className={uptimeClass(c.uptime)}
          data-tip={`${c.uptime == null ? 'No data' : fmtPct(c.uptime, 2)}\n${c.label}${c.detail ? `\n${c.detail}` : ''}`}
        />
      ))}
    </div>
  );
}

export function UptimeLegend() {
  return (
    <div className="legend">
      <span><i className="u-good" />≥ 99 %</span>
      <span><i className="u-warning" />95–99 %</span>
      <span><i className="u-serious" />80–95 %</span>
      <span><i className="u-critical" />&lt; 80 %</span>
      <span><i style={{ background: 'var(--line)' }} />No data</span>
    </div>
  );
}
