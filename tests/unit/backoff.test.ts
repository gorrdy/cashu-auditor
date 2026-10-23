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
  it('doubles with every further failure', () => {
    const swaps = Array.from({ length: 8 }, (_, i) => s('A', 'X', 'failed', 'mint_quote', 10 - i));
    const b = computeBackoff(swaps, now).get('X')!;
    expect(b.failures).toBe(8);
    expect(b.until - (now - 3 * HOUR)).toBe(128 * HOUR);
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

describe('computePairBackoff', () => {
  it('pauses a pair after routing failures and doubles', async () => {
    const { computePairBackoff } = await import('@/lib/backoff');
    const swaps = [s('A', 'X', 'failed', 'melt', 3, 'no_route'), s('A', 'X', 'failed', 'melt', 2, 'no_route')];
    expect(computePairBackoff(swaps, now).get('A>X')).toBe(now - 2 * HOUR + 2 * HOUR);
    expect(computePairBackoff(swaps, now).get('B>X')).toBeUndefined();
  });
  it('clears after the pair succeeds', async () => {
    const { computePairBackoff } = await import('@/lib/backoff');
    const swaps = [s('A', 'X', 'failed', 'melt', 3, 'no_route'), s('A', 'X', 'success', null, 1)];
    expect(computePairBackoff(swaps, now).get('A>X')).toBeUndefined();
  });
});

describe('role-aware backoff', () => {
  it('a successful receipt does not clear payout failures', () => {
    const swaps = [s('L', 'X', 'failed', 'melt', 0.5, 'Token already spent'), s('Y', 'L', 'success', null, 0.25)];
    const b = computeBackoff(swaps, now).get('L')!;
    expect(b.sendUntil).toBeGreaterThan(now);
    expect(b.receiveUntil).toBe(0);
  });
  it('stops payouts from a mint that faked a preimage', () => {
    const fake = { ...s('L', 'P', 'failed', 'melt', 1, 'fake'), preimageOk: false };
    expect(computeBackoff([fake, s('L', 'Q', 'success', null, 0.5)], now).get('L')!.banned).toBe(true);
  });
  it('stops sending to a mint that twice kept paid invoices without issuing ecash', () => {
    const unpaid = (agoH: number) => ({ ...s('A', 'U', 'failed', 'mint', agoH, 'Invoice paid but mint quote still UNPAID'), preimageOk: true });
    expect(computeBackoff([unpaid(30)], now).get('U')?.receiveUntil ?? 0).toBeLessThan(now + 24 * HOUR);
    expect(computeBackoff([unpaid(30), unpaid(28)], now).get('U')!.receiveUntil).toBeGreaterThan(now + 5 * 24 * HOUR);
    expect(computeBackoff([unpaid(30), unpaid(28), s('B', 'U', 'success', null, 1)], now).get('U')?.receiveUntil ?? 0).toBeLessThan(now);
  });
  it('keeps doubling attributed failures past one day', () => {
    const swaps = Array.from({ length: 7 }, (_, i) => s('A', 'X', 'failed', 'mint_quote', 7 - i));
    expect(computeBackoff(swaps, now).get('X')!.receiveUntil).toBeGreaterThan(now + 2 * 24 * HOUR);
  });
});
