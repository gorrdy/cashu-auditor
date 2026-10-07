import { createAvatar } from '@dicebear/core';
import { notionists } from '@dicebear/collection';
import { npubOf } from './nostr';

const BACKGROUNDS = ['ffd5b8', 'd6ccff', 'c9ecf8', 'ffe3a3', 'c8f0d4', 'ffcfe1'];
const cache = new Map<string, string>();

export function avatarUri(seed: string) {
  let uri = cache.get(seed);
  if (!uri) {
    const svg = createAvatar(notionists, { seed, backgroundColor: BACKGROUNDS, radius: 50 }).toString();
    uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    if (cache.size > 500) cache.clear();
    cache.set(seed, uri);
  }
  return uri;
}

type OperatorLike = { id: string; name: string | null; avatarSeed: string | null; pubkey: string | null; email: string | null; lnKey: string | null };

export function identityOf(op: OperatorLike) {
  if (op.pubkey) return `${npubOf(op.pubkey).slice(0, 16)}…`;
  if (op.email) return op.email;
  if (op.lnKey) return `Lightning key ${op.lnKey.slice(0, 12)}…`;
  return 'Operator';
}

export function profileOf(op: OperatorLike) {
  const identity = identityOf(op);
  return { name: op.name || identity, identity, avatar: avatarUri(op.avatarSeed ?? op.id) };
}
