import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

export function GET() {
  const body = process.env.APP_ENV === 'dev'
    ? 'User-agent: *\nDisallow: /\n'
    : [
        'User-agent: *',
        'Allow: /',
        'Allow: /api/v1/',
        'Disallow: /api/',
        'Disallow: /operators/profile',
        'Disallow: /*?*sort=',
        'Disallow: /*?*view=',
        '',
        '# AI assistants and search agents are welcome. See /llms.txt and the MCP endpoint /mcp.',
        ...['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Meta-ExternalAgent', 'Amazonbot', 'DuckAssistBot', 'MistralAI-User'].flatMap(bot => [`User-agent: ${bot}`, 'Allow: /', 'Disallow: /api/', 'Allow: /api/v1/', '']),
        `Sitemap: ${SITE_URL}/sitemap.xml`,
        '',
      ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
