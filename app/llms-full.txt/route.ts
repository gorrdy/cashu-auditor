import { SITE_URL } from '@/lib/site';
import { networkOverview, searchMints } from '@/lib/agent';

export const dynamic = 'force-dynamic';

const pct = (v: number | null) => (v == null ? '-' : `${v.toFixed(2)} %`);
const ms = (v: number | null) => (v == null ? '-' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);

export async function GET() {
  const [o, all] = await Promise.all([networkOverview(), searchMints({ limit: 100, query: undefined })]);
  const rows = all.mints.map(m =>
    `| [${m.name}](${m.page}) | ${m.url} | ${m.recommended ? 'yes' : 'no'} | ${m.state} | ${m.score ?? '-'} | ${pct(m.uptimePct.d30)} | ${ms(m.latencyMs24h)} | ${ms(m.medianPayoutMs30d)} | ${m.swaps30d.paidOut}/${m.swaps30d.received}/${m.swaps30d.failuresAttributed} | ${m.software ?? '-'}${m.outdatedSoftware ? ' (outdated)' : ''} | ${m.units.join(', ')} |`
  );
  const body = `# Cashu Mints Auditor: full mint list

Generated ${all.generatedAt}. Source: ${SITE_URL} (live, measured by the auditor, not self-reported).
${o.mintsTracked} mints tracked, ${o.mintsOnline} online, ${o.mintsRecommended} recommended. Lightning swaps in 30 days: ${o.swaps30d.total}, success ${pct(o.swaps30d.successRatePct)}.

## How to read this
- Recommended: last 7 days online, >= 99 % uptime, at least one Lightning payout and one receipt, no failure attributed to the mint, no stuck payment.
- State: ok, warn (answering but with recent problems), error (offline), unknown (not checked recently).
- Score 0-100: 30-day uptime, swap results, latency, reviews. Test mints are not scored.
- Swaps 30 d: payouts by the mint / receipts by the mint / failures attributed to the mint.
- Latency: 24-hour average of GET /v1/info from Prague. Payout: median time of a successful swap paid out by the mint.
- Mints offline for more than 30 days are not listed here; see ${SITE_URL}/api/v1/mints.

## Mints, best first

| Mint | URL | Recommended | State | Score | Uptime 30 d | Latency | Payout | Swaps 30 d (out/in/failed) | Software | Units |
|---|---|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

## About Cashu
Cashu is an open ecash protocol for Bitcoin. A mint holds bitcoin and issues blind-signed tokens; because of blind signatures the mint cannot link who receives or spends tokens. Tokens move between wallets offline as text or QR, and are minted or melted against Lightning invoices. Mints are custodial, so users pick mints with a good track record and keep small balances. More: ${SITE_URL}/learn and https://cashu.space.
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
}
