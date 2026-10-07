'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteAccount, newAvatar, updateProfileName } from '@/app/operators/actions';

export default function Profile({ name, identity, avatar, method, since }: { name: string; identity: string; avatar: string; method: string; since: string }) {
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
