# Cashu Mints Auditor

Independent proof that Cashu mints pay. Runs at https://cashu.info.

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
| `SWAP_FEE_BUDGET_SAT` | daily Lightning fee cap for swaps (default 1000) |
| `NOSTR_SECRET_KEY` | hex key the auditor sends operator alerts from (NIP-17) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push keys for operator alerts |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | Telegram alerts; register the webhook with `GET /api/telegram/setup` |
| `SMTP_URL`, `SMTP_FROM` | email sign-in, email claim verification and email alerts |

Channels without their variables are shown as coming soon on `/operators`.

## Development

```bash
npm ci
npx prisma generate
npx prisma db push
npm run dev
npm test
```

## Deploy

`./deploy.sh` deploys to the dev instance (`/srv/cashu-auditor-dev`, service `cashu-auditor-dev`,
env `/etc/cashu-auditor/dev.env`) and `./deploy.sh prod` to production (`/srv/cashu-auditor`, service
`cashu-auditor`). Each copies the working tree, builds it as the `cashu-audit` user, restarts the service
and runs the smoke tests. The two instances have separate databases and wallets; `APP_ENV=dev` turns the
accent orange and marks the site noindex.

## License

MIT, see [LICENSE](LICENSE).
