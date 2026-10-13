import { describe, expect, it } from 'vitest';
import { isRecommended } from '@/lib/stats';

const now = Date.parse('2026-10-13T10:00:00Z');
const good = { isTest: false, latestStatus: 'online', uptime7d: 99.8, addedAt: new Date(now - 30 * 86_400_000), pending: 0, reserved: 0, week: { out: 2, in: 3, blamed: 0 } };

describe('recommended mints', () => {
  it('recommends a mint that worked all week', () => {
    expect(isRecommended(good, now)).toBe(true);
  });
  it('drops a mint with an attributed failure, a stuck payment, low uptime or no payout', () => {
    expect(isRecommended({ ...good, week: { ...good.week, blamed: 1 } }, now)).toBe(false);
    expect(isRecommended({ ...good, pending: 1 }, now)).toBe(false);
    expect(isRecommended({ ...good, reserved: 50 }, now)).toBe(false);
    expect(isRecommended({ ...good, uptime7d: 98.5 }, now)).toBe(false);
    expect(isRecommended({ ...good, week: { ...good.week, out: 0 } }, now)).toBe(false);
  });
  it('never recommends test mints or mints younger than a week', () => {
    expect(isRecommended({ ...good, isTest: true }, now)).toBe(false);
    expect(isRecommended({ ...good, addedAt: new Date(now - 3 * 86_400_000) }, now)).toBe(false);
  });
});
