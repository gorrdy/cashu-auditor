import { prisma } from '@/lib/prisma';
import { verifyLnurlSignature } from '@/lib/operator/lnurl';

const reply = (body: object) => Response.json(body, { headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const k1 = p.get('k1') ?? '';
  const sig = p.get('sig') ?? '';
  const key = (p.get('key') ?? '').toLowerCase();
  if (p.get('tag') !== 'login') return reply({ status: 'ERROR', reason: 'Unsupported request' });
  const challenge = /^[0-9a-f]{64}$/.test(k1) ? await prisma.loginChallenge.findUnique({ where: { id: k1 } }) : null;
  if (!challenge || challenge.kind !== 'lnurl-auth' || challenge.usedAt || challenge.lnKey || challenge.expiresAt.getTime() < Date.now()) {
    return reply({ status: 'ERROR', reason: 'This login request expired. Reload the page and scan again.' });
  }
  if (!verifyLnurlSignature(k1, sig, key)) return reply({ status: 'ERROR', reason: 'Invalid signature' });
  await prisma.loginChallenge.update({ where: { id: k1 }, data: { lnKey: key } });
  return reply({ status: 'OK' });
}
