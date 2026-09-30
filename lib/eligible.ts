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
    select: { id: true, url: true, methods: true, mintDisabled: true, meltDisabled: true, authRequired: true },
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
    .map(({ id, url }) => ({ id, url }));
}

export const unspentBalance = async (mintId: string) =>
  (await prisma.proof.aggregate({ where: { mintId, state: 'unspent' }, _sum: { amount: true } }))._sum.amount ?? 0;
