import { niceMax } from './format';

export type StatusBucket = { label: string; success: number; failed: number; pending: number };

const SEGMENTS = [
  { key: 'success', label: 'Paid', color: 'var(--good)' },
  { key: 'failed', label: 'Failed', color: 'var(--critical)' },
  { key: 'pending', label: 'Pending', color: 'var(--warning)' },
] as const;

export default function StatusBars({ buckets, ariaLabel, firstLabel, lastLabel }: { buckets: StatusBucket[]; ariaLabel: string; firstLabel: string; lastLabel: string }) {
  const max = niceMax(Math.max(1, ...buckets.map(b => b.success + b.failed + b.pending)));
  const ticks = [max / 2, max].filter(t => Number.isInteger(t));
  const H = 180;

  return (
    <div className="chart">
      <div className="legend" style={{ marginBottom: 24 }}>
        {SEGMENTS.map(s => (
          <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>
        ))}
      </div>
      <div className="bars" role="img" aria-label={ariaLabel}>
        <div className="grid-line" style={{ bottom: 0, background: 'var(--line-strong)' }} />
        {ticks.map(t => (
          <div key={t}>
            <div className="grid-line" style={{ bottom: (t / max) * H }} />
            <div className="grid-label" style={{ bottom: (t / max) * H + 2 }}>{t}</div>
          </div>
        ))}
        {buckets.map(b => {
          const total = b.success + b.failed + b.pending;
          return (
            <div
              key={b.label}
              className="col"
              data-tip={`${total} swap${total === 1 ? '' : 's'}\n${b.label}\nPaid ${b.success} · Failed ${b.failed}${b.pending ? ` · Pending ${b.pending}` : ''}`}
            >
              <div className="stack">
                {SEGMENTS.map(s =>
                  b[s.key] > 0 ? (
                    <div key={s.key} className="seg" style={{ height: Math.max(2, (b[s.key] / max) * H - 2), background: s.color }} />
                  ) : null
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="x-axis"><span>{firstLabel}</span><span>{lastLabel}</span></div>
    </div>
  );
}

export function StatusTable({ buckets, head }: { buckets: StatusBucket[]; head: string }) {
  return (
    <details className="table-view">
      <summary>Show table</summary>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>{head}</th><th className="r">Paid</th><th className="r">Failed</th><th className="r">Pending</th></tr></thead>
          <tbody>
            {[...buckets].reverse().map(b => (
              <tr key={b.label}><td>{b.label}</td><td className="r">{b.success}</td><td className="r">{b.failed}</td><td className="r">{b.pending}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
