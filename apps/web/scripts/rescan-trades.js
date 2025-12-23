// Rescan wallet transactions and restore trades
// Usage: node scripts/rescan-trades.js [email]

const { PrismaClient, TradeStatus } = require('@prisma/client');
const prisma = new PrismaClient();

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

async function fetchTransactionHistory(walletAddress, apiKey) {
  const allTransactions = [];
  let beforeSignature;
  const maxPages = 20;

  for (let page = 0; page < maxPages; page++) {
    let url = `https://api.helius.xyz/v0/addresses/${walletAddress}/transactions?api-key=${apiKey}`;
    if (beforeSignature) {
      url += `&before=${beforeSignature}`;
    }

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) {
        console.error(`Helius API error: ${response.status}`);
        break;
      }

      const transactions = await response.json();
      if (!Array.isArray(transactions) || transactions.length === 0) break;

      allTransactions.push(...transactions);
      beforeSignature = transactions[transactions.length - 1].signature;
      console.log(`  Page ${page + 1}: ${transactions.length} txs (total: ${allTransactions.length})`);

      if (transactions.length < 100) break;
    } catch (e) {
      console.error(`Error fetching page ${page}:`, e.message);
      break;
    }
  }

  return allTransactions;
}

function parseSwapsFromTransactions(transactions, walletAddress) {
  const swaps = [];

  for (const tx of transactions) {
    try {
      if (tx.transactionError) continue;

      const isDexTx = tx.accountData?.some(acc => DEX_PROGRAMS.has(acc.account)) ||
                      tx.instructions?.some(ix => DEX_PROGRAMS.has(ix.programId));
      const isSwapType = tx.type === "SWAP" || tx.type === "SWAP_WSOL";

      if (!isDexTx && !isSwapType) continue;

      const tokenTransfers = tx.tokenTransfers || [];
      const nativeTransfers = tx.nativeTransfers || [];

      // Calculate NET flow for each token (not individual transfers)
      // This handles complex swaps with wrapped SOL, multiple hops, etc.
      const tokenFlows = new Map(); // mint -> { in: amount, out: amount, decimals }

      // Track token transfers (non-SOL)
      for (const transfer of tokenTransfers) {
        // Skip wrapped SOL - we'll handle native SOL separately
        if (transfer.mint === SOL_MINT) continue;

        if (!tokenFlows.has(transfer.mint)) {
          tokenFlows.set(transfer.mint, { in: 0, out: 0, decimals: transfer.decimals || 6 });
        }
        const flow = tokenFlows.get(transfer.mint);

        if (transfer.toUserAccount === walletAddress) {
          flow.in += transfer.tokenAmount || 0;
        }
        if (transfer.fromUserAccount === walletAddress) {
          flow.out += transfer.tokenAmount || 0;
        }
      }

      // Get TRUE net SOL change from accountData (includes all fees, tips, rent)
      // This is the ACTUAL impact on wallet balance - most accurate
      const accountData = tx.accountData || [];
      const walletAccountData = accountData.find(a => a.account === walletAddress);
      const netSolChange = walletAccountData?.nativeBalanceChange || 0;

      // Find the non-SOL token with the largest net change
      let mainToken = null;
      let mainTokenNet = 0;
      for (const [mint, flow] of tokenFlows) {
        const net = flow.in - flow.out;
        if (Math.abs(net) > Math.abs(mainTokenNet)) {
          mainTokenNet = net;
          mainToken = { mint, net, decimals: flow.decimals };
        }
      }

      // Skip if no significant token movement
      if (!mainToken || Math.abs(mainTokenNet) < 1) continue;

      // Skip if no significant SOL movement (at least 0.0001 SOL)
      if (Math.abs(netSolChange) < 100000) continue;

      // Determine swap direction based on token and SOL flow
      // BUY: received tokens (positive), spent SOL (negative netSolChange)
      // SELL: sent tokens (negative), received SOL (positive netSolChange)
      let sent = null;
      let received = null;

      if (mainTokenNet > 0 && netSolChange < 0) {
        // BUY: received tokens, spent SOL
        sent = { mint: SOL_MINT, amount: Math.abs(netSolChange), decimals: 9 };
        received = { mint: mainToken.mint, amount: mainTokenNet, decimals: mainToken.decimals };
      } else if (mainTokenNet < 0 && netSolChange > 0) {
        // SELL: sent tokens, received SOL
        sent = { mint: mainToken.mint, amount: Math.abs(mainTokenNet), decimals: mainToken.decimals };
        received = { mint: SOL_MINT, amount: netSolChange, decimals: 9 };
      }

      if (!sent || !received) continue;
      if (sent.mint === received.mint) continue;

      const rawAmountIn = Math.floor(sent.amount).toString();
      const rawAmountOut = Math.floor(received.amount).toString();

      const getSymbol = (mint) => {
        if (mint === SOL_MINT) return "SOL";
        return mint.slice(0, 6);
      };

      let pricePerToken = null;
      if (sent.mint === SOL_MINT) {
        const solAmount = sent.amount / 1e9;
        const tokenAmount = received.amount / Math.pow(10, received.decimals);
        if (tokenAmount > 0) pricePerToken = solAmount / tokenAmount;
      } else if (received.mint === SOL_MINT) {
        const solAmount = received.amount / 1e9;
        const tokenAmount = sent.amount / Math.pow(10, sent.decimals);
        if (tokenAmount > 0) pricePerToken = solAmount / tokenAmount;
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
      // Skip invalid transactions
    }
  }

  swaps.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return swaps;
}

async function rescanUser(user, apiKey) {
  console.log(`\nRescanning: ${user.email} (${user.walletAddress.slice(0, 8)}...)`);

  const transactions = await fetchTransactionHistory(user.walletAddress, apiKey);
  console.log(`  Found ${transactions.length} total transactions`);

  const swaps = parseSwapsFromTransactions(transactions, user.walletAddress);
  console.log(`  Found ${swaps.length} swap transactions`);

  const existingTrades = await prisma.trade.findMany({
    where: { userId: user.id },
    select: { txSignature: true },
  });
  const existingSignatures = new Set(existingTrades.map(t => t.txSignature));

  const newSwaps = swaps.filter(s => !existingSignatures.has(s.signature));
  console.log(`  New swaps to import: ${newSwaps.length} (${existingSignatures.size} already exist)`);

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
          amountOutMin: swap.amountOut,
          pricePerToken: swap.pricePerToken,
          txSignature: swap.signature,
          status: TradeStatus.SUCCESS,
          confirmedAt: swap.timestamp,
        },
      });
      imported++;
    } catch (e) {
      // Skip duplicates
    }
  }

  console.log(`  Imported: ${imported} trades`);
  return imported;
}

