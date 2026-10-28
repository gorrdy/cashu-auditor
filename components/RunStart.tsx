'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { startRun } from '@/app/actions';
import { BoltIcon } from './icons';
import { StateIcon } from './StateBadge';

const PRESETS = [10_000, 21_000, 50_000, 100_000];

export default function RunStart({ min, max }: { min: number; max: number }) {
  const router = useRouter();
  const [amount, setAmount] = useState(21_000);
  const [donate, setDonate] = useState(false);
  const [address, setAddress] = useState('');
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await startRun({ amount, returnTo: address, donate }).catch(() => ({ error: 'Could not start the run.' }));
    setBusy(false);
    if ('error' in r && r.error) return setError(r.error);
    const { id, key } = r as { id: string; key: string };
    try {
      localStorage.setItem(`run:${id}`, key);
    } catch {}
    router.push(`/run/${id}#${key}`);
  };

  return (
    <form className="card run-form" onSubmit={submit}>
      <h2 className="h2">Start a mint run</h2>
      <div className="amount-grid run-amounts" role="group" aria-label="Amount">
        {PRESETS.map(p => (
          <button key={p} type="button" aria-pressed={amount === p} className="amount-tile" onClick={() => setAmount(p)}>
            <b>{p.toLocaleString('en')}</b><span>sat</span>
          </button>
        ))}
      </div>
      <label className="amount-input">
        <span className="small soft">Or any amount from {min.toLocaleString('en')} to {max.toLocaleString('en')} sat</span>
        <input className="field" type="number" inputMode="numeric" min={min} max={max} value={amount || ''} onChange={e => setAmount(Math.floor(Number(e.target.value)))} />
      </label>

      <fieldset className="run-choice">
        <legend className="small soft">When the run is over</legend>
        <label><input type="radio" name="end" checked={!donate} onChange={() => setDonate(false)} /> Send what is left back to my Lightning address</label>
        {!donate && (
          <input className="field" type="email" inputMode="email" autoComplete="off" placeholder="you@wallet.com" value={address} onChange={e => setAddress(e.target.value)} aria-label="Lightning address" required />
        )}
        <label><input type="radio" name="end" checked={donate} onChange={() => setDonate(true)} /> Donate it to the audit</label>
      </fieldset>

      <label className="run-accept small">
        <input type="checkbox" checked={accept} onChange={e => setAccept(e.target.checked)} required />
        <span>I understand that the sats pass through custodial mints run by strangers. Lightning fees are deducted, and if a mint fails or keeps the money during the run, it can be delayed or lost. The audit does not cover losses.</span>
      </label>

      {error && <p className="form-msg" role="alert"><StateIcon kind="failed" /><span>{error}</span></p>}
      <button type="submit" className="btn btn-block" disabled={busy || !accept || amount < min || amount > max}>
        <BoltIcon /> {busy ? 'Creating invoice…' : `Pay ${amount >= min ? amount.toLocaleString('en') : '…'} sat and start`}
      </button>
    </form>
  );
}
