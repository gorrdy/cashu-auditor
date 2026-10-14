import { MCP_PROTOCOLS, TOOLS } from '@/lib/mcp';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

export function GET() {
  const card = {
    version: '1.0',
    protocolVersion: MCP_PROTOCOLS[0],
    serverInfo: { name: 'cashu-mints-auditor', title: 'Cashu Mints Auditor', version: '1.0.0' },
    description: 'Live reliability data for public Cashu ecash mints: uptime, latency, real Lightning payouts and receipts, scores and recommendations.',
    iconUrl: `${SITE_URL}/icon-512.png`,
    documentationUrl: `${SITE_URL}/llms.txt`,
    transport: { type: 'streamable-http', endpoint: `${SITE_URL}/mcp` },
    capabilities: { tools: { listChanged: false } },
    authentication: { required: false },
    tools: TOOLS.map(t => ({ name: t.name, title: t.title, description: t.description })),
  };
  return Response.json(card, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' } });
}
