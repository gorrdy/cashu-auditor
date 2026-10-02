import { prisma } from '@/lib/prisma';
import { isMintId } from '@/lib/mintUrl';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isMintId(id)) return new Response('Not found', { status: 404 });
  const mint = await prisma.mint.findUnique({ where: { id }, select: { iconData: true, iconType: true, iconHash: true } });
  if (!mint?.iconData || !mint.iconType || !mint.iconHash) return new Response('Not found', { status: 404 });

  const etag = `"${mint.iconHash}"`;
  const headers = {
    'Content-Type': mint.iconType,
    'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Content-Disposition': 'inline',
  };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(mint.iconData, { headers });
}
