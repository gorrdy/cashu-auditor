import { describe, expect, it } from 'vitest';
import { runFailures, runPassed, type RunHop } from '@/lib/runfail';

const now = Date.now();
const hop = (source: string, dest: string, status: string, stage: string | null, agoMin: number, duration = 3000): RunHop => ({
  sourceMintId: source, destMintId: dest, status, stage, error: null, duration, timestamp: new Date(now - agoMin * 60_000),
});

describe('runFailures', () => {
  it('puts a payment stuck for minutes on the receiver', () => {
    const f = runFailures([hop('S', 'C', 'success', null, 20), hop('C', 'N', 'pending', 'melt', 10)], now);
    expect([...f.keys()]).toEqual(['N']);
  });
  it('ignores a payment pending for under two minutes', () => {
    expect(runFailures([hop('C', 'N', 'pending', 'melt', 1)], now).size).toBe(0);
  });
  it('puts a failed payout on the payer when the receiver has received a run before', () => {
    const f = runFailures([hop('A', 'N', 'success', null, 30), hop('C', 'N', 'failed', 'melt', 10)], now);
    expect([...f.keys()]).toEqual(['C']);
  });
  it('flags a mint that could not quote the amount and skips our own planning errors', () => {
    const f = runFailures([hop('A', 'Q', 'failed', 'mint_quote', 5), hop('A', 'B', 'failed', 'balance', 5)], now);
    expect([...f.keys()]).toEqual(['Q']);
  });
  it('does not blame the payer when our own split came up short on its input fees', () => {
    const f = runFailures([{ ...hop('M', 'B', 'failed', 'split', 5), error: 'Not enough funds available to send' }], now);
    expect(f.size).toBe(0);
  });
  it('forgets failures after 30 days', () => {
    expect(runFailures([hop('A', 'Q', 'failed', 'mint_quote', 31 * 24 * 60)], now).size).toBe(0);
  });
  it('marks a mint as passed only when it both received and paid out a run', () => {
    const p = runPassed([hop('H', 'A', 'success', null, 30), hop('A', 'B', 'success', null, 29), hop('B', 'N', 'pending', 'melt', 20)], now);
    expect([...p.keys()]).toEqual(['A']);
  });
});
