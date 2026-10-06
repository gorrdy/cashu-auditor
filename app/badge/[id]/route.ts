import { prisma } from '@/lib/prisma';
import { isMintId } from '@/lib/mintUrl';
import { DAY } from '@/lib/constants';


function width(text: string) {
  return Math.round(text.length * 6.6 + 12);
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id.replace(/\.svg$/, '');
  const mint = isMintId(id) ? await prisma.mint.findUnique({ where: { id }, select: { id: true } }) : null;
  if (!mint) return new Response('Not found', { status: 404 });

  const since = new Date(Date.now() - 30 * DAY);
  const [last, total, up] = await Promise.all([
    prisma.auditLog.findFirst({ where: { mintId: id, location: 'prague' }, orderBy: { timestamp: 'desc' }, select: { status: true } }),
    prisma.auditLog.count({ where: { mintId: id, location: 'prague', timestamp: { gte: since } } }),
    prisma.auditLog.count({ where: { mintId: id, location: 'prague', timestamp: { gte: since }, status: { not: 'offline' } } }),
  ]);

  const uptime = total ? (up / total) * 100 : null;
  const online = !!last && last.status !== 'offline';
  const label = 'cashu audit';
  const value = !last ? 'not checked' : `${online ? 'online' : 'offline'}${uptime != null ? ` · ${uptime >= 99.995 ? '100' : uptime.toFixed(uptime >= 99.9 ? 2 : 1)} %` : ''}`;
  const color = !last ? '#76705f' : !online ? '#d03b3b' : uptime != null && uptime < 99 ? '#b07800' : '#0a7d0a';
  const lw = width(label), vw = width(value), w = lw + vw;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(`${label}: ${value}`)}">
<title>${esc(`${label}: ${value}`)}</title>
<rect width="${lw}" height="20" rx="3" fill="#1a1712"/><rect x="${lw}" width="${vw}" height="20" rx="3" fill="${color}"/><rect x="${lw}" width="4" height="20" fill="${color}"/>
<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
<text x="${lw / 2}" y="14">${esc(label)}</text><text x="${lw + vw / 2}" y="14">${esc(value)}</text></g></svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=900',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
