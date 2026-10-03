import { describe, expect, inject, it } from 'vitest';

const mintUrl = inject('testMintUrl');

describe.skipIf(!mintUrl)('alias detection', () => {
  it('confirms two URLs of the same backend through a shared quote', async () => {
    const { sharesBackend } = await import('@/lib/alias');
    expect(await sharesBackend(mintUrl!, mintUrl!.replace('127.0.0.1', 'localhost'))).toBe(true);
  });
  it('rejects a URL that does not know the quote', async () => {
    const { sharesBackend } = await import('@/lib/alias');
    expect(await sharesBackend(mintUrl!, 'http://127.0.0.1:9')).toBe(false);
  });
});
