//! Polyx Launchpad — an original, fee-free bonding-curve launchpad **and** AMM in
//! a single program, one file.
//!
//! Tokens are **Token-2022** with the metadata stored INSIDE the mint (metadata
//! extension) — like pump.fun — so there's no separate ~0.015 SOL Metaplex account.
//! A launch costs only the mint + curve + vault rent.
//!
//! Lifecycle: initialize (once) → create → buy/sell on the curve → auto-graduate at
//! the SOL threshold → migrate to the internal AMM (LP permanently locked) →
//! swap_sol_for_token / swap_token_for_sol. Zero fees. Constant-product (`x·y=k`).

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::{spl_token_2022::instruction::AuthorityType, Token2022},
    token_2022_extensions::{token_metadata_initialize, TokenMetadataInitialize},
    token_interface::{
        mint_to, set_authority, transfer_checked, Mint, MintTo, SetAuthority, TokenAccount,
        TransferChecked,
    },
};

declare_id!("CCkwT5o6ieiyxuJvMJNtmrVe1tBwKU7sK47QLCnfTgL4");

const DECIMALS: u8 = 6;

#[program]
pub mod polyx_launchpad {
    use super::*;

    /// Seed the global config once. `params` sets all launch economics.
    pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
        let g = &mut ctx.accounts.global;
        require!(!g.initialized, LaunchpadError::AlreadyInitialized);
        g.authority = ctx.accounts.authority.key();
        g.initialized = true;
        g.mint_decimals = params.mint_decimals;
        g.token_total_supply = params.token_total_supply;
        g.initial_virtual_token_reserves = params.initial_virtual_token_reserves;
        g.initial_virtual_sol_reserves = params.initial_virtual_sol_reserves;
        g.initial_real_token_reserves = params.initial_real_token_reserves;
        g.graduation_sol_lamports = params.graduation_sol_lamports;
        g.fee_basis_points = 0; // Polyx is fee-free.
        g.bump = ctx.bumps.global;
        Ok(())
    }

    /// Launch a token: Token-2022 mint with inline metadata (name/symbol/uri),
    /// full supply minted into the curve vault, supply locked, trading open.
    pub fn create(ctx: Context<Create>, name: String, symbol: String, uri: String) -> Result<()> {
        require!(ctx.accounts.global.initialized, LaunchpadError::NotInitialized);
        require!(name.len() <= 32 && symbol.len() <= 10 && uri.len() <= 200, LaunchpadError::MetadataTooLong);

        let mint_key = ctx.accounts.mint.key();
        let creator_key = ctx.accounts.creator.key();
        let bump = ctx.bumps.bonding_curve;
        let total_supply = ctx.accounts.global.token_total_supply;
        let ivt = ctx.accounts.global.initial_virtual_token_reserves;
        let ivs = ctx.accounts.global.initial_virtual_sol_reserves;
        let irt = ctx.accounts.global.initial_real_token_reserves;

        {
            let curve = &mut ctx.accounts.bonding_curve;
            curve.mint = mint_key;
            curve.creator = creator_key;
            curve.virtual_token_reserves = ivt;
            curve.virtual_sol_reserves = ivs;
            curve.real_token_reserves = irt;
            curve.real_sol_reserves = 0;
            curve.token_total_supply = total_supply;
            curve.complete = false;
            curve.bump = bump;
        }

        let seeds: &[&[u8]] = &[BONDING_CURVE_SEED, mint_key.as_ref(), &[bump]];

        // Write name/symbol/uri INTO the mint (Token-2022 metadata extension). The
        // token program reallocs the mint to fit the metadata; afterward we top the
        // mint's lamports back up to rent-exempt for the new size. This mirrors the
        // official Anchor 0.30 token-extensions example (fund AFTER, not before).
        token_metadata_initialize(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TokenMetadataInitialize {
                    token_program_id: ctx.accounts.token_program.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    metadata: ctx.accounts.mint.to_account_info(),
                    mint_authority: ctx.accounts.bonding_curve.to_account_info(),
                    update_authority: ctx.accounts.bonding_curve.to_account_info(),
                },
                &[seeds],
            ),
            name,
            symbol,
            uri,
        )?;
        ctx.accounts.mint.reload()?;
        {
            let mint_ai = ctx.accounts.mint.to_account_info();
            let needed = Rent::get()?.minimum_balance(mint_ai.data_len());
            let cur = mint_ai.lamports();
            if needed > cur {
                system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.creator.to_account_info(),
                            to: mint_ai,
                        },
                    ),
                    needed - cur,
                )?;
            }
        }

        // Mint the full supply into the curve vault.
        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.curve_vault.to_account_info(),
                    authority: ctx.accounts.bonding_curve.to_account_info(),
                },
                &[seeds],
            ),
            total_supply,
        )?;

        // Revoke mint authority — supply permanently fixed.
        set_authority(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                SetAuthority {
                    current_authority: ctx.accounts.bonding_curve.to_account_info(),
                    account_or_mint: ctx.accounts.mint.to_account_info(),
                },
                &[seeds],
            ),
            AuthorityType::MintTokens,
            None,
        )?;

        emit!(TokenCreated { mint: mint_key, creator: creator_key });
        Ok(())
    }

    /// Buy tokens with `sol_in` lamports on the bonding curve.
    pub fn buy(ctx: Context<Trade>, sol_in: u64, min_token_out: u64) -> Result<()> {
        require!(sol_in > 0, LaunchpadError::ZeroAmount);
        require!(!ctx.accounts.bonding_curve.complete, LaunchpadError::CurveComplete);

        let (v_sol, v_tok, r_tok, bump, mint_key) = {
            let c = &ctx.accounts.bonding_curve;
            (c.virtual_sol_reserves, c.virtual_token_reserves, c.real_token_reserves, c.bump, c.mint)
        };

        let token_out = curve::tokens_out_for_sol_in(sol_in, v_sol, v_tok, r_tok)
            .ok_or(LaunchpadError::MathOverflow)?;
        require!(token_out > 0, LaunchpadError::InsufficientReserves);
        require!(token_out >= min_token_out, LaunchpadError::SlippageExceeded);

        // SOL: user -> curve PDA.
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.user.to_account_info(),
                    to: ctx.accounts.bonding_curve.to_account_info(),
                },
            ),
            sol_in,
        )?;

        // Tokens: curve vault -> user, curve PDA signs.
        let seeds: &[&[u8]] = &[BONDING_CURVE_SEED, mint_key.as_ref(), &[bump]];
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.curve_vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.user_ata.to_account_info(),
                    authority: ctx.accounts.bonding_curve.to_account_info(),
                },
                &[seeds],
            ),
            token_out,
            DECIMALS,
        )?;

        let graduation_threshold = ctx.accounts.global.graduation_sol_lamports;
        let user_key = ctx.accounts.user.key();

        let (just_graduated, vsr, vtr, rsr, rtr) = {
            let curve = &mut ctx.accounts.bonding_curve;
            curve.virtual_sol_reserves = add(curve.virtual_sol_reserves, sol_in)?;
            curve.virtual_token_reserves = sub(curve.virtual_token_reserves, token_out)?;
            curve.real_sol_reserves = add(curve.real_sol_reserves, sol_in)?;
            curve.real_token_reserves = sub(curve.real_token_reserves, token_out)?;
            let grad = !curve.complete && curve.real_sol_reserves >= graduation_threshold;
            if grad {
                curve.complete = true;
            }
            (grad, curve.virtual_sol_reserves, curve.virtual_token_reserves,
             curve.real_sol_reserves, curve.real_token_reserves)
        };

        if just_graduated {
            emit!(Graduated { mint: mint_key, real_sol_reserves: rsr, real_token_reserves: rtr });
        }
        emit!(Traded {
            mint: mint_key, user: user_key, is_buy: true,
            sol_amount: sol_in, token_amount: token_out,
            virtual_sol_reserves: vsr, virtual_token_reserves: vtr,
        });
        Ok(())
    }

    /// Sell tokens back to the bonding curve for SOL.
    pub fn sell(ctx: Context<Trade>, token_in: u64, min_sol_out: u64) -> Result<()> {
        require!(token_in > 0, LaunchpadError::ZeroAmount);
        require!(!ctx.accounts.bonding_curve.complete, LaunchpadError::CurveComplete);

        let (v_sol, v_tok, r_sol, mint_key) = {
            let c = &ctx.accounts.bonding_curve;
            (c.virtual_sol_reserves, c.virtual_token_reserves, c.real_sol_reserves, c.mint)
        };

        let sol_out = curve::sol_out_for_tokens_in(token_in, v_sol, v_tok, r_sol)
            .ok_or(LaunchpadError::MathOverflow)?;
        require!(sol_out > 0, LaunchpadError::InsufficientReserves);
        require!(sol_out >= min_sol_out, LaunchpadError::SlippageExceeded);

        // Tokens: user -> curve vault.
        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_ata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.curve_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            token_in,
            DECIMALS,
        )?;

        // SOL: curve PDA -> user (program-owned, move lamports directly).
        **ctx.accounts.bonding_curve.to_account_info().try_borrow_mut_lamports()? -= sol_out;
        **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? += sol_out;

        let user_key = ctx.accounts.user.key();
        let (vsr, vtr) = {
            let curve = &mut ctx.accounts.bonding_curve;
            curve.virtual_token_reserves = add(curve.virtual_token_reserves, token_in)?;
            curve.virtual_sol_reserves = sub(curve.virtual_sol_reserves, sol_out)?;
            curve.real_token_reserves = add(curve.real_token_reserves, token_in)?;
            curve.real_sol_reserves = sub(curve.real_sol_reserves, sol_out)?;
            (curve.virtual_sol_reserves, curve.virtual_token_reserves)
        };

        emit!(Traded {
            mint: mint_key, user: user_key, is_buy: false,
            sol_amount: sol_out, token_amount: token_in,
            virtual_sol_reserves: vsr, virtual_token_reserves: vtr,
        });
        Ok(())
    }

    /// Graduate a completed curve into an AMM pool. Permissionless. Seeds the pool
    /// with the curve's remaining tokens + all accumulated SOL and locks the LP.
    pub fn migrate(ctx: Context<Migrate>) -> Result<()> {
        require!(ctx.accounts.bonding_curve.complete, LaunchpadError::NotGraduated);
        require!(ctx.accounts.bonding_curve.real_sol_reserves > 0, LaunchpadError::CurveComplete);

        let token_amount = ctx.accounts.bonding_curve.real_token_reserves;
        let sol_amount = ctx.accounts.bonding_curve.real_sol_reserves;
        require!(token_amount > 0 && sol_amount > 0, LaunchpadError::InsufficientReserves);

        let mint_key = ctx.accounts.mint.key();
        let lp_mint_key = ctx.accounts.lp_mint.key();
        let curve_bump = ctx.accounts.bonding_curve.bump;
        let pool_bump = ctx.bumps.pool;

        {
            let pool = &mut ctx.accounts.pool;
            pool.token_mint = mint_key;
            pool.lp_mint = lp_mint_key;
            pool.bump = pool_bump;
        }

        // Tokens: curve vault -> pool vault (curve PDA signs).
        let curve_seeds: &[&[u8]] = &[BONDING_CURVE_SEED, mint_key.as_ref(), &[curve_bump]];
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.curve_vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.pool_token_vault.to_account_info(),
                    authority: ctx.accounts.bonding_curve.to_account_info(),
                },
                &[curve_seeds],
            ),
            token_amount,
            DECIMALS,
        )?;

        // SOL: curve PDA -> pool PDA (both program-owned).
        **ctx.accounts.bonding_curve.to_account_info().try_borrow_mut_lamports()? -= sol_amount;
        **ctx.accounts.pool.to_account_info().try_borrow_mut_lamports()? += sol_amount;

        // Create the locked, pool-owned LP account (pool's ATA for lp_mint). Done
        // via CPI rather than an accounts-struct `init` so `try_accounts` fits the
        // SBF stack frame; the ATA program validates the address on creation.
        anchor_spl::associated_token::create(CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            anchor_spl::associated_token::Create {
                payer: ctx.accounts.payer.to_account_info(),
                associated_token: ctx.accounts.pool_lp_locked.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
                mint: ctx.accounts.lp_mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
        ))?;

        // Initial LP (geometric mean) minted to the locked, pool-owned LP account.
        let lp = amm::initial_lp(token_amount, sol_amount).ok_or(LaunchpadError::MathOverflow)?;
        require!(lp > 0, LaunchpadError::InsufficientReserves);
        let pool_seeds: &[&[u8]] = &[POOL_SEED, mint_key.as_ref(), &[pool_bump]];
        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.lp_mint.to_account_info(),
                    to: ctx.accounts.pool_lp_locked.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                &[pool_seeds],
            ),
            lp,
        )?;

        let pool = &mut ctx.accounts.pool;
        pool.token_reserve = token_amount;
        pool.sol_reserve = sol_amount;
        pool.lp_supply = lp;

        let curve = &mut ctx.accounts.bonding_curve;
        curve.real_token_reserves = 0;
        curve.real_sol_reserves = 0;

        emit!(Migrated { mint: mint_key, token_amount, sol_amount, lp_locked: lp });
        Ok(())
    }

    /// Swap SOL for tokens on a graduated pool (fee-free).
    pub fn swap_sol_for_token(ctx: Context<PoolSwap>, sol_in: u64, min_token_out: u64) -> Result<()> {
        require!(sol_in > 0, LaunchpadError::ZeroAmount);
        let pool = &ctx.accounts.pool;
        let token_out = amm::amount_out(sol_in, pool.sol_reserve, pool.token_reserve)
            .ok_or(LaunchpadError::MathOverflow)?;
        require!(token_out > 0, LaunchpadError::InsufficientReserves);
        require!(token_out >= min_token_out, LaunchpadError::SlippageExceeded);

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.user.to_account_info(),
                    to: ctx.accounts.pool.to_account_info(),
                },
            ),
            sol_in,
        )?;

        let mint_key = pool.token_mint;
        let seeds: &[&[u8]] = &[POOL_SEED, mint_key.as_ref(), &[pool.bump]];
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.pool_token_vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.user_token.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                &[seeds],
            ),
            token_out,
            DECIMALS,
        )?;

        let pool = &mut ctx.accounts.pool;
        pool.sol_reserve = add(pool.sol_reserve, sol_in)?;
        pool.token_reserve = sub(pool.token_reserve, token_out)?;
        emit!(PoolSwapped { mint: mint_key, is_buy: true, sol_amount: sol_in, token_amount: token_out });
        Ok(())
    }

    /// Swap tokens for SOL on a graduated pool (fee-free).
    pub fn swap_token_for_sol(ctx: Context<PoolSwap>, token_in: u64, min_sol_out: u64) -> Result<()> {
        require!(token_in > 0, LaunchpadError::ZeroAmount);
        let pool = &ctx.accounts.pool;
        let sol_out = amm::amount_out(token_in, pool.token_reserve, pool.sol_reserve)
            .ok_or(LaunchpadError::MathOverflow)?;
        require!(sol_out > 0, LaunchpadError::InsufficientReserves);
        require!(sol_out >= min_sol_out, LaunchpadError::SlippageExceeded);

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.pool_token_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            token_in,
            DECIMALS,
        )?;

        **ctx.accounts.pool.to_account_info().try_borrow_mut_lamports()? -= sol_out;
        **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? += sol_out;

        let pool = &mut ctx.accounts.pool;
        pool.token_reserve = add(pool.token_reserve, token_in)?;
        pool.sol_reserve = sub(pool.sol_reserve, sol_out)?;
        emit!(PoolSwapped { mint: pool.token_mint, is_buy: false, sol_amount: sol_out, token_amount: token_in });
        Ok(())
    }
}

