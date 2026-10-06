import { prisma } from './prisma';
import { USER_AGENT } from './site';

const HEADERS = { 'user-agent': USER_AGENT, 'content-type': 'application/json' };

export async function sharesBackend(a: string, b: string): Promise<boolean> {
  try {
    const res = await fetch(`${a}/v1/mint/quote/bolt11`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ amount: 1, unit: 'sat' }),
      signal: AbortSignal.timeout(15_000),
    });
    const created = (await res.json()) as { quote?: string; request?: string };
    if (!created.quote || !created.request) return false;
    const seen = await fetch(`${b}/v1/mint/quote/bolt11/${encodeURIComponent(created.quote)}`, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
    if (!seen.ok) return false;
    const other = (await seen.json()) as { quote?: string; request?: string };
    return other.quote === created.quote && other.request === created.request;
  } catch {
    return false;
  }
}

export async function findConfirmedAlias(url: string, pubkey: string | null | undefined) {
  if (!pubkey) return null;
  const candidates = await prisma.mint.findMany({ where: { pubkey, url: { not: url } }, select: { id: true, url: true, aliasOfId: true } });
  for (const c of candidates) {
    if (await sharesBackend(c.url, url)) return { id: c.aliasOfId ?? c.id, url: c.url };
  }
  return null;
}
