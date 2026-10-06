import { ImageResponse } from 'next/og';

export const alt = 'Cashu Audit: independent proof that Cashu mints pay';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#f5f6fa', color: '#12131c', padding: 72 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 40 }}>
          <svg width="72" height="72" viewBox="0 0 32 32"><path d="M11 2.5h10l8.5 8.5v10L21 29.5H11L2.5 21V11z" fill="none" stroke="#5b45e6" strokeWidth="2.5" strokeLinejoin="round" /><circle cx="16" cy="16" r="8.5" fill="#5b45e6" /><path d="M12 16.2l2.8 2.8 5.4-5.6" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span style={{ display: 'flex', gap: 12 }}><span>cashu</span><b>audit</b></span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -2 }}>Do Cashu mints actually pay?</div>
          <div style={{ fontSize: 32, color: '#4a4e63' }}>Uptime, latency and real Lightning swaps between public Cashu mints, every few minutes.</div>
        </div>
        <div style={{ fontSize: 26, color: '#4733cf' }}>audit.cashu.cz</div>
      </div>
    ),
    size
  );
}
