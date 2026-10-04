import { beforeAll, describe, expect, inject, it } from 'vitest';

const mintUrl = inject('testMintUrl');

describe.skipIf(!mintUrl)('swap engine against a FakeWallet mint', () => {
  let lib: {
    prisma: typeof import('@/lib/prisma').prisma;
    transfer: typeof import('@/lib/transfer').transfer;
    restoreProofs: typeof import('@/lib/wallet').restoreProofs;
    createWallet: typeof import('@/lib/wallet').createWallet;
    checkProofStates: typeof import('@/lib/checks').checkProofStates;
    swapTest: typeof import('@/lib/checks').swapTest;
  };
  let A: { id: string; url: string };
  let B: { id: string; url: string };

  const balance = async (mintId: string) =>
    (await lib.prisma.proof.aggregate({ where: { mintId, state: 'unspent' }, _sum: { amount: true } }))._sum.amount ?? 0;

  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl');
    process.env.WALLET_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const [{ prisma }, { transfer }, { restoreProofs, createWallet }, { checkProofStates, swapTest }] = await Promise.all([
      import('@/lib/prisma'), import('@/lib/transfer'), import('@/lib/wallet'), import('@/lib/checks'),
    ]);
    lib = { prisma, transfer, restoreProofs, createWallet, checkProofStates, swapTest };

    A = await prisma.mint.create({ data: { url: mintUrl! }, select: { id: true, url: true } });
    B = await prisma.mint.create({ data: { url: mintUrl!.replace('127.0.0.1', 'localhost') }, select: { id: true, url: true } });

    const wallet = createWallet(A.url);
    await wallet.loadMint();
    const quote = await wallet.createMintQuoteBolt11(300);
    for (let i = 0; i < 20 && (await wallet.checkMintQuoteBolt11(quote.quote)).state !== 'PAID'; i++) await new Promise(r => setTimeout(r, 500));
    const proofs = await wallet.mintProofsBolt11(300, quote.quote);
    for (const p of proofs) {
      await prisma.proof.create({ data: { mintId: A.id, keysetId: p.id, amount: Number(p.amount.toBigInt()), secret: p.secret, C: p.C } });
    }
  });

  it('moves sats between mints and records the swap', async () => {
    const before = await balance(A.id);
    const r = await lib.transfer({ source: A, dest: B, amount: 50 });
    expect(r.status).toBe('success');
    expect(await balance(B.id)).toBe(50);
    expect(await balance(A.id)).toBe(before - 50 - r.fee);
    const swap = await lib.prisma.swap.findUniqueOrThrow({ where: { id: r.swapId! } });
    expect(swap.dleq).toBe('valid');
    expect(swap.quoteMs).not.toBeNull();
    expect(await lib.prisma.proof.count({ where: { state: 'reserved' } })).toBe(0);
  });

  it('splits overshooting proofs so nothing beyond the fee reserve is lost', async () => {
    const before = await balance(A.id);
    const r = await lib.transfer({ source: A, dest: B, amount: 23 });
    expect(r.status).toBe('success');
    const swap = await lib.prisma.swap.findUniqueOrThrow({ where: { id: r.swapId! } });
    expect(r.fee).toBeLessThanOrEqual(swap.feeReserve ?? 0);
    expect(await balance(A.id)).toBe(before - 23 - r.fee);
  });

  it('fails without moving funds when the balance is too low', async () => {
    const before = await balance(B.id);
    const r = await lib.transfer({ source: B, dest: A, amount: 10_000 });
    expect(r.status).toBe('failed');
    expect(r.stage).toBe('balance');
    expect(r.fundsMoved).toBe(false);
    expect(await balance(B.id)).toBe(before);
  });

  it('restores deleted proofs from the seed', async () => {
    const victim = await lib.prisma.proof.findFirstOrThrow({ where: { mintId: B.id, state: 'unspent' } });
    await lib.prisma.proof.delete({ where: { id: victim.id } });
    const restored = await lib.restoreProofs(B);
    expect(restored.recovered).toBe(victim.amount);
    expect(await lib.prisma.proof.count({ where: { secret: victim.secret } })).toBe(1);
  });

  it('keeps counters monotonic across operations', async () => {
    const before = await lib.prisma.keysetCounter.findMany();
    await lib.transfer({ source: A, dest: B, amount: 10 });
    const after = await lib.prisma.keysetCounter.findMany();
    const next = new Map(after.map(c => [c.keysetId, c.next]));
    for (const c of before) expect(next.get(c.keysetId)!).toBeGreaterThanOrEqual(c.next);
    expect(after.reduce((s, c) => s + c.next, 0)).toBeGreaterThan(before.reduce((s, c) => s + c.next, 0));
  });

  it('finds our proofs unspent and completes an internal swap', async () => {
    const mint = { ...A, inputFeePpk: 0, onionUrl: null };
    const state = await lib.checkProofStates(mint);
    expect(state).toMatchObject({ spent: 0 });
    const before = await balance(A.id);
    const swap = await lib.swapTest(mint);
    expect(swap).toMatchObject({ dleq: 'valid', fee: 0 });
    expect(await balance(A.id)).toBe(before);
  });

  it('marks proofs the mint reports as spent', async () => {
    const wallet = lib.createWallet(B.url);
    await wallet.loadMint();
    const proof = await lib.prisma.proof.findFirstOrThrow({ where: { mintId: B.id, state: 'unspent' } });
    await wallet.send(proof.amount, [{ id: proof.keysetId, amount: proof.amount, secret: proof.secret, C: proof.C }]);
    const state = await lib.checkProofStates({ ...B, inputFeePpk: 0, onionUrl: null });
    expect(state).toMatchObject({ spent: 1 });
    expect((await lib.prisma.proof.findUniqueOrThrow({ where: { id: proof.id } })).state).toBe('spent_external');
  });
});
