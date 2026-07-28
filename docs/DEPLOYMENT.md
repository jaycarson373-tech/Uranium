# Deployment handoff

## Current state

The Devnet program and fixed-supply token are deployed and verified. The
frontend supports real wallet transactions. Mainnet is intentionally a separate
deployment and must never reuse the Devnet program address.

## Vercel

Copy the public values from `.env.vercel.example`. The four Devnet program
addresses in that file are already verified. Add
`NEXT_PUBLIC_INDEXER_API_URL` only after Railway returns its HTTPS domain.

Only `NEXT_PUBLIC_*` values belong in Vercel. Never put
`SUPABASE_SERVICE_ROLE_KEY`, wallet material, or a private RPC administration
key in browser variables.

## Supabase

Create a Devnet project and run this once in the SQL editor:

`supabase/migrations/202607220001_uranium_strategy.sql`

The migration creates protocol, miner, rig, event, and cursor tables; a public
read-only leaderboard; row-level security; idempotent event ingestion; and a
service-role-only cursor function.

Use a different Supabase project for mainnet. Do not copy the Devnet cursor or
indexed events into the mainnet database.

## Railway

Deploy this repository as a service. Railway uses `railway.toml` and starts
`npm run start:indexer`.

Set every value in `.env.railway.example`:

- `SOLANA_CLUSTER`
- `SOLANA_RPC_HTTP_URL`
- `SOLANA_RPC_FALLBACK_URL` (strongly recommended; use another provider)
- `USR_PROGRAM_ID`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `INDEXER_NAME`
- `INDEXER_POLL_INTERVAL_MS`
- `INDEXER_BOOTSTRAP_LIMIT`
- `ALLOWED_ORIGIN`

Railway injects `PORT`. The indexer has no wallet and no signing capability.
After deployment, `/health` must return HTTP 200 and an advancing `rpcSlot`.
Then set the Railway domain as Vercel's
`NEXT_PUBLIC_INDEXER_API_URL` and redeploy the frontend.

## Production checks

1. `npm run build:vercel`
2. `npm test`
3. `npm run test:indexer`
4. `npm run verify:devnet-state`
5. `npm run verify:devnet-gameplay`
6. `NO_DNA=1 cargo test -p uranium-strategy --lib`
7. `NO_DNA=1 anchor build`
8. Fork Devnet in Surfpool and run `npm run test:surfpool`
9. Load the deployed site twice in a clean browser session; open/close the
   protocol console; connect/disconnect a wallet; confirm there is no reload
   loop.
10. Review one build transaction in the site and reject it in the wallet. No
    transaction should be sent.

## Cluster cutover rule

Change the RPC, cluster, program, mint, config, reward vault, indexer URL, and
database together. A deployment must fail review if any Devnet address is
paired with `mainnet-beta`.

Mainnet instructions are in [MAINNET-RUNBOOK.md](MAINNET-RUNBOOK.md).
