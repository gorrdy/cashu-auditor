import { checkDonationInvoice } from '@/lib/donate';
import { isMintId } from '@/lib/mintUrl';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = isMintId(id) ? await checkDonationInvoice(id) : 'unknown';
  return Response.json({ state }, { status: state === 'unknown' ? 404 : 200, headers: { 'Cache-Control': 'no-store' } });
}
