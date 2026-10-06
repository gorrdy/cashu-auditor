# Cashu Mints Auditor

Independent proof that Cashu mints pay. Runs at https://audit.cashu.cz.

The auditor checks every tracked mint every 5 minutes from two locations, moves real sats between mints
over Lightning, verifies DLEQ proofs and proof states, and publishes the results. See `/methodology` on
the site for exactly what is measured and how failures are attributed.

## Stack

Next.js 16 (App Router), React 19, Prisma 7 with SQLite (better-sqlite3 adapter), cashu-ts 4, nostr-tools,
Node 24. Design system: `docs/BRAND.md`.

## Layout

| Path | What |
|---|---|
| `app/` | pages, server actions, API routes (`/api/run-*` are cron jobs, `/api/v1/*` is the public API) |
| `lib/transfer.ts` | swap engine: quotes, proof reservation, melt, mint, recovery |
| `lib/wallet.ts` | deterministic wallet (NUT-13), DB-backed counters, restore |
| `lib/probe.ts` | timed `/v1/info` and `/v1/keysets` probe |
| `lib/egress.ts`, `lib/netguard.ts` | blocks outbound connections to private addresses |
| `lib/blame.ts` | failure attribution |
| `deploy/` | systemd unit, Frankfurt probe script |

## Configuration

Environment (production: `/etc/cashu-auditor/env`, never in the repo):

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | `file:/path/to/dev.db` |
| `CRON_SECRET` | bearer token for `/api/run-*` |
| `PROBE_SECRET` | bearer token for the Frankfurt probe |
| `HOME_MINT_URL` | mint that funds the audit |
| `WALLET_MNEMONIC` | BIP39 seed for NUT-13 deterministic secrets |
| `BIND_HOST`, `PORT` | listen address |

## Development

```bash
npm ci
npx prisma generate
npx prisma db push
npm run dev
npm test
```

## Deploy

`./deploy.sh` copies the working tree to `/srv/cashu-auditor/app`, builds it as the `cashu-audit` user and
restarts the `cashu-auditor` systemd service.

## License

MIT, see [LICENSE](LICENSE).
