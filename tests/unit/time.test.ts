import { describe, expect, it } from 'vitest';
import { startOfDay } from '@/lib/time';
import { lastDays } from '@/lib/stats';

const at = (iso: string) => new Date(iso).getTime();

describe('Prague days', () => {
  it('starts the day at local midnight', () => {
    expect(startOfDay(at('2026-10-13T10:15:30.500Z'))).toBe(at('2026-10-12T22:00:00Z'));
    expect(startOfDay(at('2026-12-01T10:00:00Z'))).toBe(at('2026-11-30T23:00:00Z'));
  });
  it('handles the days when the clocks change', () => {
    expect(startOfDay(at('2026-10-25T11:00:00Z'))).toBe(at('2026-10-24T22:00:00Z'));
    expect(startOfDay(at('2026-03-29T11:00:00Z'))).toBe(at('2026-03-28T23:00:00Z'));
  });
  it('lists consecutive day keys', () => {
    expect(lastDays(3, at('2026-03-30T00:30:00+02:00'))).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
    expect(lastDays(2, at('2026-10-26T00:30:00+01:00'))).toEqual(['2026-10-25', '2026-10-26']);
  });
});
