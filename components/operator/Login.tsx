'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getNostrChallenge, loginWithNostr, requestEmailLogin } from '@/app/operators/actions';
import { SITE_URL } from '@/lib/site';

type Nip07 = { signEvent: (e: { kind: number; created_at: number; tags: string[][]; content: string }) => Promise<unknown> };

export default function Login({ email }: { email: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, action, pending] = useActionState(requestEmailLogin, null);

  const nostr = async () => {
    setError(null);
    const signer = (window as unknown as { nostr?: Nip07 }).nostr;
    if (!signer) return setError('No Nostr signer found. Install a browser extension such as Alby or nos2x, then reload.');
    setBusy(true);
    try {
      const challenge = await getNostrChallenge();
      const event = await signer.signEvent({
        kind: 27235,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['u', `${SITE_URL}/operators`], ['method', 'POST'], ['challenge', challenge]],
        content: '',
      });
      const r = await loginWithNostr(challenge, event);
      if (r.error) setError(r.error);
      else router.refresh();
    } catch {
      setError('Signing was cancelled.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card op-login">
      <h2 className="h2">Sign in</h2>
      <p className="small soft" style={{ margin: '4px 0 16px' }}>No password. Use the Nostr key listed for your mint, or an email address.</p>
      <button type="button" className="btn btn-block" disabled={busy} onClick={nostr}>{busy ? 'Waiting for signature…' : 'Sign in with Nostr'}</button>
      {error && <p className="donate-error" role="status">{error}</p>}
      {email && (
        <>
          <div className="donate-or"><span>or by email</span></div>
          <form action={action} className="op-add-row">
            <label className="sr-only" htmlFor="op-email">Email</label>
            <input id="op-email" name="email" type="email" className="field" placeholder="you@example.com" required autoComplete="email" />
            <button type="submit" className="btn secondary" disabled={pending}>{pending ? 'Sending…' : 'Send link'}</button>
          </form>
          {state && <p className={state.error ? 'donate-error' : 'donate-ok'} role="status">{state.error ?? state.ok}</p>}
        </>
      )}
    </div>
  );
}
