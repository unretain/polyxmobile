import {
  Connection,
  VersionedTransaction,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import { deriveKeypairFromMnemonic } from "./mobileWallet";

// RPC endpoint — Tatum by default (env-overridable). The API key, if set, is
// sent as the x-api-key header for the dedicated rate quota.
const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://solana-mainnet.gateway.tatum.io";
const RPC_KEY = process.env.NEXT_PUBLIC_SOLANA_RPC_KEY || "";
function getConnection(): Connection {
  return new Connection(
    RPC_URL,
    RPC_KEY ? { commitment: "confirmed", httpHeaders: { "x-api-key": RPC_KEY } } : "confirmed"
  );
}

// Confirm by POLLING getSignatureStatus (plain HTTP) instead of connection.
// confirmTransaction, which opens a WebSocket. Tatum has no WS endpoint, so the WS
// path just spams "ws error" and never resolves. Polling uses the same HTTP RPC.
async function confirmByPolling(connection: Connection, signature: string, timeoutMs = 45000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { value } = await connection.getSignatureStatus(signature, { searchTransactionHistory: false });
    if (value?.err) throw new Error("Transaction failed on-chain");
    if (value?.confirmationStatus === "confirmed" || value?.confirmationStatus === "finalized") return;
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error("Confirmation timed out — check the explorer link");
}

// Jupiter API
// Jupiter deprecated quote-api.jup.ag (DNS now dead → ERR_NAME_NOT_RESOLVED).
// Current free endpoint is lite-api.jup.ag/swap/v1 (same /quote and /swap paths).
const JUPITER_API = "https://lite-api.jup.ag/swap/v1";

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
  const connection = getConnection();
  const signature = await connection.sendTransaction(transaction, {
    skipPreflight: true,
    maxRetries: 3,
  });

  // 6. Confirm by polling (no WebSocket — Tatum has no WS endpoint).
  await confirmByPolling(connection, signature);

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

  const connection = getConnection();
  const signature = await connection.sendTransaction(transaction, { skipPreflight: true, maxRetries: 3 });
  await confirmByPolling(connection, signature);

  secretKey.fill(0);
  return { signature, explorerUrl: `https://solscan.io/tx/${signature}` };
}

/**
 * Get wallet balance using RPC
 */
export async function getWalletBalance(publicKey: string): Promise<number> {
  const connection = getConnection();
  const balance = await connection.getBalance(new (await import("@solana/web3.js")).PublicKey(publicKey));
  return balance / 1e9; // Convert lamports to SOL
}

const SOL_MINT_STR = "So11111111111111111111111111111111111111112";

/**
 * Withdraw SOL or an SPL token from the local (mobile) wallet, signed client-side.
 * Non-custodial: the server never holds the key, so withdrawals must be built and
 * signed here. Pass tokenMint=null (or the SOL mint) for a native SOL transfer.
 */
export async function executeClientWithdraw(
  mnemonic: string,
  destination: string,
  amountUi: number,
  tokenMint?: string | null,
  decimals: number = 9
): Promise<{ signature: string; explorerUrl: string }> {
  const connection = getConnection();
  const { secretKey } = deriveKeypairFromMnemonic(mnemonic);
  const keypair = Keypair.fromSecretKey(secretKey);
  const owner = keypair.publicKey;

  let destPubkey: PublicKey;
  try {
    destPubkey = new PublicKey(destination);
  } catch {
    secretKey.fill(0);
    throw new Error("Invalid destination address");
  }

  const tx = new Transaction();

  if (!tokenMint || tokenMint === SOL_MINT_STR) {
    const lamports = Math.round(amountUi * LAMPORTS_PER_SOL);
    if (lamports <= 0) {
      secretKey.fill(0);
      throw new Error("Amount too small");
    }
    tx.add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: destPubkey, lamports }));
  } else {
    const mint = new PublicKey(tokenMint);
    const rawAmount = BigInt(Math.round(amountUi * Math.pow(10, decimals)));
    if (rawAmount <= BigInt(0)) {
      secretKey.fill(0);
      throw new Error("Amount too small");
    }
    const sourceAta = await getAssociatedTokenAddress(mint, owner);
    const destAta = await getAssociatedTokenAddress(mint, destPubkey);
    // Create the recipient's token account if it doesn't exist yet (sender pays rent).
    try {
      await getAccount(connection, destAta);
    } catch {
      tx.add(createAssociatedTokenAccountInstruction(owner, destAta, destPubkey, mint));
    }
    tx.add(createTransferInstruction(sourceAta, destAta, owner, rawAmount));
  }

  tx.feePayer = owner;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(keypair);

  // skipPreflight: Tatum's preflight simulation returns a "failed" wrapper even when
  // the instruction logs show success, which blocked valid withdrawals. The tx is
  // built correctly; send it and confirm by polling (same as the swaps).
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    maxRetries: 3,
  });
  secretKey.fill(0);
  await confirmByPolling(connection, signature);
  return { signature, explorerUrl: `https://solscan.io/tx/${signature}` };
}
