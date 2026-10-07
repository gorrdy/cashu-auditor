'use client';

import { useEffect, useState } from 'react';

const CHECK_MS = 60_000;
const COUNTDOWN = 5;

export default function UpdateBanner({ version }: { version: string }) {
  const [available, setAvailable] = useState(false);
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (available) return;
    let stop = false;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await fetch('/api/version', { cache: 'no-store' });
        const { version: current } = (await r.json()) as { version?: string };
        if (!stop && current && current !== version) {
          setAvailable(true);
          if (window.matchMedia('(display-mode: standalone)').matches) setLeft(COUNTDOWN);
        }
      } catch {}
    };
    const timer = setInterval(check, CHECK_MS);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
    return () => {
      stop = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('online', check);
    };
  }, [version, available]);

  useEffect(() => {
    if (left === null) return;
    if (left <= 0) {
      window.location.reload();
      return;
    }
    const t = setTimeout(() => setLeft(n => (n ?? 1) - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  if (!available) return null;
  return (
    <div className="update-banner" role="status">
      <span>A new version is available{left !== null && left > 0 ? ` · updating in ${left} s` : ''}</span>
      <button type="button" onClick={() => window.location.reload()}>Update now</button>
    </div>
  );
}
