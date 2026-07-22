#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token,
    token_interface::{
        self, spl_token_2022::instruction::AuthorityType, BurnChecked, Mint, MintTo,
        SetAuthority, TokenAccount, TokenInterface, TransferChecked,
    },
};

// Deterministic local-simulation address. Replace with the wallet-controlled
// Solana Playground program address before any devnet deployment.
declare_id!("33FayKPVmoNGUxbT8o2tbandYRegiuaj2xP1Xky6ZwRa");

const CONFIG_SEED: &[u8] = b"config";
const MINT_SEED: &[u8] = b"usr-mint";
const MINER_SEED: &[u8] = b"miner";
const GRID_SIZE: usize = 25;
const MAX_RIG_LEVEL: u8 = 100;
const BPS_DENOMINATOR: u128 = 10_000;
const ACC_SCALE: u128 = 1_000_000_000_000;
const MAX_FEE_BPS: u16 = 1_000;
const TOKEN_DECIMALS: u8 = 6;
const FIXED_SUPPLY: u64 = 92_000_000_000_000;
const INITIAL_REWARD_RESERVE: u64 = 64_400_000_000_000;
const BASE_EMISSION_PER_SECOND: u64 = 50_000_000;
const HALVING_INTERVAL_SECONDS: i64 = 604_800;
const MIN_BUILD_COST: u64 = 1_000_000_000;
const CLAIM_FEE_BPS: u16 = 200;
const COMPOUND_FEE_BPS: u16 = 75;

#[program]
pub mod uranium_strategy {
    use super::*;

