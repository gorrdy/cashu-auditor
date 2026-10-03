import { prisma } from './prisma';
import { normalizeMintUrl } from './mintUrl';
import { probeMint } from './probe';
import { findConfirmedAlias } from './alias';

export const MAX_MINTS = 500;

export type TrackResult =
  | { status: 'added'; url: string; name: string | null }
  | { status: 'exists' | 'alias'; url: string; existing: string }
  | { status: 'invalid' | 'unreachable' | 'limit'; url: string; error: string };

export async function trackMint(input: string, source: string): Promise<TrackResult> {
  const url = normalizeMintUrl(input);
  if (!url) return { status: 'invalid', url: input, error: 'Enter an https:// mint URL.' };

  const existing = await prisma.mint.findUnique({ where: { url }, select: { url: true } });
  if (existing) return { status: 'exists', url, existing: existing.url };
  if ((await prisma.mint.count()) >= MAX_MINTS) return { status: 'limit', url, error: 'Mint limit reached.' };

  const probe = await probeMint(url);
  if (!probe.info) return { status: 'unreachable', url, error: `No Cashu mint answered at ${url} (${probe.error ?? 'unknown error'}).` };

  const alias = await findConfirmedAlias(url, probe.info.pubkey);
  if (alias) return { status: 'alias', url, existing: alias.url };

  await prisma.mint.create({
    data: {
      url,
      source,
      name: probe.info.name?.slice(0, 120),
      version: probe.info.version?.slice(0, 60),
      pubkey: probe.info.pubkey,
    },
  });
  return { status: 'added', url, name: probe.info.name ?? null };
}
