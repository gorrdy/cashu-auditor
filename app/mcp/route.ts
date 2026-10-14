import { respond } from '@/lib/mcp';

export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(data === null ? null : JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });

export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > 64_000) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }
  const out = await respond(body);
  return out === null ? new Response(null, { status: 202, headers: CORS }) : json(out);
}

export function GET() {
  return json({ error: 'This is a stateless MCP endpoint. POST JSON-RPC messages here (Streamable HTTP).', docs: '/llms.txt' }, 405, { Allow: 'POST, OPTIONS' });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