async function main() {
  const targetEmail = process.argv[2];

  // Get Helius API key from env
  const rpcUrl = process.env.SOLANA_RPC_URL || "";
  const heliusMatch = rpcUrl.match(/api-key=([a-f0-9-]+)/i);
  const apiKey = heliusMatch ? heliusMatch[1] : null;

  if (!apiKey) {
    console.error("ERROR: SOLANA_RPC_URL must contain Helius API key");
    console.error("Set: SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY");
    process.exit(1);
  }

  console.log("Helius API key found:", apiKey.slice(0, 8) + "...");

  // Get users
  const users = await prisma.user.findMany({
    where: targetEmail ? { email: targetEmail } : { walletAddress: { not: null } },
    select: { id: true, email: true, walletAddress: true },
  });

  if (users.length === 0) {
    console.error("No users found" + (targetEmail ? ` with email ${targetEmail}` : ""));
    process.exit(1);
  }

  console.log(`Found ${users.length} user(s) to rescan`);

  let totalImported = 0;
  for (const user of users) {
    if (!user.walletAddress) {
      console.log(`Skipping ${user.email} - no wallet`);
      continue;
    }
    totalImported += await rescanUser(user, apiKey);
  }

  console.log(`\n=== DONE ===`);
  console.log(`Total imported: ${totalImported} trades`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
