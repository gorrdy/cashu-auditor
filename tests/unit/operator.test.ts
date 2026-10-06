import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { mintContacts } from '@/lib/operator/claims';
import { LOGIN_KIND, verifyLoginEvent } from '@/lib/operator/nostr';
import { SITE_URL } from '@/lib/site';

const sk = generateSecretKey();
const pk = getPublicKey(sk);
const login = (challenge: string, overrides: Partial<{ u: string; kind: number; created_at: number }> = {}) =>
  finalizeEvent({ kind: overrides.kind ?? LOGIN_KIND, created_at: overrides.created_at ?? Math.floor(Date.now() / 1000), tags: [['u', overrides.u ?? `${SITE_URL}/operators`], ['challenge', challenge]], content: '' }, sk);

describe('mintContacts', () => {
  it('reads npub, hex and email contacts and ignores the rest', () => {
    const contact = JSON.stringify([
      { method: 'nostr', info: nip19.npubEncode(pk) },
      { method: 'nostr', info: 'f'.repeat(64) },
      { method: 'email', info: 'Ops@Example.com' },
      { method: 'email', info: 'not an email' },
      { method: 'twitter', info: '@x' },
    ]);
    expect(mintContacts(contact)).toEqual({ nostr: [pk, 'f'.repeat(64)], email: ['ops@example.com'] });
  });
  it('survives garbage', () => {
    expect(mintContacts('{bad')).toEqual({ nostr: [], email: [] });
  });
});

describe('verifyLoginEvent', () => {
  it('accepts a fresh signed event for the challenge', () => {
    expect(verifyLoginEvent(login('abc'), 'abc')).toBe(pk);
  });
  it('rejects another challenge, site, kind or an old event', () => {
    expect(verifyLoginEvent(login('abc'), 'xyz')).toBeNull();
    expect(verifyLoginEvent(login('abc', { u: 'https://evil.example/operators' }), 'abc')).toBeNull();
    expect(verifyLoginEvent(login('abc', { kind: 1 }), 'abc')).toBeNull();
    expect(verifyLoginEvent(login('abc', { created_at: Math.floor(Date.now() / 1000) - 3600 }), 'abc')).toBeNull();
  });
  it('rejects a tampered event', () => {
    const e = login('abc');
    expect(verifyLoginEvent({ ...e, pubkey: 'f'.repeat(64) }, 'abc')).toBeNull();
  });
});
