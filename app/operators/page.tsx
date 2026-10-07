import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { currentOperator } from '@/lib/operator/session';
import { npubOf } from '@/lib/operator/nostr';
import { mintContacts } from '@/lib/operator/claims';
import { msatToSat, PRICE_PER_MONTH } from '@/lib/operator/billing';
import { channelsAvailable } from '@/lib/notify/channels';
import { parsePrefs } from '@/lib/notify/events';
import { isMintId } from '@/lib/mintUrl';
import { hostOf } from '@/components/format';
import Login from '@/components/operator/Login';
import Dashboard, { type ClaimView } from '@/components/operator/Dashboard';

export const metadata: Metadata = { title: 'For mint operators' };

const STATUS: Record<string, { ok?: string; error?: string }> = {
  'signed-in': { ok: 'You are signed in.' },
  verified: { ok: 'The mint is verified. Choose a plan below to turn alerts on.' },
  'invalid-link': { error: 'This link is invalid or has expired.' },
};

const isActive = (paidUntil: Date | null) => !!paidUntil && paidUntil.getTime() > Date.now();

const FEATURES = [
  ['Offline and recovered', 'An alert when /v1/info stops answering, after the delay you choose, and another when it is back.'],
  ['Money problems', 'Outgoing Lightning payments stuck for an hour, and payments received without issuing ecash.'],
  ['Swap failures', 'When a real swap fails at your mint, with the stage and the error.'],
  ['Maintenance', 'Outdated software, a missing sat keyset and a TLS certificate about to expire.'],
];

export default async function Operators({ searchParams }: { searchParams: Promise<{ claim?: string; status?: string }> }) {
  const params = await searchParams;
  const operator = await currentOperator();
  const available = channelsAvailable();
  const status = params.status ? STATUS[params.status] : null;
  const preselect = params.claim && isMintId(params.claim) ? params.claim : null;

  let dashboard = null;
  if (operator) {
    const [claims, channels, mints] = await Promise.all([
      prisma.mintClaim.findMany({ where: { operatorId: operator.id }, orderBy: { createdAt: 'asc' } }),
      prisma.notifyChannel.findMany({ where: { operatorId: operator.id }, orderBy: { createdAt: 'asc' } }),
      prisma.mint.findMany({ where: { aliasOfId: null, isTest: false }, select: { id: true, name: true, url: true, contact: true, lnPubkey: true }, orderBy: { url: 'asc' } }),
    ]);
    const byId = new Map(mints.map(m => [m.id, m]));
    const views: ClaimView[] = claims.flatMap(c => {
      const m = byId.get(c.mintId);
      if (!m) return [];
      return [{
        id: c.id, mintId: c.mintId, name: m.name ?? hostOf(m.url), url: m.url, host: new URL(m.url).hostname,
        method: c.method as ClaimView['method'], code: c.code, verified: !!c.verifiedAt, paidUntil: c.paidUntil?.getTime() ?? null, active: isActive(c.paidUntil), alerts: c.alerts,
        prefs: parsePrefs(c.prefs), lnPubkey: m.lnPubkey, contacts: (() => { const k = mintContacts(m.contact); return { nostr: k.nostr.map(npubOf), email: k.email }; })(),
      }];
    });
    const label = (kind: string, target: string, l: string | null) => l && kind !== 'nostr' ? l : kind === 'nostr' ? `${npubOf(target).slice(0, 16)}…` : kind === 'push' ? 'Device' : target;
    dashboard = (
      <Dashboard
        who={operator.pubkey ? `${npubOf(operator.pubkey).slice(0, 20)}…` : operator.email ?? (operator.lnKey ? `Lightning key ${operator.lnKey.slice(0, 16)}…` : '')}
        operatorNpub={operator.pubkey ? npubOf(operator.pubkey) : null}
        claims={views}
        channels={channels.map(c => ({ id: c.id, kind: c.kind, label: label(c.kind, c.target, c.label) }))}
        options={mints.filter(m => !claims.some(c => c.mintId === m.id)).map(m => ({ id: m.id, label: m.name ?? hostOf(m.url) }))}
        preselect={preselect}
        available={available}
        vapidKey={process.env.VAPID_PUBLIC_KEY ?? null}
        balance={msatToSat(operator.balanceMsat)}
      />
    );
  }

  return (
    <>
      <p className="eyebrow">For mint operators</p>
      <h1 className="h1" style={{ marginTop: 8 }}>Hear about problems before your users do</h1>
      <p className="soft" style={{ margin: '10px 0 0', maxWidth: 720 }}>
        Claim your mint, prove you run it, and get alerts from the audit on Nostr, Telegram or as push notifications.
        {' '}{PRICE_PER_MONTH.toLocaleString('en')} sat per mint per month, charged daily from a balance you top up over Lightning or with ecash.
      </p>
      {status && <p className={status.error ? 'donate-error' : 'donate-ok'} role="status" style={{ marginTop: 16 }}>{status.error ?? status.ok}</p>}
      {dashboard ?? (
        <section className="section op-intro">
          <ul className="op-features">
            {FEATURES.map(([t, d]) => <li key={t} className="card"><strong>{t}</strong><span className="small soft">{d}</span></li>)}
          </ul>
          <Login email={available.email} />
        </section>
      )}
    </>
  );
}
