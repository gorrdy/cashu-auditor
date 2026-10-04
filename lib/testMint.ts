const TEST_MINT = /testnut|\btest(ing)?\s+(cashu\s+)?mint\b|\bfor testing\b|\bfake\s?wallet\b/i;

export function looksLikeTestMint(m: { url: string; name?: string | null; description?: string | null }) {
  return TEST_MINT.test([m.url, m.name ?? '', m.description ?? ''].join(' '));
}
