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
