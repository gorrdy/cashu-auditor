import type { Metadata } from 'next';
import Link from 'next/link';
import JsonLd from '@/components/JsonLd';
import { getOverview } from '@/lib/stats';
import { mintLabel } from '@/components/format';
import { SITE_URL } from '@/lib/site';
import { ORGANIZATION, breadcrumbs, graph } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'What is Cashu? How to choose a reliable Cashu mint',
  description: 'Cashu is private Chaumian ecash for Bitcoin on the Lightning Network. Learn how Cashu mints work, the risks, and how to pick a reliable mint using live audit data.',
  alternates: { canonical: '/learn' },
  openGraph: { type: 'article' },
};

const FAQ: { q: string; a: string }[] = [
  {
    q: 'What is Cashu?',
    a: 'Cashu is an open-source ecash protocol for Bitcoin. A mint issues digital bearer tokens backed by sats. The tokens are blind-signed, so the mint cannot tell who holds or spends them. Tokens can be sent as text or a QR code, even offline, and are exchanged for Bitcoin over the Lightning Network.',
  },
  {
    q: 'What is a Cashu mint?',
    a: 'A mint is the server that holds the bitcoin and issues and redeems ecash. You deposit by paying a Lightning invoice the mint creates (mint), and withdraw by asking the mint to pay a Lightning invoice for you (melt). Popular mint software is Nutshell (Python) and the Cashu Development Kit, CDK (Rust).',
  },
  {
    q: 'Are Cashu mints safe?',
    a: 'Cashu mints are custodial: the mint operator holds the bitcoin, so a mint can go offline, stop paying or disappear. Cashu gives strong privacy, not protection from the operator. Keep only small amounts in any one mint, spread larger balances across several mints and prefer mints with a long, measured track record.',
  },
  {
    q: 'How do I choose a reliable Cashu mint?',
    a: 'Pick a mint that is consistently online, actually pays out over Lightning, runs up-to-date software and has a contact. This site checks every public mint every 5 minutes and pays real sats into and out of each mint every day. Mints marked Recommended had a full week of working payouts and receipts, at least 99 % uptime and no failure attributed to them.',
  },
  {
    q: 'How does Cashu use the Lightning Network?',
    a: 'Lightning is how value enters and leaves a mint. To get ecash you pay a Lightning invoice from the mint; to spend ecash anywhere on Lightning, or to move it to another mint, the mint pays an invoice for you. A mint that cannot route Lightning payments cannot give you your sats back, which is why this audit tests real payments.',
  },
  {
    q: 'Which wallets support Cashu?',
    a: 'Cashu wallets include Cashu.me (web), Minibits, Macadamia, Sovran and eNuts, and several Nostr and Lightning apps add Cashu too. A wallet can hold ecash from many mints at once, so you can use a few reliable mints side by side.',
  },
  {
    q: 'Can I run my own Cashu mint?',
    a: 'Yes. Run Nutshell or CDK with a Lightning backend. Add your mint to this audit to get a public track record, an embeddable uptime badge and, as an operator, alerts on Nostr, Telegram or push when something breaks.',
  },
];

export default async function Learn() {
  const { mints } = await getOverview();
  const top = mints.filter(m => m.recommended).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 6);
  return (
    <article className="prose">
      <JsonLd
        data={graph(
          { '@type': 'FAQPage', '@id': `${SITE_URL}/learn#faq`, mainEntity: FAQ.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
          { '@type': 'Article', headline: 'What is Cashu? How to choose a reliable Cashu mint', url: `${SITE_URL}/learn`, publisher: ORGANIZATION, about: ['Cashu', 'Ecash', 'Bitcoin', 'Lightning Network'] },
          breadcrumbs([{ name: 'Mints', path: '/' }, { name: 'Learn', path: '/learn' }])
        )}
      />
      <p className="eyebrow">Learn</p>
      <h1 className="h1" style={{ marginTop: 8 }}>Cashu ecash and how to choose a mint</h1>
      <p>
        Cashu brings cash-like privacy to Bitcoin. Your sats live as ecash tokens issued by a mint, and you move them in and
        out over Lightning. Everything depends on the mint, so here is what a mint is, what can go wrong, and how to pick one
        using measured data instead of reputation.
      </p>

      {FAQ.map(f => (
        <section key={f.q}>
          <h2>{f.q}</h2>
          <p>{f.a}</p>
        </section>
      ))}

      {top.length > 0 && (
        <>
          <h2>Recommended Cashu mints right now</h2>
          <p>Updated live from the audit. Each link shows uptime, Lightning payouts and every recorded failure.</p>
          <ul>
            {top.map(m => (
              <li key={m.id}>
                <Link href={`/mint/${m.id}`}>{mintLabel(m)}</Link> · score {m.score} · uptime 30 d {m.uptime30d?.toFixed(2)} %
              </li>
            ))}
          </ul>
          <p><Link href="/">See all mints</Link> or <Link href="/compare">compare mints side by side</Link>.</p>
        </>
      )}

      <h2>How this site measures mints</h2>
      <p>
        Two locations check each mint&apos;s API every 5 minutes. Every day the auditor pays a few sats out of each mint and
        into each mint over Lightning, and records fees, timing and failures. Failures are attributed to a mint only when
        the evidence points there. The full rules are in the <Link href="/methodology">methodology</Link>, and all data is
        open through the API and an MCP server for AI agents.
      </p>
    </article>
  );
}
