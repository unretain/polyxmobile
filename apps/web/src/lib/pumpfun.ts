import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { config } from "./config";

// Pump.fun Program Constants
const PUMP_FUN_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMP_GLOBAL = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
const PUMP_FEE_RECIPIENT = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7fskvCwf8gCDbZ");
const PUMP_EVENT_AUTHORITY = new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7Hx6SgqR");

// Instruction discriminators
const BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
const SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

// SOL mint for reference
const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

export interface BondingCurveData {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
}

export interface PumpQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  outAmountMin: string;
  priceImpactPct: number;
  isBuy: boolean;
  bondingCurve: string;
}

export class PumpFunService {
  private connection: Connection;
  private rpcUrl: string;

  constructor() {
    this.rpcUrl = config.solanaRpcUrl || "https://api.mainnet-beta.solana.com";
    console.log("[PumpFunService] Initializing with RPC:", this.rpcUrl.substring(0, 40) + "...");
    this.connection = new Connection(this.rpcUrl, "confirmed");
  }

  /**
   * Derive the bonding curve PDA for a token
   */
  getBondingCurvePDA(mint: PublicKey): PublicKey {
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mint.toBuffer()],
      PUMP_FUN_PROGRAM_ID
    );
    return bondingCurve;
  }

  /**
   * Get the associated bonding curve token account
   */
  async getBondingCurveTokenAccount(mint: PublicKey): Promise<PublicKey> {
    const bondingCurve = this.getBondingCurvePDA(mint);
    return getAssociatedTokenAddress(mint, bondingCurve, true);
  }

  /**
   * Fetch and parse bonding curve account data
   */
  async getBondingCurveData(mint: PublicKey): Promise<BondingCurveData | null> {
    try {
      const bondingCurve = this.getBondingCurvePDA(mint);
      const accountInfo = await this.connection.getAccountInfo(bondingCurve);

      if (!accountInfo || accountInfo.data.length < 41) {
        return null;
      }

      const data = accountInfo.data;

      // Parse the bonding curve data structure
      // Layout: 8 bytes discriminator + fields
      const virtualTokenReserves = data.readBigUInt64LE(8);
      const virtualSolReserves = data.readBigUInt64LE(16);
      const realTokenReserves = data.readBigUInt64LE(24);
      const realSolReserves = data.readBigUInt64LE(32);
      const tokenTotalSupply = data.readBigUInt64LE(40);
      const complete = data[48] === 1;

      return {
        virtualTokenReserves,
        virtualSolReserves,
        realTokenReserves,
        realSolReserves,
        tokenTotalSupply,
        complete,
      };
    } catch (error) {
      console.error("Failed to fetch bonding curve data:", error);
      return null;
    }
  }

  /**
   * Check if a token is on the pump.fun bonding curve
   */
  async isOnBondingCurve(mintAddress: string): Promise<boolean> {
    try {
      const mint = new PublicKey(mintAddress);
      const bondingCurve = this.getBondingCurvePDA(mint);
      console.log("[PumpFunService] Checking bonding curve PDA:", bondingCurve.toBase58());

      const accountInfo = await this.connection.getAccountInfo(bondingCurve);
      console.log("[PumpFunService] Account info exists:", !!accountInfo);

      if (!accountInfo) {
        console.log("[PumpFunService] No account found for bonding curve");
        return false;
      }

      // Check if it's owned by pump.fun program
      const isOwned = accountInfo.owner.equals(PUMP_FUN_PROGRAM_ID);
      console.log("[PumpFunService] Owned by pump.fun program:", isOwned, "Owner:", accountInfo.owner.toBase58());
      return isOwned;
    } catch (error) {
      console.error("[PumpFunService] Error checking bonding curve:", error);
      return false;
    }
  }

  /**
   * Calculate buy quote using bonding curve formula
   * Returns amount of tokens received for given SOL input
   */
  async getBuyQuote(
    mintAddress: string,
    solAmount: bigint
  ): Promise<PumpQuote | null> {
    try {
      const mint = new PublicKey(mintAddress);
      const curveData = await this.getBondingCurveData(mint);

      if (!curveData) {
        throw new Error("Token not found on bonding curve");
      }

      if (curveData.complete) {
        throw new Error("Bonding curve complete - use Raydium/Jupiter");
      }

      // Constant product formula: x * y = k
      // tokens_out = (sol_in * virtual_token_reserves) / (virtual_sol_reserves + sol_in)
      const tokensOut =
        (solAmount * curveData.virtualTokenReserves) /
        (curveData.virtualSolReserves + solAmount);

      // Calculate price impact
      const priceImpact = this.calculatePriceImpact(
        solAmount,
        curveData.virtualSolReserves,
        true
      );

      // Apply 1% slippage for min amount
      const tokensOutMin = (tokensOut * BigInt(99)) / BigInt(100);

      return {
        inputMint: SOL_MINT.toBase58(),
        outputMint: mintAddress,
        inAmount: solAmount.toString(),
        outAmount: tokensOut.toString(),
        outAmountMin: tokensOutMin.toString(),
        priceImpactPct: priceImpact,
        isBuy: true,
        bondingCurve: this.getBondingCurvePDA(mint).toBase58(),
      };
    } catch (error) {
      console.error("Buy quote error:", error);
      throw error;
    }
  }

  /**
   * Calculate sell quote using bonding curve formula
   * Returns amount of SOL received for given token input
   */
  async getSellQuote(
    mintAddress: string,
    tokenAmount: bigint
  ): Promise<PumpQuote | null> {
    try {
      const mint = new PublicKey(mintAddress);
      const curveData = await this.getBondingCurveData(mint);

      if (!curveData) {
        throw new Error("Token not found on bonding curve");
      }

      if (curveData.complete) {
        throw new Error("Bonding curve complete - use Raydium/Jupiter");
      }

      // Constant product formula: x * y = k
      // sol_out = (token_in * virtual_sol_reserves) / (virtual_token_reserves + token_in)
      const solOut =
        (tokenAmount * curveData.virtualSolReserves) /
        (curveData.virtualTokenReserves + tokenAmount);

      // Calculate price impact
      const priceImpact = this.calculatePriceImpact(
        tokenAmount,
        curveData.virtualTokenReserves,
        false
      );

      // Apply 1% slippage for min amount
      const solOutMin = (solOut * BigInt(99)) / BigInt(100);

      return {
        inputMint: mintAddress,
        outputMint: SOL_MINT.toBase58(),
        inAmount: tokenAmount.toString(),
        outAmount: solOut.toString(),
        outAmountMin: solOutMin.toString(),
        priceImpactPct: priceImpact,
        isBuy: false,
        bondingCurve: this.getBondingCurvePDA(mint).toBase58(),
      };
    } catch (error) {
      console.error("Sell quote error:", error);
      throw error;
    }
  }

  /**
   * Calculate price impact percentage
   */
  private calculatePriceImpact(
    inputAmount: bigint,
    reserveAmount: bigint,
    isBuy: boolean
  ): number {
    // Price impact = input / reserve * 100
    const impact =
      (Number(inputAmount) / Number(reserveAmount)) * 100;
    return Math.min(impact, 100);
  }

  /**
   * Build buy instruction for pump.fun
   */
  async buildBuyInstruction(
    mint: PublicKey,
    buyer: PublicKey,
    solAmount: bigint,
    minTokensOut: bigint
  ): Promise<TransactionInstruction> {
    const bondingCurve = this.getBondingCurvePDA(mint);
    const bondingCurveTokenAccount = await this.getBondingCurveTokenAccount(mint);
    const buyerTokenAccount = await getAssociatedTokenAddress(mint, buyer);

    // Instruction data: discriminator + amount (u64) + max_sol_cost (u64)
    const data = Buffer.alloc(8 + 8 + 8);
    BUY_DISCRIMINATOR.copy(data, 0);
    data.writeBigUInt64LE(minTokensOut, 8);
    data.writeBigUInt64LE(solAmount, 16);

    const keys = [
      { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
      { pubkey: PUMP_FEE_RECIPIENT, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: bondingCurveTokenAccount, isSigner: false, isWritable: true },
      { pubkey: buyerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: PUMP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PUMP_FUN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    return new TransactionInstruction({
      keys,
      programId: PUMP_FUN_PROGRAM_ID,
      data,
    });
  }

  /**
   * Build sell instruction for pump.fun
   */
  async buildSellInstruction(
    mint: PublicKey,
    seller: PublicKey,
    tokenAmount: bigint,
    minSolOut: bigint
  ): Promise<TransactionInstruction> {
    const bondingCurve = this.getBondingCurvePDA(mint);
    const bondingCurveTokenAccount = await this.getBondingCurveTokenAccount(mint);
    const sellerTokenAccount = await getAssociatedTokenAddress(mint, seller);

    // Instruction data: discriminator + amount (u64) + min_sol_output (u64)
    const data = Buffer.alloc(8 + 8 + 8);
    SELL_DISCRIMINATOR.copy(data, 0);
    data.writeBigUInt64LE(tokenAmount, 8);
    data.writeBigUInt64LE(minSolOut, 16);

    const keys = [
      { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
      { pubkey: PUMP_FEE_RECIPIENT, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: bondingCurveTokenAccount, isSigner: false, isWritable: true },
      { pubkey: sellerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: seller, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: PUMP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PUMP_FUN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    return new TransactionInstruction({
      keys,
      programId: PUMP_FUN_PROGRAM_ID,
      data,
    });
  }

  /**
   * Execute a buy transaction
   */
  async executeBuy(
    mintAddress: string,
    buyerKeypair: Keypair,
    solAmount: bigint,
    slippageBps: number = 100 // 1% default
  ): Promise<string> {
    const mint = new PublicKey(mintAddress);
    const buyer = buyerKeypair.publicKey;

    // Get quote first
    const quote = await this.getBuyQuote(mintAddress, solAmount);
    if (!quote) {
      throw new Error("Failed to get buy quote");
    }

    // Apply slippage to minimum tokens out
    const minTokensOut =
      (BigInt(quote.outAmount) * BigInt(10000 - slippageBps)) / BigInt(10000);

    // Check if user has token account, create if needed
    const buyerTokenAccount = await getAssociatedTokenAddress(mint, buyer);
    const accountInfo = await this.connection.getAccountInfo(buyerTokenAccount);

    const transaction = new Transaction();

    // Add create ATA instruction if needed
    if (!accountInfo) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          buyer,
          buyerTokenAccount,
          buyer,
          mint
        )
      );
    }

    // Add buy instruction
    const buyIx = await this.buildBuyInstruction(
      mint,
      buyer,
      solAmount,
      minTokensOut
    );
    transaction.add(buyIx);

    // Get recent blockhash
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = buyer;

    // Sign and send
    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [buyerKeypair],
      { commitment: "confirmed" }
    );

    return signature;
  }

  /**
   * Execute a sell transaction
   */
  async executeSell(
    mintAddress: string,
    sellerKeypair: Keypair,
    tokenAmount: bigint,
    slippageBps: number = 100 // 1% default
  ): Promise<string> {
    const mint = new PublicKey(mintAddress);
    const seller = sellerKeypair.publicKey;

    // Get quote first
    const quote = await this.getSellQuote(mintAddress, tokenAmount);
    if (!quote) {
      throw new Error("Failed to get sell quote");
    }

    // Apply slippage to minimum SOL out
    const minSolOut =
      (BigInt(quote.outAmount) * BigInt(10000 - slippageBps)) / BigInt(10000);

    // Build sell instruction
    const sellIx = await this.buildSellInstruction(
      mint,
      seller,
      tokenAmount,
      minSolOut
    );

    const transaction = new Transaction().add(sellIx);

    // Get recent blockhash
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = seller;

    // Sign and send
    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [sellerKeypair],
      { commitment: "confirmed" }
    );

    return signature;
  }
}

// Singleton instance
let pumpFunService: PumpFunService | null = null;

export function getPumpFunService(): PumpFunService {
  if (!pumpFunService) {
    pumpFunService = new PumpFunService();
  }
  return pumpFunService;
}
