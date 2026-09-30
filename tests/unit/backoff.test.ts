import { describe, expect, it } from 'vitest';
import { computeBackoff } from '@/lib/backoff';
import type { BlameSwap } from '@/lib/blame';

const HOUR = 3_600_000;
const now = Date.now();
const s = (source: string, dest: string, status: string, stage: string | null, agoH: number, error: string | null = null): BlameSwap => ({
  sourceMintId: source, destMintId: dest, status, stage, error, timestamp: new Date(now - agoH * HOUR),
});

describe('computeBackoff', () => {
  it('waits one hour after the first attributed failure', () => {
    const b = computeBackoff([s('A', 'X', 'failed', 'mint_quote', 0.5)], now).get('X')!;
    expect(b.failures).toBe(1);
    expect(b.until).toBe(now - 0.5 * HOUR + HOUR);
  });
  it('doubles with every further failure and caps at 24 hours', () => {
    const swaps = Array.from({ length: 8 }, (_, i) => s('A', 'X', 'failed', 'mint_quote', 10 - i));
    const b = computeBackoff(swaps, now).get('X')!;
    expect(b.failures).toBe(8);
    expect(b.until - (now - 3 * HOUR)).toBe(24 * HOUR);
  });
  it('resets after a success', () => {
    const swaps = [s('A', 'X', 'failed', 'mint_quote', 3), s('A', 'X', 'failed', 'mint_quote', 2), s('B', 'X', 'success', null, 1)];
    expect(computeBackoff(swaps, now).get('X')).toBeUndefined();
  });
  it('marks a source with a stuck payout as pending', () => {
    const b = computeBackoff([s('K', 'H', 'pending', 'melt', 1, 'Timeout')], now).get('K')!;
    expect(b.pending).toBe(true);
    expect(computeBackoff([s('K', 'H', 'pending', 'melt', 1)], now).get('H')).toBeUndefined();
  });
  it('does not back off mints that were not blamed', () => {
    const r = computeBackoff([s('A', 'X', 'failed', 'melt', 1, 'no_route')], now);
    expect(r.size).toBe(0);
  });
});
