import type { MintState } from '@/lib/stats';

type Kind = MintState | 'success' | 'failed' | 'pending' | 'degraded';

const LABEL: Record<Kind, string> = {
  ok: 'OK',
  warn: 'Warning',
  error: 'Offline',
  unknown: 'Not checked',
  success: 'Paid',
  failed: 'Failed',
  pending: 'Pending',
  degraded: 'Degraded',
};

export function StateIcon({ kind, size = 14 }: { kind: Kind; size?: number }) {
  const s = { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true } as const;
  switch (kind) {
    case 'ok':
    case 'success':
      return (
        <svg {...s}><circle cx="8" cy="8" r="7" fill="var(--good)" /><path d="M4.8 8.2l2.1 2.1 4.3-4.5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      );
    case 'warn':
    case 'pending':
      return (
        <svg {...s}><path d="M8 1.5l7 12.5H1z" fill="var(--warning)" strokeLinejoin="round" /><path d="M8 6v4" stroke="#12131c" strokeWidth="1.7" strokeLinecap="round" /><circle cx="8" cy="12" r="1" fill="#12131c" /></svg>
      );
    case 'degraded':
      return (
        <svg {...s}><path d="M8 1l7 7-7 7-7-7z" fill="var(--serious)" /><path d="M8 4.8v3.8" stroke="#12131c" strokeWidth="1.7" strokeLinecap="round" /><circle cx="8" cy="11" r="1" fill="#12131c" /></svg>
      );
    case 'error':
    case 'failed':
      return (
        <svg {...s}><path d="M5.2 1h5.6L15 5.2v5.6L10.8 15H5.2L1 10.8V5.2z" fill="var(--critical)" /><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" /></svg>
      );
    default:
      return (
        <svg {...s}><circle cx="8" cy="8" r="6.2" fill="none" stroke="var(--ink-3)" strokeWidth="1.6" /></svg>
      );
  }
}

export default function StateBadge({ kind, label, title }: { kind: Kind; label?: string; title?: string }) {
  return (
    <span className="badge" title={title ?? label ?? LABEL[kind]} aria-label={label ?? LABEL[kind]}>
      <StateIcon kind={kind} />
      <span className="badge-label">{label ?? LABEL[kind]}</span>
    </span>
  );
}
