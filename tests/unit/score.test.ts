import { describe, expect, it } from 'vitest';
import { computeScore } from '@/lib/score';

const base = { uptime30d: 100, swapOk: 10, swapBlamed: 0, latencyMs: 150, reviewAvg: 5, reviewCount: 5 };

describe('computeScore', () => {
  it('gives a perfect mint 100', () => expect(computeScore(base).score).toBe(100));
  it('is null without availability data', () => expect(computeScore({ ...base, uptime30d: null }).score).toBeNull());
  it('reweights over available parts', () => {
    const r = computeScore({ uptime30d: 99, swapOk: 0, swapBlamed: 0, latencyMs: 150, reviewAvg: null, reviewCount: 0 });
    expect(r.score).toBe(Math.round((40 * 90 + 10 * 100) / 50));
  });
  it('counts attributed failures even below the swap minimum', () => {
    const r = computeScore({ ...base, swapOk: 0, swapBlamed: 2 });
    expect(r.parts.find(p => p.key === 'swaps')!.score).toBe(0);
    expect(r.score).toBeLessThan(80);
  });
  it('ignores swap and review parts below the minimum', () => {
    const r = computeScore({ ...base, swapOk: 2, swapBlamed: 0, reviewCount: 2 });
    expect(r.parts.find(p => p.key === 'swaps')!.score).toBeNull();
    expect(r.parts.find(p => p.key === 'reviews')!.score).toBeNull();
  });
  it('clamps slow mints to zero on latency', () => {
    const r = computeScore({ ...base, latencyMs: 5000 });
    expect(r.parts.find(p => p.key === 'latency')!.score).toBe(0);
  });
});
