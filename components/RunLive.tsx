'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BoltIcon, CoinIcon } from './icons';
import { fundRunToken } from '@/app/actions';
import CopyButton from './CopyButton';

type Owner = { key: string; returnTo: string | null; donate: boolean; token: string | null; status: string; error: string | null };

const ACTIVE = ['invoice', 'queued', 'running', 'paying'];

export function RunRefresh({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!ACTIVE.includes(status)) return;
    let last = '';
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`/api/run/${id}`, { cache: 'no-store' });
        const d = (await r.json()) as { status: string; updatedAt: number };
        const sig = `${d.status}:${d.updatedAt}`;
        if (last && sig !== last) router.refresh();
        last = sig;
      } catch {}
    }, status === 'invoice' ? 3000 : 5000);
    return () => clearInterval(poll);
  }, [id, status, router]);
  return null;
}

export function RunInvoice({ id, request, qr, creq, creqQr, amount, msLeft }: { id: string; request: string; qr: string; creq: string; creqQr: string; amount: number; msLeft: number }) {
  const [tab, setTab] = useState<'lightning' | 'ecash'>('lightning');
  const [left, setLeft] = useState(msLeft);
  const [state, action, pending] = useActionState(fundRunToken.bind(null, id), null);
  const router = useRouter();
  useEffect(() => {
    const end = Date.now() + msLeft;
    const tick = setInterval(() => setLeft(Math.max(0, end - Date.now())), 1000);
    return () => clearInterval(tick);
  }, [msLeft]);
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  const h = Math.floor(left / 3_600_000), m = Math.floor((left % 3_600_000) / 60000), s = Math.floor((left % 60000) / 1000);
  return (
    <div className="card">
      <div className="tabs" role="tablist" aria-label="Payment method">
        <button type="button" role="tab" aria-selected={tab === 'lightning'} onClick={() => setTab('lightning')}><BoltIcon /> Lightning</button>
        <button type="button" role="tab" aria-selected={tab === 'ecash'} onClick={() => setTab('ecash')}><CoinIcon /> Ecash</button>
      </div>
      {tab === 'lightning' ? (
        <div className="donate-pay" role="tabpanel" style={{ marginTop: 16 }}>
          <div className="qr" role="img" aria-label="Lightning invoice QR code" dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="donate-amount">{amount.toLocaleString('en')} <span>sat</span></p>
          <p className="donate-status"><span className="pulse" aria-hidden="true" />Waiting for payment · {h ? `${h} h ${m} min` : `${m}:${String(s).padStart(2, '0')}`}</p>
          <div className="donate-actions">
            <a className="btn" href={`lightning:${request}`}><BoltIcon /> Open wallet</a>
            <CopyButton text={request} label="Copy invoice" className="btn secondary" />
          </div>
        </div>
      ) : (
        <div role="tabpanel" style={{ marginTop: 16 }}>
          <div className="donate-pay">
            <div className="qr" role="img" aria-label="Cashu payment request QR code" dangerouslySetInnerHTML={{ __html: creqQr }} />
            <p className="soft small" style={{ margin: '12px 0 0', textAlign: 'center' }}>
              Scan with a Cashu wallet that supports payment requests, or paste a token below. Ecash from any mint works: the run then starts at that mint.
            </p>
            <div className="donate-actions">
              <a className="btn" href={`cashu:${creq}`}><CoinIcon /> Open wallet</a>
              <CopyButton text={creq} label="Copy request" className="btn secondary" />
            </div>
          </div>
          <div className="donate-or"><span>or paste a token</span></div>
          <form action={action}>
            <label className="sr-only" htmlFor="run-token">Cashu token</label>
            <textarea id="run-token" name="token" className="field mono" placeholder="cashuB…" required rows={2} />
            <button className="btn secondary btn-block" type="submit" disabled={pending} style={{ marginTop: 10 }}>{pending ? 'Redeeming…' : 'Fund the run with this token'}</button>
            {state?.error && <p className="donate-error" role="status">{state.error}</p>}
            {state?.ok && <p className="donate-ok" role="status">{state.ok}</p>}
          </form>
        </div>
      )}
    </div>
  );
}

export function RunOwner({ id }: { id: string }) {
  const [owner, setOwner] = useState<Owner | null>(null);
  useEffect(() => {
    let k = window.location.hash.slice(1);
    try {
      if (k) localStorage.setItem(`run:${id}`, k);
      else k = localStorage.getItem(`run:${id}`) ?? '';
    } catch {}
    if (!k) return;
    fetch(`/api/run/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: k }) })
      .then(r => (r.ok ? r.json() : null))
      .then(d => setOwner(d ? { ...(d as Owner), key: k } : null))
      .catch(() => {});
  }, [id]);
  if (!owner) return null;
  const link = `${window.location.origin}/run/${id}#${owner.key}`;
  return (
    <div className="card run-owner">
      <h2 className="h2">Your run</h2>
      <p className="small soft">Only you see this box. Keep the private link: it is the only way back to the refund token if the Lightning payment fails.</p>
      <dl className="kv">
        <dt>At the end</dt><dd>{owner.donate ? 'Donate to the audit' : <>Pay back to <span className="mono">{owner.returnTo}</span></>}</dd>
        <dt>Private link</dt><dd><CopyButton text={link} label="Copy private link" className="linkish" /></dd>
      </dl>
      {owner.token && (
        <>
          <p className="small" style={{ marginTop: 12 }}>The Lightning payment back did not go through. Claim the rest as a Cashu token in any wallet:</p>
          <p className="donate-code mono" style={{ overflowWrap: 'anywhere' }}>{owner.token.slice(0, 48)}…</p>
          <CopyButton text={owner.token} label="Copy token" className="btn" />
        </>
      )}
    </div>
  );
}
