import { prisma } from "../lib/prisma";
import { moralisService } from "./moralis";
import { pumpPortalService } from "./pumpportal";
import { swapSyncService } from "./swapSync";
import { PulseCategory } from "@prisma/client";

// Sync interval in milliseconds
// Same frequency as current per-user polling (5 seconds)
// But now one server fetch serves ALL users from DB
const SYNC_INTERVAL = 5000; // 5 seconds

let syncTimer: NodeJS.Timeout | null = null;
let isSyncing = false;
let lastSyncTime = 0;

interface PulseTokenData {
  address: string;
  symbol: string;
  name: string;
  logoUri?: string;
  description?: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  marketCap: number;
  liquidity: number;
  bondingProgress?: number;
  txCount?: number;
  replyCount?: number;
  twitter?: string;
  telegram?: string;
  website?: string;
  createdAt?: number;
  graduatedAt?: number;
}

// Map external token data to our format
function mapTokenData(token: any): PulseTokenData {
  return {
    address: token.address,
    symbol: token.symbol || "???",
    name: token.name || "Unknown",
    logoUri: token.logoUri || token.image_uri,
    description: token.description,
    price: token.price || 0,
    priceChange24h: token.priceChange24h || 0,
    volume24h: token.volume24h || 0,
    marketCap: token.marketCap || 0,
    liquidity: token.liquidity || 0,
    bondingProgress: token.bondingProgress,
    txCount: token.txCount || token.replyCount || 0,
    replyCount: token.replyCount || 0,
    twitter: token.twitter,
    telegram: token.telegram,
    website: token.website,
    createdAt: token.createdAt,
    graduatedAt: token.graduatedAt,
  };
}

// Sync new pairs from Moralis + PumpPortal
async function syncNewPairs(): Promise<number> {
  let tokens: PulseTokenData[] = [];

  // Get from Moralis (primary source)
  try {
    const moralisTokens = await moralisService.getNewPulsePairs(50);
    tokens = moralisTokens.map(mapTokenData);
    console.log(`[PulseSync] Got ${tokens.length} new tokens from Moralis`);
  } catch (err) {
    console.error("[PulseSync] Moralis new pairs error:", err);
  }

  // Supplement with PumpPortal real-time tokens
  try {
    const realtimeTokens = pumpPortalService.getRecentNewTokens();
    const existingAddresses = new Set(tokens.map(t => t.address));
    const newRealtimeTokens = realtimeTokens
      .filter((t: any) => !existingAddresses.has(t.address))
      .map(mapTokenData);

    if (newRealtimeTokens.length > 0) {
      tokens = [...newRealtimeTokens, ...tokens];
      console.log(`[PulseSync] Added ${newRealtimeTokens.length} real-time tokens from PumpPortal`);
    }
  } catch (err) {
    console.error("[PulseSync] PumpPortal error:", err);
  }

  // Upsert to database
  let upserted = 0;
  for (const token of tokens) {
    if (!token.address || !token.symbol || token.symbol === "???") continue;

    try {
      await prisma.pulseToken.upsert({
        where: { address: token.address },
        update: {
          symbol: token.symbol,
          name: token.name,
          logoUri: token.logoUri,
          description: token.description,
          price: token.price,
          priceChange24h: token.priceChange24h,
          volume24h: token.volume24h,
          marketCap: token.marketCap,
          liquidity: token.liquidity,
          category: PulseCategory.NEW,
          txCount: token.txCount || 0,
          replyCount: token.replyCount || 0,
          twitter: token.twitter,
          telegram: token.telegram,
          website: token.website,
          tokenCreatedAt: token.createdAt ? new Date(token.createdAt) : undefined,
        },
        create: {
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          logoUri: token.logoUri,
          description: token.description,
          price: token.price,
          priceChange24h: token.priceChange24h,
          volume24h: token.volume24h,
          marketCap: token.marketCap,
          liquidity: token.liquidity,
          category: PulseCategory.NEW,
          txCount: token.txCount || 0,
          replyCount: token.replyCount || 0,
          twitter: token.twitter,
          telegram: token.telegram,
          website: token.website,
          tokenCreatedAt: token.createdAt ? new Date(token.createdAt) : undefined,
        },
      });
      upserted++;
    } catch (err) {
      // Ignore individual upsert errors
    }
  }

  return upserted;
}

