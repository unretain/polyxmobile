import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { TradeStatus } from "@prisma/client";

const SOL_MINT = "So11111111111111111111111111111111111111112";

// Known DEX program IDs for swap detection
const DEX_PROGRAMS = new Set([
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", // Jupiter v6
  "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB", // Jupiter v4
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium AMM
  "27haf8L6oxUeXrHrgEgsexjSY5hbVUWEmvv9Nyxg8vQv", // Raydium CLMM
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", // Raydium Concentrated
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", // PumpFun
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", // PumpSwap
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", // Meteora DLMM
  "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB", // Meteora Pools
]);

interface ParsedSwap {
  signature: string;
  timestamp: Date;
  inputMint: string;
  inputSymbol: string;
  outputMint: string;
  outputSymbol: string;
  amountIn: string;
  amountOut: string;
  pricePerToken: number | null;
}

// POST /api/trading/rescan - Rescan wallet and restore trades
export async function POST(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    // Get user wallet
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, walletAddress: true },
    });

    if (!user?.walletAddress) {
      return NextResponse.json(
        { error: "No wallet found for user" },
        { status: 400 }
      );
    }

    const walletAddress = user.walletAddress;
    console.log(`[Rescan] Starting rescan for wallet ${walletAddress.slice(0, 8)}...`);

    // Check for Helius API key in RPC URL
    const rpcUrl = config.solanaRpcUrl || "";
    const heliusMatch = rpcUrl.match(/api-key=([a-f0-9-]+)/i);
    const heliusApiKey = heliusMatch ? heliusMatch[1] : null;

    if (!heliusApiKey) {
      return NextResponse.json(
        { error: "Helius API key required for transaction parsing. Set SOLANA_RPC_URL with Helius key." },
        { status: 400 }
      );
    }

    // Fetch transaction history from Helius
    const transactions = await fetchTransactionHistory(walletAddress, heliusApiKey);
    console.log(`[Rescan] Found ${transactions.length} transactions`);

    // Parse swaps from transactions
    const swaps = parseSwapsFromTransactions(transactions, walletAddress);
    console.log(`[Rescan] Found ${swaps.length} swap transactions`);

    // Get existing trades to avoid duplicates
    const existingTrades = await prisma.trade.findMany({
      where: { userId: user.id },
      select: { txSignature: true },
    });
    const existingSignatures = new Set(existingTrades.map(t => t.txSignature));

    // Filter out duplicates
    const newSwaps = swaps.filter(s => !existingSignatures.has(s.signature));
    console.log(`[Rescan] ${newSwaps.length} new swaps to import (${existingSignatures.size} already exist)`);

    // Import new trades
    let imported = 0;
    for (const swap of newSwaps) {
      try {
        await prisma.trade.create({
          data: {
            userId: user.id,
            inputMint: swap.inputMint,
            inputSymbol: swap.inputSymbol,
            outputMint: swap.outputMint,
            outputSymbol: swap.outputSymbol,
            amountIn: swap.amountIn,
            amountOut: swap.amountOut,
            amountOutMin: swap.amountOut, // Use actual as minimum since we're importing historical
            pricePerToken: swap.pricePerToken,
            txSignature: swap.signature,
            status: TradeStatus.SUCCESS,
            confirmedAt: swap.timestamp,
          },
        });
        imported++;
      } catch (e) {
        // Skip duplicates (unique constraint on txSignature)
        console.warn(`[Rescan] Failed to import ${swap.signature}:`, e);
      }
    }

    console.log(`[Rescan] Imported ${imported} trades for ${walletAddress.slice(0, 8)}...`);

    return NextResponse.json({
      success: true,
      wallet: walletAddress,
      totalTransactions: transactions.length,
      swapsFound: swaps.length,
      alreadyExisted: existingSignatures.size,
      imported,
    });
  } catch (error) {
    console.error("[Rescan] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Rescan failed" },
      { status: 500 }
    );
  }
}

