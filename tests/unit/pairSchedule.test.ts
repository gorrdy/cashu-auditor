import { describe, expect, it } from 'vitest';
import { dailyCoverage, lastTried, MAX_DAILY_TRIES, needsIn, needsOut, pairValue, type PairSwap } from '@/lib/pairSchedule';

const now = Date.now();
const sw = (source: string, dest: string, status: string, hoursAgo = 1): PairSwap => ({
  sourceMintId: source, destMintId: dest, status, timestamp: new Date(now - hoursAgo * 3_600_000),
});

describe('daily coverage', () => {
  it('a successful swap covers the source out and the destination in', () => {
    const cov = dailyCoverage([sw('A', 'B', 'success')]);
    expect(needsOut('A', cov)).toBe(false);
    expect(needsIn('B', cov)).toBe(false);
    expect(needsIn('A', cov)).toBe(true);
    expect(needsOut('B', cov)).toBe(true);
  });
  it('stops retrying a mint after the daily limit of failures', () => {
    const cov = dailyCoverage(Array.from({ length: MAX_DAILY_TRIES }, (_, i) => sw('A', `D${i}`, 'failed')));
    expect(needsOut('A', cov)).toBe(false);
  });
});

describe('pairValue', () => {
  const none = new Map<string, number>();
  it('prefers a swap that covers two mints over one', () => {
    const cov = dailyCoverage([sw('C', 'B', 'success')]);
    expect(pairValue('A', 'D', cov, none, now)!).toBeGreaterThan(pairValue('A', 'B', cov, none, now)!);
  });
  it('skips pairs where both sides are already covered', () => {
    const cov = dailyCoverage([sw('A', 'X', 'success'), sw('Y', 'B', 'success')]);
    expect(pairValue('A', 'B', cov, none, now)).toBeNull();
  });
  it('prefers a pair not tried for longest', () => {
    const cov = dailyCoverage([]);
    const last = lastTried([sw('A', 'B', 'success', 30)]);
    expect(pairValue('A', 'C', cov, last, now)!).toBeGreaterThan(pairValue('A', 'B', cov, last, now)!);
  });
});
