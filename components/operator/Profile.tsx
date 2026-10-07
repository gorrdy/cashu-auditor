'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addPasskey, deleteAccount, newAvatar, passkeyRegistrationOptions, removePasskey, updateProfileName } from '@/app/operators/actions';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';

type PasskeyView = { id: string; label: string; created: string; lastUsed: string | null };

function guessLabel() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'iPhone or iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Passkey';
}

function Passkeys({ passkeys }: { passkeys: PasskeyView[] }) {
  const router = useRouter();
  const [result, setResult] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const add = () => start(async () => {
    setResult(null);
    if (!browserSupportsWebAuthn()) return setResult({ error: 'This browser does not support passkeys.' });
    try {
      const response = await startRegistration({ optionsJSON: await passkeyRegistrationOptions() });
      setResult(await addPasskey(response, guessLabel()));
      router.refresh();
    } catch {
      setResult({ error: 'Creating the passkey was cancelled.' });
    }
  });
  return (
    <div className="card">
      <h2 className="h2">Passkeys</h2>
      <p className="small soft" style={{ margin: '4px 0 14px' }}>Sign in with Face ID, Touch ID, Windows Hello or a security key instead of your wallet or Nostr signer.</p>
      {passkeys.length > 0 && (
        <ul className="op-channels">
          {passkeys.map(p => (
            <li key={p.id}>
              <span className="op-kind">Passkey</span>
              <span className="op-target" style={{ fontFamily: 'inherit' }}>{p.label} · added {p.created}{p.lastUsed ? ` · used ${p.lastUsed}` : ''}</span>
              <button type="button" className="linkish" disabled={pending} onClick={() => confirm('Remove this passkey?') && start(async () => { await removePasskey(p.id); router.refresh(); })}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn" disabled={pending} onClick={add}>{pending ? 'Waiting for the device…' : 'Add a passkey'}</button>
      {result && <p className={result.error ? 'donate-error' : 'donate-ok'} role="status">{result.error ?? result.ok}</p>}
    </div>
  );
}

export default function Profile({ name, identity, avatar, method, since, passkeys }: { name: string; identity: string; avatar: string; method: string; since: string; passkeys: PasskeyView[] }) {
  const router = useRouter();
  const [value, setValue] = useState(name === identity ? '' : name);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="op-grid">
      <div className="card profile-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatar} alt="" width={112} height={112} className="profile-avatar" />
        <button type="button" className="btn secondary" disabled={pending} onClick={() => start(async () => { await newAvatar(); router.refresh(); })}>New avatar</button>
        <label className="profile-field">
          <span className="small soft">Display name</span>
          <div className="op-add-row">
            <input className="field" maxLength={40} placeholder={identity} value={value} onChange={e => { setValue(e.target.value); setSaved(null); }} />
            <button type="button" className="btn" disabled={pending} onClick={() => start(async () => { const r = await updateProfileName(value); setSaved(r.ok ?? null); router.refresh(); })}>Save</button>
          </div>
        </label>
        {saved && <p className="donate-ok">{saved}</p>}
      </div>
      <Passkeys passkeys={passkeys} />
      <div className="card">
        <h2 className="h2">Sign-in</h2>
        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>Method</dt><dd>{method}</dd>
          <dt>Identity</dt><dd className="mono" style={{ overflowWrap: 'anywhere' }}>{identity}</dd>
          <dt>Member since</dt><dd>{since}</dd>
        </dl>
        <h2 className="h2" style={{ marginTop: 28 }}>Delete account</h2>
        <p className="small soft" style={{ margin: '4px 0 12px' }}>Removes your claims, alert settings and channels. Paid time is not refunded.</p>
        <button type="button" className="btn secondary" disabled={pending} onClick={() => confirm('Delete your account, claims and alert channels?') && start(async () => { await deleteAccount(); router.push('/operators'); })}>Delete account</button>
      </div>
    </div>
  );
}
