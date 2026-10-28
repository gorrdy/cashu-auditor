import { prisma } from '@/lib/prisma';
import { isMintId } from '@/lib/mintUrl';
import { checkRunInvoice, runOwner } from '@/lib/mintrun';

const noStore = { 'Cache-Control': 'no-store' };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let run = isMintId(id) ? await prisma.mintRun.findUnique({ where: { id } }) : null;
  if (!run) return Response.json({ error: 'Not found' }, { status: 404, headers: noStore });
  if (run.status === 'invoice') {
    await checkRunInvoice(run);
    run = (await prisma.mintRun.findUnique({ where: { id } }))!;
  }
  return Response.json({ status: run.status, value: run.value, position: run.position, lastSwapId: run.lastSwapId, updatedAt: run.updatedAt.getTime() }, { headers: noStore });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
  const run = isMintId(id) && typeof body?.key === 'string' ? await runOwner(id, body.key) : null;
  if (!run) return Response.json({ error: 'Not found' }, { status: 404, headers: noStore });
  return Response.json({ returnTo: run.returnTo, donate: run.donate, token: run.token, status: run.status, error: run.error }, { headers: noStore });
}
