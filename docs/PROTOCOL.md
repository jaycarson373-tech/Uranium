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

Deployed Devnet values are 92,000,000 USR max supply, 50 USR/second base emission, seven-day halvings, 1,000 USR per power, a 2% claim fee, and a 0.75% compound fee. The deployed season ends at Unix timestamp `1792782286`.

## Reward accounting

Rewards use an accumulator-per-power model scaled by `1e12`. The base per-second rate halves at each fixed interval and stops at the season end or when the funded reserve is fully allocated, whichever comes first. When total power is zero, time advances without allocating rewards.

This makes the reward liability bounded by `reserve_funded`. The program never mints rewards.

## Authority and pause

The launch authority may fund the reserve and pause/unpause new miner initialization, building, and compounding. Claiming remains available while paused. There is no admin function to withdraw the reward vault.

Mainnet must initialize with a reviewed Squads vault as launch authority, and
the program upgrade authority must be transferred to that vault before token
bootstrap. Making the program immutable is a later governance decision, not an
automatic step.

## RWA boundary

Uranium-linked stocks or tokenized securities are intentionally outside the v1 token program. Availability varies by issuer and jurisdiction, and tokenized stock products may be derivatives rather than ownership of the underlying share. If added, use a separate reviewed adapter funded by defined protocol revenue; never represent USR emissions as uranium equity or commodity ownership.

## Verified Devnet state

- Program: `4ZssVwZYsfPAdoWozYyxPHFYts5uohJBHWCQo6yEm5AC`
- Mint: `6cBq44LrxdqWyZrPyvkydQ32hGPhYvErtt66eyM4KVEg`
- Config: `24P7GQNwrNQnNojxipxAYR8nmBi3ZKWHoRB8zoetWX5A`
- Reward vault: `1djxzK9KKKbfUpNSVDww3zFQqueEjCPLjrCkbU1V5X3`
- Bootstrap transaction:
  `4wVvZDTUVBC2CagKppK4XsYgg3XrWofo1E3HoPoPkQd9ggKxvmyVyQE59Wd6KbPFuSZ7mCPukp9rZqYiCfNbgHLh`

`npm run verify:devnet-state` independently checks the transaction, account
layout, allocation, token program, revoked authorities, vault owner, and config.
`npm run verify:devnet-gameplay` simulates initialize-miner plus build without
broadcasting. `npm run test:surfpool` executes build, claim, compound, rejection,
and contention paths against an isolated Devnet fork.

## Transaction approval

The website uses a two-stage action. First it displays cluster, action, token
effect, selected cell, fee payer, program, and the fact that the wallet will
show the network fee. Only the separate “Approve in wallet” action requests a
signature. Rejected or failed transactions do not update optimistic balances;
the site refreshes confirmed chain state.

## Throughput boundary

V1 intentionally keeps aggregate reward accounting in one writable config
account. A local Devnet-fork test has passed 100 concurrent submissions, but
this does not remove Solana account-lock contention during a public traffic
spike. Launch monitoring must track transaction failure rate and confirmation
latency. Do not promise unbounded throughput. A future audited version can
introduce reward shards if real mainnet measurements justify the added
accounting complexity.

## Pre-mainnet requirements

- Independent Anchor/Solana security audit.
- Independent review of client-generated account metas and all program
  instructions.
- Property and integration tests covering many miners, rounding dust, empty vaults, pause behavior, time boundaries, and account substitution attacks.
- Economic stress tests for concentration, reflexivity, late entrants, reserve exhaustion, and liquidity shocks.
- Legal review for token distribution, marketing claims, buyback mechanics, and any RWA integration.
- Multisig, monitoring, incident response, and a public disclosure of upgrade/admin powers.
