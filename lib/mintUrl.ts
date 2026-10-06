import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export function normalizeMintUrl(input: string): string | null {
  let raw = input.trim();
  if (!raw) return null;
  raw = raw.replace(/^http:\/\//i, 'https://');
  if (!/^https:\/\//i.test(raw)) raw = 'https://' + raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host.toLowerCase()}${path}`;
}

const V4_BLOCKED: [number, number][] = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8], [0xa9fe0000, 16],
  [0xac100000, 12], [0xc0000000, 24], [0xc0000200, 24], [0xc0586300, 24], [0xc0a80000, 16],
  [0xc6120000, 15], [0xc6336400, 24], [0xcb007100, 24], [0xe0000000, 3],
];

function v4ToInt(ip: string) {
  return ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
}

function isPrivateV4Int(n: number) {
  return V4_BLOCKED.some(([base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits)));
}

function v6ToBytes(ip: string): number[] | null {
  let text = ip.toLowerCase().split('%')[0];
  const v4 = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    text = text.slice(0, -v4[0].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...right];
  if (groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.flatMap(g => [parseInt(g, 16) >> 8, parseInt(g, 16) & 255]);
}

function isPrivateV6(ip: string): boolean {
  const b = v6ToBytes(ip);
  if (!b || b.length !== 16) return true;
  const zero = (from: number, to: number) => b.slice(from, to).every(x => x === 0);
  const v4At = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return isPrivateV4Int(v4At(12));
  if (zero(0, 12)) return true;
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return true;
  if (b[0] === 0x01 && b[1] === 0x00 && zero(2, 8)) return true;
  if (b[0] === 0x20 && b[1] === 0x01 && (b[2] === 0x0d && b[3] === 0xb8 || zero(2, 4))) return true;
  if (b[0] === 0x20 && b[1] === 0x02) return true;
  if ((b[0] & 0xfe) === 0xfc) return true;
  if (b[0] === 0xfe && (b[1] & 0xc0) >= 0x80) return true;
  if (b[0] === 0xff) return true;
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateV4Int(v4ToInt(ip));
  if (isIP(ip) === 6) return isPrivateV6(ip);
  return true;
}

export async function assertPublicMintUrl(mintUrl: string): Promise<void> {
  const { hostname } = new URL(mintUrl);
  const host = hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Private host');
  }
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some(a => isPrivateAddress(a.address))) {
    throw new Error('Private address');
  }
}

export const isMintId = (id: string) => /^[a-z0-9]{20,32}$/.test(id);
