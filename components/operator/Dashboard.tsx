'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import CopyButton from '@/components/CopyButton';
import {
  addNostrChannel, checkSubscriptionInvoice, claimMint, createSubscriptionInvoice, logout, paySubscriptionWithToken,
  removeChannel, removeClaim, savePrefs, savePushSubscription, sendTestNotification, telegramLink, verifyClaimAction,
} from '@/app/operators/actions';

type Method = 'nostr' | 'node' | 'motd' | 'dns';
type Prefs = { events: Record<string, boolean>; offlineMinutes: number };
export type ClaimView = {
  id: string;
  mintId: string;
  name: string;
  url: string;
  host: string;
  method: Method;
  code: string;
  verified: boolean;
  paidUntil: number | null;
  active: boolean;
  prefs: Prefs;
  contacts: { nostr: string[]; email: string[] };
  lnPubkey: string | null;
};
export type ChannelView = { id: string; kind: string; label: string };
type Available = { nostr: boolean; telegram: boolean; push: boolean; email: boolean };

const METHOD_LABEL: Record<Method, string> = { nostr: 'Nostr contact', node: 'Lightning node', motd: 'Code in mint info', dns: 'DNS record' };
const PERIODS = [1, 3, 6, 12];
const PRICE = 1000;

function Note({ r }: { r: { ok?: string; error?: string } | null }) {
  if (!r) return null;
  return <p className={r.error ? 'donate-error' : 'donate-ok'} role="status">{r.error ?? r.ok}</p>;
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="op-code">
      <code>{text}</code>
      <button type="button" className="linkish" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch {} }}>{done ? 'Copied' : 'Copy'}</button>
    </span>
  );
}

function Verify({ claim, operatorNpub }: { claim: ClaimView; operatorNpub: string | null }) {
  const [method, setMethod] = useState<Method>(claim.method);
  const [signature, setSignature] = useState('');
  const [result, setResult] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const code = `cashu-audit-verify=${claim.code}`;
  const run = () => start(async () => setResult(await verifyClaimAction(claim.id, method, method === 'node' ? signature : undefined)));
  return (
    <div className="op-verify">
      <div className="tabs op-tabs" role="tablist" aria-label="Verification method">
        {(['nostr', 'node', 'motd', 'dns'] as Method[]).filter(m => m !== 'node' || !!claim.lnPubkey).map(m => (
          <button key={m} type="button" role="tab" aria-selected={method === m} onClick={() => { setMethod(m); setResult(null); }}>
            {METHOD_LABEL[m]}{m === claim.method && <span className="op-rec">recommended</span>}
          </button>
        ))}
      </div>
      <div className="op-steps">
        {method === 'nostr' && (
          <>
            <p>Your npub must be listed as a <span className="mono">nostr</span> contact in the mint&apos;s <span className="mono">/v1/info</span>.</p>
            {claim.contacts.nostr.length ? <p className="small soft">Listed now: {claim.contacts.nostr.map(n => <span key={n} className="mono"> {n.slice(0, 12)}…</span>)}</p> : <p className="small soft">The mint lists no nostr contact yet. Add yours to the mint&apos;s info, or use another method.</p>}
            {!operatorNpub && <p className="small soft">Sign in with Nostr to use this method.</p>}
          </>
        )}
        {method === 'node' && claim.lnPubkey && (
          <>
            <p>Sign the code with the Lightning node that receives the mint&apos;s payments, then paste the signature.</p>
            <p className="small soft">The mint&apos;s invoices come from node <span className="mono">{claim.lnPubkey.slice(0, 20)}…</span></p>
            <p className="small soft">LND</p>
            <Copy text={`lncli signmessage ${code}`} />
            <p className="small soft">Core Lightning (use the zbase value)</p>
            <Copy text={`lightning-cli signmessage ${code}`} />
            <textarea className="field mono" rows={2} placeholder="Signature" value={signature} onChange={e => setSignature(e.target.value)} aria-label="Signature" />
          </>
        )}
        {method === 'motd' && (
          <>
            <p>Put this code into the mint&apos;s MOTD or description, wait for the mint to restart, then verify. Remove it afterwards.</p>
            <Copy text={code} />
            <p className="small soft">Nutshell: <span className="mono">MINT_INFO_MOTD</span> in <span className="mono">.env</span>. cdk-mintd: <span className="mono">motd</span> under <span className="mono">[mint_info]</span> in the config.</p>
          </>
        )}
        {method === 'dns' && (
          <>
            <p>Add a TXT record on the mint&apos;s domain, then verify. Remove it afterwards.</p>
            <p className="small soft">Name</p>
            <Copy text={`_cashu-audit.${claim.host}`} />
            <p className="small soft">Value</p>
            <Copy text={code} />
          </>
        )}
        <button type="button" className="btn" disabled={pending || (method === 'nostr' && !operatorNpub) || (method === 'node' && !signature.trim())} onClick={run}>
          {pending ? 'Checking…' : 'Verify'}
        </button>
        <Note r={result} />
      </div>
    </div>
  );
}

