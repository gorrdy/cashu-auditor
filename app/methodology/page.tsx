import type { Metadata } from 'next';
import StateBadge from '@/components/StateBadge';

export const metadata: Metadata = { title: 'Methodology' };

export default function Methodology() {
  return (
    <article className="prose">
      <p className="eyebrow">Methodology</p>
      <h1 className="h1" style={{ marginTop: 8 }}>How the audit works</h1>
      <p>
        Cashu Audit is an assay office for ecash. It does not rate mints. It records what a mint did when asked to
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
        <li>Each swap is between 10 and 100 sat and at most 10 % of the audit balance. A swap runs every minute, and each pair of mints is tried at most once per day in each direction (Prague calendar day). A pair is due again after 1 day, after 2 days once it has paid 3 times in a row, after 4 days at 7 and after 7 days at 14; any failure brings it back to daily. A mint that has not paid out or received successfully in 24 hours keeps all its pairs due. Each run takes the most overdue pair, pairs never tried first. Lightning fees are capped at 1,000 sat a day; when the cap is reached, swaps wait until midnight. When every eligible pair has had its swap for the day, runs are skipped until midnight.</li>
        <li>A destination must be tracked for at least 3 days and answer at least 95 % of checks in the last 24 hours. Until a mint has paid out a swap itself, it receives at most 5 sat, and the auditor never holds more than 600 sat with any operator other than its home mint.</li>
        <li>Two URLs count as the same mint only when a quote created at one URL is visible at the other, which proves a shared database. A matching pubkey alone is not enough, because anyone can copy it. Confirmed aliases share the 600 sat limit.</li>
        <li>Proofs are locked before paying. If a payment times out, the auditor asks the mint for the quote state later and settles or releases the proofs. A swap is never paid twice.</li>
        <li>A failure is attributed only where the evidence points. A refused quote or failed minting counts against the destination, a refused melt quote or a payment stuck in pending against the source.</li>
        <li>Attempts stopped by the auditor&apos;s own checks before anything is sent (too little balance, an amount outside the mint&apos;s limits) are not swaps and are left out of every statistic.</li>
        <li>A Lightning routing failure can sit anywhere on the path, so by default it counts against neither mint. A payment that timed out or hung as pending and then failed is treated the same way. It is attributed to the destination only after payments to it failed from at least two different mints with no successful payment in 7 days, and to the source likewise for payments to two different destinations.</li>
        <li>After a failure attributed to a mint it is left out of swaps for 1 hour, doubling with every further failure in a row up to 24 hours. Any successful swap resets it. A mint with a payout still pending is not used as a source until it resolves.</li>
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
        <li><strong>Lightning fee when paying out (10).</strong> Fee kept as a share of the amount paid. 1 % scores 100, 10 % scores 0.</li>
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
        <li><StateBadge kind="unknown" /> added but not checked yet.</li>
        <li>Mints that have not answered for more than 30 days are listed separately below the table. They are still checked and return automatically once they answer.</li>
      </ul>

      <h2 id="api">Open data</h2>
      <p>Everything on this site is available without a key. Responses are cached for 60 seconds.</p>
      <ul>
        <li><span className="mono">GET /api/v1/mints</span> all mints with state, score, uptime and spec, or <span className="mono">/api/v1/mints.csv</span></li>
        <li><span className="mono">GET /api/v1/mints/&#123;id&#125;</span> one mint with daily uptime, latency breakdown, swaps, integrity checks and changes</li>
        <li><span className="mono">GET /api/v1/swaps?limit=100</span> recent swaps</li>
        <li><span className="mono">GET /badge/&#123;id&#125;.svg</span> an uptime badge for mint operators to embed</li>
      </ul>

      <h2>Funding</h2>
      <p>
        Swaps are paid from donated ecash. Donated tokens are redeemed immediately, so the donor can no longer spend
        them. Balances shown are what the auditor holds right now at each mint.
      </p>
    </article>
  );
}
