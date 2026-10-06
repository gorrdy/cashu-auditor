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
