import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { bech32 } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { encodeLnurl, verifyLnurlSignature } from '@/lib/operator/lnurl';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const priv = secp256k1.utils.randomSecretKey();
const key = hex(secp256k1.getPublicKey(priv, true));
const sign = (k1: string, sk = priv) => hex(secp256k1.sign(Buffer.from(k1, 'hex'), sk, { prehash: false, format: 'der' }));

describe('LNURL-auth', () => {
  it('encodes a URL as bech32 lnurl', () => {
    const url = 'https://audit.cashu.cz/api/operator/lnurl-auth?tag=login&k1=00';
    const decoded = bech32.decode(encodeLnurl(url).toLowerCase() as `${string}1${string}`, 1023);
    expect(decoded.prefix).toBe('lnurl');
    expect(new TextDecoder().decode(bech32.fromWords(decoded.words))).toBe(url);
  });
  it('accepts a DER signature of k1 by the linking key', () => {
    const k1 = randomBytes(32).toString('hex');
    expect(verifyLnurlSignature(k1, sign(k1), key)).toBe(true);
  });
  it('rejects another k1, another key and garbage', () => {
    const k1 = randomBytes(32).toString('hex');
    expect(verifyLnurlSignature(randomBytes(32).toString('hex'), sign(k1), key)).toBe(false);
    expect(verifyLnurlSignature(k1, sign(k1, secp256k1.utils.randomSecretKey()), key)).toBe(false);
    expect(verifyLnurlSignature(k1, 'zz', key)).toBe(false);
  });
});
