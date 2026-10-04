import { json } from '@/lib/api';
import { getSwapGraph } from '@/lib/stats';

const DAYS = { '24h': 1, '7d': 7, '30d': 30 } as const;

export async function GET(request: Request) {
  const range = new URL(request.url).searchParams.get('range') ?? '30d';
  if (!(range in DAYS)) return json({ error: 'range must be 24h, 7d or 30d' }, 400);
  return json({ range, edges: await getSwapGraph(DAYS[range as keyof typeof DAYS]) });
}
