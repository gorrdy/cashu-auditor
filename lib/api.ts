import { getOverview } from './stats';
import { mintPage } from './site';

export const API_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
};

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...API_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } });

export async function mintList() {
  const { mints, now } = await getOverview();
  return {
    generatedAt: new Date(now).toISOString(),
    mints: mints.map(m => ({
      id: m.id,
      url: m.url,
      isTest: m.isTest,
      aliases: m.aliases.map(a => a.url),
      name: m.name,
      state: m.state,
      reasons: m.reasons,
      score: m.score,
      uptime24h: m.uptime24h,
      uptime7d: m.uptime7d,
      uptime30d: m.uptime30d,
      latencyMs24h: m.avgLatency24h,
      version: m.version,
      inputFeePpk: m.inputFeePpk,
      units: m.units,
      websockets: m.websockets,
      onion: !!m.onionUrl,
      swaps: { minted: m.mints, melted: m.melts, attributedFailures: m.errors },
      lastCheck: m.checkedAt ? new Date(m.checkedAt).toISOString() : null,
      offlineSince: m.offlineSince ? new Date(m.offlineSince).toISOString() : null,
      longOffline: m.longOffline,
      page: mintPage(m.id),
    })),
  };
}
