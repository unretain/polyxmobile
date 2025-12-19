import {
  Connection,
  VersionedTransaction,
  Keypair,
  TransactionMessage,
  AddressLookupTableAccount,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import bs58 from "bs58";
import { config } from "./config";

// Jupiter API endpoints - try multiple if one fails
const JUPITER_ENDPOINTS = [
  "https://lite-api.jup.ag/swap/v1", // Latest Jupiter lite API
  "https://public.jupiterapi.com", // QuickNode public endpoint
  "https://quote-api.jup.ag/v6", // Official Jupiter endpoint (legacy)
];

// Helius Sender endpoint for ultra-fast transaction landing
// No API key needed, no credits consumed
// Must include: skipPreflight: true, maxRetries: 0, and Jito tip (min 0.0002 SOL)
const HELIUS_SENDER_ENDPOINT = "https://sender.helius-rpc.com/fast";

// Jito tip accounts for MEV protection
const JITO_TIP_ACCOUNTS = [
  "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
  "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ",
  "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
  "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
  "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD",
];

// Current endpoint to use (will fallback on failure)
let currentEndpointIndex = 0;

// Common token mints
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: "ExactIn" | "ExactOut";
  slippageBps: number;
  priceImpactPct: string;
  routePlan: RoutePlanStep[];
  contextSlot: number;
  timeTaken: number;
}

export interface RoutePlanStep {
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
  };
  percent: number;
}

export interface QuoteParams {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
}

export interface SwapResult {
  signature: string;
  inputAmount: string;
  outputAmount: string;
}

export class JupiterService {
  private connection: Connection;
  private heliusApiKey: string | null;

  constructor() {
    const rpcUrl = config.solanaRpcUrl || "https://api.mainnet-beta.solana.com";
    console.log("[JupiterService] RPC URL:", rpcUrl);

    // Warn if not using Helius
    if (!rpcUrl.includes("helius")) {
      console.warn("[JupiterService] WARNING: Not using Helius RPC. Set SOLANA_RPC_URL to https://mainnet.helius-rpc.com/?api-key=YOUR_KEY");
    }

    this.connection = new Connection(rpcUrl, "confirmed");

    // Extract Helius API key from RPC URL if present
    this.heliusApiKey = this.extractHeliusApiKey(rpcUrl);
    if (this.heliusApiKey) {
      console.log("[JupiterService] Helius API key detected:", this.heliusApiKey.substring(0, 8) + "...");
    }
  }

  private extractHeliusApiKey(rpcUrl: string): string | null {
    const match = rpcUrl.match(/api-key=([a-f0-9-]+)/i);
    return match ? match[1] : null;
  }

  /**
   * Get Helius RPC URL with API key
   */
  private getHeliusRpcUrl(): string {
    if (this.heliusApiKey) {
      return `https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`;
    }
    // Fallback to configured RPC or public
    return config.solanaRpcUrl || "https://api.mainnet-beta.solana.com";
  }

  /**
   * Get Jito tip amount
   * Returns 0 to skip Jito tip entirely - we'll use standard RPC instead
   */
  private async getDynamicTipAmount(): Promise<number> {
    // Skip Jito tip - saves 0.0002 SOL per trade
    // Helius Sender requires tip, so we'll fall back to standard RPC
    return 0;
  }

