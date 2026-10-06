'use client';

import { HOUR } from '@/lib/constants';

const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit' });

function cls(v: number | null) {
  if (v == null) return '';
  if (v >= 99) return 'u-good';
  if (v >= 95) return 'u-warning';
  if (v >= 80) return 'u-serious';
  return 'u-critical';
}

export default function HourStrip({ values, firstHour, label }: { values: (number | null)[]; firstHour: number; label: string }) {
  return (
    <div className="strip compact" role="img" aria-label={label}>
      {values.map((v, i) => {
        const t = (firstHour + i) * HOUR;
        return <span key={i} className={cls(v)} data-tip={`${v == null ? 'No data' : v >= 99.995 ? '100 %' : `${v.toFixed(2)} %`}\n${hourFmt.format(t)}–${hourFmt.format(t + HOUR)}`} />;
      })}
    </div>
  );
}