// Sync graduating pairs (near bonding curve completion)
async function syncGraduatingPairs(): Promise<number> {
  let tokens: PulseTokenData[] = [];

  try {
    const moralisTokens = await moralisService.getGraduatingPulsePairs(100);
    // Filter to $10K-$69K market cap range
    tokens = moralisTokens
      .filter((t: any) => {
        const mc = t.marketCap || 0;
        return mc >= 10000 && mc < 69000;
      })
      .map(mapTokenData);
    console.log(`[PulseSync] Got ${tokens.length} graduating tokens from Moralis`);
  } catch (err) {
    console.error("[PulseSync] Moralis graduating error:", err);
  }

  // Upsert to database
  let upserted = 0;
  for (const token of tokens) {
    if (!token.address || !token.symbol || token.symbol === "???") continue;

    try {
      await prisma.pulseToken.upsert({
        where: { address: token.address },
        update: {
          symbol: token.symbol,
          name: token.name,
          logoUri: token.logoUri,
          price: token.price,
          priceChange24h: token.priceChange24h,
          volume24h: token.volume24h,
          marketCap: token.marketCap,
          liquidity: token.liquidity,
          category: PulseCategory.GRADUATING,
          bondingProgress: token.bondingProgress,
          txCount: token.txCount || 0,
        },
        create: {
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          logoUri: token.logoUri,
          price: token.price,
          priceChange24h: token.priceChange24h,
          volume24h: token.volume24h,
          marketCap: token.marketCap,
          liquidity: token.liquidity,
          category: PulseCategory.GRADUATING,
          bondingProgress: token.bondingProgress,
          txCount: token.txCount || 0,
        },
      });
      upserted++;
    } catch (err) {
      // Ignore individual upsert errors
    }
  }

  return upserted;
}

// Sync graduated pairs (migrated to Raydium)
// NO INDIVIDUAL TOKEN ENRICHMENT - just use list endpoint data to avoid rate limits
async function syncGraduatedPairs(): Promise<number> {
  let tokens: PulseTokenData[] = [];

  try {
    // Use getGraduatedTokens directly - NO enrichment to avoid 50+ API calls
    const moralisTokens = await moralisService.getGraduatedTokens(50);
    tokens = moralisTokens.map((t) => ({
      address: t.tokenAddress,
      symbol: t.symbol || "???",
      name: t.name || "Unknown",
      logoUri: t.logo,
      price: parseFloat(t.priceUsd || "0"),
      priceChange24h: 0, // Not available from list endpoint
      volume24h: 0, // Not available from list endpoint - will be updated from PumpPortal
      marketCap: parseFloat(t.fullyDilutedValuation || "0"),
      liquidity: parseFloat(t.liquidity || "0"),
      graduatedAt: t.graduatedAt ? new Date(t.graduatedAt).getTime() : Date.now(),
    }));
    console.log(`[PulseSync] Got ${tokens.length} graduated tokens from Moralis (no enrichment)`);
  } catch (err) {
    console.error("[PulseSync] Moralis graduated error:", err);
  }

  // Supplement with PumpPortal real-time migrated tokens (these have live MC/volume)
  try {
    const realtimeTokens = pumpPortalService.getMigratedTokens();
    const existingAddresses = new Set(tokens.map(t => t.address));
    const newMigratedTokens = realtimeTokens
      .filter((t: any) => !existingAddresses.has(t.address) && t.marketCap > 0)
      .map(mapTokenData);

    if (newMigratedTokens.length > 0) {
      tokens = [...newMigratedTokens, ...tokens];
      console.log(`[PulseSync] Added ${newMigratedTokens.length} migrated tokens from PumpPortal (with live data)`);
    }

    // Also update MC/volume for existing tokens if PumpPortal has better data
    for (const rt of realtimeTokens as any[]) {
      const idx = tokens.findIndex(t => t.address === rt.address);
      if (idx !== -1 && rt.marketCap > 0) {
        tokens[idx].marketCap = rt.marketCap || tokens[idx].marketCap;
        tokens[idx].volume24h = rt.volume24h || tokens[idx].volume24h;
        tokens[idx].price = rt.price || tokens[idx].price;
      }
    }
  } catch (err) {
    console.error("[PulseSync] PumpPortal migrated error:", err);
  }

  // NO MORE ENRICHMENT - removed the getTokenData calls that were causing rate limits

  // Upsert to database
  let upserted = 0;
  for (const token of tokens) {
    if (!token.address || !token.symbol || token.symbol === "???") continue;

    try {
      await prisma.pulseToken.upsert({
        where: { address: token.address },
        update: {
          symbol: token.symbol,
          name: token.name,
          logoUri: token.logoUri,
          price: token.price,
          priceChange24h: token.priceChange24h,
          volume24h: token.volume24h,
          marketCap: token.marketCap,
          liquidity: token.liquidity,
          category: PulseCategory.GRADUATED,
          graduatedAt: token.graduatedAt ? new Date(token.graduatedAt) : new Date(),
        },
        create: {
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          logoUri: token.logoUri,
          price: token.price,
          priceChange24h: token.priceChange24h,
          volume24h: token.volume24h,
          marketCap: token.marketCap,
          liquidity: token.liquidity,
          category: PulseCategory.GRADUATED,
          graduatedAt: token.graduatedAt ? new Date(token.graduatedAt) : new Date(),
        },
      });
      upserted++;
    } catch (err) {
      // Ignore individual upsert errors
    }
  }

  return upserted;
}

