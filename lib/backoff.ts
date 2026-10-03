import { makeBlame, type BlameSwap } from './blame';
import { prisma } from './prisma';

const HOUR = 3_600_000;
export const MAX_BACKOFF_MS = 24 * HOUR;

export type Backoff = { failures: number; until: number; pending: boolean };

export function computePairBackoff(swaps: BlameSwap[], now = Date.now()) {
  const blame = makeBlame(swaps, now);
  const sorted = [...swaps].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const pairs = new Map<string, { failures: number; last: number }>();
  for (const s of sorted) {
    const key = `${s.sourceMintId}>${s.destMintId}`;
    if (s.status === 'success') {
      pairs.delete(key);
      continue;
    }
    if (s.status !== 'failed' || s.stage !== 'melt' || blame(s)) continue;
    const p = pairs.get(key) ?? { failures: 0, last: 0 };
    p.failures++;
    p.last = s.timestamp.getTime();
    pairs.set(key, p);
  }
  const until = new Map<string, number>();
  for (const [key, p] of pairs) until.set(key, p.last + Math.min(MAX_BACKOFF_MS, HOUR * 2 ** (p.failures - 1)));
  return until;
}

export function computeBackoff(swaps: BlameSwap[], now = Date.now()) {
  const blame = makeBlame(swaps, now);
  const sorted = [...swaps].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const state = new Map<string, { failures: number; last: number; pending: boolean }>();
  const get = (id: string) => {
    let s = state.get(id);
    if (!s) state.set(id, (s = { failures: 0, last: 0, pending: false }));
    return s;
  };
  for (const s of sorted) {
    if (s.status === 'success') {
      for (const id of [s.sourceMintId, s.destMintId]) {
        const st = get(id);
        st.failures = 0;
      }
      continue;
    }
    const id = blame(s);
    if (!id) continue;
    const st = get(id);
    if (s.status === 'pending') {
      st.pending = true;
      continue;
    }
    st.failures++;
    st.last = s.timestamp.getTime();
  }
  const out = new Map<string, Backoff>();
  for (const [id, s] of state) {
    if (!s.failures && !s.pending) continue;
    const wait = s.failures ? Math.min(MAX_BACKOFF_MS, HOUR * 2 ** (s.failures - 1)) : 0;
    out.set(id, { failures: s.failures, until: s.failures ? s.last + wait : 0, pending: s.pending });
  }
  return out;
}

export async function loadBackoff(now = Date.now()) {
  const swaps = await prisma.swap.findMany({
    where: { OR: [{ timestamp: { gte: new Date(now - 7 * 86_400_000) } }, { status: 'pending' }] },
    select: { status: true, stage: true, error: true, preimageOk: true, sourceMintId: true, destMintId: true, timestamp: true },
  });
  const map = computeBackoff(swaps, now);
  const pairs = computePairBackoff(swaps, now);
  return {
    map,
    canPair: (source: string, dest: string) => (pairs.get(`${source}>${dest}`) ?? 0) <= now,
    canSend: (id: string) => {
      const b = map.get(id);
      return !b || (!b.pending && b.until <= now);
    },
    canReceive: (id: string) => {
      const b = map.get(id);
      return !b || b.until <= now;
    },
  };
}
