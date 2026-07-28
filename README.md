# Uranium Strategy

Uranium Strategy is a fixed-supply, burn-to-build strategy game on Solana.

## Verified Devnet deployment

- Program: `4ZssVwZYsfPAdoWozYyxPHFYts5uohJBHWCQo6yEm5AC`
- USR mint: `6cBq44LrxdqWyZrPyvkydQ32hGPhYvErtt66eyM4KVEg`
- Config PDA: `24P7GQNwrNQnNojxipxAYR8nmBi3ZKWHoRB8zoetWX5A`
- Reward vault: `1djxzK9KKKbfUpNSVDww3zFQqueEjCPLjrCkbU1V5X3`
- Fixed supply: 92,000,000 USR
- Reward reserve: 64,400,000 USR
- Treasury allocation: 27,600,000 USR
- Mint authority: revoked
- Freeze authority: revoked

The website connects a wallet, reads confirmed account state, initializes the
player Miner PDA on first build, and submits build, claim, and compound
transactions only after an in-app summary and the wallet's own approval.

## Checks

```bash
npm ci
npm run build:vercel
npm run test:indexer
npm run verify:devnet-state
npm run verify:devnet-gameplay
NO_DNA=1 cargo test -p uranium-strategy --lib
```

For a full local lifecycle and 100-transaction contention test, start a
Devnet-forked Surfpool instance and run:

```bash
NO_DNA=1 surfpool start --network devnet --no-deploy \
  --skip-signature-verification --skip-blockhash-check --ci
npm run test:surfpool
```

The Surfpool test never mutates live Devnet.

## Services

- Frontend: Next.js/Vinext, deployed to Vercel and Sites.
- Program: Anchor, classic SPL Token.
- Indexer: stateless Railway service that reads confirmed logs.
- Database: Supabase projections with read-only public policies and
  service-role-only ingestion functions.

Use [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for environments and deployment,
[docs/PROTOCOL.md](docs/PROTOCOL.md) for mechanics, and
[docs/MAINNET-RUNBOOK.md](docs/MAINNET-RUNBOOK.md) for the mainnet gates.

## Mainnet boundary

Devnet success does not authorize a mainnet launch. Mainnet requires a new
program ID, a 2-of-3 Squads vault for protocol and upgrade authority, a paid RPC
with fallback, a separate Supabase/indexer environment, independent security
and legal review, and explicit approval of the final deployment and bootstrap
transactions. Never commit or send a wallet keypair, seed phrase, RPC secret,
or Supabase service-role key.