// Fetch transaction history from Helius
async function fetchTransactionHistory(walletAddress: string, apiKey: string): Promise<any[]> {
  const allTransactions: any[] = [];
  let beforeSignature: string | undefined;
  const maxPages = 20; // Up to 2000 transactions

  for (let page = 0; page < maxPages; page++) {
    const url = `https://api.helius.xyz/v0/addresses/${walletAddress}/transactions?api-key=${apiKey}`;
    const params: any = { limit: 100 };
    if (beforeSignature) {
      params.before = beforeSignature;
    }

    try {
      const response = await fetch(url + (beforeSignature ? `&before=${beforeSignature}` : ""), {
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        console.error(`[Rescan] Helius API error: ${response.status}`);
        break;
      }

      const transactions = await response.json();
      if (!Array.isArray(transactions) || transactions.length === 0) {
        break;
      }

      allTransactions.push(...transactions);
      beforeSignature = transactions[transactions.length - 1].signature;

      console.log(`[Rescan] Fetched page ${page + 1}, ${transactions.length} txs, total ${allTransactions.length}`);

      // Stop if we got less than limit (no more pages)
      if (transactions.length < 100) {
        break;
      }
    } catch (e) {
      console.error(`[Rescan] Error fetching page ${page}:`, e);
      break;
    }
  }

  return allTransactions;
}

// Parse swap transactions from Helius parsed transactions
function parseSwapsFromTransactions(transactions: any[], walletAddress: string): ParsedSwap[] {
  const swaps: ParsedSwap[] = [];

  for (const tx of transactions) {
    try {
      // Skip failed transactions
      if (tx.transactionError) continue;

      // Check if this is a swap (look for DEX programs)
      const isDexTx = tx.accountData?.some((acc: any) => DEX_PROGRAMS.has(acc.account)) ||
                      tx.instructions?.some((ix: any) => DEX_PROGRAMS.has(ix.programId));

      // Also check for SWAP type from Helius
      const isSwapType = tx.type === "SWAP" || tx.type === "SWAP_WSOL";

      if (!isDexTx && !isSwapType) continue;

      // Parse token transfers to detect what was swapped
      const tokenTransfers = tx.tokenTransfers || [];
      const nativeTransfers = tx.nativeTransfers || [];

      // Find tokens sent and received by the wallet
      let sent: { mint: string; amount: number; decimals: number } | null = null;
      let received: { mint: string; amount: number; decimals: number } | null = null;

      // Check token transfers
      for (const transfer of tokenTransfers) {
        if (transfer.fromUserAccount === walletAddress && transfer.tokenAmount > 0) {
          if (!sent || transfer.tokenAmount > sent.amount) {
            sent = {
              mint: transfer.mint,
              amount: transfer.tokenAmount,
              decimals: transfer.decimals || 6,
            };
          }
        }
        if (transfer.toUserAccount === walletAddress && transfer.tokenAmount > 0) {
          if (!received || transfer.tokenAmount > received.amount) {
            received = {
              mint: transfer.mint,
              amount: transfer.tokenAmount,
              decimals: transfer.decimals || 6,
            };
          }
        }
      }

      // Check native SOL transfers
      for (const transfer of nativeTransfers) {
        const solAmount = transfer.amount / 1e9;
        if (transfer.fromUserAccount === walletAddress && solAmount > 0.001) {
          // Sending SOL (buying tokens)
          if (!sent || solAmount > sent.amount / Math.pow(10, sent.decimals)) {
            sent = { mint: SOL_MINT, amount: transfer.amount, decimals: 9 };
          }
        }
        if (transfer.toUserAccount === walletAddress && solAmount > 0.001) {
          // Receiving SOL (selling tokens)
          if (!received || solAmount > received.amount / Math.pow(10, received.decimals)) {
            received = { mint: SOL_MINT, amount: transfer.amount, decimals: 9 };
          }
        }
      }

      // Skip if we couldn't detect both sides
      if (!sent || !received) continue;

      // Skip if same token (not a swap)
      if (sent.mint === received.mint) continue;

      // Calculate raw amounts
      const rawAmountIn = Math.floor(sent.amount).toString();
      const rawAmountOut = Math.floor(received.amount).toString();

      // Get symbols from Helius metadata or generate from mint
      const getSymbol = (mint: string) => {
        if (mint === SOL_MINT) return "SOL";
        // Check if Helius provided symbol in the transfer
        for (const transfer of tokenTransfers) {
          if (transfer.mint === mint && transfer.tokenStandard) {
            return transfer.tokenStandard;
          }
        }
        return mint.slice(0, 6);
      };

      // Calculate price (SOL per token)
      let pricePerToken: number | null = null;
      if (sent.mint === SOL_MINT) {
        // Buying: price = SOL spent / tokens received
        const solAmount = sent.amount / 1e9;
        const tokenAmount = received.amount / Math.pow(10, received.decimals);
        if (tokenAmount > 0) {
          pricePerToken = solAmount / tokenAmount;
        }
      } else if (received.mint === SOL_MINT) {
        // Selling: price = SOL received / tokens sold
        const solAmount = received.amount / 1e9;
        const tokenAmount = sent.amount / Math.pow(10, sent.decimals);
        if (tokenAmount > 0) {
          pricePerToken = solAmount / tokenAmount;
        }
      }

      swaps.push({
        signature: tx.signature,
        timestamp: new Date(tx.timestamp * 1000),
        inputMint: sent.mint,
        inputSymbol: getSymbol(sent.mint),
        outputMint: received.mint,
        outputSymbol: getSymbol(received.mint),
        amountIn: rawAmountIn,
        amountOut: rawAmountOut,
        pricePerToken,
      });
    } catch (e) {
      console.warn(`[Rescan] Error parsing tx ${tx.signature}:`, e);
    }
  }

  // Sort by timestamp (oldest first)
  swaps.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return swaps;
}

// GET /api/trading/rescan - Check rescan status
export async function GET(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const tradeCount = await prisma.trade.count({
      where: { userId: session.user.id },
    });

    return NextResponse.json({
      tradeCount,
      hasHeliusKey: !!config.solanaRpcUrl?.includes("helius"),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to get status" },
      { status: 500 }
    );
  }
}