// ===========================================================================
// PDA seeds + checked helpers
// ===========================================================================

pub const GLOBAL_SEED: &[u8] = b"global";
pub const BONDING_CURVE_SEED: &[u8] = b"bonding_curve";
pub const POOL_SEED: &[u8] = b"pool";

fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or(LaunchpadError::MathOverflow.into())
}
fn sub(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b).ok_or(LaunchpadError::MathOverflow.into())
}

// ===========================================================================
// Bonding-curve math — constant product (`x·y=k`) over virtual reserves.
// ===========================================================================

pub mod curve {
    pub fn tokens_out_for_sol_in(sol_in: u64, virtual_sol: u64, virtual_token: u64, real_token: u64) -> Option<u64> {
        if sol_in == 0 { return Some(0); }
        let k = (virtual_sol as u128).checked_mul(virtual_token as u128)?;
        let new_virtual_sol = (virtual_sol as u128).checked_add(sol_in as u128)?;
        let new_virtual_token = k.checked_div(new_virtual_sol)?;
        let mut tokens_out = (virtual_token as u128).checked_sub(new_virtual_token)?;
        let real_token = real_token as u128;
        if tokens_out > real_token { tokens_out = real_token; }
        u64::try_from(tokens_out).ok()
    }

    pub fn sol_out_for_tokens_in(token_in: u64, virtual_sol: u64, virtual_token: u64, real_sol: u64) -> Option<u64> {
        if token_in == 0 { return Some(0); }
        let k = (virtual_sol as u128).checked_mul(virtual_token as u128)?;
        let new_virtual_token = (virtual_token as u128).checked_add(token_in as u128)?;
        let new_virtual_sol = k.checked_div(new_virtual_token)?;
        let mut sol_out = (virtual_sol as u128).checked_sub(new_virtual_sol)?;
        let real_sol = real_sol as u128;
        if sol_out > real_sol { sol_out = real_sol; }
        u64::try_from(sol_out).ok()
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        const V_SOL: u64 = 30_000_000_000;
        const V_TOK: u64 = 1_073_000_000_000_000;
        const R_TOK: u64 = 793_100_000_000_000;
        #[test]
        fn buy_monotonic_and_capped() {
            let a = tokens_out_for_sol_in(1_000_000_000, V_SOL, V_TOK, R_TOK).unwrap();
            let b = tokens_out_for_sol_in(2_000_000_000, V_SOL, V_TOK, R_TOK).unwrap();
            assert!(a > 0 && b > a);
            assert!(tokens_out_for_sol_in(u64::MAX / 2, V_SOL, V_TOK, R_TOK).unwrap() <= R_TOK);
        }
        #[test]
        fn round_trip_cannot_mint_sol() {
            let sol_in = 5_000_000_000u64;
            let tok = tokens_out_for_sol_in(sol_in, V_SOL, V_TOK, R_TOK).unwrap();
            let back = sol_out_for_tokens_in(tok, V_SOL + sol_in, V_TOK - tok, sol_in).unwrap();
            assert!(back <= sol_in);
        }
    }
}

