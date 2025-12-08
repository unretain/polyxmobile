import { Connection, VersionedTransaction, Keypair } from "@solana/web3.js";
import { config } from "./config";

// Jupiter API endpoints - try multiple if one fails
// Note: quote-api.jup.ag has DNS issues on some hosts (like Railway)
// public.jupiterapi.com is a reliable fallback hosted by QuickNode
const JUPITER_ENDPOINTS = [
  "https://public.jupiterapi.com",  // QuickNode public endpoint (most reliable)
  "https://quote-api.jup.ag/v6",     // Official Jupiter endpoint
];

// Current endpoint to use (will fallback on failure)
let currentEndpointIndex = 0;

// Platform fee - disabled for now (requires referral program setup with Jupiter)
// To enable: Apply at https://referral.jup.ag/ and get a referral account
// const PLATFORM_FEE_WALLET = "E1KexcKsZb5Pkz7Uy2tEVqKvWjAq9XbyaUBddsuxePNt";
// const PLATFORM_FEE_BPS = 100; // 1% fee

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

  constructor() {
    const rpcUrl = config.solanaRpcUrl || "https://api.mainnet-beta.solana.com";
    console.log("[JupiterService] Initializing with RPC:", rpcUrl.substring(0, 40) + "...");
    this.connection = new Connection(rpcUrl, "confirmed");
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

      const url = new URL(`${baseUrl}/quote`);
      url.searchParams.set("inputMint", params.inputMint);
      url.searchParams.set("outputMint", params.outputMint);
      url.searchParams.set("amount", params.amount);
      url.searchParams.set("slippageBps", (params.slippageBps || 50).toString());
      url.searchParams.set("onlyDirectRoutes", "false");
      url.searchParams.set("asLegacyTransaction", "false");

      console.log(`[JUPITER] Trying endpoint ${endpointIndex + 1}/${JUPITER_ENDPOINTS.length}: ${baseUrl}`);
      console.log(`[JUPITER] Fetching quote from: ${url.toString().substring(0, 120)}...`);
      const startTime = Date.now();

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout per endpoint

        const response = await fetch(url.toString(), {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "User-Agent": "PumpLab/1.0",
          },
          signal: controller.signal,
        });

        clearTimeout(timeout);
        console.log(`[JUPITER] Response status: ${response.status} in ${Date.now() - startTime}ms`);

        if (!response.ok) {
          const error = await response.text();
          console.error(`[JUPITER] Error response: ${error}`);
          errors.push(`Endpoint ${endpointIndex + 1}: ${response.status} - ${error}`);
          continue; // Try next endpoint
        }

        const data = await response.json();
        console.log(`[JUPITER] Quote received: outAmount=${data.outAmount}`);

        // Remember which endpoint worked
        currentEndpointIndex = endpointIndex;
        return data;
      } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`[JUPITER] Fetch error after ${duration}ms:`, error);

        if (error instanceof Error) {
          if (error.name === "AbortError") {
            errors.push(`Endpoint ${endpointIndex + 1}: timeout after ${duration}ms`);
          } else {
            errors.push(`Endpoint ${endpointIndex + 1}: ${error.message}`);
          }
        }
        // Continue to try next endpoint
      }
    }

    // All endpoints failed
    throw new Error(`All Jupiter endpoints failed:\n${errors.join("\n")}`);
  }

  /**
   * Get the swap transaction from Jupiter with endpoint fallback
   */
  async getSwapTransaction(
    quoteResponse: JupiterQuote,
    userPublicKey: string
  ): Promise<VersionedTransaction> {
    const errors: string[] = [];

    // Try each endpoint until one works
    for (let i = 0; i < JUPITER_ENDPOINTS.length; i++) {
      const endpointIndex = (currentEndpointIndex + i) % JUPITER_ENDPOINTS.length;
      const baseUrl = JUPITER_ENDPOINTS[endpointIndex];

      console.log(`[JUPITER] Trying swap endpoint ${endpointIndex + 1}/${JUPITER_ENDPOINTS.length}: ${baseUrl}`);

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(`${baseUrl}/swap`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "PumpLab/1.0",
          },
          body: JSON.stringify({
            quoteResponse,
            userPublicKey,
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: "auto",
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const error = await response.text();
          console.error(`[JUPITER] Swap error: ${error}`);
          errors.push(`Endpoint ${endpointIndex + 1}: ${response.status} - ${error}`);
          continue;
        }

        const { swapTransaction } = await response.json();
        const txBuffer = Buffer.from(swapTransaction, "base64");

        // Remember which endpoint worked
        currentEndpointIndex = endpointIndex;
        return VersionedTransaction.deserialize(txBuffer);
      } catch (error) {
        if (error instanceof Error) {
          if (error.name === "AbortError") {
            errors.push(`Endpoint ${endpointIndex + 1}: timeout`);
          } else {
            errors.push(`Endpoint ${endpointIndex + 1}: ${error.message}`);
          }
        }
      }
    }

    throw new Error(`All Jupiter swap endpoints failed:\n${errors.join("\n")}`);
  }

  /**
   * Sign and execute a swap transaction
   */
  async executeSwap(
    transaction: VersionedTransaction,
    secretKey: Uint8Array
  ): Promise<string> {
    const signer = Keypair.fromSecretKey(secretKey);

    // Sign the transaction
    transaction.sign([signer]);

    // Send transaction
    const signature = await this.connection.sendTransaction(transaction, {
      skipPreflight: false,
      maxRetries: 3,
    });

    // Wait for confirmation
    const confirmation = await this.connection.confirmTransaction(
      signature,
      "confirmed"
    );

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    return signature;
  }

  /**
   * Get SOL balance for a wallet
   */
  async getSolBalance(walletAddress: string): Promise<number> {
    const { PublicKey } = await import("@solana/web3.js");
    const balance = await this.connection.getBalance(new PublicKey(walletAddress));
    return balance;
  }

  /**
   * Get token accounts for a wallet
   */
  async getTokenAccounts(walletAddress: string): Promise<Array<{
    mint: string;
    balance: string;
    decimals: number;
  }>> {
    const { PublicKey } = await import("@solana/web3.js");
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