// Clean up stale tokens (older than 24 hours for NEW, 48 hours for others)
async function cleanupStaleTokens(): Promise<number> {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  try {
    // Delete stale NEW tokens (older than 24 hours)
    const deletedNew = await prisma.pulseToken.deleteMany({
      where: {
        category: PulseCategory.NEW,
        OR: [
          { tokenCreatedAt: { lt: twentyFourHoursAgo } },
          { tokenCreatedAt: null, createdAt: { lt: twentyFourHoursAgo } },
        ],
      },
    });

    // Delete stale GRADUATING tokens (older than 48 hours)
    const deletedGraduating = await prisma.pulseToken.deleteMany({
      where: {
        category: PulseCategory.GRADUATING,
        updatedAt: { lt: fortyEightHoursAgo },
      },
    });

    // Keep GRADUATED tokens longer (7 days)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const deletedGraduated = await prisma.pulseToken.deleteMany({
      where: {
        category: PulseCategory.GRADUATED,
        graduatedAt: { lt: sevenDaysAgo },
      },
    });

    const total = deletedNew.count + deletedGraduating.count + deletedGraduated.count;
    if (total > 0) {
      console.log(`[PulseSync] Cleaned up ${total} stale tokens (new: ${deletedNew.count}, graduating: ${deletedGraduating.count}, graduated: ${deletedGraduated.count})`);
    }
    return total;
  } catch (err) {
    console.error("[PulseSync] Cleanup error:", err);
    return 0;
  }
}

// Sync swaps for tokens that don't have swaps synced yet
// This runs after token list sync to populate swap history
async function syncTokenSwaps(): Promise<number> {
  try {
    // Get all pulse tokens that don't have swaps synced
    const unsyncedTokens = await prisma.pulseToken.findMany({
      where: {
        NOT: {
          address: {
            in: (await prisma.tokenSyncStatus.findMany({
              where: { swapsSynced: true },
              select: { tokenAddress: true },
            })).map(s => s.tokenAddress),
          },
        },
      },
      orderBy: { marketCap: "desc" }, // Prioritize higher MC tokens
      take: 5, // Sync 5 tokens per cycle to avoid rate limits
    });

    if (unsyncedTokens.length === 0) {
      return 0;
    }

    console.log(`[PulseSync] Syncing swaps for ${unsyncedTokens.length} tokens...`);

    let synced = 0;
    for (const token of unsyncedTokens) {
      try {
        const result = await swapSyncService.syncHistoricalSwaps(token.address);
        if (result.synced) {
          synced++;
          console.log(`[PulseSync] Synced ${result.count} swaps for ${token.symbol}`);
        }
      } catch (err) {
        console.error(`[PulseSync] Failed to sync swaps for ${token.symbol}:`, err);
      }
    }

    return synced;
  } catch (err) {
    console.error("[PulseSync] Swap sync error:", err);
    return 0;
  }
}

// Main sync function
export async function syncPulseTokens(): Promise<{
  new: number;
  graduating: number;
  graduated: number;
  cleaned: number;
  swapsSynced: number;
}> {
  if (isSyncing) {
    console.log("[PulseSync] Already syncing, skipping...");
    return { new: 0, graduating: 0, graduated: 0, cleaned: 0, swapsSynced: 0 };
  }

  isSyncing = true;
  const startTime = Date.now();

  try {
    // First sync token lists
    const [newCount, graduatingCount, graduatedCount, cleanedCount] = await Promise.all([
      syncNewPairs(),
      syncGraduatingPairs(),
      syncGraduatedPairs(),
      cleanupStaleTokens(),
    ]);

    // Then sync swaps for unsynced tokens (after token list is updated)
    const swapsSynced = await syncTokenSwaps();

    lastSyncTime = Date.now();
    const duration = lastSyncTime - startTime;
    console.log(`[PulseSync] Completed in ${duration}ms - New: ${newCount}, Graduating: ${graduatingCount}, Graduated: ${graduatedCount}, Cleaned: ${cleanedCount}, SwapsSynced: ${swapsSynced}`);

    return {
      new: newCount,
      graduating: graduatingCount,
      graduated: graduatedCount,
      cleaned: cleanedCount,
      swapsSynced,
    };
  } catch (err) {
    console.error("[PulseSync] Sync error:", err);
    throw err;
  } finally {
    isSyncing = false;
  }
}

// Start background sync
export function startPulseSync(): void {
  if (syncTimer) {
    console.log("[PulseSync] Already running");
    return;
  }

  console.log(`[PulseSync] Starting background sync every ${SYNC_INTERVAL / 1000}s`);

  // Run immediately
  syncPulseTokens().catch(console.error);

  // Then run on interval
  syncTimer = setInterval(() => {
    syncPulseTokens().catch(console.error);
  }, SYNC_INTERVAL);
}

// Stop background sync
export function stopPulseSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    console.log("[PulseSync] Stopped background sync");
  }
}

// Get sync status
export function getPulseSyncStatus(): {
  isRunning: boolean;
  isSyncing: boolean;
  lastSyncTime: number;
} {
  return {
    isRunning: syncTimer !== null,
    isSyncing,
    lastSyncTime,
  };
}

export const pulseSyncService = {
  sync: syncPulseTokens,
  start: startPulseSync,
  stop: stopPulseSync,
  getStatus: getPulseSyncStatus,
};