    /// Creates the canonical USR mint for one launch authority, mints the
    /// approved fixed distribution, and revokes mint/freeze authority in the
    /// same atomic transaction. No mint keypair is required because the mint
    /// is a PDA owned by this program instance.
    pub fn bootstrap_devnet(ctx: Context<BootstrapDevnet>, season_end_ts: i64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(season_end_ts > now, StrategyError::InvalidSeasonEnd);
        require_keys_eq!(
            ctx.accounts.token_program.key(),
            token::ID,
            StrategyError::InvalidTokenProgram
        );

        {
            let config = &mut ctx.accounts.config;
            config.version = 1;
            config.authority = ctx.accounts.authority.key();
            config.mint = ctx.accounts.mint.key();
            config.reward_vault = ctx.accounts.reward_vault.key();
            config.fixed_supply = FIXED_SUPPLY;
            config.start_ts = now;
            config.season_end_ts = season_end_ts;
            config.last_update_ts = now;
            config.halving_interval_seconds = HALVING_INTERVAL_SECONDS;
            config.base_emission_per_second = BASE_EMISSION_PER_SECOND;
            config.min_build_cost = MIN_BUILD_COST;
            config.total_power = 0;
            config.reserve_funded = INITIAL_REWARD_RESERVE;
            config.rewards_allocated = 0;
            config.rewards_claimed = 0;
            config.total_burned = 0;
            config.acc_reward_per_power = 0;
            config.claim_fee_bps = CLAIM_FEE_BPS;
            config.compound_fee_bps = COMPOUND_FEE_BPS;
            config.mint_decimals = TOKEN_DECIMALS;
            config.paused = false;
            config.bump = ctx.bumps.config;
        }

        let authority = ctx.accounts.authority.key();
        let bump_seed = [ctx.accounts.config.bump];
        let signer_seed_slice: &[&[u8]] = &[CONFIG_SEED, authority.as_ref(), &bump_seed];
        let signer_seeds = &[signer_seed_slice];

        token_interface::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.reward_vault.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer_seeds,
            ),
            INITIAL_REWARD_RESERVE,
        )?;

        let treasury_amount = FIXED_SUPPLY
            .checked_sub(INITIAL_REWARD_RESERVE)
            .ok_or(StrategyError::MathOverflow)?;
        token_interface::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.authority_tokens.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer_seeds,
            ),
            treasury_amount,
        )?;

        for authority_type in [AuthorityType::MintTokens, AuthorityType::FreezeAccount] {
            token_interface::set_authority(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    SetAuthority {
                        account_or_mint: ctx.accounts.mint.to_account_info(),
                        current_authority: ctx.accounts.config.to_account_info(),
                    },
                    signer_seeds,
                ),
                authority_type,
                None,
            )?;
        }

        emit!(ProtocolInitialized {
            authority,
            mint: ctx.accounts.mint.key(),
            fixed_supply: FIXED_SUPPLY,
            season_end_ts,
        });
        emit!(ReserveFunded {
            amount: INITIAL_REWARD_RESERVE,
            reserve_funded: INITIAL_REWARD_RESERVE,
        });

        Ok(())
    }

    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        base_emission_per_second: u64,
        halving_interval_seconds: i64,
        season_end_ts: i64,
        min_build_cost: u64,
        claim_fee_bps: u16,
        compound_fee_bps: u16,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        require!(base_emission_per_second > 0, StrategyError::InvalidEmission);
        require!(halving_interval_seconds > 0, StrategyError::InvalidHalvingInterval);
        require!(season_end_ts > now, StrategyError::InvalidSeasonEnd);
        require!(min_build_cost > 0, StrategyError::InvalidBuildCost);
        require!(claim_fee_bps <= MAX_FEE_BPS, StrategyError::FeeTooHigh);
        require!(compound_fee_bps <= MAX_FEE_BPS, StrategyError::FeeTooHigh);
        require!(compound_fee_bps <= claim_fee_bps, StrategyError::InvalidFeeSchedule);
        require!(ctx.accounts.mint.supply > 0, StrategyError::EmptyMint);
        require!(ctx.accounts.mint.mint_authority.is_none(), StrategyError::MintAuthorityActive);
        require!(ctx.accounts.mint.freeze_authority.is_none(), StrategyError::FreezeAuthorityActive);
        require_keys_eq!(ctx.accounts.token_program.key(), token::ID, StrategyError::InvalidTokenProgram);

        let config = &mut ctx.accounts.config;
        config.version = 1;
        config.authority = ctx.accounts.authority.key();
        config.mint = ctx.accounts.mint.key();
        config.reward_vault = ctx.accounts.reward_vault.key();
        config.fixed_supply = ctx.accounts.mint.supply;
        config.start_ts = now;
        config.season_end_ts = season_end_ts;
        config.last_update_ts = now;
        config.halving_interval_seconds = halving_interval_seconds;
        config.base_emission_per_second = base_emission_per_second;
        config.min_build_cost = min_build_cost;
        config.total_power = 0;
        config.reserve_funded = 0;
        config.rewards_allocated = 0;
        config.rewards_claimed = 0;
        config.total_burned = 0;
        config.acc_reward_per_power = 0;
        config.claim_fee_bps = claim_fee_bps;
        config.compound_fee_bps = compound_fee_bps;
        config.mint_decimals = ctx.accounts.mint.decimals;
        config.paused = false;
        config.bump = ctx.bumps.config;

        emit!(ProtocolInitialized {
            authority: config.authority,
            mint: config.mint,
            fixed_supply: config.fixed_supply,
            season_end_ts,
        });

        Ok(())
    }

    pub fn fund_reserve(ctx: Context<FundReserve>, amount: u64) -> Result<()> {
        require!(amount > 0, StrategyError::AmountTooSmall);
        require_keys_eq!(ctx.accounts.token_program.key(), token::ID, StrategyError::InvalidTokenProgram);

        update_pool(&mut ctx.accounts.config, Clock::get()?.unix_timestamp)?;

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.authority_tokens.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.reward_vault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        ctx.accounts.config.reserve_funded = ctx
            .accounts
            .config
            .reserve_funded
            .checked_add(amount)
            .ok_or(StrategyError::MathOverflow)?;

        emit!(ReserveFunded {
            amount,
            reserve_funded: ctx.accounts.config.reserve_funded,
        });

        Ok(())
    }

    pub fn initialize_miner(ctx: Context<InitializeMiner>) -> Result<()> {
        require!(!ctx.accounts.config.paused, StrategyError::ProtocolPaused);

        let miner = &mut ctx.accounts.miner;
        miner.owner = ctx.accounts.owner.key();
        miner.power = 0;
        miner.rig_levels = [0; GRID_SIZE];
        miner.accrued_rewards = 0;
        miner.reward_debt = 0;
        miner.total_burned = 0;
        miner.total_claimed = 0;
        miner.total_compounded = 0;
        miner.bump = ctx.bumps.miner;

        emit!(MinerInitialized { owner: miner.owner });
        Ok(())
    }

    pub fn build_rig(ctx: Context<BuildRig>, slot: u8, burn_amount: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, StrategyError::ProtocolPaused);
        require_keys_eq!(ctx.accounts.token_program.key(), token::ID, StrategyError::InvalidTokenProgram);
        require!((slot as usize) < GRID_SIZE, StrategyError::InvalidGridSlot);
        require!(burn_amount >= ctx.accounts.config.min_build_cost, StrategyError::AmountTooSmall);
        require!(
            burn_amount % ctx.accounts.config.min_build_cost == 0,
            StrategyError::InvalidBuildMultiple
        );

        let units = burn_amount
            .checked_div(ctx.accounts.config.min_build_cost)
            .ok_or(StrategyError::MathOverflow)?;
        let level_units = u8::try_from(units).map_err(|_| StrategyError::RigLevelExceeded)?;
        let current_level = ctx.accounts.miner.rig_levels[slot as usize];
        let next_level = current_level
            .checked_add(level_units)
            .ok_or(StrategyError::RigLevelExceeded)?;
        require!(next_level <= MAX_RIG_LEVEL, StrategyError::RigLevelExceeded);

        update_pool(&mut ctx.accounts.config, Clock::get()?.unix_timestamp)?;
        settle_miner(&ctx.accounts.config, &mut ctx.accounts.miner)?;

        token_interface::burn_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                BurnChecked {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.owner_tokens.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            burn_amount,
            ctx.accounts.mint.decimals,
        )?;

        ctx.accounts.miner.rig_levels[slot as usize] = next_level;
        ctx.accounts.miner.power = ctx
            .accounts
            .miner
            .power
            .checked_add(units)
            .ok_or(StrategyError::MathOverflow)?;
        ctx.accounts.miner.total_burned = ctx
            .accounts
            .miner
            .total_burned
            .checked_add(burn_amount)
            .ok_or(StrategyError::MathOverflow)?;
        ctx.accounts.config.total_power = ctx
            .accounts
            .config
            .total_power
            .checked_add(units)
            .ok_or(StrategyError::MathOverflow)?;
        ctx.accounts.config.total_burned = ctx
            .accounts
            .config
            .total_burned
            .checked_add(burn_amount)
            .ok_or(StrategyError::MathOverflow)?;
        ctx.accounts.miner.reward_debt = accumulated_for_power(
            ctx.accounts.config.acc_reward_per_power,
            ctx.accounts.miner.power,
        )?;

        emit!(RigBuilt {
            owner: ctx.accounts.owner.key(),
            slot,
            level: next_level,
            burn_amount,
            total_power: ctx.accounts.miner.power,
        });

        Ok(())
    }

    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        require_keys_eq!(ctx.accounts.token_program.key(), token::ID, StrategyError::InvalidTokenProgram);

        update_pool(&mut ctx.accounts.config, Clock::get()?.unix_timestamp)?;
        settle_miner(&ctx.accounts.config, &mut ctx.accounts.miner)?;

        let gross = ctx.accounts.miner.accrued_rewards;
        require!(gross > 0, StrategyError::NothingToClaim);
        require!(ctx.accounts.reward_vault.amount >= gross, StrategyError::ReserveUnderfunded);

        let fee = ((gross as u128)
            .checked_mul(ctx.accounts.config.claim_fee_bps as u128)
            .ok_or(StrategyError::MathOverflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(StrategyError::MathOverflow)?) as u64;
        let net = gross.checked_sub(fee).ok_or(StrategyError::MathOverflow)?;

        ctx.accounts.miner.accrued_rewards = 0;
        ctx.accounts.miner.reward_debt = accumulated_for_power(
            ctx.accounts.config.acc_reward_per_power,
            ctx.accounts.miner.power,
        )?;
        ctx.accounts.miner.total_claimed = ctx
            .accounts
            .miner
            .total_claimed
            .checked_add(net)
            .ok_or(StrategyError::MathOverflow)?;
        ctx.accounts.config.rewards_claimed = ctx
            .accounts
            .config
            .rewards_claimed
            .checked_add(gross)
            .ok_or(StrategyError::MathOverflow)?;
        ctx.accounts.config.total_burned = ctx
            .accounts
            .config
            .total_burned
            .checked_add(fee)
            .ok_or(StrategyError::MathOverflow)?;

        let authority = ctx.accounts.config.authority;
        let bump_seed = [ctx.accounts.config.bump];
        let signer_seed_slice: &[&[u8]] = &[CONFIG_SEED, authority.as_ref(), &bump_seed];
        let signer_seeds = &[signer_seed_slice];

        if net > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        from: ctx.accounts.reward_vault.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.owner_tokens.to_account_info(),
                        authority: ctx.accounts.config.to_account_info(),
                    },
                    signer_seeds,
                ),
                net,
                ctx.accounts.mint.decimals,
            )?;
        }

        if fee > 0 {
            token_interface::burn_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    BurnChecked {
                        mint: ctx.accounts.mint.to_account_info(),
                        from: ctx.accounts.reward_vault.to_account_info(),
                        authority: ctx.accounts.config.to_account_info(),
                    },
                    signer_seeds,
                ),
                fee,
                ctx.accounts.mint.decimals,
            )?;
        }

        emit!(RewardsClaimed {
            owner: ctx.accounts.owner.key(),
            gross,
            fee,
            net,
        });

        Ok(())
    }

    pub fn compound_rewards(ctx: Context<CompoundRewards>, slot: u8) -> Result<()> {
        require!(!ctx.accounts.config.paused, StrategyError::ProtocolPaused);
        require_keys_eq!(ctx.accounts.token_program.key(), token::ID, StrategyError::InvalidTokenProgram);
        require!((slot as usize) < GRID_SIZE, StrategyError::InvalidGridSlot);

        update_pool(&mut ctx.accounts.config, Clock::get()?.unix_timestamp)?;
        settle_miner(&ctx.accounts.config, &mut ctx.accounts.miner)?;

        let pending = ctx.accounts.miner.accrued_rewards;
        let (gross_consumed, units) = compound_quote(
            pending,
            ctx.accounts.config.min_build_cost,
            ctx.accounts.config.compound_fee_bps,
        )?;
        require!(ctx.accounts.reward_vault.amount >= gross_consumed, StrategyError::ReserveUnderfunded);

        let level_units = u8::try_from(units).map_err(|_| StrategyError::RigLevelExceeded)?;
        let next_level = ctx.accounts.miner.rig_levels[slot as usize]
            .checked_add(level_units)
            .ok_or(StrategyError::RigLevelExceeded)?;
        require!(next_level <= MAX_RIG_LEVEL, StrategyError::RigLevelExceeded);

        ctx.accounts.miner.accrued_rewards = pending
            .checked_sub(gross_consumed)
            .ok_or(StrategyError::MathOverflow)?;
        ctx.accounts.miner.rig_levels[slot as usize] = next_level;
        ctx.accounts.miner.power = ctx
            .accounts
            .miner
            .power
            .checked_add(units)
            .ok_or(StrategyError::MathOverflow)?;
        ctx.accounts.miner.total_compounded = ctx
            .accounts
            .miner
            .total_compounded
            .checked_add(gross_consumed)
            .ok_or(StrategyError::MathOverflow)?;
        ctx.accounts.config.total_power = ctx
            .accounts
            .config
            .total_power
            .checked_add(units)
            .ok_or(StrategyError::MathOverflow)?;
        ctx.accounts.config.rewards_claimed = ctx
            .accounts
            .config
            .rewards_claimed
            .checked_add(gross_consumed)
            .ok_or(StrategyError::MathOverflow)?;
        ctx.accounts.config.total_burned = ctx
            .accounts
            .config
            .total_burned
            .checked_add(gross_consumed)
            .ok_or(StrategyError::MathOverflow)?;
        ctx.accounts.miner.reward_debt = accumulated_for_power(
            ctx.accounts.config.acc_reward_per_power,
            ctx.accounts.miner.power,
        )?;

        let authority = ctx.accounts.config.authority;
        let bump_seed = [ctx.accounts.config.bump];
        let signer_seed_slice: &[&[u8]] = &[CONFIG_SEED, authority.as_ref(), &bump_seed];
        let signer_seeds = &[signer_seed_slice];
        token_interface::burn_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                BurnChecked {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.reward_vault.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer_seeds,
            ),
            gross_consumed,
            ctx.accounts.mint.decimals,
        )?;

        emit!(RewardsCompounded {
            owner: ctx.accounts.owner.key(),
            slot,
            gross_consumed,
            power_added: units,
            remaining_rewards: ctx.accounts.miner.accrued_rewards,
        });

        Ok(())
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        emit!(PauseChanged { paused });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct BootstrapDevnet<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + ProtocolConfig::INIT_SPACE,
        seeds = [CONFIG_SEED, authority.key().as_ref()],
        bump,
    )]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        init,
        payer = authority,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = config,
        mint::freeze_authority = config,
        mint::token_program = token_program,
        seeds = [MINT_SEED, authority.key().as_ref()],
        bump,
    )]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = config,
        associated_token::token_program = token_program,
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = authority,
        associated_token::token_program = token_program,
    )]
    pub authority_tokens: InterfaceAccount<'info, TokenAccount>,
    #[account(constraint = token_program.key() == token::ID @ StrategyError::InvalidTokenProgram)]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        constraint = mint.mint_authority.is_none() @ StrategyError::MintAuthorityActive,
        constraint = mint.freeze_authority.is_none() @ StrategyError::FreezeAuthorityActive,
    )]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = authority,
        space = 8 + ProtocolConfig::INIT_SPACE,
        seeds = [CONFIG_SEED, authority.key().as_ref()],
        bump,
    )]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        init,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = config,
        associated_token::token_program = token_program,
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(constraint = token_program.key() == token::ID @ StrategyError::InvalidTokenProgram)]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundReserve<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, authority.key().as_ref()], bump = config.bump, has_one = authority, has_one = mint, has_one = reward_vault)]
    pub config: Account<'info, ProtocolConfig>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = authority, token::token_program = token_program)]
    pub authority_tokens: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = config.reward_vault)]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(constraint = token_program.key() == token::ID @ StrategyError::InvalidTokenProgram)]
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct InitializeMiner<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED, config.authority.as_ref()], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        init,
        payer = owner,
        space = 8 + Miner::INIT_SPACE,
        seeds = [MINER_SEED, config.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub miner: Account<'info, Miner>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuildRig<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config.authority.as_ref()], bump = config.bump, has_one = mint)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut, seeds = [MINER_SEED, config.key().as_ref(), owner.key().as_ref()], bump = miner.bump, has_one = owner)]
    pub miner: Account<'info, Miner>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = owner, token::token_program = token_program)]
    pub owner_tokens: InterfaceAccount<'info, TokenAccount>,
    #[account(constraint = token_program.key() == token::ID @ StrategyError::InvalidTokenProgram)]
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config.authority.as_ref()], bump = config.bump, has_one = mint, has_one = reward_vault)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut, seeds = [MINER_SEED, config.key().as_ref(), owner.key().as_ref()], bump = miner.bump, has_one = owner)]
    pub miner: Account<'info, Miner>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, address = config.reward_vault)]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = owner, token::token_program = token_program)]
    pub owner_tokens: InterfaceAccount<'info, TokenAccount>,
    #[account(constraint = token_program.key() == token::ID @ StrategyError::InvalidTokenProgram)]
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct CompoundRewards<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config.authority.as_ref()], bump = config.bump, has_one = mint, has_one = reward_vault)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut, seeds = [MINER_SEED, config.key().as_ref(), owner.key().as_ref()], bump = miner.bump, has_one = owner)]
    pub miner: Account<'info, Miner>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, address = config.reward_vault)]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(constraint = token_program.key() == token::ID @ StrategyError::InvalidTokenProgram)]
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, authority.key().as_ref()], bump = config.bump, has_one = authority)]
    pub config: Account<'info, ProtocolConfig>,
}

