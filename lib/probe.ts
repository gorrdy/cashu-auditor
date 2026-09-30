import { request } from 'node:https';
import type { TLSSocket } from 'node:tls';
import { assertPublicMintUrl } from './mintUrl';
import { guardedLookup } from './netguard';

const PROBE_TIMEOUT_MS = 8_000;
const MAX_BODY = 1_000_000;
const USER_AGENT = 'cashu-audit/1.0 (+https://audit.cashu.cz/methodology)';

export type MintInfo = {
  name?: string;
  version?: string;
  pubkey?: string;
  description?: string;
  icon_url?: string;
  motd?: string;
  tos_url?: string;
  time?: number;
  urls?: unknown;
  contact?: unknown;
  max_array_length?: number;
  nuts?: Record<string, unknown>;
};

export type PaymentMethod = { op: 'mint' | 'melt'; method: string; unit: string; min?: number; max?: number };

export type MintSpec = {
  contact: { method: string; info: string }[];
  motd: string | null;
  tosUrl: string | null;
  onionUrl: string | null;
  methods: PaymentMethod[];
  units: string[];
  mintDisabled: boolean;
  meltDisabled: boolean;
  authRequired: boolean;
  websockets: boolean;
  cachedResponses: boolean;
  batchMax: number | null;
  maxArrayLength: number | null;
};

export type KeysetSummary = { activeId: string | null; inputFeePpk: number | null; count: number; activeSat: boolean };

export type Timings = { dnsMs?: number; connectMs?: number; tlsMs?: number; ttfbMs?: number };

export type ProbeResult = {
  status: 'online' | 'degraded' | 'offline';
  latency: number;
  keysetsMs?: number;
  httpStatus?: number;
  error?: string;
  info?: MintInfo;
  spec?: MintSpec;
  keysets?: KeysetSummary;
  timings?: Timings;
  clockSkewMs?: number;
  cert?: { issuer: string | null; validTo: number | null };
  address?: string;
};

type Timed = {
  status: number;
  body: string;
  total: number;
  startedAt: number;
  timings: Timings;
  cert?: { issuer: string | null; validTo: number | null };
  address?: string;
};

function timedGet(url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<Timed> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const startedAt = Date.now();
    const at: { lookup?: number; connect?: number; secure?: number; first?: number } = {};
    const ms = (v?: number) => (v === undefined ? undefined : Math.round(v));

    const req = request(
      url,
      { method: 'GET', agent: false, lookup: guardedLookup, headers: { accept: 'application/json', 'user-agent': USER_AGENT } },
      res => {
        at.first = performance.now() - t0;
        const socket = res.socket as TLSSocket;
        const peer = socket.getPeerCertificate?.();
        const cert = peer && Object.keys(peer).length
          ? { issuer: String(peer.issuer?.O ?? peer.issuer?.CN ?? '') || null, validTo: Date.parse(peer.valid_to) || null }
          : undefined;
        const address = socket.remoteAddress;
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY) return req.destroy(new Error('Response too large'));
          chunks.push(chunk);
        });
        res.on('end', () => {
          clearTimeout(timer);
          const connectEnd = at.connect ?? at.lookup ?? 0;
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            total: Math.round(performance.now() - t0),
            startedAt,
            timings: {
              dnsMs: ms(at.lookup),
              connectMs: at.connect !== undefined ? ms(at.connect - (at.lookup ?? 0)) : undefined,
              tlsMs: at.secure !== undefined ? ms(at.secure - connectEnd) : undefined,
              ttfbMs: at.first !== undefined ? ms(at.first - (at.secure ?? connectEnd)) : undefined,
            },
            cert,
            address,
          });
        });
        res.on('error', reject);
      }
    );
    const timer = setTimeout(() => {
      const error = new Error(`Timeout after ${timeoutMs / 1000}s`);
      error.name = 'TimeoutError';
      req.destroy(error);
    }, timeoutMs);
    req.on('socket', socket => {
      socket.once('lookup', () => (at.lookup = performance.now() - t0));
      socket.once('connect', () => (at.connect = performance.now() - t0));
      socket.once('secureConnect', () => (at.secure = performance.now() - t0));
    });
    req.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    req.end();
  });
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    return code && !error.message.includes(code) ? `${error.message} (${code})` : error.message;
  }
  return String(error);
}

