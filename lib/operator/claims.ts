import { Resolver } from 'node:dns/promises';
import { prisma } from '../prisma';
import { probeMint } from '../probe';
import { randomToken } from './session';
import { toHexPubkey } from './nostr';
import { recoverNodeKey } from './nodeSig';

export type ClaimMethod = 'nostr' | 'node' | 'motd' | 'dns';
export const METHODS: ClaimMethod[] = ['nostr', 'node', 'motd', 'dns'];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function mintContacts(contact: string | null) {
  let list: unknown = [];
  try {
    list = contact ? JSON.parse(contact) : [];
  } catch {}
  const nostr: string[] = [];
  const email: string[] = [];
  for (const e of Array.isArray(list) ? list : []) {
    const method = String((e as { method?: unknown })?.method ?? '').toLowerCase();
    const info = String((e as { info?: unknown })?.info ?? '').trim();
    if (method === 'nostr') {
      const hex = toHexPubkey(info);
      if (hex) nostr.push(hex);
    } else if (method === 'email' && EMAIL.test(info)) email.push(info.toLowerCase());
  }
  return { nostr: [...new Set(nostr)], email: [...new Set(email)] };
}

async function publicTxt(name: string) {
  const resolver = new Resolver({ timeout: 4000, tries: 2 });
  resolver.setServers(['1.1.1.1', '8.8.8.8', '9.9.9.9']);
  return (await resolver.resolveTxt(name)).map(r => r.join(''));
}

export const verifyCode = (code: string) => `cashu-audit-verify=${code}`;

export function recommendedMethod(contacts: ReturnType<typeof mintContacts>, operatorPubkey: string | null, lnPubkey: string | null = null): ClaimMethod {
  if (operatorPubkey && contacts.nostr.includes(operatorPubkey)) return 'nostr';
  if (lnPubkey) return 'node';
  return 'motd';
}

export async function startClaim(operatorId: string, mintId: string) {
  const mint = await prisma.mint.findUnique({ where: { id: mintId }, select: { id: true, aliasOfId: true } });
  if (!mint) return { error: 'Mint not found' };
  const id = mint.aliasOfId ?? mint.id;
  const existing = await prisma.mintClaim.findUnique({ where: { operatorId_mintId: { operatorId, mintId: id } } });
  if (existing) return { claim: existing };
  const operator = await prisma.operator.findUnique({ where: { id: operatorId }, select: { pubkey: true } });
  const m = await prisma.mint.findUnique({ where: { id }, select: { contact: true, lnPubkey: true } });
  const method = recommendedMethod(mintContacts(m?.contact ?? null), operator?.pubkey ?? null, m?.lnPubkey ?? null);
  const claim = await prisma.mintClaim.create({ data: { operatorId, mintId: id, method, code: randomToken(12) } });
  return { claim };
}

async function markVerified(claimId: string, method: ClaimMethod) {
  await prisma.mintClaim.update({ where: { id: claimId }, data: { verifiedAt: new Date(), method } });
}

export async function verifyClaim(operatorId: string, claimId: string, method: ClaimMethod, input?: string): Promise<{ ok?: string; error?: string }> {
  const claim = await prisma.mintClaim.findUnique({ where: { id: claimId } });
  if (!claim || claim.operatorId !== operatorId) return { error: 'Claim not found' };
  const mint = await prisma.mint.findUnique({ where: { id: claim.mintId }, select: { url: true, contact: true, name: true, lnPubkey: true } });
  if (!mint) return { error: 'Mint not found' };

  if (method === 'nostr') {
    const operator = await prisma.operator.findUnique({ where: { id: operatorId }, select: { pubkey: true } });
    if (!operator?.pubkey) return { error: 'Sign in with Nostr first.' };
    const fresh = await probeMint(mint.url);
    const live = mintContacts(fresh.info?.contact ? JSON.stringify(fresh.info.contact) : mint.contact);
    if (!live.nostr.includes(operator.pubkey)) return { error: 'Your npub is not listed as a nostr contact in this mint\'s /v1/info.' };
    await markVerified(claim.id, 'nostr');
    return { ok: 'Verified through the nostr contact of the mint.' };
  }

  if (method === 'node') {
    if (!mint.lnPubkey) return { error: 'The Lightning node of this mint is not known yet.' };
    const key = recoverNodeKey(verifyCode(claim.code), input ?? '');
    if (!key) return { error: 'Paste the signature that signmessage returned.' };
    if (key !== mint.lnPubkey) return { error: 'The signature is valid but comes from another node than the one in the mint\'s invoices.' };
    await markVerified(claim.id, 'node');
    return { ok: 'Verified with the mint\'s Lightning node.' };
  }

  if (method === 'motd') {
    const fresh = await probeMint(mint.url);
    if (!fresh.info) return { error: 'The mint did not answer /v1/info.' };
    if (!JSON.stringify(fresh.info).includes(verifyCode(claim.code))) return { error: 'The code was not found in /v1/info yet. Add it to the MOTD or description and try again.' };
    await markVerified(claim.id, 'motd');
    return { ok: 'Verified. You can remove the code from the mint again.' };
  }

  if (method === 'dns') {
    const host = new URL(mint.url).hostname;
    try {
      const records = await publicTxt(`_cashu-audit.${host}`);
      if (!records.some(r => r.trim() === verifyCode(claim.code))) return { error: `TXT record _cashu-audit.${host} does not contain the code yet.` };
    } catch {
      return { error: `No TXT record found at _cashu-audit.${host}.` };
    }
    await markVerified(claim.id, 'dns');
    return { ok: 'Verified through DNS. You can remove the record again.' };
  }

  return { error: 'Unknown method' };
}
