import { Connection, VersionedTransaction, Keypair } from "@solana/web3.js";
import { deriveKeypairFromMnemonic } from "./mobileWallet";

// RPC endpoint - use public one for mobile
const RPC_URL = "https://api.mainnet-beta.solana.com";

// Jupiter API
const JUPITER_API = "https://quote-api.jup.ag/v6";

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: number;
  routePlan: Array<{ label: string; percent: number }>;
}

/**
 * Get a swap quote from Jupiter
 */
export async function getSwapQuote(
  inputMint: string,
  outputMint: string,
  amount: string,
  slippageBps: number = 3000 // 30% for memecoins
): Promise<SwapQuote> {
  const url = `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`;

  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to get quote");
  }

  const quote = await response.json();

  return {
    inputMint: quote.inputMint,
    outputMint: quote.outputMint,
    inAmount: quote.inAmount,
    outAmount: quote.outAmount,
    priceImpactPct: parseFloat(quote.priceImpactPct),
    routePlan: quote.routePlan?.map((step: { swapInfo: { label: string }; percent: number }) => ({
      label: step.swapInfo.label,
      percent: step.percent,
    })) || [],
  };
}

/**
 * Execute a swap using the local mnemonic
 * This signs the transaction client-side - no server needed
 */
export async function executeSwap(
  mnemonic: string,
  inputMint: string,
  outputMint: string,
  amount: string,
  slippageBps: number = 3000
): Promise<{ signature: string; explorerUrl: string }> {
  // 1. Derive keypair from mnemonic
  const { publicKey, secretKey } = deriveKeypairFromMnemonic(mnemonic);
  const keypair = Keypair.fromSecretKey(secretKey);

  // 2. Get quote from Jupiter
  const quoteUrl = `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`;
  const quoteResponse = await fetch(quoteUrl);
  if (!quoteResponse.ok) {
    throw new Error("Failed to get quote");
  }
  const quote = await quoteResponse.json();

  // 3. Get swap transaction from Jupiter
  const swapResponse = await fetch(`${JUPITER_API}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: publicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
  });

  if (!swapResponse.ok) {
    const error = await swapResponse.json().catch(() => ({}));
    throw new Error(error.error || "Failed to create swap transaction");
  }

  const { swapTransaction } = await swapResponse.json();

  // 4. Deserialize and sign transaction
  const transactionBuf = Buffer.from(swapTransaction, "base64");
  const transaction = VersionedTransaction.deserialize(transactionBuf);
  transaction.sign([keypair]);

  // 5. Send transaction
  const connection = new Connection(RPC_URL, "confirmed");
  const signature = await connection.sendTransaction(transaction, {
    skipPreflight: true,
    maxRetries: 3,
  });

  // 6. Confirm transaction
  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  });

  // Clear sensitive data
  secretKey.fill(0);

  return {
    signature,
    explorerUrl: `https://solscan.io/tx/${signature}`,
  };
}

/**
 * Client-side pump.fun / PumpSwap swap using the persisted mobile wallet.
 * Uses PumpPortal's local-trade API (returns a tx we sign locally), so buying a
 * bonding-curve coin never needs a server session — same as the Jupiter path.
 * `pool: "auto"` routes to the bonding curve OR the AMM if the coin migrated.
 *
 * amount is RAW: buy -> lamports of SOL; sell -> token base units (6 decimals).
 */
export async function executeClientPumpSwap(
  mnemonic: string,
  tokenMint: string,
  amount: string,
  slippageBps: number = 1000,
  isBuy: boolean = true
): Promise<{ signature: string; explorerUrl: string }> {
  const { publicKey, secretKey } = deriveKeypairFromMnemonic(mnemonic);
  const keypair = Keypair.fromSecretKey(secretKey);

  const denominatedInSol = isBuy ? "true" : "false";
  const amountValue = isBuy ? Number(amount) / 1e9 : Number(amount) / 1e6;

  const res = await fetch("https://pumpportal.fun/api/trade-local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey,
      action: isBuy ? "buy" : "sell",
      mint: tokenMint,
      amount: amountValue,
      denominatedInSol,
      slippage: Math.max(1, Math.round(slippageBps / 100)),
      priorityFee: 0.00001,
      pool: "auto",
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Pump trade failed: ${t.slice(0, 120) || res.status}`);
  }

  const data = new Uint8Array(await res.arrayBuffer());
  const transaction = VersionedTransaction.deserialize(data);
  transaction.sign([keypair]);

  const connection = new Connection(RPC_URL, "confirmed");
  const signature = await connection.sendTransaction(transaction, { skipPreflight: true, maxRetries: 3 });
  const bh = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight });

  secretKey.fill(0);
  return { signature, explorerUrl: `https://solscan.io/tx/${signature}` };
}

/**
 * Get wallet balance using RPC
 */
export async function getWalletBalance(publicKey: string): Promise<number> {
  const connection = new Connection(RPC_URL, "confirmed");
  const balance = await connection.getBalance(new (await import("@solana/web3.js")).PublicKey(publicKey));
  return balance / 1e9; // Convert lamports to SOL
}
