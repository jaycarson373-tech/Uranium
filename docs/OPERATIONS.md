# Operations and monitoring

## Required monitors

- Website: request `/` every minute and alert on non-200, redirect loops, or
  three consecutive failures.
- Indexer: request Railway `/health` every minute. Alert on HTTP 503,
  `ok: false`, stale `lastPollAt`, or use of the fallback RPC for more than five
  minutes.
- Chain invariants: run the state verifier on a schedule and alert if the
  program owner changes unexpectedly, mint/freeze authority is restored, vault
  ownership changes, or `rewards_claimed` exceeds `reserve_funded`.
- Database: alert on ingestion RPC errors, connection saturation, storage
  pressure, and rejected service-role requests.
- Product: track wallet transaction submissions, confirmed/failed results,
  confirmation p50/p95, account-lock errors, RPC rate-limit errors, and indexer
  lag.

## Safe degradation

- If Railway or Supabase is unavailable, hide the leaderboard. Direct wallet
  balances and Miner state remain sourced from Solana RPC.
- If the primary RPC fails, Railway automatically tries
  `SOLANA_RPC_FALLBACK_URL`.
- If browser RPC is unhealthy, show an RPC error and do not enable an action
  based on stale state.
- Never replace failed on-chain reads with invented balances or cached reward
  amounts.

## Secrets

Railway holds the Supabase service-role key and private indexer RPC endpoints.
Vercel holds only public browser variables. No service stores a Solana private
key. Redact query strings and authorization headers from logs and support
screenshots.

## Incident ownership

Before launch, name one primary operator and one backup. Both need access to
Vercel, Railway, Supabase, RPC provider dashboards, the GitHub repository, and
the Squads multisig. The Squads threshold remains 2-of-3; incident urgency does
not reduce it.
