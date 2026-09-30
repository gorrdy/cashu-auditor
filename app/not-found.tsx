import Link from 'next/link';

export default function NotFound() {
  return (
    <section style={{ padding: '48px 0' }}>
      <p className="eyebrow">404</p>
      <h1 className="h1" style={{ marginTop: 8 }}>Nothing stamped here</h1>
      <p className="soft">This page or mint is not in the audit log.</p>
      <p><Link href="/">← All mints</Link></p>
    </section>
  );
}
