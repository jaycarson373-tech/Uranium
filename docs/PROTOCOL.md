# Uranium Strategy v1

## Product loop

1. The player connects a Solana wallet and initializes one `Miner` PDA for the canonical config.
2. The player burns a fixed multiple of `min_build_cost` USR to level one of 25 reserve cells.
3. Every level adds one unit of mining power.
4. A finite, pre-funded vault releases rewards pro rata to active mining power.
5. The player either claims rewards to their token account or compounds them into more power.

There is no simulated balance, off-chain ownership ledger, random winner, SOL wager, or infinite mint in the core loop.

## On-chain accounts

- `ProtocolConfig` PDA, seeds `config + launch authority`: immutable token identity and supply snapshot; reward schedule; aggregate power/accounting; fees; pause state.
- USR mint PDA, seeds `usr-mint + launch authority`: the classic SPL mint created during atomic bootstrap.
- `Miner` PDA, seeds `miner + config + owner`: wallet owner, 25 rig levels, power, accrued rewards, reward debt, and lifetime totals.
- Reward vault ATA: classic SPL Token account owned by the config PDA. V1 has no vault-withdrawal instruction.

## Token rules

- Classic SPL Token only.
- The approved devnet bootstrap creates exactly 92,000,000 USR with six decimals.
- Bootstrap sends 64,400,000 USR to the reward vault and 27,600,000 USR to the launch authority's token account.
- Mint authority and freeze authority are revoked in the same atomic bootstrap transaction.
- Building burns the player's USR.
- Claiming transfers the net reward and burns the configured claim fee from the vault.
- Compounding burns the consumed vault rewards and converts the productive portion into mining power.

Approved devnet values are 92,000,000 USR max supply, 50 USR/second base emission, seven-day halvings, 1,000 USR per power, a 2% claim fee, and a 0.75% compound fee. The season-end timestamp is chosen at bootstrap so the 90-day campaign begins at the actual deployment time.

## Reward accounting

Rewards use an accumulator-per-power model scaled by `1e12`. The base per-second rate halves at each fixed interval and stops at the season end or when the funded reserve is fully allocated, whichever comes first. When total power is zero, time advances without allocating rewards.

This makes the reward liability bounded by `reserve_funded`. The program never mints rewards.

## Authority and pause

The launch authority may fund the reserve and pause/unpause new miner initialization, building, and compounding. Claiming remains available while paused. There is no admin function to withdraw the reward vault.

Before mainnet, authority should move to a reviewed multisig and the upgrade authority should follow an explicitly published policy. Making the program immutable is a later governance decision, not an automatic step.

## RWA boundary

Uranium-linked stocks or tokenized securities are intentionally outside the v1 token program. Availability varies by issuer and jurisdiction, and tokenized stock products may be derivatives rather than ownership of the underlying share. If added, use a separate reviewed adapter funded by defined protocol revenue; never represent USR emissions as uranium equity or commodity ownership.

## Deployment gate

No deployment or token transaction should occur until the operator sees and approves:

- cluster (`devnet` for the first run);
- generated program address and final program binary hash;
- token name/symbol/decimals and exact fixed supply;
- supply allocation and reward-vault funding amount;
- emission rate, halving interval, season end, build cost, and fees;
- fee-payer address and estimated devnet SOL cost;
- all authority revocations and remaining authorities.

The source and direct SBF-target release build compile locally. Solana CLI 3.1.14's packaged `cargo build-sbf` post-processor has an empty syscall allowlist on this machine, so deployment moves to the user's wallet-controlled Solana Playground workspace. The exact final binary must be built there and every deployment/bootstrap instruction simulated before signature.

After approval: deploy the program, then execute the atomic bootstrap that creates/mints USR, revokes mint/freeze authority, initializes the protocol, and funds the reserve. Simulate each user instruction before activating frontend transaction controls.

## Pre-mainnet requirements

- Independent Anchor/Solana security audit.
- Property and integration tests covering many miners, rounding dust, empty vaults, pause behavior, time boundaries, and account substitution attacks.
- Economic stress tests for concentration, reflexivity, late entrants, reserve exhaustion, and liquidity shocks.
- Legal review for token distribution, marketing claims, buyback mechanics, and any RWA integration.
- Multisig, monitoring, incident response, and a public disclosure of upgrade/admin powers.
