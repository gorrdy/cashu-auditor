import { createHash } from 'node:crypto';

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 8_000;

const SIGNATURES: { type: string; test: (b: Buffer) => boolean }[] = [
  { type: 'image/png', test: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/jpeg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/gif', test: b => b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a' },
  { type: 'image/webp', test: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { type: 'image/avif', test: b => b.subarray(4, 12).toString('latin1') === 'ftypavif' },
  { type: 'image/x-icon', test: b => b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 },
];

export type Icon = { data: Uint8Array<ArrayBuffer>; type: string; hash: string };

export async function fetchIcon(url: string): Promise<Icon> {
  if (!url.startsWith('https://')) throw new Error('Icon URL must be https');
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store', headers: { accept: 'image/*' } });
  if (!res.ok || !res.body) throw new Error(`Icon HTTP ${res.status}`);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('Icon too large');

  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.byteLength;
    if (size > MAX_BYTES) throw new Error('Icon too large');
    chunks.push(chunk);
  }
  const buf = Buffer.concat(chunks);
  const type = SIGNATURES.find(s => s.test(buf))?.type;
  if (!type) throw new Error('Icon is not a supported raster image');

  const data = new Uint8Array(new ArrayBuffer(buf.byteLength));
  data.set(buf);
  return { data, type, hash: createHash('sha256').update(buf).digest('hex').slice(0, 16) };
}
