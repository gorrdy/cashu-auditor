'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const TYPES = ['audit', 'swap', 'donation', 'checks', 'mints'] as const;
const MIN_REFRESH_GAP_MS = 4_000;

export default function LiveStatus() {
  const router = useRouter();
  const [state, setState] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [last, setLast] = useState<string | null>(null);
  const pending = useRef(false);
  const lastRefresh = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const refresh = () => {
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

    const es = new EventSource('/api/live');
    es.onopen = () => setState('live');
    es.onerror = () => setState(es.readyState === EventSource.CLOSED ? 'offline' : 'connecting');
    const onEvent = (e: MessageEvent) => {
      setLast(e.type);
      refresh();
    };
    for (const t of TYPES) es.addEventListener(t, onEvent);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && pending.current) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      es.close();
      document.removeEventListener('visibilitychange', onVisible);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router]);

  const label = state === 'live' ? 'Live' : state === 'connecting' ? 'Connecting' : 'Offline';
  return (
    <span className={`live live-${state}`} title={last ? `Last update: ${last}` : 'Updates arrive automatically'} aria-live="polite">
      <i aria-hidden="true" />
      {label}
    </span>
  );
}
