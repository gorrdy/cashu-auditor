import { getOverview } from '@/lib/stats';
import { SITE_URL, mintPage } from '@/lib/site';

export const dynamic = 'force-dynamic';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export async function GET() {
  const { mints, now } = await getOverview();
  const today = new Date(now).toISOString().slice(0, 10);
  const pages: { loc: string; priority: number; freq: string; lastmod?: string }[] = [
    { loc: `${SITE_URL}/`, priority: 1, freq: 'hourly', lastmod: today },
    { loc: `${SITE_URL}/learn`, priority: 0.9, freq: 'monthly' },
    { loc: `${SITE_URL}/run`, priority: 0.7, freq: 'daily' },
    { loc: `${SITE_URL}/methodology`, priority: 0.7, freq: 'monthly' },
    { loc: `${SITE_URL}/infrastructure`, priority: 0.6, freq: 'daily', lastmod: today },
    { loc: `${SITE_URL}/compare`, priority: 0.6, freq: 'daily' },
    { loc: `${SITE_URL}/operators`, priority: 0.5, freq: 'monthly' },
    ...mints
      .filter(m => !m.isTest)
      .map(m => ({ loc: mintPage(m.id), priority: m.longOffline ? 0.3 : m.recommended ? 0.8 : 0.6, freq: m.longOffline ? 'weekly' : 'daily', lastmod: m.longOffline ? undefined : today })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `  <url><loc>${esc(p.loc)}</loc>${p.lastmod ? `<lastmod>${p.lastmod}</lastmod>` : ''}<changefreq>${p.freq}</changefreq><priority>${p.priority}</priority></url>`).join('\n')}
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
