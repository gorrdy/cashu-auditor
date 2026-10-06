'use client';

import { useActionState, useEffect, useState } from 'react';
import { createInvoice, donateToken } from '@/app/actions';
import CopyField from './CopyField';
import { StateIcon } from './StateBadge';

type Tab = 'lightning' | 'cashu' | 'token';
type Invoice = { id: string; request: string; qr: string; expiresAt: number };
type InvoiceState = 'unpaid' | 'paid' | 'expired';

const PRESETS = [1000, 5000, 21000];

function Note({ kind, children }: { kind: 'ok' | 'failed' | 'pending'; children: React.ReactNode }) {
  return (
    <p className="form-msg" role="status">
      <span style={{ marginTop: 2 }}><StateIcon kind={kind} /></span>
      <span>{children}</span>
    </p>
  );
}

function Qr({ svg, label }: { svg: string; label: string }) {
  return <div className="qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}

function Lightning() {
  const [amount, setAmount] = useState(1000);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [state, setState] = useState<InvoiceState>('unpaid');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (!invoice || state !== 'unpaid') return;
    let stop = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/donate/invoice/${invoice.id}`, { cache: 'no-store' });
        const { state: s } = (await r.json()) as { state: InvoiceState | 'unknown' };
        if (!stop && (s === 'paid' || s === 'expired')) setState(s);
      } catch {}
    };
    const timer = setInterval(poll, 3000);
    const tick = setInterval(() => setLeft(Math.max(0, invoice.expiresAt - Date.now())), 1000);
    return () => {
      stop = true;
      clearInterval(timer);
      clearInterval(tick);
    };
  }, [invoice, state]);

  const create = async () => {
    setBusy(true);
    setError(null);
    const r = await createInvoice(amount).catch(() => ({ error: 'Could not create an invoice.' }));
    setBusy(false);
    if ('error' in r && r.error) return setError(r.error);
    setState('unpaid');
    setLeft(Math.max(0, (r as Invoice).expiresAt - Date.now()));
    setInvoice(r as Invoice);
  };

  if (invoice) {
    const hours = Math.floor(left / 3_600_000), mins = Math.floor((left % 3_600_000) / 60000), secs = Math.floor((left % 60000) / 1000);
    const expires = hours ? `${hours} h ${mins} min` : `${mins}:${String(secs).padStart(2, '0')}`;
    return (
      <div className="donate-pay">
        {state === 'paid' ? (
          <Note kind="ok">Thank you. {amount.toLocaleString('en')} sat received and added to the audit wallet.</Note>
        ) : state === 'expired' ? (
          <Note kind="failed">The invoice expired.</Note>
        ) : (
          <>
            <a href={`lightning:${invoice.request}`} className="qr-link"><Qr svg={invoice.qr} label="Lightning invoice QR code" /></a>
            <Note kind="pending">Waiting for payment · expires in {expires}</Note>
            <CopyField label="Lightning invoice" value={invoice.request} />
          </>
        )}
        <button type="button" className="btn secondary" style={{ marginTop: 12 }} onClick={() => setInvoice(null)}>
          {state === 'paid' ? 'Donate again' : 'New amount'}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="chips" style={{ marginBottom: 10 }}>
        {PRESETS.map(p => (
          <button key={p} type="button" className="btn secondary amount-chip" aria-pressed={amount === p} onClick={() => setAmount(p)}>
            {p.toLocaleString('en')} sat
          </button>
        ))}
      </div>
      <label className="sr-only" htmlFor="ln-amount">Amount in sat</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          id="ln-amount"
          className="field"
          type="number"
          inputMode="numeric"
          min={100}
          max={1000000}
          step={1}
          value={amount || ''}
          onChange={e => setAmount(Math.floor(Number(e.target.value)))}
        />
        <button className="btn nowrap" type="button" disabled={busy || amount < 100} onClick={create}>
          {busy ? 'Creating…' : 'Create invoice'}
        </button>
      </div>
      {error && <Note kind="failed">{error}</Note>}
    </div>
  );
}

function TokenForm() {
  const [state, action, pending] = useActionState(donateToken, null);
  return (
    <form action={action}>
      <label className="sr-only" htmlFor="token">Cashu token</label>
      <textarea id="token" name="token" className="field" placeholder="cashuB…" required rows={3} />
      <div style={{ marginTop: 12 }}>
        <button className="btn" type="submit" disabled={pending}>{pending ? 'Redeeming…' : 'Donate token'}</button>
      </div>
      {state && <Note kind={state.error ? 'failed' : 'ok'}>{state.error ?? state.ok}</Note>}
    </form>
  );
}

export default function Donate({ cashuRequest, cashuQr }: { cashuRequest: string; cashuQr: string }) {
  const [tab, setTab] = useState<Tab>('lightning');
  return (
    <div className="card">
      <h2 className="h2">Fund the audit</h2>
      <p className="soft small" style={{ margin: '4px 0 14px' }}>
        Swaps are paid from donated sats. Everything received goes into real swaps between mints.
      </p>
      <div className="segmented" role="group" aria-label="Payment method" style={{ marginBottom: 16 }}>
        {(['lightning', 'cashu', 'token'] as const).map(t => (
          <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t === 'lightning' ? 'Lightning' : t === 'cashu' ? 'Cashu request' : 'Paste token'}
          </button>
        ))}
      </div>
      {tab === 'lightning' && <Lightning />}
      {tab === 'cashu' && (
        <div className="donate-pay">
          <a href={`cashu:${cashuRequest}`} className="qr-link"><Qr svg={cashuQr} label="Cashu payment request QR code" /></a>
          <p className="soft small" style={{ margin: '10px 0 0' }}>
            Scan with a wallet that supports payment requests (NUT-18). Any amount, sat from any mint.
          </p>
          <CopyField label="Payment request" value={cashuRequest} />
        </div>
      )}
      {tab === 'token' && <TokenForm />}
    </div>
  );
}
