import { prisma } from './prisma';
import { invoiceNode } from './bolt11';
import { createWallet } from './wallet';
import { errorMessage, withTimeout } from './transfer';
import { USER_AGENT } from './site';

export type GraphNode = {
  pubkey: string;
  public: boolean;
  alias?: string;
  capacity?: number;
  channels?: number;
  closedChannels?: number;
  firstSeen?: number;
  country?: string;
  city?: string;
  hosting?: string;
};

export type LnNode = { checkedAt: number; node: GraphNode; via: (GraphNode & { feeBaseMsat: number; feePpm: number })[] };

const GRAPH_API = 'https://mempool.space/api/v1/lightning/nodes';
const FALLBACK_API = 'https://1ml.com/node';

async function fallbackNode(pubkey: string): Promise<GraphNode> {
  try {
    const res = await fetch(`${FALLBACK_API}/${pubkey}/json`, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return { pubkey, public: false };
    const n = (await res.json()) as Record<string, unknown>;
    if (n.pub_key !== pubkey) return { pubkey, public: false };
    return {
      pubkey,
      public: true,
      alias: typeof n.alias === 'string' ? n.alias.slice(0, 60) : undefined,
      capacity: Number(n.capacity) || 0,
      channels: Number(n.channelcount) || 0,
    };
  } catch {
    return { pubkey, public: false };
  }
}

async function graphNode(pubkey: string): Promise<GraphNode> {
  try {
    const res = await fetch(`${GRAPH_API}/${pubkey}`, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return fallbackNode(pubkey);
    const n = (await res.json()) as Record<string, unknown>;
    const name = (v: unknown) => (v && typeof v === 'object' ? String((v as Record<string, unknown>).en ?? '') || undefined : undefined);
    return {
      pubkey,
      public: true,
      alias: typeof n.alias === 'string' ? n.alias.slice(0, 60) : undefined,
      capacity: Number(n.capacity) || 0,
      channels: Number(n.active_channel_count) || 0,
      closedChannels: Number(n.closed_channel_count) || 0,
      firstSeen: Number(n.first_seen) ? Number(n.first_seen) * 1000 : undefined,
      country: name(n.country),
      city: name(n.city),
      hosting: typeof n.as_organization === 'string' ? n.as_organization.slice(0, 80) : undefined,
    };
  } catch {
    return fallbackNode(pubkey);
  }
}

function quoteAmount(methods: string | null) {
  const list = methods ? (JSON.parse(methods) as { op: string; method: string; unit: string; min?: number }[]) : [];
  const min = list.find(m => m.op === 'mint' && m.method === 'bolt11' && m.unit === 'sat')?.min ?? 1;
  return Math.max(10, min);
}

export async function checkLnNode(mint: { id: string; url: string; methods: string | null }) {
  try {
    const wallet = createWallet(mint.url);
    await withTimeout(wallet.loadMint());
    const quote = await withTimeout(wallet.createMintQuoteBolt11(quoteAmount(mint.methods)));
    const decoded = invoiceNode(quote.request);
    if (!decoded) return { ok: false, error: 'Could not decode invoice' };
    const node = await graphNode(decoded.payee);
    const hops = [...new Map(decoded.hints.map(r => [r[0].pubkey, r[0]])).values()].slice(0, 3);
    const via = await Promise.all(hops.map(async h => ({ ...(await graphNode(h.pubkey)), feeBaseMsat: h.feeBaseMsat, feePpm: h.feePpm })));
    const value: LnNode = { checkedAt: Date.now(), node, via };
    await prisma.mint.update({ where: { id: mint.id }, data: { lnPubkey: decoded.payee, lnNode: JSON.stringify(value), lnCheckedAt: new Date() } });
    return { ok: true, public: node.public, via: via.length };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
