'use client';

import { useRef } from 'react';

export default function CompareForm({ options, selected, slots }: { options: { id: string; label: string }[]; selected: string[]; slots: number }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} method="get" action="/compare" className="cmp-form">
      {Array.from({ length: slots }, (_, i) => (
        <label key={i} className="cmp-slot">
          <span className="cmp-slot-n">{i + 1}</span>
          <span className="sr-only">Mint {i + 1}</span>
          <select name="m" className="field" defaultValue={selected[i] ?? ''} onChange={() => form.current?.requestSubmit()}>
            <option value="">Choose a mint</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
      ))}
      <noscript><button type="submit" className="btn">Compare</button></noscript>
    </form>
  );
}
