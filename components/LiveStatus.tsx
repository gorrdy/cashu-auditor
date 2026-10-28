'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const TYPES = ['audit', 'swap', 'donation', 'checks', 'mints'] as const;
const MIN_REFRESH_GAP_MS = 10_000;
const STATIC_PATHS = new Set(['/methodology']);

export default function LiveStatus() {
  const router = useRouter();
  const pathname = usePathname();
  const isStatic = STATIC_PATHS.has(pathname);
  const [state, setState] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [last, setLast] = useState<string | null>(null);
  const pending = useRef(false);
  const lastRefresh = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const refresh = () => {
      if (isStatic) return;
      if (document.visibilityState !== 'visible') {
        pending.current = true;
        return;
      }
      if (timer.current) return;
      const wait = Math.max(500, MIN_REFRESH_GAP_MS - (Date.now() - lastRefresh.current));
      timer.current = setTimeout(() => {
        timer.current = null;
        pending.current = false;
        lastRefresh.current = Date.now();
        router.refresh();
      }, wait);
    };

    const onEvent = (e: MessageEvent) => {
      setLast(e.type);
      refresh();
    };
    let es: EventSource;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let delay = 5_000;
    const connect = () => {
      es = new EventSource('/api/live');
      es.onopen = () => {
        if (delay > 5_000) refresh();
        delay = 5_000;
        setState('live');
      };
      es.onerror = () => {
        if (es.readyState !== EventSource.CLOSED) return setState('connecting');
        setState('offline');
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 60_000);
      };
      for (const t of TYPES) es.addEventListener(t, onEvent);
    };
    connect();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && pending.current) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      es.close();
      if (retry) clearTimeout(retry);
      document.removeEventListener('visibilitychange', onVisible);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router, isStatic]);

  const label = state === 'live' ? 'Live' : state === 'connecting' ? 'Connecting' : 'Offline';
  return (
    <span className={`live live-${state}`} title={last ? `Last update: ${last}` : 'Updates arrive automatically'} aria-label={`Live updates: ${label}`}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}
