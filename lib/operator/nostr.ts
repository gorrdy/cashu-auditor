import { verifyEvent, type NostrEvent } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { SITE_URL } from '../site';

export const LOGIN_KIND = 27235;

export function verifyLoginEvent(event: unknown, challenge: string): string | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as NostrEvent;
  if (e.kind !== LOGIN_KIND || typeof e.pubkey !== 'string' || !Array.isArray(e.tags)) return null;
  if (Math.abs(Date.now() / 1000 - e.created_at) > 600) return null;
  const tag = (name: string) => e.tags.find(t => t[0] === name)?.[1];
  if (tag('challenge') !== challenge || tag('u') !== `${SITE_URL}/operators`) return null;
  try {
    const clean = { id: e.id, pubkey: e.pubkey, created_at: e.created_at, kind: e.kind, tags: e.tags, content: e.content, sig: e.sig };
    return verifyEvent(clean) ? e.pubkey : null;
  } catch {
    return null;
  }
}

export function toHexPubkey(value: string): string | null {
  const v = value.trim().replace(/^nostr:/i, '');
  if (/^[0-9a-f]{64}$/i.test(v)) return v.toLowerCase();
  try {
    const d = nip19.decode(v);
    if (d.type === 'npub') return d.data;
    if (d.type === 'nprofile') return d.data.pubkey;
  } catch {}
  return null;
}

export const npubOf = (hex: string) => nip19.npubEncode(hex);
