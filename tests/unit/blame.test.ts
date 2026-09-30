import { describe, expect, it } from 'vitest';
import { makeBlame, type BlameSwap } from '@/lib/blame';

const now = Date.now();
const s = (source: string, dest: string, status: string, stage: string | null = null, error: string | null = null, ago = 60_000): BlameSwap => ({
  sourceMintId: source, destMintId: dest, status, stage, error, timestamp: new Date(now - ago),
});

describe('makeBlame', () => {
  it('blames the destination for a refused mint quote', () => {
    const x = s('A', 'B', 'failed', 'mint_quote', 'unsupported');
    expect(makeBlame([x], now)(x)).toBe('B');
  });
  it('blames the source for a refused melt quote', () => {
    const x = s('A', 'B', 'failed', 'melt_quote', 'bad invoice');
    expect(makeBlame([x], now)(x)).toBe('A');
  });
  it('does not blame anyone for a single routing failure', () => {
    const x = s('A', 'B', 'failed', 'melt', 'Lightning payment failed: FAILURE_REASON_NO_ROUTE.');
    expect(makeBlame([x], now)(x)).toBeNull();
  });
  it('blames a destination that fails to receive from two sources', () => {
    const a = s('A', 'D', 'failed', 'melt', 'no_route');
    const b = s('C', 'D', 'failed', 'melt', 'Payment failed');
    const blame = makeBlame([a, b], now);
    expect(blame(a)).toBe('D');
    expect(blame(b)).toBe('D');
  });
  it('does not blame a destination that also received successfully', () => {
    const a = s('A', 'D', 'failed', 'melt', 'no_route');
    const b = s('C', 'D', 'failed', 'melt', 'no_route');
    const ok = s('E', 'D', 'success');
    expect(makeBlame([a, b, ok], now)(a)).toBeNull();
  });
  it('blames the source for a stuck payment', () => {
    const x = s('K', 'H', 'pending', 'melt', 'Timeout after 60s');
    expect(makeBlame([x], now)(x)).toBe('K');
  });
  it('ignores evidence outside the window', () => {
    const old = s('C', 'D', 'failed', 'melt', 'no_route', 10 * 86_400_000);
    const x = s('A', 'D', 'failed', 'melt', 'no_route');
    expect(makeBlame([old, x], now)(x)).toBeNull();
  });
  it('never blames balance failures', () => {
    const x = s('A', 'B', 'failed', 'balance', 'Insufficient balance');
    expect(makeBlame([x], now)(x)).toBeNull();
  });
});

describe('recentlyFailing', () => {
  it('flags a mint whose last attributed failure is newer than its last success', async () => {
    const { recentlyFailing } = await import('@/lib/blame');
    const ok = s('K', 'H', 'success', null, null, 120_000);
    const stuck = s('K', 'H', 'pending', 'melt', 'Timeout', 60_000);
    expect([...recentlyFailing([ok, stuck], now)]).toEqual(['K']);
  });
  it('clears after a later success', async () => {
    const { recentlyFailing } = await import('@/lib/blame');
    const bad = s('A', 'B', 'failed', 'mint_quote', 'down', 120_000);
    const ok = s('C', 'B', 'success', null, null, 60_000);
    expect(recentlyFailing([bad, ok], now).size).toBe(0);
  });
});
