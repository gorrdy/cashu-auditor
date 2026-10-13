import { beforeAll, describe, expect, inject, it } from 'vitest';
import { Amount, getEncodedToken } from '@cashu/cashu-ts';

const DAY = 86_400_000;

describe('daily billing notices', () => {
  let prisma: typeof import('@/lib/prisma').prisma;
  let billing: typeof import('@/lib/operator/billing');
  const now = Date.now();

  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl');
    ({ prisma } = await import('@/lib/prisma'));
    billing = await import('@/lib/operator/billing');
  });

  async function operatorWith(url: string, balanceSat: number, paidUntil: Date | null) {
    const mint = await prisma.mint.create({ data: { url } });
    const op = await prisma.operator.create({ data: { balanceMsat: BigInt(balanceSat * 1000) } });
    await prisma.mintClaim.create({ data: { operatorId: op.id, mintId: mint.id, method: 'dns', code: 'test', verifiedAt: new Date(now), alerts: true, paidUntil } });
    return op.id;
  }
  const state = (id: string) => prisma.operator.findUniqueOrThrow({ where: { id }, select: { lowNotifiedAt: true, pausedNotifiedAt: true, balanceMsat: true } });

  it('does not say paused before the first top-up', async () => {
    const id = await operatorWith('https://never-paid.example', 0, null);
    await billing.chargeDue(now, id);
    expect(await state(id)).toMatchObject({ lowNotifiedAt: null, pausedNotifiedAt: null });
  });

  it('does not warn while prepaid coverage lasts', async () => {
    const id = await operatorWith('https://prepaid.example', 0, new Date(now + 30 * DAY));
    await billing.chargeDue(now, id);
    expect(await state(id)).toMatchObject({ lowNotifiedAt: null, pausedNotifiedAt: null });
  });

  it('warns when coverage ends within three days, then pauses when it lapses', async () => {
    const id = await operatorWith('https://lapsing.example', 0, new Date(now + 2 * DAY));
    await billing.chargeDue(now, id);
    expect((await state(id)).lowNotifiedAt).not.toBeNull();
    await billing.chargeDue(now + 3 * DAY, id);
    expect((await state(id)).pausedNotifiedAt).not.toBeNull();
  });

  it('charges one day from the balance when coverage runs out', async () => {
    const id = await operatorWith('https://funded.example', 100, new Date(now));
    await billing.chargeDue(now, id);
    expect(Number((await state(id)).balanceMsat)).toBe(100_000 - Number(billing.DAY_MSAT));
  });

  it('accepts top-up tokens only from the home mint', async () => {
    process.env.HOME_MINT_URL = 'https://home.example';
    const id = await operatorWith('https://topup.example', 0, null);
    const token = getEncodedToken({ mint: 'https://evil.example', proofs: [{ id: '00ad268c4d1f5826', amount: Amount.from(1000), secret: 'a'.repeat(64), C: '02' + 'b'.repeat(64) }] });
    expect(await billing.topupWithToken(id, token)).toEqual({ error: expect.stringContaining('Only tokens from home.example') });
    expect(Number((await state(id)).balanceMsat)).toBe(0);
  });
});