// ===========================================================================
// AMM pool math — constant product over real reserves, fee-free.
// ===========================================================================

pub mod amm {
    pub fn amount_out(amount_in: u64, reserve_in: u64, reserve_out: u64) -> Option<u64> {
        if amount_in == 0 || reserve_in == 0 || reserve_out == 0 { return Some(0); }
        let numerator = (amount_in as u128).checked_mul(reserve_out as u128)?;
        let denominator = (reserve_in as u128).checked_add(amount_in as u128)?;
        u64::try_from(numerator.checked_div(denominator)?).ok()
    }
    pub fn initial_lp(token_amount: u64, sol_amount: u64) -> Option<u64> {
        let product = (token_amount as u128).checked_mul(sol_amount as u128)?;
        u64::try_from(isqrt(product)).ok()
    }
    fn isqrt(n: u128) -> u128 {
        if n < 2 { return n; }
        let mut x = n;
        let mut y = (x + 1) / 2;
        while y < x { x = y; y = (x + n / x) / 2; }
        x
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn swap_monotonic_and_bounded() {
            let a = amount_out(1_000, 1_000_000, 2_000_000).unwrap();
            let b = amount_out(2_000, 1_000_000, 2_000_000).unwrap();
            assert!(a > 0 && b > a);
            assert!(amount_out(u64::MAX / 2, 1_000_000, 2_000_000).unwrap() < 2_000_000);
        }
        #[test]
        fn isqrt_floor() { assert_eq!(isqrt(16), 4); assert_eq!(isqrt(17), 4); }
    }
}

