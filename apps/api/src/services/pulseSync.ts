import { prisma } from "../lib/prisma";
import { moralisService } from "./moralis";
import { pumpPortalService } from "./pumpportal";
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
async function syncGraduatedPairs(): Promise<number> {
  let tokens: PulseTokenData[] = [];

  try {
    const moralisTokens = await moralisService.getGraduatedPulsePairs(50);
    tokens = moralisTokens.map(mapTokenData);
    console.log(`[PulseSync] Got ${tokens.length} graduated tokens from Moralis`);
  } catch (err) {
    console.error("[PulseSync] Moralis graduated error:", err);
  }

  // Supplement with PumpPortal real-time migrated tokens
  try {
    const realtimeTokens = pumpPortalService.getMigratedTokens();
    const existingAddresses = new Set(tokens.map(t => t.address));
    const newMigratedTokens = realtimeTokens
      .filter((t: any) => !existingAddresses.has(t.address))
      .map(mapTokenData);

    if (newMigratedTokens.length > 0) {
      tokens = [...newMigratedTokens, ...tokens];
      console.log(`[PulseSync] Added ${newMigratedTokens.length} migrated tokens from PumpPortal`);
    }
  } catch (err) {
    console.error("[PulseSync] PumpPortal migrated error:", err);
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

// Main sync function
export async function syncPulseTokens(): Promise<{
  new: number;
  graduating: number;
  graduated: number;
  cleaned: number;
}> {
  if (isSyncing) {
    console.log("[PulseSync] Already syncing, skipping...");
    return { new: 0, graduating: 0, graduated: 0, cleaned: 0 };
  }

  isSyncing = true;
  const startTime = Date.now();

  try {
    // Run all syncs in parallel
    const [newCount, graduatingCount, graduatedCount, cleanedCount] = await Promise.all([
      syncNewPairs(),
      syncGraduatingPairs(),
      syncGraduatedPairs(),
      cleanupStaleTokens(),
    ]);

    lastSyncTime = Date.now();
    const duration = lastSyncTime - startTime;
    console.log(`[PulseSync] Completed in ${duration}ms - New: ${newCount}, Graduating: ${graduatingCount}, Graduated: ${graduatedCount}, Cleaned: ${cleanedCount}`);

    return {
      new: newCount,
      graduating: graduatingCount,
      graduated: graduatedCount,
      cleaned: cleanedCount,
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
