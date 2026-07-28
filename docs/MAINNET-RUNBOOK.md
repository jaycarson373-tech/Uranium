# Mainnet runbook

This document prepares mainnet. It does not authorize a transaction.

## Wallet model

Use four project signing wallets:

1. Three separate hardware-backed human member wallets.
2. One separate low-balance deployer and fee-payer wallet.

Create a 2-of-3 Squads multisig from the three member wallets. The Squads vault
must control:

- program upgrade authority;
- protocol launch authority;
- protocol pause authority (the same V1 authority);
- treasury token account.

The reward vault is a program-derived token account and has no private key. The
Railway indexer has no wallet. Each player uses their own wallet.

## Required external inputs

- `MAINNET_PROGRAM_ID`: public address from a newly generated, securely stored
  program keypair.
- `SQUADS_VAULT_ADDRESS`: the vault PDA shown by Squads.
- `MAINNET_RPC_HTTP_URL`: paid mainnet RPC; keep it server-side where possible.
- A fallback RPC from a different provider.
- Mainnet Supabase project URL and service-role secret.
- Independent program audit report and resolved findings.
- Legal review of token distribution and launch claims.

Never paste or commit a keypair or seed phrase.

## Source and build

1. Freeze the release commit.
2. Replace `declare_id!` and the mainnet `Anchor.toml` entry with
   `MAINNET_PROGRAM_ID` on a dedicated release branch.
3. Build in a pinned, reproducible environment.
4. Record the release commit, toolchain versions, ELF hash, program ID, and
   program-data size.
5. Run the complete Rust, frontend, indexer, Devnet, and Surfpool suites.
6. Obtain a second-person match of source ID, ELF ID, and program keypair public
   address.

Do not deploy the Devnet binary address to mainnet.

## Deployment transaction gate

Before requesting a signature, show:

- cluster: `mainnet-beta`;
- new program ID;
- deployer/fee-payer public address;
- exact deployment SOL estimate;
- initial upgrade authority;
- release commit and ELF SHA-256;
- simulation result.

Deploy from the low-balance deployer. Immediately create a Squads proposal to
transfer upgrade authority to the Squads vault. Verify the new authority on
chain before bootstrap.

## Atomic bootstrap gate

Execute `bootstrap_devnet` (the V1 instruction name is historical) from a
Squads vault transaction. Before member approval, show:

- cluster and program ID;
- Squads vault address;
- derived config, mint, reward vault, and treasury ATA;
- exact 92,000,000 USR fixed supply;
- 64,400,000 USR reward reserve;
- 27,600,000 USR treasury allocation;
- six decimals;
- 50 USR/second base emission;
- seven-day halvings;
- 1,000 USR build cost;
- 2% claim fee;
- 0.75% compound fee;
- exact season-end timestamp;
- mint and freeze authority revocations;
- estimated SOL and simulation result.

Require two Squads approvals. After execution, run the state verifier configured
for mainnet and confirm that mint and freeze authorities are `None`.

## Token access and liquidity

The approved fixed-supply bootstrap creates the mint as a PDA of the Uranium
Strategy program. It is not a Pump.fun mint. Do not advertise or attempt a
Pump.fun launch for this mint.

Players need USR before they can build. The mainnet launch plan therefore needs
a separately reviewed DEX liquidity transaction using part of the 27,600,000
USR treasury allocation and a disclosed amount of SOL or stablecoin. Before
that transaction, publish:

- venue and pool address;
- exact USR and quote-token amounts;
- initial price implied by those amounts;
- LP position owner and withdrawal policy;
- whether fees accrue to the Squads treasury;
- treasury tokens retained for operations, incentives, or later liquidity.

The game program never receives the SOL used in a DEX purchase. During gameplay,
the only SOL paid is Solana network fees and one-time account rent. Build burns
USR; claim transfers USR; compound burns vault USR.

The alternative `initialize_protocol` instruction can bind an existing,
authority-revoked classic SPL mint, but it begins with an empty reward reserve.
Using a third-party fair-launch mint would require acquiring and depositing the
entire intended reserve and redesigning the approved distribution. That path is
not approved by this runbook.

## Staged activation

1. Keep the website on Devnet while mainnet state is verified.
2. Start a separate mainnet indexer and Supabase database.
3. Run an operator wallet smoke path with a deliberately small circulating
   amount.
4. Change all frontend cluster/address/indexer values in one deployment.
5. Start with a limited announcement.
6. Monitor RPC error rate, confirmation p50/p95, account-lock failures, indexer
   lag, Supabase errors, vault balance, supply, and program logs.
7. Expand traffic only if the first observation window is healthy.

## Incident actions

- Frontend/RPC failure: keep chain state authoritative, switch RPC, do not
  fabricate balances.
- Indexer lag: hide leaderboard/projections; wallet actions can continue from
  direct RPC state.
- Suspicious gameplay behavior: Squads pauses initialization, build, and
  compound. Claims remain available by design.
- Program vulnerability: pause, publish the scope, prepare an audited upgrade
  through Squads, and require the normal multisig review.

Do not advertise mainnet as live until the production deployment, bootstrap,
state verification, smoke transaction, and monitoring checks all pass.
