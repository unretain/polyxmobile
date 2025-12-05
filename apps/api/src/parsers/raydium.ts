import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { ParsedSwap, DEX_PROGRAMS, TOKENS } from "../grpc/client";

// Raydium AMM instruction discriminators
const RAYDIUM_SWAP_BASE_IN = 9;
const RAYDIUM_SWAP_BASE_OUT = 11;

// Raydium CLMM swap discriminators (first 8 bytes of instruction data)
const CLMM_SWAP_DISCRIMINATOR = Buffer.from([248, 198, 158, 145, 225, 117, 135, 200]);

interface RaydiumSwapAccounts {
  amm: string;
  poolCoinTokenAccount: string;
  poolPcTokenAccount: string;
  userSourceTokenAccount: string;
  userDestTokenAccount: string;
  userOwner: string;
}

export function parseRaydiumAmmSwap(
  signature: string,
  slot: number,
  timestamp: number,
  accounts: string[],
  data: Buffer,
  preBalances: Map<string, { mint: string; amount: bigint }>,
  postBalances: Map<string, { mint: string; amount: bigint }>
): ParsedSwap | null {
  try {
    const instruction = data[0];

    if (instruction !== RAYDIUM_SWAP_BASE_IN && instruction !== RAYDIUM_SWAP_BASE_OUT) {
      return null;
    }

    // Raydium AMM swap account layout (simplified):
    // 0: token_program
    // 1: amm_id
    // 2: amm_authority
    // 3: amm_open_orders
    // 4: amm_target_orders (optional)
    // 5: pool_coin_token_account
    // 6: pool_pc_token_account
    // 7: serum_program (optional)
    // ... more serum accounts
    // user_source_token_account
    // user_dest_token_account
    // user_owner

    if (accounts.length < 10) {
      return null;
    }

    // Find user token accounts by looking at balance changes
    let sourceAccount: string | null = null;
    let destAccount: string | null = null;
    let sourceMint: string | null = null;
    let destMint: string | null = null;
    let sourceChange = BigInt(0);
    let destChange = BigInt(0);

    for (const [account, preBal] of preBalances) {
      const postBal = postBalances.get(account);
      if (!postBal) continue;

      const change = postBal.amount - preBal.amount;

      if (change < 0 && !sourceAccount) {
        sourceAccount = account;
        sourceMint = preBal.mint;
        sourceChange = -change;
      } else if (change > 0 && !destAccount) {
        destAccount = account;
        destMint = postBal.mint;
        destChange = change;
      }
    }

    if (!sourceMint || !destMint || sourceChange === BigInt(0) || destChange === BigInt(0)) {
      return null;
    }

    // Determine base/quote (SOL or USDC is usually quote)
    const isSourceQuote = sourceMint === TOKENS.SOL || sourceMint === TOKENS.USDC || sourceMint === TOKENS.USDT;
    const isDestQuote = destMint === TOKENS.SOL || destMint === TOKENS.USDC || destMint === TOKENS.USDT;

    let baseMint: string;
    let quoteMint: string;
    let baseAmount: number;
    let quoteAmount: number;
    let isBuy: boolean;

    if (isDestQuote && !isSourceQuote) {
      // Selling base for quote
      baseMint = sourceMint;
      quoteMint = destMint;
      baseAmount = Number(sourceChange) / 1e9; // Assuming 9 decimals
      quoteAmount = Number(destChange) / 1e9;
      isBuy = false;
    } else if (isSourceQuote && !isDestQuote) {
      // Buying base with quote
      baseMint = destMint;
      quoteMint = sourceMint;
      baseAmount = Number(destChange) / 1e9;
      quoteAmount = Number(sourceChange) / 1e9;
      isBuy = true;
    } else {
      // Both or neither are quote tokens, pick one as base
      baseMint = sourceMint;
      quoteMint = destMint;
      baseAmount = Number(sourceChange) / 1e9;
      quoteAmount = Number(destChange) / 1e9;
      isBuy = false;
    }

    const price = quoteAmount / baseAmount;

    return {
      signature,
      slot,
      timestamp,
      dex: "raydium",
      baseMint,
      quoteMint,
      baseAmount,
      quoteAmount,
      price,
      isBuy,
      maker: accounts[accounts.length - 1], // Last account is usually user owner
    };
  } catch (error) {
    console.error("Error parsing Raydium AMM swap:", error);
    return null;
  }
}

export function parseRaydiumClmmSwap(
  signature: string,
  slot: number,
  timestamp: number,
  accounts: string[],
  data: Buffer,
  preBalances: Map<string, { mint: string; amount: bigint }>,
  postBalances: Map<string, { mint: string; amount: bigint }>
): ParsedSwap | null {
  try {
    // Check discriminator
    const discriminator = data.slice(0, 8);
    if (!discriminator.equals(CLMM_SWAP_DISCRIMINATOR)) {
      return null;
    }

    // Similar logic to AMM swap parsing
    let sourceAccount: string | null = null;
    let destAccount: string | null = null;
    let sourceMint: string | null = null;
    let destMint: string | null = null;
    let sourceChange = BigInt(0);
    let destChange = BigInt(0);

    for (const [account, preBal] of preBalances) {
      const postBal = postBalances.get(account);
      if (!postBal) continue;

      const change = postBal.amount - preBal.amount;

      if (change < 0 && !sourceAccount) {
        sourceAccount = account;
        sourceMint = preBal.mint;
        sourceChange = -change;
      } else if (change > 0 && !destAccount) {
        destAccount = account;
        destMint = postBal.mint;
        destChange = change;
      }
    }

    if (!sourceMint || !destMint || sourceChange === BigInt(0) || destChange === BigInt(0)) {
      return null;
    }

    const isSourceQuote = sourceMint === TOKENS.SOL || sourceMint === TOKENS.USDC || sourceMint === TOKENS.USDT;
    const isDestQuote = destMint === TOKENS.SOL || destMint === TOKENS.USDC || destMint === TOKENS.USDT;

    let baseMint: string;
    let quoteMint: string;
    let baseAmount: number;
    let quoteAmount: number;
    let isBuy: boolean;

    if (isDestQuote && !isSourceQuote) {
      baseMint = sourceMint;
      quoteMint = destMint;
      baseAmount = Number(sourceChange) / 1e9;
      quoteAmount = Number(destChange) / 1e9;
      isBuy = false;
    } else if (isSourceQuote && !isDestQuote) {
      baseMint = destMint;
      quoteMint = sourceMint;
      baseAmount = Number(destChange) / 1e9;
      quoteAmount = Number(sourceChange) / 1e9;
      isBuy = true;
    } else {
      baseMint = sourceMint;
      quoteMint = destMint;
      baseAmount = Number(sourceChange) / 1e9;
      quoteAmount = Number(destChange) / 1e9;
      isBuy = false;
    }

    const price = quoteAmount / baseAmount;

    return {
      signature,
      slot,
      timestamp,
      dex: "raydium-clmm",
      baseMint,
      quoteMint,
      baseAmount,
      quoteAmount,
      price,
      isBuy,
      maker: accounts[0],
    };
  } catch (error) {
    console.error("Error parsing Raydium CLMM swap:", error);
    return null;
  }
}
