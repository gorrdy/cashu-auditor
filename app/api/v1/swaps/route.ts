import { json } from '@/lib/api';
import { getRecentSwaps } from '@/lib/stats';

export async function GET(request: Request) {
  const limit = Math.min(500, Math.max(1, Number(new URL(request.url).searchParams.get('limit') ?? 100) || 100));
  const swaps = await getRecentSwaps({ take: limit });
  return json({
    swaps: swaps.map(s => ({
      id: s.id,
      at: s.timestamp.toISOString(),
      kind: s.kind,
      status: s.status,
      stage: s.stage,
      error: s.error,
      amount: s.amount,
      fee: s.status === 'success' ? s.fee : null,
      durationMs: s.status === 'pending' ? null : s.duration,
      from: { id: s.sourceMint.id, url: s.sourceMint.url, name: s.sourceMint.name },
      to: { id: s.destMint.id, url: s.destMint.url, name: s.destMint.name },
    })),
  });
}
