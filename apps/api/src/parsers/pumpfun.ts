import { ParsedSwap, TOKENS } from "../grpc/client";

// Pump.fun instruction discriminators (Anchor style - first 8 bytes)
// These are the sighash of the instruction names
const PUMP_BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]); // "buy"
const PUMP_SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]); // "sell"

// Pump.fun bonding curve account structure indices
const PUMP_ACCOUNTS = {
  GLOBAL: 0,
  FEE_RECIPIENT: 1,
  MINT: 2,
  BONDING_CURVE: 3,
  BONDING_CURVE_TOKEN_ACCOUNT: 4,
  USER_TOKEN_ACCOUNT: 5,
  USER: 6,
  SYSTEM_PROGRAM: 7,
  TOKEN_PROGRAM: 8,
  RENT: 9,
  EVENT_AUTHORITY: 10,
  PROGRAM: 11,
};

export function parsePumpFunSwap(
  signature: string,
  slot: number,
  timestamp: number,
  accounts: string[],
  data: Buffer,
  preBalances: Map<string, { mint: string; amount: bigint }>,
  postBalances: Map<string, { mint: string; amount: bigint }>,
  preSolBalances: Map<string, bigint>,
  postSolBalances: Map<string, bigint>
): ParsedSwap | null {
  try {
    if (data.length < 8) {
      return null;
    }

    const discriminator = data.slice(0, 8);
    const isBuy = discriminator.equals(PUMP_BUY_DISCRIMINATOR);
    const isSell = discriminator.equals(PUMP_SELL_DISCRIMINATOR);

    if (!isBuy && !isSell) {
      return null;
    }

    // Get mint address (token being traded)
    if (accounts.length < 7) {
      return null;
    }

    const mint = accounts[PUMP_ACCOUNTS.MINT];
    const user = accounts[PUMP_ACCOUNTS.USER];
    const bondingCurve = accounts[PUMP_ACCOUNTS.BONDING_CURVE];

    // Calculate token amount from balance changes
    let tokenAmount = BigInt(0);
    for (const [account, preBal] of preBalances) {
      if (preBal.mint !== mint) continue;
      const postBal = postBalances.get(account);
      if (!postBal) continue;

      const change = postBal.amount - preBal.amount;
      if (change !== BigInt(0)) {
        tokenAmount = change > 0 ? change : -change;
        break;
      }
    }

    // Calculate SOL amount from balance changes
    let solAmount = BigInt(0);
    const userPreSol = preSolBalances.get(user) || BigInt(0);
    const userPostSol = postSolBalances.get(user) || BigInt(0);
    const solChange = userPostSol - userPreSol;

    // For buys: user loses SOL, gains tokens
    // For sells: user gains SOL, loses tokens
    if (isBuy) {
      solAmount = solChange < 0 ? -solChange : solChange;
    } else {
      solAmount = solChange > 0 ? solChange : -solChange;
    }

    // Pump.fun uses 6 decimals for tokens and 9 for SOL
    const baseAmount = Number(tokenAmount) / 1e6; // Token decimals
    const quoteAmount = Number(solAmount) / 1e9; // SOL decimals

    if (baseAmount === 0 || quoteAmount === 0) {
      return null;
    }

    // Price is SOL per token
    const price = quoteAmount / baseAmount;

    return {
      signature,
      slot,
      timestamp,
      dex: "pump.fun",
      baseMint: mint,
      quoteMint: TOKENS.SOL,
      baseAmount,
      quoteAmount,
      price,
      isBuy,
      maker: user,
    };
  } catch (error) {
    console.error("Error parsing Pump.fun swap:", error);
    return null;
  }
}

// Parse buy instruction data for amount info
export function parsePumpBuyData(data: Buffer): { maxSolCost: bigint; amount: bigint } | null {
  try {
    // Skip 8-byte discriminator
    // Next is amount (u64) and maxSolCost (u64)
    if (data.length < 24) return null;

    const amount = data.readBigUInt64LE(8);
    const maxSolCost = data.readBigUInt64LE(16);

    return { amount, maxSolCost };
  } catch {
    return null;
  }
}

// Parse sell instruction data for amount info
export function parsePumpSellData(data: Buffer): { amount: bigint; minSolOutput: bigint } | null {
  try {
    if (data.length < 24) return null;

    const amount = data.readBigUInt64LE(8);
    const minSolOutput = data.readBigUInt64LE(16);

    return { amount, minSolOutput };
  } catch {
    return null;
  }
}
