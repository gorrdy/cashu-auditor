export type ScoreInput = {
  uptime30d: number | null;
  swapOk: number;
  swapBlamed: number;
  latencyMs: number | null;
  feePct: number | null;
  reviewAvg: number | null;
  reviewCount: number;
};

export type ScorePart = { key: string; label: string; weight: number; score: number | null; detail: string };

const clamp = (v: number) => Math.max(0, Math.min(100, v));

export const MIN_SWAPS = 3;
export const MIN_REVIEWS = 3;

export function computeScore(i: ScoreInput): { score: number | null; parts: ScorePart[] } {
  const swaps = i.swapOk + i.swapBlamed;
  const parts: ScorePart[] = [
    {
      key: 'uptime',
      label: 'Availability, 30 days',
      weight: 40,
      score: i.uptime30d == null ? null : clamp((i.uptime30d - 90) * 10),
      detail: i.uptime30d == null ? 'no checks yet' : `${i.uptime30d.toFixed(2)} % (90 % scores 0, 100 % scores 100)`,
    },
    {
      key: 'swaps',
      label: 'Swap success, 30 days',
      weight: 30,
      score: swaps >= MIN_SWAPS || i.swapBlamed > 0 ? (i.swapOk / swaps) * 100 : null,
      detail: swaps >= MIN_SWAPS || i.swapBlamed > 0 ? `${i.swapOk} of ${swaps} swaps without a failure attributed to the mint` : `needs ${MIN_SWAPS} swaps, has ${swaps}`,
    },
    {
      key: 'latency',
      label: 'Response time',
      weight: 10,
      score: i.latencyMs == null ? null : clamp(100 - ((i.latencyMs - 150) / 1850) * 100),
      detail: i.latencyMs == null ? 'no answers yet' : `${Math.round(i.latencyMs)} ms (150 ms scores 100, 2 s scores 0)`,
    },
    {
      key: 'fees',
      label: 'Lightning fee when paying out',
      weight: 10,
      score: i.feePct == null ? null : clamp(100 - ((i.feePct - 1) / 9) * 100),
      detail: i.feePct == null ? 'no payouts yet' : `${i.feePct.toFixed(1)} % (1 % scores 100, 10 % scores 0)`,
    },
    {
      key: 'reviews',
      label: 'Nostr reviews',
      weight: 10,
      score: i.reviewCount >= MIN_REVIEWS && i.reviewAvg != null ? (i.reviewAvg / 5) * 100 : null,
      detail: i.reviewCount >= MIN_REVIEWS && i.reviewAvg != null ? `${i.reviewAvg.toFixed(1)} / 5 from ${i.reviewCount} ratings` : `needs ${MIN_REVIEWS} ratings, has ${i.reviewCount}`,
    },
  ];
  if (parts[0].score == null) return { score: null, parts };
  const used = parts.filter(p => p.score != null);
  const weight = used.reduce((s, p) => s + p.weight, 0);
  return { score: Math.round(used.reduce((s, p) => s + p.weight * p.score!, 0) / weight), parts };
}
