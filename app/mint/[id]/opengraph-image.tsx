import { ImageResponse } from 'next/og';
import { mintList } from '@/lib/api';

export const alt = 'Cashu Mints Auditor';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const STATE = { ok: ['OK', '#0ca30c'], warn: ['Warning', '#fab219'], error: ['Offline', '#d03b3b'], unknown: ['Not checked', '#6f7490'] } as const;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = (await mintList()).mints.find(x => x.id === id);
  const name = (m?.name?.replace(/^"|"$/g, '') || m?.url.replace(/^https:\/\//, '') || 'Unknown mint').slice(0, 40);
  const [stateLabel, stateColor] = STATE[(m?.state ?? 'unknown') as keyof typeof STATE];
  const stat = (label: string, value: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 24, color: '#4a4e63' }}>{label}</div>
      <div style={{ fontSize: 48, fontWeight: 700 }}>{value}</div>
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#f5f6fa', color: '#12131c', padding: 72 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 30 }}>
          <span style={{ display: 'flex', gap: 12 }}><span>Cashu Mints</span><b>Auditor</b></span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ width: 22, height: 22, borderRadius: 11, background: stateColor }} />{stateLabel}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 72, fontWeight: 700, letterSpacing: -2 }}>{name}</div>
          <div style={{ fontSize: 28, color: '#4a4e63' }}>{m?.url.replace(/^https:\/\//, '') ?? ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 80 }}>
          {stat('Audit score', m?.score != null ? `${m.score} / 100` : '—')}
          {stat('Uptime 30 d', m?.uptime30d != null ? `${m.uptime30d.toFixed(2)} %` : '—')}
          {stat('Latency', m?.latencyMs24h != null ? `${m.latencyMs24h} ms` : '—')}
        </div>
      </div>
    ),
    size
  );
}
