import { DAY } from './constants';

export const RUN_FAIL_DAYS = 30;
export const RUN_STALL_MS = 2 * 60_000;

export type RunHop = {
  status: string;
  stage: string | null;
  error: string | null;
  sourceMintId: string;
  destMintId: string;
  timestamp: Date;
  duration: number;
};

export type RunFail = { at: number; reason: string };

const NOT_THE_MINT = ['limits', 'balance', 'reserve'];

export function runFailures(hops: RunHop[], now = Date.now()) {
  const recent = hops.filter(h => now - h.timestamp.getTime() < RUN_FAIL_DAYS * DAY);
  const paidOut = new Set(recent.filter(h => h.status === 'success').map(h => h.sourceMintId));
  const received = new Set(recent.filter(h => h.status === 'success').map(h => h.destMintId));
  const lightning = (h: RunHop) => (paidOut.has(h.sourceMintId) || !received.has(h.destMintId) ? h.destMintId : h.sourceMintId);

  const out = new Map<string, RunFail>();
  const mark = (id: string, at: number, reason: string) => {
    if ((out.get(id)?.at ?? 0) < at) out.set(id, { at, reason });
  };
  for (const h of recent) {
    const at = h.timestamp.getTime();
    const stalled = h.status === 'pending' ? h.stage === 'melt' && now - at > RUN_STALL_MS : h.status === 'success' && h.duration > RUN_STALL_MS;
    if (h.status !== 'failed' && !stalled) continue;
    if (h.status === 'failed' && (NOT_THE_MINT.includes(h.stage ?? '') || /Not enough funds/.test(h.error ?? ''))) continue;
    if (stalled) {
      const id = lightning(h);
      mark(id, at, id === h.destMintId ? 'A large Lightning payment to it got stuck' : 'A large Lightning payment from it got stuck');
    } else if (h.stage === 'mint_quote') mark(h.destMintId, at, 'Could not create an invoice for the amount');
    else if (h.stage === 'mint') mark(h.destMintId, at, 'Was paid but did not issue the ecash');
    else if (h.stage === 'melt_quote' || h.stage === 'split') mark(h.sourceMintId, at, 'Could not quote paying out the amount');
    else if (h.stage === 'melt') {
      const id = lightning(h);
      mark(id, at, id === h.destMintId ? 'Could not receive the amount over Lightning' : 'Could not pay out the amount over Lightning');
    }
  }
  return out;
}

export function runPassed(hops: RunHop[], now = Date.now()) {
  const recent = hops.filter(h => h.status === 'success' && now - h.timestamp.getTime() < RUN_FAIL_DAYS * DAY);
  const paid = new Map<string, number>();
  const got = new Map<string, number>();
  for (const h of recent) {
    const at = h.timestamp.getTime();
    paid.set(h.sourceMintId, Math.max(paid.get(h.sourceMintId) ?? 0, at));
    got.set(h.destMintId, Math.max(got.get(h.destMintId) ?? 0, at));
  }
  const failed = runFailures(hops, now);
  return new Map([...paid].filter(([id]) => got.has(id) && !failed.has(id)).map(([id, at]) => [id, Math.max(at, got.get(id)!)]));
}
