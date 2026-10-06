'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';

type Option = { id: string; label: string };

export default function CompareForm({ options, selected, max, presets }: {
  options: Option[];
  selected: string[];
  max: number;
  presets: { label: string; ids: string[] }[];
}) {
  const form = useRef<HTMLFormElement>(null);
  const [count, setCount] = useState(Math.max(2, selected.length));
  const submit = () => form.current?.requestSubmit();

  return (
    <div className="cmp-controls">
      {presets.length > 0 && (
        <div className="cmp-presets" role="group" aria-label="Presets">
          <span className="small soft">Quick picks</span>
          {presets.map(p => (
            <Link key={p.label} href={`/compare?${p.ids.slice(0, count).map(id => `m=${id}`).join('&')}`} prefetch={false} className="cmp-preset">{p.label}</Link>
          ))}
        </div>
      )}
      <form ref={form} method="get" action="/compare" className="cmp-form">
        {Array.from({ length: count }, (_, i) => (
          <div key={`${i}-${selected[i] ?? ''}`} className="cmp-slot">
            <span className="cmp-slot-n" aria-hidden="true">{i + 1}</span>
            <label className="sr-only" htmlFor={`cmp-${i}`}>Mint {i + 1}</label>
            <select id={`cmp-${i}`} name="m" className="field" defaultValue={selected[i] ?? ''} onChange={submit}>
              <option value="">Choose a mint</option>
              {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            {count > 2 && (
              <button
                type="button"
                className="cmp-remove"
                aria-label={`Remove mint ${i + 1}`}
                onClick={e => {
                  const select = (e.currentTarget.parentElement?.querySelector('select') ?? null) as HTMLSelectElement | null;
                  if (select?.value) {
                    select.value = '';
                    submit();
                  } else setCount(n => n - 1);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </button>
            )}
          </div>
        ))}
        {count < max && (
          <button type="button" className="btn secondary cmp-add" onClick={() => setCount(n => n + 1)}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            Add mint
          </button>
        )}
        <noscript><button type="submit" className="btn">Compare</button></noscript>
      </form>
    </div>
  );
}
