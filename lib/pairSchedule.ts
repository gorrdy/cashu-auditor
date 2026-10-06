import { DAY } from './constants';

export type PairSwap = { sourceMintId: string; destMintId: string; status: string; timestamp: Date };
export type PairState = { last: number; streak: number };

export const NEVER_TRIED = 1e6;

export const pairKey = (source: string, dest: string) => `${source}>${dest}`;

export function pairInterval(streak: number) {
  if (streak >= 14) return 7 * DAY;
  if (streak >= 7) return 4 * DAY;
  if (streak >= 3) return 2 * DAY;
  return DAY;
}

export function pairStates(newestFirst: PairSwap[]) {
  const states = new Map<string, PairState & { open: boolean }>();
  for (const s of newestFirst) {
    const key = pairKey(s.sourceMintId, s.destMintId);
    let st = states.get(key);
    if (!st) states.set(key, (st = { last: s.timestamp.getTime(), streak: 0, open: true }));
    if (!st.open || s.status === 'pending') continue;
    if (s.status === 'success') st.streak++;
    else st.open = false;
  }
  return states as Map<string, PairState>;
}

export function mintFreshness(swaps: PairSwap[], now: number) {
  const sent = new Set<string>();
  const received = new Set<string>();
  for (const s of swaps) {
    if (s.status !== 'success' || now - s.timestamp.getTime() >= DAY) continue;
    sent.add(s.sourceMintId);
    received.add(s.destMintId);
  }
  return { sent, received };
}

export function pairPriority(
  source: string,
  dest: string,
  states: Map<string, PairState>,
  fresh: { sent: Set<string>; received: Set<string> },
  now: number
): number | null {
  const st = states.get(pairKey(source, dest));
  if (!st) return NEVER_TRIED;
  const overdue = (now - st.last) / pairInterval(st.streak);
  if (overdue >= 1) return overdue;
  if (!fresh.sent.has(source) || !fresh.received.has(dest)) return 1 + overdue;
  return null;
}