const str = (v: unknown, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function parseMethods(op: 'mint' | 'melt', nut: unknown): PaymentMethod[] {
  const methods = (nut as { methods?: unknown })?.methods;
  if (!Array.isArray(methods)) return [];
  return methods
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map(m => ({
      op,
      method: str(m.method, 40) ?? '?',
      unit: str(m.unit, 20) ?? '?',
      min: num(m.min_amount) ?? undefined,
      max: num(m.max_amount) ?? undefined,
    }))
    .slice(0, 20);
}

export function parseSpec(info: MintInfo): MintSpec {
  const nuts = (info.nuts ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const methods = [...parseMethods('mint', nuts['4']), ...parseMethods('melt', nuts['5'])];
  const urls = Array.isArray(info.urls) ? info.urls.filter((u): u is string => typeof u === 'string') : [];
  const onion = urls.find(u => /^https?:\/\/[a-z2-7]{56}\.onion(\/|$)/i.test(u));
  const contact = Array.isArray(info.contact)
    ? info.contact
        .map(c => ({ method: str((c as { method?: unknown })?.method, 30), info: str((c as { info?: unknown })?.info, 200) }))
        .filter((c): c is { method: string; info: string } => !!c.method && !!c.info)
        .slice(0, 10)
    : [];
  const ws = nuts['17']?.supported;
  return {
    contact,
    motd: str(info.motd, 300),
    tosUrl: str(info.tos_url, 300)?.startsWith('https://') ? str(info.tos_url, 300) : null,
    onionUrl: onion ? onion.replace(/\/+$/, '') : null,
    methods,
    units: [...new Set(methods.map(m => m.unit))],
    mintDisabled: nuts['4']?.disabled === true,
    meltDisabled: nuts['5']?.disabled === true,
    authRequired: !!(nuts['21'] || nuts['22']),
    websockets: Array.isArray(ws) ? ws.length > 0 : ws === true,
    cachedResponses: !!nuts['19'],
    batchMax: num(nuts['29']?.max_batch_size),
    maxArrayLength: num(info.max_array_length),
  };
}

function parseKeysets(body: string): KeysetSummary {
  const parsed = JSON.parse(body) as { keysets?: { id?: string; unit?: string; active?: boolean; input_fee_ppk?: number }[] };
  const keysets = Array.isArray(parsed?.keysets) ? parsed.keysets : [];
  const active = keysets
    .filter(k => k.active && k.unit === 'sat' && typeof k.id === 'string')
    .sort((a, b) => (a.input_fee_ppk ?? 0) - (b.input_fee_ppk ?? 0))[0];
  return {
    activeId: active?.id ?? null,
    inputFeePpk: active ? active.input_fee_ppk ?? 0 : null,
    count: keysets.length,
    activeSat: !!active,
  };
}

export async function probeMint(mintUrl: string): Promise<ProbeResult> {
  const start = performance.now();
  try {
    await assertPublicMintUrl(mintUrl);
    const res = await timedGet(`${mintUrl}/v1/info`);
    const base = { latency: res.total, httpStatus: res.status, timings: res.timings, cert: res.cert, address: res.address };
    if (res.status < 200 || res.status >= 300) return { status: 'offline', ...base, error: `HTTP ${res.status}` };

    let info: MintInfo;
    try {
      info = JSON.parse(res.body);
    } catch {
      return { status: 'offline', ...base, error: 'Response is not JSON' };
    }
    if (!info || typeof info !== 'object' || (!info.nuts && !info.pubkey)) {
      return { status: 'offline', ...base, error: 'Not a Cashu mint info response' };
    }
    const spec = parseSpec(info);
    const clockSkewMs = typeof info.time === 'number' ? Math.round(info.time * 1000 - (res.startedAt + res.total / 2)) : undefined;
    const withInfo = { ...base, info, spec, clockSkewMs };

    try {
      const ks = await timedGet(`${mintUrl}/v1/keysets`);
      if (ks.status < 200 || ks.status >= 300) return { status: 'degraded', ...withInfo, keysetsMs: ks.total, error: `Keysets HTTP ${ks.status}` };
      const keysets = parseKeysets(ks.body);
      if (!keysets.activeSat) return { status: 'degraded', ...withInfo, keysets, keysetsMs: ks.total, error: 'No active sat keyset' };
      return { status: 'online', ...withInfo, keysets, keysetsMs: ks.total };
    } catch (error) {
      return { status: 'degraded', ...withInfo, error: `Keysets: ${describe(error)}` };
    }
  } catch (error) {
    return { status: 'offline', latency: Math.round(performance.now() - start), error: describe(error) };
  }
}

export async function hasInternet(): Promise<boolean> {
  const targets = ['https://1.1.1.1/cdn-cgi/trace', 'https://dns.google/'];
  const results = await Promise.allSettled(
    targets.map(t => fetch(t, { signal: AbortSignal.timeout(5_000), cache: 'no-store' }))
  );
  return results.some(r => r.status === 'fulfilled' && r.value.ok);
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}