#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub reward_vault: Pubkey,
    pub fixed_supply: u64,
    pub start_ts: i64,
    pub season_end_ts: i64,
    pub last_update_ts: i64,
    pub halving_interval_seconds: i64,
    pub base_emission_per_second: u64,
    pub min_build_cost: u64,
    pub total_power: u64,
    pub reserve_funded: u64,
    pub rewards_allocated: u64,
    pub rewards_claimed: u64,
    pub total_burned: u64,
    pub acc_reward_per_power: u128,
    pub claim_fee_bps: u16,
    pub compound_fee_bps: u16,
    pub mint_decimals: u8,
    pub version: u8,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Miner {
    pub owner: Pubkey,
    pub power: u64,
    pub rig_levels: [u8; GRID_SIZE],
    pub accrued_rewards: u64,
    pub reward_debt: u128,
    pub total_burned: u64,
    pub total_claimed: u64,
    pub total_compounded: u64,
    pub bump: u8,
}

fn update_pool(config: &mut ProtocolConfig, now: i64) -> Result<()> {
    let end = now.min(config.season_end_ts);
    let from = config.last_update_ts.max(config.start_ts);
    if end <= from {
        return Ok(());
    }

    if config.total_power == 0 {
        config.last_update_ts = end;
        return Ok(());
    }

    let scheduled = emission_between(
        config.start_ts,
        from,
        end,
        config.halving_interval_seconds,
        config.base_emission_per_second,
    )?;
    let available = config
        .reserve_funded
        .checked_sub(config.rewards_allocated)
        .ok_or(StrategyError::MathOverflow)?;
    let reward = scheduled.min(available);

    if reward > 0 {
        let increment = (reward as u128)
            .checked_mul(ACC_SCALE)
            .ok_or(StrategyError::MathOverflow)?
            .checked_div(config.total_power as u128)
            .ok_or(StrategyError::MathOverflow)?;
        config.acc_reward_per_power = config
            .acc_reward_per_power
            .checked_add(increment)
            .ok_or(StrategyError::MathOverflow)?;
        config.rewards_allocated = config
            .rewards_allocated
            .checked_add(reward)
            .ok_or(StrategyError::MathOverflow)?;
    }

    config.last_update_ts = end;
    Ok(())
}

