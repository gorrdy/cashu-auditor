import { prisma } from './prisma';

export const SLOW_BELOW = 3_000;
export const STOP_BELOW = 1_000;
export const SLOW_INTERVAL_MS = 60 * 60_000;

export async function totalBalance() {
  return (await prisma.proof.aggregate({ where: { state: 'unspent', mint: { isTest: false } }, _sum: { amount: true } }))._sum.amount ?? 0;
}

export async function budgetState(now = Date.now()) {
  const total = await totalBalance();
  if (total < STOP_BELOW) return { total, allowed: false, reason: `Balance ${total} sat below ${STOP_BELOW} sat, swaps paused` };
  if (total < SLOW_BELOW) {
    const last = await prisma.swap.findFirst({ where: { kind: 'swap' }, orderBy: { timestamp: 'desc' }, select: { timestamp: true } });
    if (last && now - last.timestamp.getTime() < SLOW_INTERVAL_MS) {
      return { total, allowed: false, reason: `Balance ${total} sat below ${SLOW_BELOW} sat, at most one swap per hour` };
    }
  }
  return { total, allowed: true, reason: null };
}
