import { Connection, VersionedTransaction, Keypair } from "@solana/web3.js";
import { config } from "./config";

const JUPITER_QUOTE_API = "https://quote-api.jup.ag/v6";

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
    this.connection = new Connection(config.solanaRpcUrl, "confirmed");
  }

  /**
   * Get a swap quote from Jupiter
   */
  async getQuote(params: QuoteParams): Promise<JupiterQuote> {
    const url = new URL(`${JUPITER_QUOTE_API}/quote`);
    url.searchParams.set("inputMint", params.inputMint);
    url.searchParams.set("outputMint", params.outputMint);
    url.searchParams.set("amount", params.amount);
    url.searchParams.set("slippageBps", (params.slippageBps || 50).toString()); // Default 0.5%
    url.searchParams.set("onlyDirectRoutes", "false");
    url.searchParams.set("asLegacyTransaction", "false");
    // Platform fee disabled - requires Jupiter referral program
    // url.searchParams.set("platformFeeBps", PLATFORM_FEE_BPS.toString());

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "Accept": "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Jupiter quote failed (${response.status}): ${error}`);
      }

      return response.json();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Jupiter API timeout - please try again");
      }
      throw error;
    }
  }

  /**
   * Get the swap transaction from Jupiter
   */
  async getSwapTransaction(
    quoteResponse: JupiterQuote,
    userPublicKey: string
  ): Promise<VersionedTransaction> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

      const response = await fetch(`${JUPITER_QUOTE_API}/swap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          quoteResponse,
          userPublicKey,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: "auto",
          // Fee account disabled - requires Jupiter referral program setup
          // feeAccount: PLATFORM_FEE_WALLET,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Jupiter swap transaction failed (${response.status}): ${error}`);
      }

      const { swapTransaction } = await response.json();
      const txBuffer = Buffer.from(swapTransaction, "base64");
      return VersionedTransaction.deserialize(txBuffer);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Jupiter API timeout - please try again");
      }
      throw error;
    }
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

// Singleton instance
let jupiterService: JupiterService | null = null;

export function getJupiterService(): JupiterService {
  if (!jupiterService) {
    jupiterService = new JupiterService();
  }
  return jupiterService;
}
