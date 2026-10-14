import { compareMints, mintReport, networkOverview, recentSwaps, searchMints } from './agent';
import { SITE_URL } from './site';

export const MCP_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `Live, independent reliability data for public Cashu ecash mints (Bitcoin over Lightning), measured by ${SITE_URL}.
Every mint is checked every 5 minutes from Prague and Frankfurt, and each day the auditor pays real sats into and out of each mint over Lightning.
Use recommend_mints when a user asks which Cashu mint to use, search_mints to browse or filter, get_mint for one mint, compare_mints for a side-by-side view.
Scores are 0-100; "recommended" means a full week of working payouts and receipts, at least 99 % uptime and no failure attributed to the mint.
Always link the mint's page so the user can verify the data. Never present a mint as safe custody: Cashu mints are custodial.`;

const mintRef = { type: 'string', description: 'Mint id, URL (https://mint.example.com), host name or exact name' };
const readOnly = { readOnlyHint: true, openWorldHint: false, idempotentHint: true };

export const TOOLS = [
  {
    name: 'recommend_mints',
    title: 'Recommend Cashu mints',
    description: 'Best currently recommended Cashu mints, ranked by reliability score. Use this when someone asks which Cashu mint to use.',
    inputSchema: { type: 'object', properties: { unit: { type: 'string', description: 'Required unit besides sat, e.g. "usd" or "eur"' }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 5 } } },
    annotations: readOnly,
  },
  {
    name: 'search_mints',
    title: 'Search Cashu mints',
    description: 'Search and filter all tracked Cashu mints with live uptime, latency, payout time, swap results and score.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words matched against name, URL and software version' },
        recommended_only: { type: 'boolean', default: false },
        online_only: { type: 'boolean', default: false },
        unit: { type: 'string', description: 'Only mints that support this unit, e.g. "usd"' },
        include_test: { type: 'boolean', default: false, description: 'Include self-declared test mints' },
        sort: { type: 'string', enum: ['score', 'uptime', 'latency', 'payout'], default: 'score' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
    },
    annotations: readOnly,
  },
  {
    name: 'get_mint',
    title: 'Cashu mint report',
    description: 'Detailed report for one Cashu mint: state, score, uptime 24 h to 90 d, latency, outages, Lightning swap results over 7 days, NUTs and software.',
    inputSchema: { type: 'object', properties: { mint: mintRef }, required: ['mint'] },
    annotations: readOnly,
  },
  {
    name: 'compare_mints',
    title: 'Compare Cashu mints',
    description: 'Side-by-side comparison of 2 to 5 Cashu mints.',
    inputSchema: { type: 'object', properties: { mints: { type: 'array', items: mintRef, minItems: 2, maxItems: 5 } }, required: ['mints'] },
    annotations: readOnly,
  },
  {
    name: 'network_overview',
    title: 'Cashu network overview',
    description: 'How many Cashu mints are tracked, online and recommended, Lightning swap success over 30 days and the top recommended mints.',
    inputSchema: { type: 'object', properties: {} },
    annotations: readOnly,
  },
  {
    name: 'recent_swaps',
    title: 'Recent Lightning swaps',
    description: 'Most recent real Lightning swaps made by the auditor, optionally for one mint, with amounts, fees, results and errors.',
    inputSchema: { type: 'object', properties: { mint: mintRef, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } } },
    annotations: readOnly,
  },
] as const;

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : undefined);
const int = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Math.floor(Number(v)) : d);

async function callTool(name: string, a: Args): Promise<unknown> {
  switch (name) {
    case 'recommend_mints':
      return searchMints({ recommendedOnly: true, unit: str(a.unit), limit: int(a.limit, 5) });
    case 'search_mints':
      return searchMints({
        query: str(a.query),
        recommendedOnly: a.recommended_only === true,
        onlineOnly: a.online_only === true,
        unit: str(a.unit),
        includeTest: a.include_test === true,
        sort: (['score', 'uptime', 'latency', 'payout'] as const).find(s => s === a.sort),
        limit: int(a.limit, 20),
      });
    case 'get_mint': {
      const ref = str(a.mint);
      if (!ref) throw new ToolError('Missing "mint"');
      return (await mintReport(ref)) ?? notFound(ref);
    }
    case 'compare_mints': {
      const refs = Array.isArray(a.mints) ? a.mints.map(str).filter((x): x is string => !!x) : [];
      if (refs.length < 2) throw new ToolError('Give 2 to 5 mints');
      return compareMints(refs);
    }
    case 'network_overview':
      return networkOverview();
    case 'recent_swaps': {
      const ref = str(a.mint);
      return (await recentSwaps(ref, int(a.limit, 20))) ?? notFound(ref!);
    }
    default:
      throw new RpcError(-32602, `Unknown tool: ${name}`);
  }
}

class RpcError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}
class ToolError extends Error {}
const notFound = (ref: string) => {
  throw new ToolError(`No tracked mint matches "${ref}". Use search_mints to find it, or add it at ${SITE_URL}.`);
};

type Request = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

async function handle(req: Request) {
  const params = req.params ?? {};
  switch (req.method) {
    case 'initialize': {
      const asked = String(params.protocolVersion ?? '');
      return {
        protocolVersion: MCP_PROTOCOLS.includes(asked) ? asked : MCP_PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'cashu-mints-auditor', title: 'Cashu Mints Auditor', version: '1.0.0', websiteUrl: SITE_URL },
        instructions: INSTRUCTIONS,
      };
    }
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call': {
      const name = String(params.name ?? '');
      try {
        const data = await callTool(name, (params.arguments as Args) ?? {});
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
      } catch (error) {
        if (error instanceof ToolError) return { content: [{ type: 'text', text: error.message }], isError: true };
        throw error;
      }
    }
    case 'resources/list':
      return { resources: [] };
    case 'prompts/list':
      return { prompts: [] };
    default:
      throw new RpcError(-32601, `Method not found: ${req.method}`);
  }
}

export async function respond(body: unknown) {
  const one = async (req: Request) => {
    if (!req || typeof req !== 'object' || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      return { jsonrpc: '2.0', id: req?.id ?? null, error: { code: -32600, message: 'Invalid request' } };
    }
    if (req.id === undefined || req.id === null) {
      return null;
    }
    try {
      return { jsonrpc: '2.0', id: req.id, result: await handle(req) };
    } catch (error) {
      const code = error instanceof RpcError ? error.code : -32603;
      return { jsonrpc: '2.0', id: req.id, error: { code, message: error instanceof RpcError ? error.message : 'Internal error' } };
    }
  };
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.slice(0, 20).map(one))).filter(Boolean);
    return out.length ? out : null;
  }
  return one(body as Request);
}
