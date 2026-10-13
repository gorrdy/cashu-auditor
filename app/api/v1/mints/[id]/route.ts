import { json } from '@/lib/api';
import { getMintDetail, getOverview } from '@/lib/stats';
import { getMintExtras } from '@/lib/stats-extra';
import { computeScore } from '@/lib/score';
import { isMintId } from '@/lib/mintUrl';
import { mintPage } from '@/lib/site';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isMintId(id)) return json({ error: 'Not found' }, 404);
  const [d, x, overview] = await Promise.all([getMintDetail(id, '7d'), getMintExtras(id, '7d'), getOverview()]);
  if (!d) return json({ error: 'Not found' }, 404);
  const m = d.mint;
  if (m.aliasOfId) return Response.redirect(new URL(`/api/v1/mints/${m.aliasOfId}`, request.url), 308);
  const scored = computeScore({ ...d.scoreInput, reviewAvg: x.reviews.average, reviewCount: x.reviews.rated });
  const score = m.isTest ? null : scored.score;
  const parts = scored.parts;
  return json({
    id: m.id,
    url: m.url,
    name: m.name,
    isTest: m.isTest,
    recommended: overview.mints.find(r => r.id === m.id)?.recommended ?? false,
    state: d.state,
    reasons: d.reasons,
    score,
    scoreParts: parts,
    uptime: d.uptime,
    uptimeFrankfurt7d: x.frankfurtUptime,
    daily: d.days,
    latency7d: { prague: d.latencyStats, timings: x.timings },
    incidents7d: d.incidents,
    swaps7d: { ...d.swapStats, ...x.swapDetail },
    spec: {
      version: m.version,
      pubkey: m.pubkey,
      nuts: m.nuts,
      methods: m.methods ? JSON.parse(m.methods) : [],
      inputFeePpk: m.inputFeePpk,
      activeKeysetId: m.activeKeysetId,
      mintDisabled: m.mintDisabled,
      meltDisabled: m.meltDisabled,
      authRequired: m.authRequired,
      websockets: m.websockets,
      onionUrl: m.onionUrl,
      tosUrl: m.tosUrl,
    },
    network: { ipv4: m.ipv4, ipv6: m.ipv6, asn: m.asn, asName: m.asName, country: m.country, tlsIssuer: m.tlsIssuer, tlsExpiresAt: m.tlsExpiresAt },
    integrity: x.checks,
    changes: x.events,
    reviews: { count: x.reviews.count, rated: x.reviews.rated, average: x.reviews.average },
    page: mintPage(m.id),
  });
}