// ===========================================================================
// Instruction params + account contexts
// ===========================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeParams {
    pub mint_decimals: u8,
    pub token_total_supply: u64,
    pub initial_virtual_token_reserves: u64,
    pub initial_virtual_sol_reserves: u64,
    pub initial_real_token_reserves: u64,
    pub graduation_sol_lamports: u64,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = Global::LEN, seeds = [GLOBAL_SEED], bump)]
    pub global: Account<'info, Global>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Create<'info> {
    #[account(seeds = [GLOBAL_SEED], bump = global.bump)]
    pub global: Account<'info, Global>,
    #[account(
        init, payer = creator,
        mint::decimals = DECIMALS,
        mint::authority = bonding_curve,
        mint::token_program = token_program,
        extensions::metadata_pointer::authority = bonding_curve,
        extensions::metadata_pointer::metadata_address = mint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init, payer = creator, space = BondingCurve::LEN,
        seeds = [BONDING_CURVE_SEED, mint.key().as_ref()], bump
    )]
    pub bonding_curve: Account<'info, BondingCurve>,
    #[account(
        init, payer = creator,
        associated_token::mint = mint,
        associated_token::authority = bonding_curve,
        associated_token::token_program = token_program,
    )]
    pub curve_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Trade<'info> {
    #[account(seeds = [GLOBAL_SEED], bump = global.bump)]
    pub global: Account<'info, Global>,
    #[account(
        mut, seeds = [BONDING_CURVE_SEED, mint.key().as_ref()], bump = bonding_curve.bump,
        has_one = mint,
    )]
    pub bonding_curve: Account<'info, BondingCurve>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = bonding_curve, associated_token::token_program = token_program)]
    pub curve_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = user, associated_token::token_program = token_program)]
    pub user_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Migrate<'info> {
    // Heavy account structs are boxed onto the heap so `try_accounts` stays
    // under the 4KB SBF stack frame limit (init'ing several token accounts at
    // once otherwise overflows the frame).
    #[account(
        mut, seeds = [BONDING_CURVE_SEED, mint.key().as_ref()], bump = bonding_curve.bump,
        has_one = mint,
    )]
    pub bonding_curve: Box<Account<'info, BondingCurve>>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = bonding_curve, associated_token::token_program = token_program)]
    pub curve_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(init, payer = payer, space = Pool::LEN, seeds = [POOL_SEED, mint.key().as_ref()], bump)]
    pub pool: Box<Account<'info, Pool>>,
    #[account(init, payer = payer, mint::decimals = DECIMALS, mint::authority = pool, mint::token_program = token_program)]
    pub lp_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(init, payer = payer, associated_token::mint = mint, associated_token::authority = pool, associated_token::token_program = token_program)]
    pub pool_token_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Pool-owned LP account with no withdraw path — migration LP is locked here.
    /// Created via CPI inside `migrate` (kept out of the accounts-struct `init` set
    /// so `try_accounts` stays under the 4KB SBF stack frame limit). The SPL
    /// associated-token program validates this is the canonical ATA on creation.
    /// CHECK: initialized in-handler as the pool's ATA for `lp_mint`.
    #[account(mut)]
    pub pool_lp_locked: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PoolSwap<'info> {
    #[account(mut, seeds = [POOL_SEED, pool.token_mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(address = pool.token_mint, mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = pool, associated_token::token_program = token_program)]
    pub pool_token_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = user, associated_token::token_program = token_program)]
    pub user_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