fn emission_between(start: i64, from: i64, to: i64, interval: i64, base_rate: u64) -> Result<u64> {
    require!(interval > 0, StrategyError::InvalidHalvingInterval);
    if to <= from || to <= start {
        return Ok(0);
    }

    let mut cursor = from.max(start);
    let mut total: u128 = 0;

    while cursor < to {
        let period = ((cursor - start) / interval) as u32;
        let rate = base_rate.checked_shr(period).unwrap_or(0);
        if rate == 0 {
            break;
        }
        let next_boundary = start
            .checked_add(
                (period as i64 + 1)
                    .checked_mul(interval)
                    .ok_or(StrategyError::MathOverflow)?,
            )
            .ok_or(StrategyError::MathOverflow)?;
        let segment_end = to.min(next_boundary);
        let duration = u64::try_from(segment_end - cursor).map_err(|_| StrategyError::MathOverflow)?;
        total = total
            .checked_add((duration as u128).checked_mul(rate as u128).ok_or(StrategyError::MathOverflow)?)
            .ok_or(StrategyError::MathOverflow)?;
        cursor = segment_end;
    }

    u64::try_from(total).map_err(|_| error!(StrategyError::MathOverflow))
}

fn accumulated_for_power(acc_reward_per_power: u128, power: u64) -> Result<u128> {
    acc_reward_per_power
        .checked_mul(power as u128)
        .ok_or_else(|| error!(StrategyError::MathOverflow))?
        .checked_div(ACC_SCALE)
        .ok_or_else(|| error!(StrategyError::MathOverflow))
}

