// Swap Sync Service
// Permanently stores all token swaps in database
// - Initial sync: Fetch ALL historical swaps from Moralis
// - Incremental sync: Only fetch new swaps since last sync
// - OHLCV: Build candles directly from DB, no API calls

import { prisma } from "../lib/prisma";
import { moralisService } from "./moralis";
import type { OHLCV } from "@shared/types";

// SOL address for detecting SOL trades
const SOL_ADDRESS = "so11111111111111111111111111111111111111112";

interface MoralisSwap {
  transactionHash: string;
  transactionType: "buy" | "sell";
  blockTimestamp: string;
  walletAddress: string;
  bought: {
    address: string;
    amount: string;
    usdPrice: number;
    usdAmount: number;
  };
  sold: {
    address: string;
    amount: string;
    usdPrice: number;
    usdAmount: number;
  };
  totalValueUsd: number;
}

class SwapSyncService {
  private syncingTokens: Set<string> = new Set();

  // Check if token's swaps are synced
  async isSynced(tokenAddress: string): Promise<boolean> {
    const status = await prisma.tokenSyncStatus.findUnique({
      where: { tokenAddress },
    });
    return status?.swapsSynced ?? false;
  }

  // Get sync status
  async getSyncStatus(tokenAddress: string) {
    return prisma.tokenSyncStatus.findUnique({
      where: { tokenAddress },
    });
  }

  // Sync all historical swaps for a token (called once per token)
  // Returns immediately if already synced or syncing
  async syncHistoricalSwaps(tokenAddress: string): Promise<{ synced: boolean; count: number }> {
    // Check if already synced
    const status = await this.getSyncStatus(tokenAddress);
    if (status?.swapsSynced) {
      console.log(`[SwapSync] ${tokenAddress.slice(0, 8)}... already synced (${status.totalSwaps} swaps)`);
      return { synced: true, count: status.totalSwaps };
    }

    // Check if currently syncing
    if (this.syncingTokens.has(tokenAddress)) {
      console.log(`[SwapSync] ${tokenAddress.slice(0, 8)}... sync already in progress`);
      return { synced: false, count: 0 };
    }

    this.syncingTokens.add(tokenAddress);
    console.log(`[SwapSync] Starting historical sync for ${tokenAddress.slice(0, 8)}...`);

    try {
      // Fetch ALL swaps from Moralis (paginated)
      let allSwaps: MoralisSwap[] = [];
      let cursor: string | undefined;
      let page = 0;
      const maxPages = 200; // ~20,000 swaps max

      while (page < maxPages) {
        const { swaps, cursor: nextCursor } = await moralisService.getTokenSwaps(tokenAddress, {
          order: "DESC",
          limit: 100,
          cursor,
        });

        if (swaps.length === 0) break;

        allSwaps = allSwaps.concat(swaps as MoralisSwap[]);
        cursor = nextCursor;
        page++;

        if (page % 20 === 0) {
          console.log(`[SwapSync] ${tokenAddress.slice(0, 8)}... page ${page}, ${allSwaps.length} swaps`);
        }

        if (!cursor) break;
      }

      console.log(`[SwapSync] Fetched ${allSwaps.length} total swaps for ${tokenAddress.slice(0, 8)}...`);

      // Store swaps in database
      let stored = 0;
      const batchSize = 100;

      for (let i = 0; i < allSwaps.length; i += batchSize) {
        const batch = allSwaps.slice(i, i + batchSize);
        const swapData = batch.map((swap) => this.parseSwap(tokenAddress, swap)).filter(Boolean);

        if (swapData.length > 0) {
          await prisma.tokenSwap.createMany({
            data: swapData as any[],
            skipDuplicates: true,
          });
          stored += swapData.length;
        }
      }

      // Update sync status
      const timestamps = allSwaps.map((s) => new Date(s.blockTimestamp).getTime());
      const oldestTime = timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null;
      const newestTime = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;

      await prisma.tokenSyncStatus.upsert({
        where: { tokenAddress },
        create: {
          tokenAddress,
          swapsSynced: true,
          oldestSwapTime: oldestTime,
          newestSwapTime: newestTime,
          totalSwaps: stored,
          lastSwapSync: new Date(),
        },
        update: {
          swapsSynced: true,
          oldestSwapTime: oldestTime,
          newestSwapTime: newestTime,
          totalSwaps: stored,
          lastSwapSync: new Date(),
        },
      });

      console.log(`[SwapSync] ✅ Synced ${stored} swaps for ${tokenAddress.slice(0, 8)}...`);
      return { synced: true, count: stored };
    } catch (error) {
      console.error(`[SwapSync] Error syncing ${tokenAddress.slice(0, 8)}...:`, error);
      return { synced: false, count: 0 };
    } finally {
      this.syncingTokens.delete(tokenAddress);
    }
  }

