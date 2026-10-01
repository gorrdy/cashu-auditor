'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export default function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get('q') ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const apply = (q: string) => {
    const next = new URLSearchParams(params.toString());
    if (q.trim()) next.set('q', q.trim());
    else next.delete('q');
    const qs = next.toString();
    router.replace(qs ? `/?${qs}` : '/', { scroll: false });
  };

  return (
    <form
      role="search"
      action="/"
      method="get"
      className="search"
      onSubmit={e => {
        e.preventDefault();
        apply(value);
      }}
    >
      {[...params.entries()].filter(([k]) => k !== 'q').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="sr-only" htmlFor="mint-search">Search mints</label>
      <input
        id="mint-search"
        name="q"
        type="search"
        className="field"
        placeholder="Search name, URL, software…"
        autoComplete="off"
        value={value}
        onChange={e => {
          setValue(e.target.value);
          if (timer.current) clearTimeout(timer.current);
          const q = e.target.value;
          timer.current = setTimeout(() => apply(q), 250);
        }}
      />
    </form>
  );
}
