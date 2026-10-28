let holder: string | null = null;

export function lockHolder() {
  return holder;
}

export async function withWalletLock<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  if (holder) return null;
  holder = name;
  try {
    return await fn();
  } finally {
    holder = null;
  }
}

export async function waitForWalletLock<T>(name: string, fn: () => Promise<T>, timeoutMs = 40_000): Promise<T | null> {
  const until = Date.now() + timeoutMs;
  while (holder && Date.now() < until) await new Promise(r => setTimeout(r, 500));
  return withWalletLock(name, fn);
}
