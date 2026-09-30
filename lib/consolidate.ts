import { prisma } from './prisma';
import { transfer, type TransferResult } from './transfer';
import { normalizeMintUrl } from './mintUrl';

export function homeMintUrl() {
  const raw = process.env.HOME_MINT_URL;
  return raw ? normalizeMintUrl(raw) : null;
}

export async function consolidateToHomeMint(sourceMintId: string): Promise<TransferResult | null> {
  const homeUrl = homeMintUrl();
  if (!homeUrl) return null;

  const source = await prisma.mint.findUnique({ where: { id: sourceMintId }, select: { id: true, url: true } });
  if (!source || source.url === homeUrl) return null;

  const balance = await prisma.proof.aggregate({ where: { mintId: source.id, state: 'unspent' }, _sum: { amount: true } });
  if (!balance._sum.amount) return null;

  const home = await prisma.mint.upsert({ where: { url: homeUrl }, update: {}, create: { url: homeUrl } });
  return transfer({ source, dest: home, kind: 'consolidate' });
}
