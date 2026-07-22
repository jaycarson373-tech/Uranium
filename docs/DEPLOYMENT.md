# Deployment handoff

## Current boundary

The program source and web application are prepared, but no program or token exists on devnet yet. This machine has no default Solana signer. Program deployment must therefore begin inside a user-controlled wallet environment such as Solana Playground. Never send a keypair, seed phrase or service-role secret through chat.

## Devnet sequence

1. Import the `programs/uranium_strategy` source into Solana Playground.
2. Let Playground assign the program address inside its wallet-controlled workspace.
3. Replace the compile-only `declare_id!` and both `Anchor.toml` entries with that public address.
4. Build in Playground and inspect the final program address and authority.
5. Before deployment, display and approve: devnet cluster, wallet fee payer, loader/program destination, estimated devnet SOL, program address and upgrade authority.
6. Simulate, then deploy from the connected wallet.
7. Set `NEXT_PUBLIC_USR_PROGRAM_ID` to the confirmed address.
8. Derive the authority-specific `config` and `usr-mint` PDAs, then prepare the `bootstrap_devnet` transaction.
9. Display and approve the bootstrap summary. Simulate before requesting the wallet signature.
10. Verify: 92M supply, 64.4M reward vault, 27.6M authority treasury, six decimals, and both mint/freeze authorities set to none.
11. Run one smoke path: initialize miner → burn 1,000 USR → wait → claim → build again → compound.

Passing devnet demonstrates runtime compatibility and transaction wiring. It does not guarantee mainnet safety. Before mainnet, repeat simulation against the final binary, obtain an independent audit, move authorities to a multisig, test economic edge cases and complete legal review.

## Vercel

Use `.env.vercel.example`. Only `NEXT_PUBLIC_*` values belong in the frontend. Never add `SUPABASE_SERVICE_ROLE_KEY` to Vercel.

## Railway

Deploy this repository with `railway.toml` and the variables in `.env.railway.example`. The Railway process is read-only with respect to Solana: it polls confirmed program logs, decodes known Anchor events and writes indexed projections using the Supabase service role. It never holds a Solana signing key.

## Supabase

Run `supabase/migrations/202607220001_uranium_strategy.sql` once in the SQL editor. Public clients receive read-only access to the protocol, miner, rig and event tables. Only the Railway service role can invoke the ingestion function or update the indexer cursor.

## Production replacements

- Replace the public devnet RPC with a paid RPC before traffic grows.
- Use separate Supabase projects for devnet and mainnet.
- Change every cluster/address variable together; never combine a mainnet RPC with devnet program IDs.
- Set Railway `ALLOWED_ORIGIN` to the final Vercel/Sites domain.
- Keep mainnet disabled in the UI until a second explicit deployment approval.
