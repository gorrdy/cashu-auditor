import Link from 'next/link';
import type { Metadata } from 'next';
import StateBadge from '@/components/StateBadge';

export const metadata: Metadata = {
  title: 'Methodology: how Cashu mints are audited',
  description: 'How Cashu Mints Auditor checks mint availability every 5 minutes, pays real sats over Lightning every day, attributes failures and scores and recommends mints.',
  alternates: { canonical: '/methodology' },
};

export default function Methodology() {
  return (
    <article className="prose">
      <p className="eyebrow">Methodology</p>
      <h1 className="h1" style={{ marginTop: 8 }}>How the audit works</h1>
      <p>
        Cashu Mints Auditor is an assay office for ecash. It does not rate mints. It records what a mint did when asked to
        answer and when asked to pay, and publishes the log.
      </p>

      <h2>Availability checks</h2>
      <ul>
        <li>Every 5 minutes the auditor calls <span className="mono">GET /v1/info</span> and <span className="mono">GET /v1/keysets</span> on every tracked mint, from a server in Prague.</li>
        <li>A check counts as <strong>up</strong> when <span className="mono">/v1/info</span> returns a valid Cashu info document within 8 seconds.</li>
        <li>If info answers but there is no active sat keyset, the mint is <strong>degraded</strong>: reachable, but unable to issue ecash.</li>
        <li>Response time is measured for <span className="mono">/v1/info</span> only and includes TLS and the network path from Prague.</li>
        <li>A mint that was up and fails a check is probed once more 2 seconds later before it is recorded as offline, so a single dropped connection is not counted as an outage.</li>
        <li>If almost every mint fails at once, the auditor first confirms its own internet connection and discards the round when it is offline.</li>
      </ul>

      <h2>Lightning swaps</h2>
      <p>
        A swap takes a small random amount of donated ecash at one mint, melts it to pay a Lightning invoice created by
        another mint, and mints fresh ecash there. It is the only way to prove that both mints actually move money.
      </p>
      <ul>
        <li>Each swap is between 10 and 100 sat and at most 10 % of the audit balance. The goal is that every mint pays out once and receives once each day (Prague calendar day). Runs start every minute and pick the swap that covers the most mints still missing: a source without a successful payout today and a destination without a successful receipt. Among those, the pair not tried for longest goes first, so counterparts rotate over the days. A mint takes part in at most 3 failed attempts per direction per day, whichever side caused them, each with a different counterpart, which tells a broken mint from a single bad route. Once every mint is covered, runs are skipped until midnight. Lightning fees are capped at 1,000 sat a day.</li>
        <li>A destination must be tracked for at least 3 days and be online with an active keyset in at least 95 % of at least 12 checks in the last 24 hours. Until a mint has paid out a swap itself, it receives at most 5 sat, and the auditor never holds more than 600 sat with any operator other than its home mint.</li>
        <li>Two URLs count as the same mint only when a quote created at one URL is visible at the other, which proves a shared database. A matching pubkey alone is not enough, because anyone can copy it. Confirmed aliases share the 600 sat limit.</li>
        <li>Proofs are locked before paying. If a payment times out, the auditor asks the mint for the quote state later and settles or releases the proofs. A swap is never paid twice.</li>
        <li>A failure is attributed only where the evidence points. A refused quote or failed minting counts against the destination, a refused melt quote or a payment stuck in pending against the source.</li>
        <li>Attempts stopped by the auditor&apos;s own checks before anything is sent (too little balance, an amount outside the mint&apos;s limits) are not swaps and are left out of every statistic.</li>
        <li>A Lightning routing failure can sit anywhere on the path, so by default it counts against neither mint. A payment that timed out or hung as pending and then failed is treated the same way. It is attributed to the destination when payments to it failed from at least two different mints in 7 days and either none succeeded or at least half of at least five attempts failed; the source is treated the same way for payments to two different destinations.</li>
        <li>After a failure attributed to a mint it is left out of swaps for 1 hour, doubling with every further failure in a row up to 7 days. A successful swap in the same direction resets it. A mint that twice in a row takes a paid Lightning invoice without issuing the ecash receives nothing for 7 days and shows a warning until it issues ecash again. A mint with a payout still pending is not used as a source until it resolves. Ecash locked in a payout that is still pending after 30 days is shown as written off; the auditor keeps checking it and takes it back if the mint ever fails or settles the payment.</li>
        <li>A routing failure between two specific mints pauses only that pair, for 1 hour doubling up to 24 hours, so other mints keep being tried.</li>
        <li>Mints that describe themselves as test mints in their name, URL or description may issue unbacked ecash. They are checked for availability, never receive swaps, and any balance held there is paid out and not counted in the audit balance.</li>
        <li>Swap amounts respect the minimum and maximum each mint advertises for Lightning deposits and withdrawals.</li>
        <li>A mint is marked Warning for swaps only while its most recent attributed failure in the last 24 hours is newer than its last successful swap.</li>
        <li>Fees are what the source kept after returning change: amount sent minus amount minted minus change.</li>
      </ul>

      <h2>Second vantage point</h2>
      <ul>
        <li>Every 5 minutes a server in Frankfurt runs the same <span className="mono">/v1/info</span> check. Availability states use Prague; Frankfurt is shown next to it so a slow route can be told apart from a slow mint.</li>
        <li>Response time is split into DNS lookup, TCP connect, TLS handshake and server response.</li>
      </ul>

      <h2>Specification and changes</h2>
      <ul>
        <li>From <span className="mono">/v1/info</span> and <span className="mono">/v1/keysets</span> the audit records payment methods, units and limits, whether deposits or withdrawals are disabled, the input fee of the active keyset, its version, authentication, WebSocket and batch support, contact, terms and onion address.</li>
        <li>Changes of software version, mint pubkey, active keyset, input fee, message of the day and disabled operations are logged with the time they were first seen.</li>
        <li>Clock offset compares the mint&apos;s reported time with the auditor&apos;s clock. The mint reports whole seconds, so offsets below 1 s are noise.</li>
        <li>The TLS certificate issuer and expiry are read on every check. Hosting network (ASN) and IPv4/IPv6 availability are refreshed daily; the country is where the IP block is registered, not necessarily where the server stands.</li>
        <li>Mints that advertise an onion address are checked over Tor every 6 hours.</li>
        <li>Once a day the audit asks every online mint for a small invoice it never pays. The invoice shows which Lightning node the mint uses and which route hints it gives; the node is then looked up in the public graph (mempool.space, with 1ML as fallback) for channels, capacity and hosting. Mints sharing a node are linked to each other.</li>
      </ul>

      <h2>Integrity checks</h2>
      <ul>
        <li><strong>Proof state.</strong> Once a day the auditor asks each mint where it holds ecash whether those proofs are still unspent (NUT-07). Proofs the mint reports as spent, although the auditor never spent them, are marked lost.</li>
        <li><strong>Internal swap.</strong> Once a day the auditor swaps ecash with the mint (<span className="mono">/v1/swap</span>) without Lightning. At mints without input fees all of its proofs are swapped, elsewhere the smallest one.</li>
        <li><strong>DLEQ.</strong> Every proof the auditor receives is checked for a valid DLEQ proof (NUT-12), which shows the mint signed it with the published key.</li>
        <li>All ecash uses deterministic secrets (NUT-13), so proofs lost to a dropped connection can be restored from the auditor&apos;s seed.</li>
      </ul>

      <h2 id="score">Audit score</h2>
      <p>A number from 0 to 100 computed only from what the audit measured. Parts without enough data are left out and the remaining weights rescaled.</p>
      <ul>
        <li><strong>Availability, 30 days (weight 40).</strong> 90 % or less scores 0, 100 % scores 100, linear in between.</li>
        <li><strong>Swap success, 30 days (30).</strong> Share of the mint&apos;s swaps without a failure attributed to it. Counted from 3 swaps, or from the first attributed failure.</li>
        <li><strong>Response time (10).</strong> Average over 24 hours from Prague. 150 ms scores 100, 2 s scores 0.</li>
        <li><strong>Nostr reviews (10).</strong> Average rating out of 5. Needs at least 3 ratings.</li>
      </ul>

      <h2>Reviews</h2>
      <p>
        Reviews are NIP-87 recommendations (kind 38000) read from public Nostr relays. Each event is signed by its
        author; only the latest review per author and mint is counted. The audit does not write or filter reviews.
      </p>

      <h2>States</h2>
      <ul style={{ listStyle: 'none', paddingLeft: 0, display: 'grid', gap: 10 }}>
        <li><StateBadge kind="ok" /> answered the last check, at least 99 % uptime in 24 h, last swap through it paid.</li>
        <li><StateBadge kind="warn" /> answering, but uptime in 24 h is below 99 %, keysets are missing, a swap is pending, or the last swap through it failed at its step.</li>
        <li><StateBadge kind="error" /> did not answer the last check.</li>
        <li><StateBadge kind="unknown" /> added but not checked yet, or not checked in the last 2 hours.</li>
        <li>Mints that have not answered for more than 30 days are listed separately below the table. They are still checked and return automatically once they answer.</li>
      </ul>

      <h2 id="recommended">Recommended mints</h2>
      <p>
        A mint is marked <strong>Recommended</strong> and listed first when, over the last 7 days, it was online at the last
        check, answered at least 99 % of checks, paid out and received at least one swap each, had no failure attributed to
        it and holds none of the auditor&apos;s sats in a stuck payment. It must be tracked for at least 7 days and must not be a test mint. Routing failures
        that are not attributed to the mint do not count against it.
      </p>

      <h2>Test mints</h2>
      <p>
        Mints that describe themselves as test mints are checked but not scored or recommended, are left out of the totals
        and of the newest software version, and are listed after the other mints.
      </p>

      <h2 id="mint-run">Mint runs</h2>
      <p>
        A <Link href="/run">mint run</Link> is funded by a visitor with 10,000 to 100,000 sat, paid to the home mint over Lightning or as Cashu ecash from any mint, in which case the run starts at that mint. The auditor then
        sends the whole amount, minus fees, over Lightning through every recommended mint whose limits allow it, in random order,
        one mint at a time, and finally back to the home mint. A mint that cannot quote, receive or pay the amount is skipped;
        after three failures in a row the run returns home. The visitor pays only the fees actually charged; what is left goes to
        their Lightning address, or to a Cashu token on their private run page if that payment fails, or to the audit if they
        chose to donate. Run hops are listed on each mint&apos;s page but do not count toward scores, recommendations or the
        daily fee budget, and the run&apos;s sats are not counted as audit balance.
      </p>

      <h2 id="api">Open data</h2>
      <p>Everything on this site is available without a key. Responses are cached for 60 seconds.</p>
      <ul>
        <li><span className="mono">GET /api/v1/mints</span> all mints with state, score, uptime, spec and swap counts for 30 days, or <span className="mono">/api/v1/mints.csv</span></li>
        <li><span className="mono">GET /api/v1/mints/&#123;id&#125;</span> one mint with daily uptime, latency breakdown, swaps, integrity checks and changes</li>
        <li><span className="mono">GET /api/v1/swaps?limit=100</span> recent swaps</li>
        <li><span className="mono">GET /badge/&#123;id&#125;.svg</span> an uptime badge for mint operators to embed</li>
      </ul>

      <h2 id="agents">For AI agents</h2>
      <p>
        The same data is available to AI assistants through an MCP server at <span className="mono">https://cashu.info/mcp</span>{' '}
        (Streamable HTTP, read only, no key). Its tools recommend, search, compare and describe mints and list recent swaps.
        The server card is at <a href="/.well-known/mcp.json">/.well-known/mcp.json</a>, a summary for language models at{' '}
        <a href="/llms.txt">/llms.txt</a>, the full mint list in Markdown at <a href="/llms-full.txt">/llms-full.txt</a> and the
        API description at <a href="/openapi.json">/openapi.json</a>.
      </p>

      <h2>Funding</h2>
      <p>
        Swaps are paid from donated ecash. Donated tokens are redeemed immediately, so the donor can no longer spend
        them. Balances shown are what the auditor holds right now at each mint.
      </p>
    </article>
  );
}
