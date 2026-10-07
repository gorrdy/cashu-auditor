import { randomBytes } from 'node:crypto';
import { bech32 } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { prisma } from '../prisma';
import { SITE_URL } from '../site';

export const LNURL_COOKIE = 'lnurl_k1';

export function encodeLnurl(url: string) {
  return bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode(url)), 1023).toUpperCase();
}

export async function createLnurlChallenge() {
  const k1 = randomBytes(32).toString('hex');
  await prisma.loginChallenge.create({ data: { id: k1, kind: 'lnurl-auth', expiresAt: new Date(Date.now() + 10 * 60_000) } });
  return { k1, lnurl: encodeLnurl(`${SITE_URL}/api/operator/lnurl-auth?tag=login&k1=${k1}&action=login`) };
}

export function verifyLnurlSignature(k1: string, sig: string, key: string) {
  if (!/^[0-9a-f]{64}$/.test(k1) || !/^[0-9a-f]{16,200}$/i.test(sig) || !/^0[23][0-9a-f]{64}$/i.test(key)) return false;
  try {
    return secp256k1.verify(Buffer.from(sig, 'hex'), Buffer.from(k1, 'hex'), Buffer.from(key, 'hex'), { prehash: false, format: 'der', lowS: false });
  } catch {
    return false;
  }
}
