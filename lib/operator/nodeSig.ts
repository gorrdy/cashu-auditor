import { createHash } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';

const ZBASE32 = 'ybndrfg8ejkmcpqxot1uwisza345h769';
const PREFIX = 'Lightning Signed Message:';

export function zbase32Decode(text: string): Uint8Array | null {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of text.trim()) {
    const i = ZBASE32.indexOf(ch);
    if (i < 0) return null;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 255);
      value &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(out);
}

export function zbase32Encode(bytes: Uint8Array) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ZBASE32[(value >> bits) & 31];
      value &= (1 << bits) - 1;
    }
  }
  if (bits > 0) out += ZBASE32[(value << (5 - bits)) & 31];
  return out;
}

export const messageHash = (message: string) => {
  const once = createHash('sha256').update(Buffer.from(PREFIX + message, 'utf8')).digest();
  return createHash('sha256').update(once).digest();
};

export function recoverNodeKey(message: string, signature: string): string | null {
  const sig = zbase32Decode(signature);
  if (!sig || sig.length < 65) return null;
  const header = sig[0];
  if (header < 27 || header > 34) return null;
  try {
    return secp256k1.Signature.fromBytes(sig.slice(1, 65), 'compact').addRecoveryBit((header - 27) & 3).recoverPublicKey(messageHash(message)).toHex(true);
  } catch {
    return null;
  }
}
