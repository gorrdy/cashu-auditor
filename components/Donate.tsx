'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { createInvoice, donateToken } from '@/app/actions';
import { BoltIcon, CoinIcon } from './icons';

type Tab = 'lightning' | 'ecash';
type Invoice = { id: string; request: string; qr: string; expiresAt: number; amount: number };
type InvoiceState = 'unpaid' | 'paid' | 'expired';

const PRESETS = [1000, 5000, 21000];
const OPEN_EVENT = 'donate:open';

export function DonateButton({ tab = 'lightning', className = 'btn', children }: { tab?: Tab; className?: string; children: React.ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: tab }))}>
      {children}
    </button>
  );
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1500);
    } catch {}
  };
  return { copied, copy };
}

const short = (s: string) => (s.length > 34 ? `${s.slice(0, 18)}…${s.slice(-12)}` : s);

function Qr({ svg, label }: { svg: string; label: string }) {
  return <div className="qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}

function Lightning() {
  const [amount, setAmount] = useState(5000);
  const [custom, setCustom] = useState(false);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [state, setState] = useState<InvoiceState>('unpaid');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  const { copied, copy } = useCopy();

  useEffect(() => {
    if (!invoice || state !== 'unpaid') return;
    let stop = false;
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`/api/donate/invoice/${invoice.id}`, { cache: 'no-store' });
        const { state: s } = (await r.json()) as { state: InvoiceState | 'unknown' };
        if (!stop && (s === 'paid' || s === 'expired')) setState(s);
      } catch {}
    }, 3000);
    const tick = setInterval(() => setLeft(Math.max(0, invoice.expiresAt - Date.now())), 1000);
    return () => {
      stop = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [invoice, state]);

  const create = async () => {
    setBusy(true);
    setError(null);
    const r = await createInvoice(amount).catch(() => ({ error: 'Could not create an invoice.' }));
    setBusy(false);
    if ('error' in r && r.error) return setError(r.error);
    const inv = { ...(r as Omit<Invoice, 'amount'>), amount };
    setState('unpaid');
    setLeft(Math.max(0, inv.expiresAt - Date.now()));
    setInvoice(inv);
  };

  if (invoice && state === 'paid') {
    return (
      <div className="donate-done">
        <span className="donate-done-mark" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 16 16"><path d="m3.5 8.4 3 3 6-6.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <p className="donate-done-title">{invoice.amount.toLocaleString('en')} sat received</p>
        <p className="soft small" style={{ margin: 0 }}>Thank you. It goes straight into the next swaps.</p>
        <button type="button" className="btn secondary" style={{ marginTop: 20 }} onClick={() => setInvoice(null)}>Donate again</button>
      </div>
    );
  }

  if (invoice) {
    const h = Math.floor(left / 3_600_000), m = Math.floor((left % 3_600_000) / 60000), s = Math.floor((left % 60000) / 1000);
    const expires = h ? `${h} h ${m} min` : `${m}:${String(s).padStart(2, '0')}`;
    return (
      <div className="donate-pay">
        <Qr svg={invoice.qr} label="Lightning invoice QR code" />
        <p className="donate-amount">{invoice.amount.toLocaleString('en')} <span>sat</span></p>
        {state === 'expired' ? (
          <p className="donate-status is-expired">Invoice expired</p>
        ) : (
          <p className="donate-status"><span className="pulse" aria-hidden="true" />Waiting for payment · {expires}</p>
        )}
        <div className="donate-actions">
          <a className="btn" href={`lightning:${invoice.request}`}><BoltIcon /> Open wallet</a>
          <button type="button" className="btn secondary" onClick={() => copy('ln', invoice.request)}>{copied === 'ln' ? 'Copied' : 'Copy invoice'}</button>
        </div>
        <p className="donate-code mono" title={invoice.request}>{short(invoice.request)}</p>
        <button type="button" className="linkish" onClick={() => setInvoice(null)}>Change amount</button>
      </div>
    );
  }

  return (
    <div>
      <div className="amount-grid" role="radiogroup" aria-label="Amount">
        {PRESETS.map(p => (
          <button key={p} type="button" role="radio" aria-checked={!custom && amount === p} className="amount-tile" onClick={() => { setCustom(false); setAmount(p); }}>
            <b>{p.toLocaleString('en')}</b><span>sat</span>
          </button>
        ))}
        <button type="button" role="radio" aria-checked={custom} className="amount-tile" onClick={() => setCustom(true)}>
          <b>Other</b><span>amount</span>
        </button>
      </div>
      {custom && (
        <label className="amount-input">
          <span className="sr-only">Amount in sat</span>
          <input
            className="field"
            type="number"
            inputMode="numeric"
            min={100}
            max={1000000}
            autoFocus
            value={amount || ''}
            onChange={e => setAmount(Math.floor(Number(e.target.value)))}
          />
          <span className="amount-unit">sat</span>
        </label>
      )}
      <button className="btn btn-block" type="button" disabled={busy || amount < 100} onClick={create} style={{ marginTop: 16 }}>
        <BoltIcon /> {busy ? 'Creating invoice…' : `Pay ${amount >= 100 ? amount.toLocaleString('en') : '…'} sat`}
      </button>
      {error && <p className="donate-error" role="status">{error}</p>}
    </div>
  );
}

