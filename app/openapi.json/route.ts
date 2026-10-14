import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

const obj = (description: string) => ({ description, content: { 'application/json': { schema: { type: 'object' } } } });

export function GET() {
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'Cashu Mints Auditor API',
      version: '1',
      description: 'Live, measured reliability data for public Cashu ecash mints: uptime, latency, real Lightning swaps, scores and recommendations. No key needed; responses are cached for 60 seconds. An MCP server with the same data is at /mcp.',
      license: { name: 'MIT', url: 'https://github.com/gorrdy/cashu-auditor/blob/main/LICENSE' },
    },
    servers: [{ url: SITE_URL }],
    paths: {
      '/api/v1/mints': {
        get: {
          operationId: 'listMints',
          summary: 'All tracked mints',
          description: 'Every mint with state, recommended flag, score, uptime 24 h/7 d/30 d, latency, software, units and swap counts over 30 days.',
          responses: { 200: obj('Mint list') },
        },
      },
      '/api/v1/mints.csv': {
        get: { operationId: 'listMintsCsv', summary: 'All tracked mints as CSV', responses: { 200: { description: 'CSV', content: { 'text/csv': { schema: { type: 'string' } } } } } },
      },
      '/api/v1/mints/{id}': {
        get: {
          operationId: 'getMint',
          summary: 'One mint',
          description: 'Daily uptime, latency breakdown, outages, swaps over 7 days, integrity checks and spec. An alias id redirects to its primary mint.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: obj('Mint detail'), 308: { description: 'Alias of another mint' }, 404: obj('Not found') },
        },
      },
      '/api/v1/swaps': {
        get: {
          operationId: 'listSwaps',
          summary: 'Recent Lightning swaps',
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } }],
          responses: { 200: obj('Swaps, newest first') },
        },
      },
      '/api/v1/network': {
        get: {
          operationId: 'getNetwork',
          summary: 'Lightning swap graph between mints',
          parameters: [{ name: 'range', in: 'query', schema: { type: 'string', enum: ['24h', '7d', '30d'], default: '30d' } }],
          responses: { 200: obj('Edges with counts of successful and failed swaps') },
        },
      },
    },
  };
  return Response.json(spec, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' } });
}
