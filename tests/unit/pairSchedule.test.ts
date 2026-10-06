import { describe, expect, it } from 'vitest';
import { DAY } from '@/lib/constants';
import { mintFreshness, NEVER_TRIED, pairInterval, pairPriority, pairStates, type PairSwap } from '@/lib/pairSchedule';

const now = Date.now();
const sw = (source: string, dest: string, status: string, daysAgo: number): PairSwap => ({
  sourceMintId: source, destMintId: dest, status, timestamp: new Date(now - daysAgo * DAY),
});
const newestFirst = (list: PairSwap[]) => [...list].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

describe('pairStates', () => {
  it('counts consecutive successes from the newest attempt', () => {
    const st = pairStates(newestFirst([sw('A', 'B', 'success', 1), sw('A', 'B', 'success', 2), sw('A', 'B', 'failed', 3), sw('A', 'B', 'success', 4)]));
    expect(st.get('A>B')!.streak).toBe(2);
  });
  it('a failure resets the streak', () => {
    expect(pairStates(newestFirst([sw('A', 'B', 'failed', 1), sw('A', 'B', 'success', 2)])).get('A>B')!.streak).toBe(0);
  });
  it('ignores pending attempts for the streak', () => {
    expect(pairStates(newestFirst([sw('A', 'B', 'pending', 0.1), sw('A', 'B', 'success', 1)])).get('A>B')!.streak).toBe(1);
  });
});

describe('pairPriority', () => {
  const freshAll = { sent: new Set(['A', 'C']), received: new Set(['B', 'D']) };
  it('puts never tried pairs first', () => {
    expect(pairPriority('A', 'B', new Map(), freshAll, now)).toBe(NEVER_TRIED);
  });
  it('tests a reliable pair less often', () => {
    const history = newestFirst(Array.from({ length: 7 }, (_, i) => sw('A', 'B', 'success', 1.5 + i)));
    const states = pairStates(history);
    expect(pairInterval(states.get('A>B')!.streak)).toBe(4 * DAY);
    expect(pairPriority('A', 'B', states, freshAll, now)).toBeNull();
  });
  it('retests a failing pair after a day', () => {
    const states = pairStates([sw('A', 'B', 'failed', 1.1)]);
    expect(pairPriority('A', 'B', states, freshAll, now)).toBeGreaterThan(1);
  });
  it('keeps a mint without a payout in 24 h in rotation', () => {
    const states = pairStates(newestFirst(Array.from({ length: 7 }, (_, i) => sw('A', 'B', 'success', 1.5 + i))));
    const fresh = mintFreshness([], now);
    expect(pairPriority('A', 'B', states, fresh, now)).toBeGreaterThan(1);
  });
});
