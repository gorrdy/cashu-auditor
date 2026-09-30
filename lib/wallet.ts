import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { Amount, Wallet, type CounterSource, type ProofLike } from '@cashu/cashu-ts';
import { prisma } from './prisma';

let cachedSeed: Uint8Array | null | undefined;

function walletSeed(): Uint8Array | null {
  if (cachedSeed !== undefined) return cachedSeed;
  const mnemonic = process.env.WALLET_MNEMONIC?.trim();
  if (!mnemonic) {
    console.warn('WALLET_MNEMONIC is not set, ecash outputs are not recoverable');
    return (cachedSeed = null);
  }
  if (!validateMnemonic(mnemonic, wordlist)) throw new Error('WALLET_MNEMONIC is not a valid BIP39 mnemonic');
  return (cachedSeed = mnemonicToSeedSync(mnemonic));
}

export const dbCounterSource: CounterSource = {
  reserve: (keysetId, n) =>
    prisma.$transaction(async tx => {
      const row = await tx.keysetCounter.upsert({ where: { keysetId }, update: {}, create: { keysetId } });
      if (n > 0) await tx.keysetCounter.update({ where: { keysetId }, data: { next: row.next + n } });
      return { start: row.next, count: n };
    }),
  reserveAt: (keysetId, start, count) =>
    prisma.$transaction(async tx => {
      const row = await tx.keysetCounter.upsert({ where: { keysetId }, update: {}, create: { keysetId } });
      if (start < row.next) throw new Error(`Counter ${start} for keyset ${keysetId} already issued (next ${row.next})`);
      await tx.keysetCounter.update({ where: { keysetId }, data: { next: start + count } });
      return { start, count };
    }),
  advanceToAtLeast: async (keysetId, minNext) => {
    await prisma.$transaction(async tx => {
      const row = await tx.keysetCounter.upsert({ where: { keysetId }, update: {}, create: { keysetId } });
      if (row.next < minNext) await tx.keysetCounter.update({ where: { keysetId }, data: { next: minNext } });
    });
  },
  snapshot: async () => Object.fromEntries((await prisma.keysetCounter.findMany()).map(c => [c.keysetId, c.next])),
  setNext: async (keysetId, next) => {
    await prisma.keysetCounter.upsert({ where: { keysetId }, update: { next }, create: { keysetId, next } });
  },
};

export function createWallet(url: string) {
  const seed = walletSeed();
  return seed ? new Wallet(url, { bip39seed: seed, counterSource: dbCounterSource }) : new Wallet(url);
}

const RECENT_WINDOW = 300;

export async function restoreProofs(mint: { id: string; url: string }, opts: { full?: boolean } = {}) {
  if (!walletSeed()) return { recovered: 0, proofs: 0 };
  const wallet = createWallet(mint.url);
  await wallet.loadMint();
  const counters = new Map((await prisma.keysetCounter.findMany()).map(c => [c.keysetId, c.next]));

  const found: ProofLike[] = [];
  for (const keyset of wallet.keyChain.getKeysets()) {
    const next = counters.get(keyset.id);
    if (!next) continue;
    const { proofs } = opts.full
      ? await wallet.batchRestore(RECENT_WINDOW, undefined, 0, keyset.id)
      : await wallet.restore(Math.max(0, next - RECENT_WINDOW), Math.min(next, RECENT_WINDOW), { keysetId: keyset.id });
    found.push(...proofs);
  }
  if (found.length === 0) return { recovered: 0, proofs: 0 };

  const known = new Set(
    (await prisma.proof.findMany({ where: { secret: { in: found.map(p => p.secret) } }, select: { secret: true } })).map(p => p.secret)
  );
  const fresh = found.filter(p => !known.has(p.secret));
  const states = fresh.length ? await wallet.checkProofsStates(fresh) : [];
  let recovered = 0;
  let count = 0;
  for (const [i, p] of fresh.entries()) {
    if (states[i]?.state !== 'UNSPENT') continue;
    const amount = Amount.from(p.amount).toNumber();
    await prisma.proof.create({ data: { mintId: mint.id, keysetId: p.id, amount, secret: p.secret, C: p.C } });
    recovered += amount;
    count++;
  }
  return { recovered, proofs: count };
}
