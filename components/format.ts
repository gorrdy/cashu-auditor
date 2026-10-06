import { TZ } from '@/lib/stats';

export { HOUR as HOUR_MS } from '@/lib/constants';

const dateTime = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dateOnly = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const dayShort = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const hourOnly = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

export const fmtDateTime = (t: number | Date) => dateTime.format(t);
export const fmtDate = (t: number | Date) => dateOnly.format(t);
export const fmtHour = (t: number) => hourOnly.format(t);
export const fmtDayKey = (key: string) => dayShort.format(Date.parse(key + 'T12:00:00Z'));

export function fmtPct(v: number | null | undefined, digits = 1) {
  if (v == null) return '—';
  if (v >= 99.995) return '100 %';
  return `${v.toFixed(digits)} %`;
}

export function fmtMs(v: number | null | undefined) {
  if (v == null) return '—';
  return v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)} s` : `${Math.round(v)} ms`;
}

export const fmtSat = (v: number) => `${v.toLocaleString('en-US')} sat`;

export function fmtAgo(now: number, t: number | null) {
  if (t == null) return 'never';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function fmtDuration(ms: number) {
  const m = Math.round(ms / 60_000);
  if (m < 1) return '< 1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

export const hostOf = (url: string) => url.replace(/^https?:\/\//, '');
export const mintLabel = (m: { name: string | null; url: string }) => m.name?.replace(/^"|"$/g, '') || hostOf(m.url);

export function uptimeClass(v: number | null) {
  if (v == null) return '';
  if (v >= 99) return 'u-good';
  if (v >= 95) return 'u-warning';
  if (v >= 80) return 'u-serious';
  return 'u-critical';
}

export function niceMax(v: number) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}
