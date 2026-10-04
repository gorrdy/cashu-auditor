import { makeBlame, type BlameSwap } from './blame';
import { prisma } from './prisma';

const HOUR = 3_600_000;
export const MAX_BACKOFF_MS = 24 * HOUR;

export type Backoff = { failures: number; until: number; pending: boolean; sendUntil: number; receiveUntil: number; banned: boolean };

const wait = (failures: number) => (failures ? Math.min(MAX_BACKOFF_MS, HOUR * 2 ** (failures - 1)) : 0);

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
  type Role = { failures: number; last: number };
  const state = new Map<string, { send: Role; receive: Role; pending: boolean; banned: boolean }>();
  const get = (id: string) => {
    let s = state.get(id);
    if (!s) state.set(id, (s = { send: { failures: 0, last: 0 }, receive: { failures: 0, last: 0 }, pending: false, banned: false }));
    return s;
  };
  for (const s of sorted) {
    if (s.preimageOk === false && now - s.timestamp.getTime() < 7 * 24 * HOUR) get(s.sourceMintId).banned = true;
    if (s.status === 'success') {
      get(s.sourceMintId).send.failures = 0;
      get(s.destMintId).receive.failures = 0;
      continue;
    }
    const id = blame(s);
    if (!id) continue;
    const st = get(id);
    if (s.status === 'pending') {
      st.pending = true;
      continue;
    }
    const role = id === s.sourceMintId ? st.send : st.receive;
    role.failures++;
    role.last = s.timestamp.getTime();
  }
  const out = new Map<string, Backoff>();
  for (const [id, s] of state) {
    if (!s.send.failures && !s.receive.failures && !s.pending && !s.banned) continue;
    const sendUntil = s.send.failures ? s.send.last + wait(s.send.failures) : 0;
    const receiveUntil = s.receive.failures ? s.receive.last + wait(s.receive.failures) : 0;
    out.set(id, {
      failures: Math.max(s.send.failures, s.receive.failures),
      until: Math.max(sendUntil, receiveUntil),
      pending: s.pending,
      sendUntil,
      receiveUntil,
      banned: s.banned,
    });
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
  const stuck = new Set(
    (await prisma.proof.groupBy({ by: ['mintId'], where: { state: 'reserved' } })).map(r => r.mintId)
  );
  for (const id of stuck) {
    const b = map.get(id);
    map.set(id, b ? { ...b, pending: true } : { failures: 0, until: 0, pending: true, sendUntil: 0, receiveUntil: 0, banned: false });
  }
  return {
    map,
    canPair: (source: string, dest: string) => (pairs.get(`${source}>${dest}`) ?? 0) <= now,
    canSend: (id: string) => {
      const b = map.get(id);
      return !b || (!b.pending && !b.banned && b.sendUntil <= now);
    },
    canReceive: (id: string) => {
      const b = map.get(id);
      return !b || b.receiveUntil <= now;
    },
  };
}
