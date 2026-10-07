'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getNostrChallenge, loginWithNostr, requestEmailLogin, startLightningLogin } from '@/app/operators/actions';
import { SITE_URL } from '@/lib/site';

type Nip07 = { signEvent: (e: { kind: number; created_at: number; tags: string[][]; content: string }) => Promise<unknown> };

export default function Login({ email }: { email: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, action, pending] = useActionState(requestEmailLogin, null);
  const [ln, setLn] = useState<{ lnurl: string; qr: string } | null>(null);
  const [lnState, setLnState] = useState<'waiting' | 'expired' | null>(null);

  useEffect(() => {
    if (!ln) return;
    const t = setInterval(async () => {
      const r = await fetch('/api/operator/lnurl-auth/status', { cache: 'no-store' }).then(x => x.json()).catch(() => null);
      if (r?.state === 'ok') {
        clearInterval(t);
        router.refresh();
      } else if (r?.state === 'expired') {
        clearInterval(t);
        setLnState('expired');
      }
    }, 2000);
    return () => clearInterval(t);
  }, [ln, router]);

  const lightning = async () => {
    setError(null);
    setLnState('waiting');
    setLn(await startLightningLogin());
  };

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
      <p className="small soft" style={{ margin: '4px 0 16px' }}>No password. Scan with a Lightning wallet (Phoenix, Zeus, Alby and others), or sign with the Nostr key listed for your mint.</p>
      {ln ? (
        <div className="donate-pay">
          <a href={`lightning:${ln.lnurl}`} aria-label="Open in a Lightning wallet"><div className="qr" role="img" aria-label="Lightning login QR code" dangerouslySetInnerHTML={{ __html: ln.qr }} /></a>
          {lnState === 'expired' ? (
            <p className="donate-status is-expired">The login request expired.</p>
          ) : (
            <p className="donate-status"><span className="pulse" aria-hidden="true" />Scan with a Lightning wallet that supports LNURL-auth</p>
          )}
          <div className="donate-actions">
            <a className="btn" href={`lightning:${ln.lnurl}`}>Open wallet</a>
            <button type="button" className="btn secondary" onClick={() => setLn(null)}>Back</button>
          </div>
        </div>
      ) : (
        <div className="op-login-buttons">
          <button type="button" className="btn btn-block" onClick={lightning}>Sign in with Lightning</button>
          <button type="button" className="btn secondary btn-block" disabled={busy} onClick={nostr}>{busy ? 'Waiting for signature…' : 'Sign in with Nostr'}</button>
        </div>
      )}
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