  // Sync only NEW swaps since last sync (called periodically)
  async syncNewSwaps(tokenAddress: string): Promise<number> {
    const status = await this.getSyncStatus(tokenAddress);
    if (!status?.swapsSynced) {
      // Not yet synced, do full sync instead
      const result = await this.syncHistoricalSwaps(tokenAddress);
      return result.count;
    }

    try {
      // Fetch recent swaps (newest first)
      const { swaps } = await moralisService.getTokenSwaps(tokenAddress, {
        order: "DESC",
        limit: 100,
      });

      if (swaps.length === 0) return 0;

      // Store new swaps (skipDuplicates handles existing ones)
      const swapData = (swaps as MoralisSwap[]).map((swap) => this.parseSwap(tokenAddress, swap)).filter(Boolean);

      if (swapData.length > 0) {
        const result = await prisma.tokenSwap.createMany({
          data: swapData as any[],
          skipDuplicates: true,
        });

        if (result.count > 0) {
          // Update sync status
          const newestTime = new Date((swaps[0] as MoralisSwap).blockTimestamp);
          await prisma.tokenSyncStatus.update({
            where: { tokenAddress },
            data: {
              newestSwapTime: newestTime,
              totalSwaps: { increment: result.count },
              lastSwapSync: new Date(),
            },
          });

          console.log(`[SwapSync] Added ${result.count} new swaps for ${tokenAddress.slice(0, 8)}...`);
        }

        return result.count;
      }

      return 0;
    } catch (error) {
      console.error(`[SwapSync] Error syncing new swaps for ${tokenAddress.slice(0, 8)}...:`, error);
      return 0;
    }
  }

  // Parse Moralis swap to our DB format
  private parseSwap(tokenAddress: string, swap: MoralisSwap) {
    const addressLower = tokenAddress.toLowerCase();
    const boughtIsToken = swap.bought?.address?.toLowerCase() === addressLower;
    const soldIsToken = swap.sold?.address?.toLowerCase() === addressLower;

    let tokenAmount = 0;
    let solAmount = 0;
    let priceUsd = 0;

    if (boughtIsToken) {
      tokenAmount = parseFloat(swap.bought.amount || "0");
      solAmount = parseFloat(swap.sold?.amount || "0");
      priceUsd = swap.bought.usdPrice || 0;
    } else if (soldIsToken) {
      tokenAmount = parseFloat(swap.sold.amount || "0");
      solAmount = parseFloat(swap.bought?.amount || "0");
      priceUsd = swap.sold.usdPrice || 0;
    }

    // Calculate price from amounts if not provided
    if (priceUsd === 0 && tokenAmount > 0) {
      const solPrice = boughtIsToken ? swap.sold?.usdPrice : swap.bought?.usdPrice;
      if (solPrice && solAmount > 0) {
        priceUsd = (solAmount * solPrice) / tokenAmount;
      }
    }

    if (tokenAmount === 0 || priceUsd === 0) {
      return null;
    }

    return {
      tokenAddress,
      txHash: swap.transactionHash,
      timestamp: new Date(swap.blockTimestamp),
      type: swap.transactionType,
      walletAddress: swap.walletAddress,
      tokenAmount,
      solAmount,
      priceUsd,
      totalValueUsd: swap.totalValueUsd || tokenAmount * priceUsd,
    };
  }

