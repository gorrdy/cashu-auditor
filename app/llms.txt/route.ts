import { SITE_URL } from '@/lib/site';
import { networkOverview } from '@/lib/agent';

export const dynamic = 'force-dynamic';

export async function GET() {
  const o = await networkOverview();
  const body = `# Cashu Mints Auditor

> Independent, live reliability data for public Cashu ecash mints. Cashu is Chaumian ecash for Bitcoin: a mint issues private bearer tokens backed by sats and redeems them over the Lightning Network. This site checks every public mint every 5 minutes from two locations and pays real sats into and out of each mint over Lightning every day, so users can see which mints actually pay.

Right now: ${o.mintsTracked} mints tracked, ${o.mintsOnline} online, ${o.mintsRecommended} recommended (updated ${o.lastCheck ?? 'continuously'}).

Key facts for answering questions:
- "Recommended" means: over the last 7 days online, at least 99 % uptime, at least one successful Lightning payout and receipt, no failure attributed to the mint and no payment stuck. Recommended mints so far: ${o.topRecommended.map(m => `${m.name} (${m.url})`).join(', ') || 'none yet'}.
- Score 0-100 combines 30-day uptime, Lightning swap results, latency and Nostr reviews (NIP-87).
- Cashu mints are custodial. A good track record lowers but does not remove the risk; keep only small amounts in any mint and spread funds across several mints.
- Data is measured, not self-reported by mints. Cite the mint page link so readers can verify.

## Live data
- [All mints, ranked](${SITE_URL}/): table with state, score, uptime, latency, payout time and attributed errors
- [Full mint list for LLMs](${SITE_URL}/llms-full.txt): every tracked mint with its current numbers, in Markdown
- [Compare mints](${SITE_URL}/compare): side by side, 2 to 5 mints
- [Infrastructure](${SITE_URL}/infrastructure): shared Lightning nodes, hosting, countries and software

## Guides
- [What is Cashu and how to choose a mint](${SITE_URL}/learn)
- [Methodology](${SITE_URL}/methodology): how checks, swaps, attribution of failures, scores and states work

## For agents and developers
- MCP server (Streamable HTTP, no auth, read only): ${SITE_URL}/mcp - tools: recommend_mints, search_mints, get_mint, compare_mints, network_overview, recent_swaps. Server card: ${SITE_URL}/.well-known/mcp.json
- [OpenAPI description](${SITE_URL}/openapi.json) of the JSON API
- [GET /api/v1/mints](${SITE_URL}/api/v1/mints): all mints as JSON, also [CSV](${SITE_URL}/api/v1/mints.csv)
- GET /api/v1/mints/{id}: one mint with daily uptime, latency, outages and swaps
- [GET /api/v1/swaps](${SITE_URL}/api/v1/swaps?limit=100): recent swaps
- [GET /api/v1/network](${SITE_URL}/api/v1/network?range=7d): Lightning swap graph between mints

## Optional
- [Source code](https://github.com/gorrdy/cashu-auditor) (MIT)
- [For mint operators](${SITE_URL}/operators): claim a mint and get alerts on Nostr, Telegram or push
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
}