  /**
   * Get priority fee estimate from Helius
   */
  private async getPriorityFeeEstimate(transaction: VersionedTransaction): Promise<number> {
    if (!this.heliusApiKey) {
      return 50000; // Default 50k microLamports if no Helius
    }

    try {
      const serializedTx = bs58.encode(transaction.serialize());
      const response = await fetch(this.getHeliusRpcUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "priority-fee",
          method: "getPriorityFeeEstimate",
          params: [
            {
              transaction: serializedTx,
              options: { recommended: true },
            },
          ],
        }),
        signal: AbortSignal.timeout(10000),
      });

      const data = await response.json();
      if (data.result?.priorityFeeEstimate) {
        console.log("[JupiterService] Priority fee estimate:", data.result.priorityFeeEstimate);
        return data.result.priorityFeeEstimate;
      }
    } catch (error) {
      console.warn("[JupiterService] Failed to get priority fee estimate:", error);
    }

    return 50000; // Default fallback
  }

  /**
   * Get a swap quote from Jupiter with endpoint fallback
   */
  async getQuote(params: QuoteParams): Promise<JupiterQuote> {
    const errors: string[] = [];

    // Try each endpoint until one works
    for (let i = 0; i < JUPITER_ENDPOINTS.length; i++) {
      const endpointIndex = (currentEndpointIndex + i) % JUPITER_ENDPOINTS.length;
      const baseUrl = JUPITER_ENDPOINTS[endpointIndex];

      // Use /quote for lite API, append /quote for others
      const quoteUrl = baseUrl.includes("lite-api") ? `${baseUrl}/quote` : `${baseUrl}/quote`;

      const url = new URL(quoteUrl);
      url.searchParams.set("inputMint", params.inputMint);
      url.searchParams.set("outputMint", params.outputMint);
      url.searchParams.set("amount", params.amount);
      url.searchParams.set("slippageBps", (params.slippageBps || 50).toString());
      url.searchParams.set("onlyDirectRoutes", "false");

      console.log(`[JUPITER] Trying endpoint ${endpointIndex + 1}/${JUPITER_ENDPOINTS.length}: ${baseUrl}`);
      const startTime = Date.now();

      try {
        const response = await fetch(url.toString(), {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent": "PumpLab/1.0",
          },
          signal: AbortSignal.timeout(15000),
        });

        console.log(`[JUPITER] Response status: ${response.status} in ${Date.now() - startTime}ms`);

        if (!response.ok) {
          const error = await response.text();
          console.error(`[JUPITER] Error response: ${error}`);
          errors.push(`Endpoint ${endpointIndex + 1}: ${response.status} - ${error}`);
          continue;
        }

        const data = await response.json();
        console.log(`[JUPITER] Quote received: outAmount=${data.outAmount}`);

        currentEndpointIndex = endpointIndex;
        return data;
      } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`[JUPITER] Fetch error after ${duration}ms:`, error);

        if (error instanceof Error) {
          errors.push(`Endpoint ${endpointIndex + 1}: ${error.message}`);
        }
      }
    }

    throw new Error(`All Jupiter endpoints failed:\n${errors.join("\n")}`);
  }

  /**
   * Get the swap transaction from Jupiter with optimized priority fees
   */
  async getSwapTransaction(
    quoteResponse: JupiterQuote,
    userPublicKey: string
  ): Promise<VersionedTransaction> {
    const errors: string[] = [];

    for (let i = 0; i < JUPITER_ENDPOINTS.length; i++) {
      const endpointIndex = (currentEndpointIndex + i) % JUPITER_ENDPOINTS.length;
      const baseUrl = JUPITER_ENDPOINTS[endpointIndex];

      const swapUrl = baseUrl.includes("lite-api") ? `${baseUrl}/swap` : `${baseUrl}/swap`;

      console.log(`[JUPITER] Trying swap endpoint ${endpointIndex + 1}/${JUPITER_ENDPOINTS.length}: ${baseUrl}`);

      try {
        const response = await fetch(swapUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "PumpLab/1.0",
          },
          body: JSON.stringify({
            quoteResponse,
            userPublicKey,
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            // Use Jupiter's built-in priority fee - keep it low for small trades
            prioritizationFeeLamports: {
              priorityLevelWithMaxLamports: {
                maxLamports: 100000, // Max 0.0001 SOL for priority (reduced from 0.001)
                priorityLevel: "high",
              },
            },
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
          const error = await response.text();
          console.error(`[JUPITER] Swap error: ${error}`);
          errors.push(`Endpoint ${endpointIndex + 1}: ${response.status} - ${error}`);
          continue;
        }

        const { swapTransaction } = await response.json();
        const txBuffer = Buffer.from(swapTransaction, "base64");

        currentEndpointIndex = endpointIndex;
        return VersionedTransaction.deserialize(txBuffer);
      } catch (error) {
        if (error instanceof Error) {
          errors.push(`Endpoint ${endpointIndex + 1}: ${error.message}`);
        }
      }
    }

    throw new Error(`All Jupiter swap endpoints failed:\n${errors.join("\n")}`);
  }

  /**
   * Add Jito tip to transaction for better landing rate
   */
  private async addJitoTip(
    transaction: VersionedTransaction,
    signer: Keypair
  ): Promise<VersionedTransaction> {
    try {
      // Get ALT accounts to decompile the transaction
      const altAccountResponses = await Promise.all(
        transaction.message.addressTableLookups.map((l) =>
          this.connection.getAddressLookupTable(l.accountKey)
        )
      );

      const altAccounts: AddressLookupTableAccount[] = altAccountResponses
        .filter((item) => item.value !== null)
        .map((item) => item.value!);

      // Decompile the message
      const decompiledMessage = TransactionMessage.decompile(transaction.message, {
        addressLookupTableAccounts: altAccounts,
      });

      // Get dynamic tip amount
      const tipAmount = await this.getDynamicTipAmount();
      console.log(`[JupiterService] Adding Jito tip: ${tipAmount / LAMPORTS_PER_SOL} SOL`);

      // Add tip instruction to random Jito account
      const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
      const tipIx = SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: new PublicKey(tipAccount),
        lamports: tipAmount,
      });

      decompiledMessage.instructions.push(tipIx);

      // Recompile and sign
      const newTransaction = new VersionedTransaction(
        decompiledMessage.compileToV0Message(altAccounts)
      );
      newTransaction.sign([signer]);

      return newTransaction;
    } catch (error) {
      console.warn("[JupiterService] Failed to add Jito tip, using original transaction:", error);
      transaction.sign([signer]);
      return transaction;
    }
  }

  /**
   * Sign and execute a swap transaction via standard RPC
   * Skipping Helius Sender to avoid 0.0002 SOL tip requirement
   */
  async executeSwap(
    transaction: VersionedTransaction,
    secretKey: Uint8Array
  ): Promise<string> {
    const signer = Keypair.fromSecretKey(secretKey);

    // Sign transaction (no Jito tip to save fees)
    transaction.sign([signer]);

    // Use configured RPC
    const rpcUrl = config.solanaRpcUrl || "https://api.mainnet-beta.solana.com";
    console.log("[JupiterService] Sending via RPC...");

    const connection = new Connection(rpcUrl, "confirmed");

    try {
      const signature = await connection.sendTransaction(transaction, {
        skipPreflight: false, // Let it validate first
        maxRetries: 5,
      });

      console.log("[JupiterService] Transaction sent:", signature);

      // Wait for confirmation
      const confirmed = await this.pollForConfirmation(connection, signature, transaction);

      if (!confirmed) {
        throw new Error("Transaction failed to confirm within timeout");
      }

      return signature;
    } catch (error) {
      console.error("[JupiterService] Transaction failed:", error);

      if (error instanceof Error) {
        if (error.message.includes("401") || error.message.includes("Unauthorized")) {
          throw new Error("RPC authorization failed. Check your SOLANA_RPC_URL.");
        }
        if (
          error.message.includes("insufficient funds") ||
          error.message.includes("0x1") ||
          error.message.includes("Attempt to debit") ||
          error.message.includes("Custom\":1")
        ) {
          throw new Error("Insufficient SOL balance for this swap (need amount + ~0.0002 SOL fees).");
        }
        if (error.message.includes("blockhash")) {
          throw new Error("Transaction expired. Please try again.");
        }
      }
      throw error;
    }
  }

  /**
   * Poll for transaction confirmation with rebroadcast (Helius best practice)
   */
  private async pollForConfirmation(
    connection: Connection,
    signature: string,
    transaction: VersionedTransaction,
    maxAttempts: number = 30
  ): Promise<boolean> {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Check signature status
        const statuses = await connection.getSignatureStatuses([signature]);
        const status = statuses?.value?.[0];

        if (status) {
          if (status.err) {
            console.error("[JupiterService] Transaction failed:", status.err);
            throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
          }

          if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
            console.log(`[JupiterService] Transaction confirmed: ${status.confirmationStatus}`);
            return true;
          }
        }

        // Check if blockhash expired
        const currentBlockHeight = await connection.getBlockHeight();
        if (currentBlockHeight > lastValidBlockHeight) {
          console.log("[JupiterService] Blockhash expired");
          return false;
        }

        // Rebroadcast every 2 seconds (Helius recommendation)
        if (attempt > 0 && attempt % 2 === 0) {
          console.log(`[JupiterService] Rebroadcasting transaction (attempt ${attempt + 1})...`);
          try {
            await connection.sendTransaction(transaction, {
              skipPreflight: true,
              maxRetries: 0,
            });
          } catch {
            // Ignore rebroadcast errors
          }
        }

        // Wait 1 second before next poll
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        if (error instanceof Error && error.message.includes("Transaction failed")) {
          throw error;
        }
        console.warn(`[JupiterService] Poll attempt ${attempt + 1} error:`, error);
      }
    }

    return false;
  }

  /**
   * Get SOL balance for a wallet
   */
  async getSolBalance(walletAddress: string): Promise<number> {
    const balance = await this.connection.getBalance(new PublicKey(walletAddress));
    return balance;
  }

  /**
   * Get token accounts for a wallet
   */
  async getTokenAccounts(
    walletAddress: string
  ): Promise<Array<{ mint: string; balance: string; decimals: number }>> {
    const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");

    const accounts = await this.connection.getParsedTokenAccountsByOwner(
      new PublicKey(walletAddress),
      { programId: TOKEN_PROGRAM_ID }
    );

    return accounts.value.map((account) => {
      const info = account.account.data.parsed.info;
      return {
        mint: info.mint,
        balance: info.tokenAmount.amount,
        decimals: info.tokenAmount.decimals,
      };
    });
  }

  /**
   * Get token prices in USD from Jupiter Price API
   * @param mints Array of token mint addresses
   * @returns Map of mint address to price in USD
   */
  async getTokenPrices(mints: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    if (mints.length === 0) {
      return prices;
    }

    try {
      // Jupiter Price API v2
      const url = new URL("https://api.jup.ag/price/v2");
      url.searchParams.set("ids", mints.join(","));
      url.searchParams.set("showExtraInfo", "false");

      console.log(`[JupiterService] Fetching prices for ${mints.length} tokens`);

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "PumpLab/1.0",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.error(`[JupiterService] Price API error: ${response.status}`);
        return prices;
      }

      const data = await response.json();

      // data.data is a map of mint -> { id, type, price }
      if (data.data) {
        for (const [mint, info] of Object.entries(data.data)) {
          const priceInfo = info as { price?: string };
          if (priceInfo.price) {
            prices.set(mint, parseFloat(priceInfo.price));
          }
        }
      }

      console.log(`[JupiterService] Got prices for ${prices.size}/${mints.length} tokens`);
      return prices;
    } catch (error) {
      console.error("[JupiterService] Failed to fetch token prices:", error);
      return prices;
    }
  }

  /**
   * Get the connection instance
   */
  getConnection(): Connection {
    return this.connection;
  }
}

// Create fresh instance each time to ensure config is read
export function getJupiterService(): JupiterService {
  return new JupiterService();
}
