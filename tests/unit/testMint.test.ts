import { describe, expect, it } from 'vitest';
import { looksLikeTestMint } from '@/lib/testMint';

describe('looksLikeTestMint', () => {
  it.each([
    [{ url: 'https://testnut.cashu.space', name: 'Testnut mint' }],
    [{ url: 'https://8333.space:3338', name: 'Cashu test mint', description: 'This mint is for testing and development purposes only.' }],
    [{ url: 'https://mint.routstr.com', name: 'RoutstrMint', description: 'Routstr testing mint' }],
    [{ url: 'https://cashu.centurymetadata.org', name: 'Century Metadata Test Mint' }],
  ])('flags %o', m => expect(looksLikeTestMint(m)).toBe(true));
  it.each([
    [{ url: 'https://mint.unclerics.cash', name: "Uncle Ric's 2.0", description: 'Ecash for the homies' }],
    [{ url: 'https://cashu.cz', name: 'cashu.cz', description: 'Cashu.cz mint.' }],
    [{ url: 'https://mint.minibits.cash/Bitcoin', name: 'Minibits mint', description: 'research project in BETA' }],
  ])('keeps %o', m => expect(looksLikeTestMint(m)).toBe(false));
});
