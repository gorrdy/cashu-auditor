export default function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M11 2.5h10l8.5 8.5v10L21 29.5H11L2.5 21V11z" fill="none" stroke="var(--copper)" strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="16" cy="16" r="8.5" fill="var(--copper)" />
      <path d="M12 16.2l2.8 2.8 5.4-5.6" fill="none" stroke="var(--surface)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