// ===========================================================================
// Account state
// ===========================================================================

#[account]
pub struct Global {
    pub authority: Pubkey,
    pub initialized: bool,
    pub mint_decimals: u8,
    pub token_total_supply: u64,
    pub initial_virtual_token_reserves: u64,
    pub initial_virtual_sol_reserves: u64,
    pub initial_real_token_reserves: u64,
    pub graduation_sol_lamports: u64,
    pub fee_basis_points: u16,
    pub bump: u8,
}
impl Global { pub const LEN: usize = 8 + 32 + 1 + 1 + 8 * 5 + 2 + 1; }

#[account]
pub struct BondingCurve {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub virtual_token_reserves: u64,
    pub virtual_sol_reserves: u64,
    pub real_token_reserves: u64,
    pub real_sol_reserves: u64,
    pub token_total_supply: u64,
    pub complete: bool,
    pub bump: u8,
}
impl BondingCurve { pub const LEN: usize = 8 + 32 + 32 + 8 * 5 + 1 + 1; }

#[account]
pub struct Pool {
    pub token_mint: Pubkey,
    pub lp_mint: Pubkey,
    pub token_reserve: u64,
    pub sol_reserve: u64,
    pub lp_supply: u64,
    pub bump: u8,
}
impl Pool { pub const LEN: usize = 8 + 32 + 32 + 8 * 3 + 1; }

