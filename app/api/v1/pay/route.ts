import { redeemPayment } from '@/lib/donate';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' } });

export function OPTIONS() {
  return new Response(null, { status: 204, headers: HEADERS });
}

export async function POST(request: Request) {
  if (Number(request.headers.get('content-length') ?? 0) > 64_000) return reply({ error: 'Payload too large' }, 413);
  let payload: unknown;
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return reply({ error: 'Invalid JSON' }, 400);
  }
  const result = await redeemPayment(payload);
  return result.ok ? reply({ ok: result.ok }) : reply({ error: result.error }, 400);
}