fn settle_miner(config: &ProtocolConfig, miner: &mut Miner) -> Result<()> {
    let accumulated = accumulated_for_power(config.acc_reward_per_power, miner.power)?;
    let newly_accrued = accumulated
        .checked_sub(miner.reward_debt)
        .ok_or(StrategyError::MathOverflow)?;
    let newly_accrued_u64 = u64::try_from(newly_accrued).map_err(|_| StrategyError::MathOverflow)?;
    miner.accrued_rewards = miner
        .accrued_rewards
        .checked_add(newly_accrued_u64)
        .ok_or(StrategyError::MathOverflow)?;
    miner.reward_debt = accumulated;
    Ok(())
}

fn compound_quote(pending: u64, build_cost: u64, fee_bps: u16) -> Result<(u64, u64)> {
    require!(pending > 0, StrategyError::NothingToCompound);
    require!(build_cost > 0, StrategyError::InvalidBuildCost);
    let efficiency = BPS_DENOMINATOR
        .checked_sub(fee_bps as u128)
        .ok_or(StrategyError::MathOverflow)?;
    require!(efficiency > 0, StrategyError::InvalidFeeSchedule);

    let productive = (pending as u128)
        .checked_mul(efficiency)
        .ok_or(StrategyError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(StrategyError::MathOverflow)?;
    let units_u128 = productive
        .checked_div(build_cost as u128)
        .ok_or(StrategyError::MathOverflow)?;
    require!(units_u128 > 0, StrategyError::NothingToCompound);

    let productive_cost = units_u128
        .checked_mul(build_cost as u128)
        .ok_or(StrategyError::MathOverflow)?;
    let numerator = productive_cost
        .checked_mul(BPS_DENOMINATOR)
        .ok_or(StrategyError::MathOverflow)?;
    let gross = numerator
        .checked_add(efficiency - 1)
        .ok_or(StrategyError::MathOverflow)?
        .checked_div(efficiency)
        .ok_or(StrategyError::MathOverflow)?;
    require!(gross <= pending as u128, StrategyError::NothingToCompound);

    Ok((
        u64::try_from(gross).map_err(|_| StrategyError::MathOverflow)?,
        u64::try_from(units_u128).map_err(|_| StrategyError::MathOverflow)?,
    ))
}

#[event]
pub struct ProtocolInitialized {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub fixed_supply: u64,
    pub season_end_ts: i64,
}

#[event]
pub struct ReserveFunded {
    pub amount: u64,
    pub reserve_funded: u64,
}

#[event]
pub struct MinerInitialized {
    pub owner: Pubkey,
}

#[event]
pub struct RigBuilt {
    pub owner: Pubkey,
    pub slot: u8,
    pub level: u8,
    pub burn_amount: u64,
    pub total_power: u64,
}

#[event]
pub struct RewardsClaimed {
    pub owner: Pubkey,
    pub gross: u64,
    pub fee: u64,
    pub net: u64,
}

#[event]
pub struct RewardsCompounded {
    pub owner: Pubkey,
    pub slot: u8,
    pub gross_consumed: u64,
    pub power_added: u64,
    pub remaining_rewards: u64,
}

#[event]
pub struct PauseChanged {
    pub paused: bool,
}

#[error_code]
pub enum StrategyError {
    #[msg("The protocol is paused")]
    ProtocolPaused,
    #[msg("The emission rate must be greater than zero")]
    InvalidEmission,
    #[msg("The halving interval is invalid")]
    InvalidHalvingInterval,
    #[msg("The season end timestamp must be in the future")]
    InvalidSeasonEnd,
    #[msg("The build cost is invalid")]
    InvalidBuildCost,
    #[msg("The amount is too small")]
    AmountTooSmall,
    #[msg("The amount must be an exact multiple of the rig build cost")]
    InvalidBuildMultiple,
    #[msg("The selected grid slot is invalid")]
    InvalidGridSlot,
    #[msg("The rig would exceed its maximum level")]
    RigLevelExceeded,
    #[msg("The fee is too high")]
    FeeTooHigh,
    #[msg("Compound fee must not exceed claim fee")]
    InvalidFeeSchedule,
    #[msg("The token mint has no supply")]
    EmptyMint,
    #[msg("The mint authority must be revoked")]
    MintAuthorityActive,
    #[msg("The freeze authority must be revoked")]
    FreezeAuthorityActive,
    #[msg("Only the classic SPL Token program is supported")]
    InvalidTokenProgram,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("No rewards are available to claim")]
    NothingToClaim,
    #[msg("Not enough rewards are available to compound a rig level")]
    NothingToCompound,
    #[msg("The finite reward reserve is underfunded")]
    ReserveUnderfunded,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approved_bootstrap_distribution_is_exact() {
        let treasury = FIXED_SUPPLY.checked_sub(INITIAL_REWARD_RESERVE).unwrap();
        assert_eq!(FIXED_SUPPLY, 92_000_000_000_000);
        assert_eq!(INITIAL_REWARD_RESERVE, 64_400_000_000_000);
        assert_eq!(treasury, 27_600_000_000_000);
        assert_eq!(CLAIM_FEE_BPS, 200);
        assert_eq!(COMPOUND_FEE_BPS, 75);
    }

    #[test]
    fn emission_crosses_halving_boundaries() {
        let reward = emission_between(0, 0, 25, 10, 100).unwrap();
        assert_eq!(reward, 1_625);
    }

    #[test]
    fn emission_stops_when_rate_reaches_zero() {
        let reward = emission_between(0, 0, 10_000, 10, 1).unwrap();
        assert_eq!(reward, 10);
    }

    #[test]
    fn compound_quote_keeps_rounding_inside_pending_balance() {
        let (gross, units) = compound_quote(10_000, 1_000, 75).unwrap();
        assert_eq!(units, 9);
        assert!(gross <= 10_000);
        assert!(gross >= 9_000);
    }

    #[test]
    fn accumulator_math_is_proportional() {
        let acc = 25_u128 * ACC_SCALE;
        assert_eq!(accumulated_for_power(acc, 4).unwrap(), 100);
    }
}
