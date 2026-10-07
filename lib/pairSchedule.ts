export type PairSwap = { sourceMintId: string; destMintId: string; status: string; timestamp: Date };

export const MAX_DAILY_TRIES = 3;

export const pairKey = (source: string, dest: string) => `${source}>${dest}`;

export function lastTried(newestFirst: PairSwap[]) {
  const last = new Map<string, number>();
  for (const s of newestFirst) {
    const key = pairKey(s.sourceMintId, s.destMintId);
    if (!last.has(key)) last.set(key, s.timestamp.getTime());
  }
  return last;
}

export type Coverage = { sent: Set<string>; received: Set<string>; sendTries: Map<string, number>; receiveTries: Map<string, number> };

export function dailyCoverage(today: PairSwap[]): Coverage {
  const cov: Coverage = { sent: new Set(), received: new Set(), sendTries: new Map(), receiveTries: new Map() };
  for (const s of today) {
    if (s.status === 'success') {
      cov.sent.add(s.sourceMintId);
      cov.received.add(s.destMintId);
    } else {
      cov.sendTries.set(s.sourceMintId, (cov.sendTries.get(s.sourceMintId) ?? 0) + 1);
      cov.receiveTries.set(s.destMintId, (cov.receiveTries.get(s.destMintId) ?? 0) + 1);
    }
  }
  return cov;
}

export const needsOut = (id: string, cov: Coverage) => !cov.sent.has(id) && (cov.sendTries.get(id) ?? 0) < MAX_DAILY_TRIES;
export const needsIn = (id: string, cov: Coverage) => !cov.received.has(id) && (cov.receiveTries.get(id) ?? 0) < MAX_DAILY_TRIES;

export function pairValue(source: string, dest: string, cov: Coverage, last: Map<string, number>, now: number): number | null {
  const out = needsOut(source, cov);
  const inn = needsIn(dest, cov);
  if (!out && !inn) return null;
  const reliable = (out || cov.sent.has(source)) && (inn || cov.received.has(dest)) ? 100 : 0;
  const tried = last.get(pairKey(source, dest));
  const freshness = tried == null ? 50 : Math.min(49, (now - tried) / 86_400_000);
  return (Number(out) + Number(inn)) * 1000 + reliable + freshness;
}
