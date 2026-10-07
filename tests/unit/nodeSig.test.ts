import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { messageHash, recoverNodeKey, zbase32Decode, zbase32Encode } from '@/lib/operator/nodeSig';

const priv = secp256k1.utils.randomSecretKey();
const pub = Buffer.from(secp256k1.getPublicKey(priv, true)).toString('hex');

function lndSign(message: string, sk = priv) {
  const sig = secp256k1.sign(messageHash(message), sk, { prehash: false, format: 'recovered' });
  const out = new Uint8Array(65);
  out[0] = 31 + sig[0];
  out.set(sig.slice(1), 1);
  return zbase32Encode(out);
}

describe('node signatures', () => {
  it('round-trips zbase32', () => {
    const bytes = Uint8Array.from({ length: 65 }, (_, i) => (i * 37) & 255);
    expect(zbase32Decode(zbase32Encode(bytes))).toEqual(bytes);
  });
  it('recovers the node key from an LND-style signature', () => {
    expect(recoverNodeKey('cashu-audit-verify=abc', lndSign('cashu-audit-verify=abc'))).toBe(pub);
  });
  it('recovers a different key for another message', () => {
    expect(recoverNodeKey('cashu-audit-verify=xyz', lndSign('cashu-audit-verify=abc'))).not.toBe(pub);
  });
  it('rejects garbage', () => {
    expect(recoverNodeKey('m', 'not zbase!')).toBeNull();
  });
});
