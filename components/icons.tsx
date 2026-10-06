export function BoltIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M9.2 1 3 9.2h4.3L6.6 15 13 6.7H8.7L9.2 1Z" fill="currentColor" />
    </svg>
  );
}

export function CoinIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="8" cy="8" r="6.2" />
      <path d="m5.4 8.1 1.8 1.8 3.5-3.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
