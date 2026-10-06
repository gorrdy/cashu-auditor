'use client';

import { useActionState, useRef, useState } from 'react';
import { addMint } from '@/app/actions';
import { StateIcon } from './StateBadge';

function preview(input: string) {
  const raw = input.trim().replace(/^http:\/\//i, 'https://');
  if (!raw) return null;
  try {
    const url = new URL(/^https:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.protocol === 'https:' && url.hostname.includes('.') ? `https://${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}` : null;
  } catch {
    return null;
  }
}

function AddMintForm({ onDone }: { onDone: () => void }) {
  const [state, action, pending] = useActionState(addMint, null);
  const [value, setValue] = useState('');
  const url = preview(value);
  return (
    <form action={action}>
      <label className="sr-only" htmlFor="mint-url">Mint URL</label>
      <input
        id="mint-url"
        name="url"
        className="field"
        placeholder="mint.example.com"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        inputMode="url"
        required
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
      />
      <p className="small muted add-preview">{url ? <>Will check <span className="mono">{url}/v1/info</span></> : 'Paste a mint URL. https:// is added if missing.'}</p>
      <button className="btn btn-block" type="submit" disabled={pending || !url}>{pending ? 'Checking the mint…' : 'Add mint'}</button>
      {state && (
        <p className="form-msg" role="status">
          <span style={{ marginTop: 2 }}><StateIcon kind={state.error ? 'failed' : 'ok'} /></span>
          <span>{state.error ?? state.ok}</span>
        </p>
      )}
      {state?.ok && <button type="button" className="linkish" onClick={onDone}>Close</button>}
    </form>
  );
}

export function AddMintButton() {
  const ref = useRef<HTMLDialogElement>(null);
  const [session, setSession] = useState(0);
  const open = () => {
    setSession(n => n + 1);
    ref.current?.showModal();
  };
  return (
    <>
      <button type="button" className="btn add-mint" onClick={open} aria-label="Add a mint" title="Add a mint">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        <span className="add-mint-label">Add mint</span>
      </button>
      <dialog ref={ref} className="sheet" aria-labelledby="add-mint-title" onClick={e => e.target === ref.current && ref.current.close()}>
        <div className="sheet-body">
          <div className="sheet-head">
            <div>
              <p className="eyebrow">Track a mint</p>
              <h2 id="add-mint-title" className="h2">Add a mint</h2>
            </div>
            <button type="button" className="sheet-close" aria-label="Close" onClick={() => ref.current?.close()}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          </div>
          <p className="soft small" style={{ margin: '0 0 16px' }}>
            The audit checks <span className="mono">/v1/info</span> before adding. Only public mints are accepted. First checks run within 5 minutes.
          </p>
          {session > 0 && <AddMintForm key={session} onDone={() => ref.current?.close()} />}
        </div>
      </dialog>
    </>
  );
}