function Ecash({ request, qr }: { request: string; qr: string }) {
  const [state, action, pending] = useActionState(donateToken, null);
  const { copied, copy } = useCopy();
  return (
    <div>
      <div className="donate-pay">
        <Qr svg={qr} label="Cashu payment request QR code" />
        <p className="soft small" style={{ margin: '12px 0 0', textAlign: 'center' }}>
          Scan with a Cashu wallet that supports payment requests. Any amount, sat from any mint.
        </p>
        <div className="donate-actions">
          <a className="btn" href={`cashu:${request}`}><CoinIcon /> Open wallet</a>
          <button type="button" className="btn secondary" onClick={() => copy('creq', request)}>{copied === 'creq' ? 'Copied' : 'Copy request'}</button>
        </div>
      </div>
      <div className="donate-or"><span>or paste a token</span></div>
      <form action={action}>
        <label className="sr-only" htmlFor="token">Cashu token</label>
        <textarea id="token" name="token" className="field mono" placeholder="cashuB…" required rows={2} />
        <button className="btn secondary btn-block" type="submit" disabled={pending} style={{ marginTop: 10 }}>{pending ? 'Redeeming…' : 'Redeem token'}</button>
        {state?.error && <p className="donate-error" role="status">{state.error}</p>}
        {state?.ok && <p className="donate-ok" role="status">{state.ok}</p>}
      </form>
    </div>
  );
}

export default function DonateDialog({ cashuRequest, cashuQr }: { cashuRequest: string; cashuQr: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>('lightning');
  const [session, setSession] = useState(0);

  useEffect(() => {
    const open = (e: Event) => {
      setTab((e as CustomEvent<Tab | undefined>).detail ?? 'lightning');
      if (!ref.current?.open) setSession(n => n + 1);
      ref.current?.showModal();
    };
    window.addEventListener(OPEN_EVENT, open);
    if (window.location.hash === '#donate') open(new CustomEvent(OPEN_EVENT));
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);

  return (
    <dialog ref={ref} className="sheet" aria-labelledby="donate-title" onClick={e => e.target === ref.current && ref.current.close()}>
      <div className="sheet-body">
        <div className="sheet-head">
          <div>
            <p className="eyebrow">Support</p>
            <h2 id="donate-title" className="h2">Fund the audit</h2>
          </div>
          <button type="button" className="sheet-close" aria-label="Close" onClick={() => ref.current?.close()}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>
        <p className="soft small" style={{ margin: '0 0 16px' }}>
          Every swap moves real sats between mints and pays real Lightning fees. Donations are what the audit spends.
        </p>
        <div className="tabs" role="tablist" aria-label="Payment method">
          <button type="button" role="tab" aria-selected={tab === 'lightning'} onClick={() => setTab('lightning')}><BoltIcon /> Lightning</button>
          <button type="button" role="tab" aria-selected={tab === 'ecash'} onClick={() => setTab('ecash')}><CoinIcon /> Ecash</button>
        </div>
        {session > 0 && (
          <div key={session} style={{ marginTop: 20 }}>
            <div hidden={tab !== 'lightning'}><Lightning /></div>
            <div hidden={tab !== 'ecash'}><Ecash request={cashuRequest} qr={cashuQr} /></div>
          </div>
        )}
      </div>
    </dialog>
  );
}
