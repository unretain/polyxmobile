# Polyx Launchpad

An **original**, **fee-free** Solana launchpad: a bonding-curve token launch that
graduates into a built-in AMM — all in a **single Anchor program**. It implements
the standard constant-product mechanism (`x·y=k`) from scratch; it is not derived
from anyone's source. Every economic parameter is configurable at `initialize`.

**Zero fees anywhere** — no platform fee, no swap fee.

## Isolation

Standalone Anchor workspace, intentionally decoupled from the app. It does **not**
import from, or get imported by, `apps/web` or `apps/api`. Nothing is wired into
the frontend until you say so.

## One program (important for SolPG)

The launchpad and the AMM live in **one** program, so migration is a pure internal
move (no cross-program CPI, no PDA-signing across programs). That means **one**
SolPG project, one deploy.

## Full lifecycle (all implemented)

```
initialize            once, by authority — sets curve params
  → create            mint fixed supply into curve vault, lock supply, open trading
  → buy / sell        constant-product curve with virtual reserves, slippage-guarded
  → (auto) graduate   when real SOL hits the threshold, curve flips `complete`
  → migrate           permissionless crank: moves remaining tokens + all SOL into an
                      internal AMM pool and mints the initial LP to a pool-owned,
                      no-withdraw account (liquidity permanently locked)
  → swap_sol_for_token / swap_token_for_sol   trade on the pool forever, fee-free
```

## Layout

```
launchpad/
  Anchor.toml
  Cargo.toml
  programs/polyx-launchpad/
    Cargo.toml
    src/
      lib.rs   # EVERYTHING — instructions, accounts, curve + AMM math,
               # state, events, errors (single file, unit-tested)
```

## Deploy on Solana Playground (beta.solpg.io)

1. New project → **Anchor**.
2. Put `lib.rs`, `curve.rs`, `amm.rs`, `state.rs`, `errors.rs` into `src/`.
3. Edit SolPG's `Cargo.toml` deps:
   ```
   anchor-lang = { version = "0.30.1", features = ["init-if-needed"] }
   anchor-spl = "0.30.1"
   ```
4. **Build** (🔨) — SolPG generates the program keypair and syncs `declare_id!`
   (ignore the placeholder id).
5. `solana config set --url devnet`, `solana airdrop 5`, then **Deploy** (🚀).
6. Call `initialize` once with your params, then run the lifecycle on **devnet**.

## Suggested default economics (configurable at `initialize`)

6-decimal token:

| Param | Suggested value |
|---|---|
| token_total_supply | 1_000_000_000 × 10^6 |
| initial_virtual_token_reserves | 1_073_000_000 × 10^6 |
| initial_virtual_sol_reserves | 30 × 10^9 (30 SOL) |
| initial_real_token_reserves | 793_100_000 × 10^6 |
| graduation_sol_lamports | 85 × 10^9 (85 SOL) |

## Before mainnet — non-negotiable

This program custodies user funds. Before touching real SOL:
1. Run the full path on **devnet** (create → buy to threshold → migrate → swap).
2. Write TS integration tests covering slippage, double-migrate, and rounding.
3. Get a **third-party audit**. Rounding direction and PDA/authority checks are the
   classic ways bonding-curve/AMM programs get drained.
```