  // Build OHLCV candles from stored swaps (NO API CALLS)
  // intervalMs: 1000 for 1s, 60000 for 1min, etc.
  async getOHLCVFromDB(
    tokenAddress: string,
    intervalMs: number = 60000,
    maxCandles: number = 5000
  ): Promise<OHLCV[]> {
    // Get all swaps for this token from DB, ordered by timestamp ASC
    const swaps = await prisma.tokenSwap.findMany({
      where: { tokenAddress },
      orderBy: { timestamp: "asc" },
      take: maxCandles * 2, // Get more swaps than candles to ensure enough data
    });

    if (swaps.length === 0) {
      return [];
    }

    // ALL modes (including 1s) use interval-based aggregation
    // perTrade flag is no longer used - 1s just uses 1000ms interval
    const candleMap = new Map<number, OHLCV>();

    for (const swap of swaps) {
      const timestamp = swap.timestamp.getTime();
      const candleTime = Math.floor(timestamp / intervalMs) * intervalMs;
      const price = swap.priceUsd;

      if (price <= 0) continue;

      const existing = candleMap.get(candleTime);
      if (existing) {
        existing.high = Math.max(existing.high, price);
        existing.low = Math.min(existing.low, price);
        existing.close = price;
        existing.volume += swap.totalValueUsd;
      } else {
        candleMap.set(candleTime, {
          timestamp: candleTime,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: swap.totalValueUsd,
        });
      }
    }

    // Sort candles by time
    const sortedCandles = Array.from(candleMap.values()).sort(
      (a, b) => a.timestamp - b.timestamp
    );

    if (sortedCandles.length === 0) {
      return [];
    }

    // Fill gaps between candles with flat candles (same OHLC as previous close)
    // This makes the chart continuous like TradingView
    const filledCandles: OHLCV[] = [];
    const firstCandle = sortedCandles[0];
    const lastCandle = sortedCandles[sortedCandles.length - 1];

    let currentTime = firstCandle.timestamp;
    let candleIndex = 0;
    let lastPrice = firstCandle.open;

    while (currentTime <= lastCandle.timestamp && filledCandles.length < maxCandles) {
      const existingCandle = sortedCandles[candleIndex];

      if (existingCandle && existingCandle.timestamp === currentTime) {
        // Real candle exists for this interval
        filledCandles.push(existingCandle);
        lastPrice = existingCandle.close;
        candleIndex++;
      } else {
        // No trade in this interval - create flat candle with previous close
        filledCandles.push({
          timestamp: currentTime,
          open: lastPrice,
          high: lastPrice,
          low: lastPrice,
          close: lastPrice,
          volume: 0,
        });
      }

      currentTime += intervalMs;
    }

    return filledCandles.slice(-maxCandles);
  }

  // Get OHLCV - checks DB first, syncs if needed, then returns from DB
  // LIVE MODE: Always fetch latest swaps on every request for real-time data
  // intervalMs: 1000 for 1s, 60000 for 1min, etc.
  async getOHLCV(
    tokenAddress: string,
    intervalMs: number = 60000
  ): Promise<OHLCV[]> {
    // Check if synced
    const status = await this.getSyncStatus(tokenAddress);

    if (!status?.swapsSynced) {
      // Not synced yet - sync now (await for it)
      console.log(`[SwapSync] Token ${tokenAddress.slice(0, 8)}... not synced, syncing now...`);
      await this.syncHistoricalSwaps(tokenAddress);
    } else {
      // LIVE: Always sync new swaps on every request (don't await to keep response fast)
      this.syncNewSwaps(tokenAddress).catch(() => {});
    }

    // Return from DB
    return this.getOHLCVFromDB(tokenAddress, intervalMs);
  }

  // Get swap count for a token from DB
  async getSwapCount(tokenAddress: string): Promise<number> {
    return prisma.tokenSwap.count({ where: { tokenAddress } });
  }

  // Get recent swaps from DB
  async getRecentSwaps(tokenAddress: string, limit: number = 50) {
    return prisma.tokenSwap.findMany({
      where: { tokenAddress },
      orderBy: { timestamp: "desc" },
      take: limit,
    });
  }
}

export const swapSyncService = new SwapSyncService();
