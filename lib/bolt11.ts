import { createHash } from 'node:crypto';

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

export function paymentHashOf(invoice: string): string | null {
  const lower = invoice.trim().toLowerCase();
  const sep = lower.lastIndexOf('1');
  if (!lower.startsWith('ln') || sep < 0) return null;
  const words = [...lower.slice(sep + 1)].map(c => CHARSET.indexOf(c));
  if (words.some(w => w < 0)) return null;
  const data = words.slice(0, -6);
  let i = 7;
  while (i + 3 <= data.length - 104) {
    const tag = data[i];
    const len = data[i + 1] * 32 + data[i + 2];
    const value = data.slice(i + 3, i + 3 + len);
    if (tag === 1 && len === 52) {
      const bits = value.map(v => v.toString(2).padStart(5, '0')).join('').slice(0, 256);
      return BigInt('0b' + bits).toString(16).padStart(64, '0');
    }
    i += 3 + len;
  }
  return null;
}

export function preimageMatches(paymentHash: string | null, preimage: unknown): boolean | null {
  if (!paymentHash || typeof preimage !== 'string' || !/^[0-9a-f]{64}$/i.test(preimage)) return null;
  return createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex') === paymentHash;
}