// ===========================================================================
// Events
// ===========================================================================

#[event]
pub struct TokenCreated { pub mint: Pubkey, pub creator: Pubkey }

#[event]
pub struct Traded {
    pub mint: Pubkey, pub user: Pubkey, pub is_buy: bool,
    pub sol_amount: u64, pub token_amount: u64,
    pub virtual_sol_reserves: u64, pub virtual_token_reserves: u64,
}

#[event]
pub struct Graduated { pub mint: Pubkey, pub real_sol_reserves: u64, pub real_token_reserves: u64 }

#[event]
pub struct Migrated { pub mint: Pubkey, pub token_amount: u64, pub sol_amount: u64, pub lp_locked: u64 }

#[event]
pub struct PoolSwapped { pub mint: Pubkey, pub is_buy: bool, pub sol_amount: u64, pub token_amount: u64 }

// ===========================================================================
// Errors
// ===========================================================================

#[error_code]
pub enum LaunchpadError {
    #[msg("Global config is already initialized")]
    AlreadyInitialized,
    #[msg("Global config is not initialized")]
    NotInitialized,
    #[msg("Bonding curve is complete; this token has graduated to the AMM")]
    CurveComplete,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Output amount is below the requested minimum (slippage)")]
    SlippageExceeded,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Not enough reserves on the curve to fill this trade")]
    InsufficientReserves,
    #[msg("Curve has not reached the graduation threshold")]
    NotGraduated,
    #[msg("Metadata name/symbol/uri too long")]
    MetadataTooLong,
}
