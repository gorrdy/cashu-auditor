import { beforeAll, describe, expect, inject, it } from 'vitest';

describe('MCP server', () => {
  let respond: typeof import('@/lib/mcp').respond;

  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl');
    ({ respond } = await import('@/lib/mcp'));
  });

  const call = (method: string, params?: object, id: number | undefined = 1) => respond({ jsonrpc: '2.0', id, method, params }) as Promise<{ result?: Record<string, unknown>; error?: { code: number } } | null>;

  it('negotiates the protocol version', async () => {
    const r = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(r?.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'cashu-mints-auditor' } });
    expect((await call('initialize', { protocolVersion: '1999-01-01' }))?.result?.protocolVersion).toBe('2025-11-25');
  });

  it('acknowledges notifications without a response', async () => {
    expect(await respond({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
  });

  it('lists read-only tools', async () => {
    const tools = (await call('tools/list'))?.result?.tools as { name: string; annotations: { readOnlyHint: boolean } }[];
    expect(tools.map(t => t.name)).toEqual(['recommend_mints', 'search_mints', 'get_mint', 'compare_mints', 'network_overview', 'recent_swaps']);
    expect(tools.every(t => t.annotations.readOnlyHint)).toBe(true);
  });

  it('runs a search and reports unknown mints as tool errors', async () => {
    const search = (await call('tools/call', { name: 'search_mints', arguments: { limit: 3 } }))?.result;
    expect(search?.structuredContent).toMatchObject({ mints: expect.any(Array) });
    const missing = (await call('tools/call', { name: 'get_mint', arguments: { mint: 'https://nope.example' } }))?.result;
    expect(missing?.isError).toBe(true);
    expect((await call('tools/call', { name: 'nope' }))?.error?.code).toBe(-32602);
    expect((await call('foo/bar'))?.error?.code).toBe(-32601);
  });
});
