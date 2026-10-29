import { DAY } from './constants';
const ROUTE_ERROR = /no[_ ]?route|route|payment failed|failure_reason|http status|timeout after|melt state pending/i;

export type BlameSwap = {
  status: string;
  stage: string | null;
  error: string | null;
  sourceMintId: string;
  destMintId: string;
  timestamp: Date;
  preimageOk?: boolean | null;
};

export const BLAME_SELECT = { status: true, stage: true, error: true, preimageOk: true, sourceMintId: true, destMintId: true, timestamp: true } as const;

const FAIL_RATIO = 0.5;
const MIN_RATIO_ATTEMPTS = 5;

export function makeBlame(swaps: BlameSwap[], now = Date.now(), windowMs = 7 * DAY) {
  const recent = swaps.filter(s => now - s.timestamp.getTime() < windowMs);
  const okIn = new Map<string, number>();
  const okOut = new Map<string, number>();
  const failIn = new Map<string, number>();
  const failOut = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const s of recent) {
    if (s.status !== 'success') continue;
    bump(okIn, s.destMintId);
    bump(okOut, s.sourceMintId);
  }
  const failedFrom = new Map<string, Set<string>>();
  const failedTo = new Map<string, Set<string>>();
  for (const s of recent) {
    if (s.status !== 'failed' || s.stage !== 'melt' || !ROUTE_ERROR.test(s.error ?? '')) continue;
    bump(failIn, s.destMintId);
    bump(failOut, s.sourceMintId);
    if (!failedFrom.has(s.destMintId)) failedFrom.set(s.destMintId, new Set());
    failedFrom.get(s.destMintId)!.add(s.sourceMintId);
    if (!failedTo.has(s.sourceMintId)) failedTo.set(s.sourceMintId, new Set());
    failedTo.get(s.sourceMintId)!.add(s.destMintId);
  }

  const mostlyFailing = (fails: number, oks: number) => oks === 0 || (fails + oks >= MIN_RATIO_ATTEMPTS && fails / (fails + oks) >= FAIL_RATIO);
  const destBad = (id: string) => (failedFrom.get(id)?.size ?? 0) >= 2 && mostlyFailing(failIn.get(id) ?? 0, okIn.get(id) ?? 0);
  const sourceBad = (id: string) => (failedTo.get(id)?.size ?? 0) >= 2 && mostlyFailing(failOut.get(id) ?? 0, okOut.get(id) ?? 0);

  return (s: BlameSwap): string | null => {
    if (s.status === 'success') return null;
    if (s.stage === 'mint') {
      if (s.preimageOk === false) return s.sourceMintId;
      if (s.preimageOk !== true && /still UNPAID/.test(s.error ?? '')) return null;
      return s.destMintId;
    }
    if (s.status === 'pending') return s.stage === 'melt' ? s.sourceMintId : null;
    switch (s.stage) {
      case 'mint_quote':
        return s.destMintId;
      case 'split':
        return /Not enough funds/.test(s.error ?? '') ? null : s.sourceMintId;
      case 'melt_quote':
        return s.sourceMintId;
      case 'melt': {
        if (!ROUTE_ERROR.test(s.error ?? '')) return s.sourceMintId;
        if (destBad(s.destMintId)) return s.destMintId;
        if (sourceBad(s.sourceMintId)) return s.sourceMintId;
        return null;
      }
      default:
        return null;
    }
  };
}

export function recentlyFailing(swaps: BlameSwap[], now = Date.now()) {
  const blame = makeBlame(swaps, now);
  const lastOk = new Map<string, number>();
  const lastBad = new Map<string, number>();
  for (const s of swaps) {
    const t = s.timestamp.getTime();
    if (s.status === 'success') {
      for (const id of [s.sourceMintId, s.destMintId]) lastOk.set(id, Math.max(lastOk.get(id) ?? 0, t));
      continue;
    }
    const id = blame(s);
    if (id) lastBad.set(id, Math.max(lastBad.get(id) ?? 0, t));
  }
  return new Set([...lastBad].filter(([id, t]) => now - t < DAY && t > (lastOk.get(id) ?? 0)).map(([id]) => id));
}

export const UNHONORED_LIMIT = 2;

export function unhonoredMints(swaps: BlameSwap[], now = Date.now()) {
  const sorted = [...swaps].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const runs = new Map<string, { count: number; last: number }>();
  for (const s of sorted) {
    if (s.status === 'success') runs.delete(s.destMintId);
    else if (s.status === 'failed' && s.stage === 'mint' && s.preimageOk === true && now - s.timestamp.getTime() < 7 * DAY) {
      const r = runs.get(s.destMintId) ?? { count: 0, last: 0 };
      r.count++;
      r.last = s.timestamp.getTime();
      runs.set(s.destMintId, r);
    }
  }
  return new Map([...runs].filter(([, r]) => r.count >= UNHONORED_LIMIT).map(([id, r]) => [id, r.last]));
}
