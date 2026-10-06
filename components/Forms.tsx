'use client';

import { useActionState } from 'react';
import { addMint, type FormResult } from '@/app/actions';
import { StateIcon } from './StateBadge';

function Message({ state }: { state: FormResult }) {
  if (!state) return null;
  return (
    <p className="form-msg" role="status">
      <span style={{ marginTop: 2 }}><StateIcon kind={state.error ? 'failed' : 'ok'} /></span>
      <span>{state.error ?? state.ok}</span>
    </p>
  );
}

export function AddMintForm() {
  const [state, action, pending] = useActionState(addMint, null);
  return (
    <form action={action} className="card">
      <h2 className="h2">Track a mint</h2>
      <p className="soft small" style={{ margin: '4px 0 14px' }}>
        We check <span className="mono">/v1/info</span> before adding. Only public https mints are accepted.
      </p>
      <label className="sr-only" htmlFor="url">Mint URL</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input id="url" name="url" className="field" placeholder="mint.example.com" required />
        <button className="btn secondary" type="submit" disabled={pending}>{pending ? 'Checking…' : 'Add'}</button>
      </div>
      <Message state={state} />
    </form>
  );
}