function Subscription({ claim }: { claim: ClaimView }) {
  const router = useRouter();
  const [months, setMonths] = useState(1);
  const [invoice, setInvoice] = useState<{ id: string; request: string; qr: string; amount: number } | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [result, setResult] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!invoice) return;
    const t = setInterval(async () => {
      const s = await checkSubscriptionInvoice(invoice.id).catch(() => 'unpaid');
      if (s === 'paid' || s === 'expired') {
        setState(s);
        clearInterval(t);
        if (s === 'paid') router.refresh();
      }
    }, 3000);
    return () => clearInterval(t);
  }, [invoice, router]);

  const active = claim.active;
  return (
    <div className="op-sub">
      <p className="op-sub-state">
        {active ? <>Alerts active until <strong>{new Date(claim.paidUntil!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</strong></> : <>Alerts are <strong>not active</strong>. {PRICE.toLocaleString('en')} sat per month.</>}
      </p>
      {invoice && state !== 'paid' ? (
        <div className="donate-pay">
          <div className="qr" role="img" aria-label="Lightning invoice QR code" dangerouslySetInnerHTML={{ __html: invoice.qr }} />
          <p className="donate-amount">{invoice.amount.toLocaleString('en')} <span>sat</span></p>
          <p className="donate-status">{state === 'expired' ? 'Invoice expired' : <><span className="pulse" aria-hidden="true" />Waiting for payment</>}</p>
          <div className="donate-actions">
            <a className="btn" href={`lightning:${invoice.request}`}>Open wallet</a>
            <CopyButton text={invoice.request} label="Copy invoice" />
          </div>
          <button type="button" className="linkish" onClick={() => setInvoice(null)}>Cancel</button>
        </div>
      ) : (
        <>
          <div className="op-periods" role="group" aria-label="Period">
            {PERIODS.map(p => (
              <button key={p} type="button" className="amount-tile" aria-pressed={months === p} onClick={() => setMonths(p)}>
                <b>{p} {p === 1 ? 'month' : 'months'}</b><span>{(p * PRICE).toLocaleString('en')} sat</span>
              </button>
            ))}
          </div>
          <button type="button" className="btn" disabled={pending} onClick={() => start(async () => {
            const r = await createSubscriptionInvoice(claim.id, months);
            if ('error' in r && r.error) setResult({ error: r.error });
            else { setState(null); setInvoice(r as { id: string; request: string; qr: string; amount: number }); }
          })}>{pending ? 'Creating invoice…' : `Pay ${(months * PRICE).toLocaleString('en')} sat with Lightning`}</button>
          <details className="op-token">
            <summary>Pay with a Cashu token</summary>
            <textarea className="field mono" rows={2} placeholder="cashuB…" value={token} onChange={e => setToken(e.target.value)} />
            <button type="button" className="btn secondary" disabled={pending || !token.trim()} onClick={() => start(async () => { setResult(await paySubscriptionWithToken(claim.id, token)); setToken(''); })}>Redeem token</button>
          </details>
        </>
      )}
      {state === 'paid' && <p className="donate-ok">Paid. Thank you.</p>}
      <Note r={result} />
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  offline: 'Mint goes offline',
  degraded: 'No active sat keyset',
  swapfail: 'A swap fails at the mint',
  stuck: 'Outgoing payment stuck for an hour',
  unpaid: 'Payment received, no ecash issued',
  outdated: 'Software is outdated',
  tls: 'TLS certificate expires within 14 days',
};

function Preferences({ claim }: { claim: ClaimView }) {
  const [events, setEvents] = useState(claim.prefs.events);
  const [minutes, setMinutes] = useState(claim.prefs.offlineMinutes);
  const [result, setResult] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="op-prefs">
      {Object.keys(EVENT_LABEL).map(k => (
        <label key={k} className="op-check">
          <input type="checkbox" checked={!!events[k]} onChange={e => setEvents({ ...events, [k]: e.target.checked })} />
          {EVENT_LABEL[k]}
          {k === 'offline' && events.offline && (
            <span className="small soft"> after <input className="field op-minutes" type="number" min={5} max={1440} value={minutes} onChange={e => setMinutes(Number(e.target.value))} aria-label="Minutes offline before an alert" /> min</span>
          )}
        </label>
      ))}
      <button type="button" className="btn secondary" disabled={pending} onClick={() => start(async () => setResult(await savePrefs(claim.id, events, minutes)))}>Save alerts</button>
      <Note r={result} />
    </div>
  );
}

function ClaimCard({ claim, operatorNpub }: { claim: ClaimView; operatorNpub: string | null }) {
  const [pending, start] = useTransition();
  const active = claim.verified && claim.active;
  return (
    <div className="card op-claim">
      <div className="op-claim-head">
        <div>
          <Link href={`/mint/${claim.mintId}`} className="op-claim-name">{claim.name}</Link>
          <div className="url mono small muted">{claim.host}</div>
        </div>
        <span className={`op-status ${active ? 'is-on' : claim.verified ? 'is-off' : 'is-pending'}`}>{active ? 'Alerts on' : claim.verified ? 'Verified' : 'Not verified'}</span>
      </div>
      {!claim.verified ? <Verify claim={claim} operatorNpub={operatorNpub} /> : (
        <>
          <Subscription claim={claim} />
          <h3 className="op-sub-title">Alerts</h3>
          <Preferences claim={claim} />
        </>
      )}
      <button type="button" className="linkish op-remove" disabled={pending} onClick={() => confirm('Remove this mint from your account?') && start(() => removeClaim(claim.id))}>Remove</button>
    </div>
  );
}

function ClaimForm({ options, preselect }: { options: { id: string; label: string }[]; preselect: string | null }) {
  const [mintId, setMintId] = useState(preselect ?? '');
  const [result, setResult] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="card op-add">
      <h3 className="h2">Add your mint</h3>
      <div className="op-add-row">
        <select className="field" value={mintId} onChange={e => setMintId(e.target.value)} aria-label="Mint">
          <option value="">Choose a mint</option>
          {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <button type="button" className="btn" disabled={pending || !mintId} onClick={() => start(async () => setResult(await claimMint(mintId)))}>Claim</button>
      </div>
      <p className="small soft" style={{ margin: '8px 0 0' }}>Not listed? <Link href="/#mints">Add the mint to the audit</Link> first.</p>
      <Note r={result} />
    </div>
  );
}

function base64ToBytes(b64: string) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

function Channels({ channels, available, vapidKey }: { channels: ChannelView[]; available: Available; vapidKey: string | null }) {
  const [npub, setNpub] = useState('');
  const [result, setResult] = useState<{ ok?: string; error?: string } | null>(null);
  const [tests, setTests] = useState<{ kind: string; ok: boolean; error?: string }[] | null>(null);
  const [pending, start] = useTransition();

  const enablePush = () => start(async () => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return setResult({ error: 'This browser has no push support. On iPhone, add the site to the home screen first.' });
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(vapidKey!) });
      setResult(await savePushSubscription(JSON.stringify(sub)));
    } catch {
      setResult({ error: 'Notifications were not allowed.' });
    }
  });

  return (
    <div className="card">
      <h2 className="h2">Where alerts go</h2>
      <p className="small soft" style={{ margin: '4px 0 16px' }}>Every channel gets every alert of every mint on your account.</p>
      {channels.length === 0 ? <p className="small muted">No channel yet.</p> : (
        <ul className="op-channels">
          {channels.map(c => (
            <li key={c.id}>
              <span className="op-kind">{c.kind}</span>
              <span className="op-target">{c.label}</span>
              <button type="button" className="linkish" onClick={() => start(() => removeChannel(c.id))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div className="op-add-channels">
        <div className="op-channel">
          <strong>Nostr</strong>
          {available.nostr ? (
            <div className="op-add-row">
              <input className="field" placeholder="npub1…" value={npub} onChange={e => setNpub(e.target.value)} aria-label="npub" />
              <button type="button" className="btn secondary" disabled={pending || !npub.trim()} onClick={() => start(async () => { setResult(await addNostrChannel(npub)); setNpub(''); })}>Add</button>
            </div>
          ) : <span className="small muted">Coming soon</span>}
        </div>
        <div className="op-channel">
          <strong>Telegram</strong>
          {available.telegram ? (
            <button type="button" className="btn secondary" disabled={pending} onClick={() => start(async () => { const r = await telegramLink(); if (r.url) window.open(r.url, '_blank', 'noopener'); else setResult(r); })}>Connect Telegram</button>
          ) : <span className="small muted">Coming soon</span>}
        </div>
        <div className="op-channel">
          <strong>Push on this device</strong>
          {available.push && vapidKey ? <button type="button" className="btn secondary" disabled={pending} onClick={enablePush}>Enable notifications</button> : <span className="small muted">Coming soon</span>}
        </div>
      </div>
      {channels.length > 0 && (
        <button type="button" className="btn secondary" style={{ marginTop: 16 }} disabled={pending} onClick={() => start(async () => setTests(await sendTestNotification()))}>Send a test alert</button>
      )}
      {tests && <ul className="op-tests">{tests.map((t, i) => <li key={i} className={t.ok ? 'donate-ok' : 'donate-error'}>{t.kind}: {t.ok ? 'sent' : t.error}</li>)}</ul>}
      <Note r={result} />
    </div>
  );
}

export default function Dashboard({ who, claims, channels, options, preselect, available, vapidKey, operatorNpub }: {
  who: string;
  claims: ClaimView[];
  channels: ChannelView[];
  options: { id: string; label: string }[];
  preselect: string | null;
  available: Available;
  vapidKey: string | null;
  operatorNpub: string | null;
}) {
  const [pending, start] = useTransition();
  return (
    <>
      <div className="op-who">
        <span className="small soft">Signed in as <span className="mono">{who}</span></span>
        <button type="button" className="linkish" disabled={pending} onClick={() => start(() => logout())}>Sign out</button>
      </div>
      <section className="section">
        <div className="section-head"><h2 className="h2">Your mints</h2></div>
        <div className="op-grid">
          {claims.map(c => <ClaimCard key={c.id} claim={c} operatorNpub={operatorNpub} />)}
          <ClaimForm options={options} preselect={preselect} />
        </div>
      </section>
      <section className="section">
        <Channels channels={channels} available={available} vapidKey={vapidKey} />
      </section>
    </>
  );
}
