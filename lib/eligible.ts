import { prisma } from './prisma';
import type { PaymentMethod } from './probe';

export async function latestStatuses() {
  const rows = await prisma.$queryRaw<{ mintId: string; status: string }[]>`
    SELECT a.mintId, a.status FROM AuditLog a
    JOIN (SELECT mintId, MAX(timestamp) ts FROM AuditLog WHERE location = 'prague' GROUP BY mintId) l
      ON l.mintId = a.mintId AND l.ts = a.timestamp AND a.location = 'prague'`;
  return new Map(rows.map(r => [r.mintId, r.status]));
}

export async function swappableMints() {
  const status = await latestStatuses();
  const mints = await prisma.mint.findMany({
    select: { id: true, url: true, pubkey: true, addedAt: true, methods: true, mintDisabled: true, meltDisabled: true, authRequired: true },
    orderBy: { url: 'asc' },
  });
  return mints
    .filter(m => {
      const methods = m.methods ? (JSON.parse(m.methods) as PaymentMethod[]) : [];
      return (
        status.get(m.id) === 'online' && !m.mintDisabled && !m.meltDisabled && !m.authRequired &&
        methods.some(x => x.op === 'mint' && x.method === 'bolt11' && x.unit === 'sat')
      );
    })
    .map(({ id, url, pubkey, addedAt }) => ({ id, url, pubkey, addedAt }));
}

export const unspentBalance = async (mintId: string) =>
  (await prisma.proof.aggregate({ where: { mintId, state: 'unspent' }, _sum: { amount: true } }))._sum.amount ?? 0;

export const MIN_AGE_MS = 3 * 86_400_000;
export const OPERATOR_EXPOSURE = 600;

export async function trustState(now = Date.now()) {
  const [mints, balances, payouts] = await Promise.all([
    prisma.mint.findMany({ select: { id: true, url: true, aliasOfId: true, addedAt: true } }),
    prisma.proof.groupBy({ by: ['mintId'], where: { state: { in: ['unspent', 'reserved'] } }, _sum: { amount: true } }),
    prisma.swap.groupBy({ by: ['sourceMintId'], where: { status: 'success', preimageOk: { not: false } } }),
  ]);
  const operatorOf = new Map(mints.map(m => [m.id, m.aliasOfId ?? m.id]));
  const held = new Map<string, number>();
  for (const b of balances) {
    const op = operatorOf.get(b.mintId) ?? b.mintId;
    held.set(op, (held.get(op) ?? 0) + (b._sum.amount ?? 0));
  }
  const added = new Map(mints.map(m => [m.id, m.addedAt.getTime()]));
  const proven = new Set(payouts.map(p => p.sourceMintId));
  return {
    mature: (id: string) => now - (added.get(id) ?? now) >= MIN_AGE_MS,
    proven: (id: string) => proven.has(id),
    operatorHeld: (id: string) => held.get(operatorOf.get(id) ?? id) ?? 0,
    canHoldMore: (id: string, amount: number) => (held.get(operatorOf.get(id) ?? id) ?? 0) + amount <= OPERATOR_EXPOSURE,
  };
}
