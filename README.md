# Uranium Strategy

Solana devnet-ready MVP for a fixed-supply, on-chain uranium strategy game.

## What is real now

- A production-building web app with wallet-standard Solana wallet discovery and connection.
- An Anchor program implementing an atomic fixed-supply bootstrap, authority-scoped config and mint PDAs, miner PDAs, a 25-cell reserve, USR burns, finite-vault emissions, deterministic halvings, claims, compounding, and an emergency pause.
- Unit tests for emission boundaries, accumulator math, and compound rounding.

Current checks pass for the Vinext and Vercel production builds, web rendering tests, lint, native Rust unit tests, and a direct release build for Solana's SBF target. Solana CLI 3.1.14's packaged `cargo build-sbf` post-processor still has a zero-byte syscall allowlist on this machine, so the final wallet-controlled Playground build and transaction simulations remain mandatory before deployment.

The program and USR mint are **not deployed**. Transaction buttons remain locked until the final program ID, mint, initialization parameters, and fee payer are shown and explicitly approved for devnet.

## Local web app

```bash
npm install
cp .env.example .env.local
npm run dev
```

The default RPC is Solana devnet. Set `NEXT_PUBLIC_USR_PROGRAM_ID` and `NEXT_PUBLIC_USR_MINT` only after those addresses exist.

## Program checks

```bash
cargo test -p uranium-strategy --lib
```

The current `declare_id!` value is a public, compile-only placeholder with no deploy keypair. It must be replaced with the wallet-controlled Playground program address before building a deployment artifact.

## Important

This repository is pre-launch software, not a security audit or an investment product. Do not deploy to mainnet or accept funds without an independent program audit, economic simulation, legal review, and operational controls.

See [docs/PROTOCOL.md](docs/PROTOCOL.md) for the design and deployment gate.
