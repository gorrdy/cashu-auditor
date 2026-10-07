import { createHash } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';

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

export type RouteHop = { pubkey: string; channel: string; feeBaseMsat: number; feePpm: number };

function toBytes(words: number[]) {
  const out: number[] = [];
  let acc = 0, bits = 0;
  for (const w of words) {
    acc = ((acc << 5) | w) & 0xffffff;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
    }
  }
  if (bits > 0) out.push((acc << (8 - bits)) & 255);
  return Uint8Array.from(out);
}

export function invoiceNode(invoice: string): { payee: string; hints: RouteHop[][] } | null {
  const lower = invoice.trim().toLowerCase();
  const sep = lower.lastIndexOf('1');
  if (!lower.startsWith('ln') || sep < 0) return null;
  const words = [...lower.slice(sep + 1)].map(c => CHARSET.indexOf(c));
  if (words.some(w => w < 0) || words.length < 7 + 104 + 6) return null;
  const data = words.slice(0, -6);
  const body = data.slice(0, -104);
  let payee: string | null = null;
  const hints: RouteHop[][] = [];
  let i = 7;
  while (i + 3 <= body.length) {
    const tag = body[i];
    const len = body[i + 1] * 32 + body[i + 2];
    const value = body.slice(i + 3, i + 3 + len);
    if (tag === 19 && len === 53) payee = Buffer.from(toBytes(value).slice(0, 33)).toString('hex');
    if (tag === 3) {
      const b = Buffer.from(toBytes(value));
      const route: RouteHop[] = [];
      for (let k = 0; k + 51 <= b.length; k += 51) {
        route.push({
          pubkey: b.subarray(k, k + 33).toString('hex'),
          channel: b.subarray(k + 33, k + 41).toString('hex'),
          feeBaseMsat: b.readUInt32BE(k + 41),
          feePpm: b.readUInt32BE(k + 45),
        });
      }
      if (route.length) hints.push(route);
    }
    i += 3 + len;
  }
  if (!payee) {
    try {
      const sig = toBytes(data.slice(-104));
      const hash = createHash('sha256').update(Buffer.concat([Buffer.from(lower.slice(0, sep), 'utf8'), Buffer.from(toBytes(body))])).digest();
      payee = secp256k1.Signature.fromBytes(sig.slice(0, 64), 'compact').addRecoveryBit(sig[64]).recoverPublicKey(hash).toHex(true);
    } catch {
      return null;
    }
  }
  return { payee, hints };
}

export function amountMsat(invoice: string): number | null {
  const m = invoice.trim().toLowerCase().match(/^ln(?:bc|tb|bcrt|tbs)(\d+)([munp]?)1/);
  if (!m) return null;
  const n = Number(m[1]);
  const factor = { '': 1e11, m: 1e8, u: 1e5, n: 1e2, p: 0.1 }[m[2] as '' | 'm' | 'u' | 'n' | 'p'];
  const msat = n * factor;
  return Number.isSafeInteger(Math.round(msat)) ? Math.round(msat) : null;
}
