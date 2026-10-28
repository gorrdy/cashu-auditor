import { getMintDetail, getOverview, getRecentSwaps } from './stats';
import { mintPage, SITE_URL } from './site';
import { hostOf, mintLabel } from '@/components/format';
import { normalizeMintUrl } from './mintUrl';

type Row = Awaited<ReturnType<typeof getOverview>>['mints'][number];

const round = (v: number | null, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

export function mintSummary(m: Row) {
  return {
    id: m.id,
    name: mintLabel(m),
    url: m.url,
    page: mintPage(m.id),
    state: m.state,
    reasons: m.reasons,
    recommended: m.recommended,
    failedMintRun: m.runFail ? { at: new Date(m.runFail.at).toISOString(), reason: m.runFail.reason } : null,
    score: m.score,
    uptimePct: { h24: round(m.uptime24h), d7: round(m.uptime7d), d30: round(m.uptime30d) },
    latencyMs24h: m.avgLatency24h,
    medianPayoutMs30d: m.payoutMs,
    swaps30d: { received: m.mints, paidOut: m.melts, failuresAttributed: m.errors },
    software: m.version,
    outdatedSoftware: !!m.versionStatus?.outdated,
    units: m.units,
    inputFeePpk: m.inputFeePpk,
    websockets: !!m.websockets,
    onion: !!m.onionUrl,
    isTest: m.isTest,
    offlineSince: m.offlineSince ? new Date(m.offlineSince).toISOString() : null,
    otherUrls: m.aliases.map(a => a.url),
  };
}

export type MintQuery = { query?: string; recommendedOnly?: boolean; onlineOnly?: boolean; unit?: string; includeTest?: boolean; sort?: 'score' | 'uptime' | 'latency' | 'payout'; limit?: number };

export async function searchMints(q: MintQuery = {}) {
  const { mints, now } = await getOverview();
  const terms = (q.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const sorters: Record<NonNullable<MintQuery['sort']>, (a: Row, b: Row) => number> = {
    score: (a, b) => Number(b.recommended) - Number(a.recommended) || (b.score ?? -1) - (a.score ?? -1),
    uptime: (a, b) => (b.uptime30d ?? -1) - (a.uptime30d ?? -1),
    latency: (a, b) => (a.avgLatency24h ?? Infinity) - (b.avgLatency24h ?? Infinity),
    payout: (a, b) => (a.payoutMs ?? Infinity) - (b.payoutMs ?? Infinity),
  };
  const list = mints
    .filter(m => !m.longOffline || q.query)
    .filter(m => q.includeTest || !m.isTest)
    .filter(m => !q.recommendedOnly || m.recommended)
    .filter(m => !q.onlineOnly || (m.latestStatus && m.latestStatus !== 'offline'))
    .filter(m => !q.unit || m.units.includes(q.unit.toLowerCase()))
    .filter(m => {
      if (!terms.length) return true;
      const hay = [m.name, m.url, m.version, ...m.aliases.map(a => a.url)].filter(Boolean).join(' ').toLowerCase();
      return terms.every(t => hay.includes(t));
    })
    .sort(sorters[q.sort ?? 'score']);
  const limit = Math.min(100, Math.max(1, q.limit ?? 20));
  return { generatedAt: new Date(now).toISOString(), total: list.length, mints: list.slice(0, limit).map(mintSummary) };
}

export async function findMint(ref: string) {
  const { mints } = await getOverview();
  const r = ref.trim();
  const url = normalizeMintUrl(r);
  const host = r.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
  return (
    mints.find(m => m.id === r) ??
    mints.find(m => (url && (m.url === url || m.aliases.some(a => a.url === url)))) ??
    mints.find(m => hostOf(m.url).toLowerCase() === host || m.aliases.some(a => hostOf(a.url).toLowerCase() === host)) ??
    mints.find(m => mintLabel(m).toLowerCase() === r.toLowerCase()) ??
    null
  );
}

export async function mintReport(ref: string) {
  const row = await findMint(ref);
  if (!row) return null;
  const d = await getMintDetail(row.id, '7d');
  if (!d) return null;
  return {
    ...mintSummary(row),
    uptimePct: { h24: round(d.uptime['24h']), d7: round(d.uptime['7d']), d30: round(d.uptime['30d']), d90: round(d.uptime['90d']) },
    latency7d: d.latencyStats,
    incidents7d: d.incidents.slice(0, 10).map(i => ({ start: new Date(i.start).toISOString(), end: i.end ? new Date(i.end).toISOString() : null, checks: i.checks, error: i.error })),
    swaps7d: {
      total: d.swapStats.all.total,
      successRatePct: round(d.swapStats.all.successRate),
      asPayer: d.swapStats.asSource,
      asReceiver: d.swapStats.asDest,
      failuresAttributed: d.swapStats.errorsBlamed,
    },
    spec: { version: d.mint.version, nuts: d.mint.nuts, pubkey: d.mint.pubkey, mintDisabled: d.mint.mintDisabled, meltDisabled: d.mint.meltDisabled, contact: d.mint.contact ? JSON.parse(d.mint.contact) : null, motd: d.mint.motd },
    checkedAt: d.lastAudit ? new Date(d.lastAudit.timestamp).toISOString() : null,
  };
}

export async function compareMints(refs: string[]) {
  const rows = await Promise.all(refs.slice(0, 5).map(r => findMint(r)));
  return { mints: rows.map((r, i) => (r ? mintSummary(r) : { notFound: refs[i] })) };
}

export async function networkOverview() {
  const { totals, now, mints } = await getOverview();
  return {
    generatedAt: new Date(now).toISOString(),
    mintsTracked: totals.tracked,
    mintsOnline: totals.online,
    mintsRecommended: totals.recommended,
    swaps30d: { total: totals.swaps, successRatePct: round(totals.successRate), movedSat: totals.swapped, feesSat: totals.fees, avgSwapMs: totals.avgSwapMs },
    lastCheck: totals.lastCheck ? new Date(totals.lastCheck).toISOString() : null,
    topRecommended: mints.filter(m => m.recommended).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 10).map(m => ({ name: mintLabel(m), url: m.url, score: m.score, page: mintPage(m.id) })),
    methodology: `${SITE_URL}/methodology`,
  };
}

export async function recentSwaps(ref?: string, limit = 20) {
  const row = ref ? await findMint(ref) : null;
  if (ref && !row) return null;
  const swaps = await getRecentSwaps({ mintId: row?.id, take: Math.min(100, Math.max(1, limit)) });
  return {
    swaps: swaps.map(s => ({
      at: s.timestamp.toISOString(),
      from: mintLabel(s.sourceMint),
      to: mintLabel(s.destMint),
      amountSat: s.amount,
      feeSat: s.fee,
      status: s.status,
      failedAt: s.status === 'failed' ? s.stage : null,
      error: s.error,
      durationMs: s.duration,
    })),
  };
}
