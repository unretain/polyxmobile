import { Router } from "express";
import { z } from "zod";
// Primary data source: Moralis (pump.fun endpoints + OHLCV)
// Fallback: PumpPortal real-time WebSocket for very new tokens
import { pumpFunService } from "../services/pumpfun";
import { dexScreenerService } from "../services/dexscreener";
import { birdeyeService } from "../services/birdeye";
import { pumpPortalService } from "../services/pumpportal";
import { meteoraService } from "../services/meteora";
import { moralisService } from "../services/moralis";
import { cache } from "../lib/cache";

export const pulseRoutes = Router();

const newPairsQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  source: z.enum(["all", "pumpfun", "pumpportal", "meteora", "dexscreener", "trending"]).default("all"),
});

// GET /api/pulse/new-pairs - Get newest token pairs
// PRIMARY SOURCE: Moralis pump.fun/new API (has CDN logos, reliable data)
// FALLBACK: PumpPortal real-time WebSocket for latest tokens not yet indexed
pulseRoutes.get("/new-pairs", async (req, res) => {
  try {
    const query = newPairsQuerySchema.parse(req.query);
    const { limit, source } = query;

    // Try cache first (short TTL for fresh data)
    const cacheKey = `pulse:new-pairs:${source}:${limit}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    let tokens: any[] = [];

    // PRIMARY: Use Moralis pump.fun/new endpoint (most reliable, has logos)
    if (source === "all" || source === "pumpfun" || source === "pumpportal") {
      try {
        const moralisTokens = await moralisService.getNewPulsePairs(limit);
        tokens = tokens.concat(moralisTokens);
        console.log(`📦 Got ${moralisTokens.length} new tokens from Moralis`);
      } catch (err) {
        console.error("Moralis new tokens error:", err);
      }
    }

    // SUPPLEMENT: Add PumpPortal real-time tokens not yet in Moralis
    // These are the very latest (last few minutes) that Moralis hasn't indexed yet
    if (source === "all" || source === "pumpportal") {
      try {
        const realtimeTokens = pumpPortalService.getRecentNewTokens();
        // Only add tokens not already in Moralis results
        const existingAddresses = new Set(tokens.map((t: any) => t.address));
        const newRealtimeTokens = realtimeTokens.filter(
          (t: any) => !existingAddresses.has(t.address)
        );
        if (newRealtimeTokens.length > 0) {
          tokens = [...newRealtimeTokens, ...tokens]; // Prepend newer tokens
          console.log(`📦 Added ${newRealtimeTokens.length} real-time tokens from PumpPortal`);
        }
      } catch (err) {
        console.error("PumpPortal fetch error:", err);
      }
    }

    // Meteora DLMM pairs (only if explicitly requested)
    if (source === "meteora") {
      try {
        const meteoraTokens = await meteoraService.getNewPairs(Math.min(limit, 30));
        tokens = tokens.concat(meteoraTokens);
        console.log(`📦 Fetched ${meteoraTokens.length} tokens from Meteora`);
      } catch (err) {
        console.error("Meteora fetch error:", err);
      }
    }

    // Remove duplicates by address
    const uniqueTokens = Array.from(
      new Map(tokens.map((t) => [t.address, t])).values()
    );

    // Filter out invalid tokens
    const validTokens = uniqueTokens.filter((t) =>
      t.address &&
      t.symbol &&
      t.symbol !== "???"
    );

    // Sort by creation time (newest first)
    validTokens.sort((a, b) => b.createdAt - a.createdAt);

    // Limit results
    const result = validTokens.slice(0, limit);

    const response = {
      data: result,
      total: result.length,
      timestamp: Date.now(),
      sources: ["moralis", "pumpportal"],
      realtime: pumpPortalService.isConnected(),
    };

    // Cache for 5 seconds (fresh data)
    await cache.set(cacheKey, JSON.stringify(response), 5);

    res.json(response);
  } catch (error) {
    console.error("Error fetching new pairs:", error);
    res.status(500).json({ error: "Failed to fetch new pairs" });
  }
});

// GET /api/pulse/graduating - Get coins about to graduate from pump.fun
// PRIMARY SOURCE: Moralis pump.fun/bonding API (has bondingCurveProgress %)
// "Final Stretch" = Market cap $20K-$69K (approaching graduation threshold)
// Following Axiom.trade's approach: https://docs.axiom.trade/axiom/finding-tokens/pulse
// Pump.fun graduation happens at ~$69K market cap when bonding curve is 100% filled
pulseRoutes.get("/graduating", async (req, res) => {
  try {
    let tokens: any[] = [];

    // Market cap thresholds for "Final Stretch" (following Axiom's approach)
    // Pump.fun tokens graduate at ~$69K market cap
    // Final Stretch = tokens with $20K-$69K market cap actively approaching graduation
    const MIN_MARKET_CAP = 20000; // $20K - minimum to be in "Final Stretch"
    const MAX_MARKET_CAP = 69000; // $69K - graduation threshold

    // PRIMARY: Use Moralis bonding endpoint
    try {
      const moralisTokens = await moralisService.getGraduatingPulsePairs(100);
      // Filter by market cap range: $20K-$69K (true "Final Stretch")
      // Tokens < $20K are too early, tokens >= $69K should have graduated
      tokens = moralisTokens.filter((t: any) => {
        const mc = t.marketCap || 0;
        return mc >= MIN_MARKET_CAP && mc < MAX_MARKET_CAP;
      });
      console.log(`📦 Got ${moralisTokens.length} bonding tokens, ${tokens.length} are in Final Stretch ($${MIN_MARKET_CAP/1000}K-$${MAX_MARKET_CAP/1000}K MC)`);
    } catch (err) {
      console.error("Moralis bonding tokens error:", err);
    }

    // SUPPLEMENT: Add PumpPortal real-time graduating tokens
    if (tokens.length === 0) {
      const realtimeTokens = pumpPortalService.getGraduatingTokens();
      if (realtimeTokens.length > 0) {
        tokens = realtimeTokens.filter((t: any) => {
          const mc = t.marketCap || 0;
          return mc >= MIN_MARKET_CAP && mc < MAX_MARKET_CAP;
        });
        console.log(`📦 Using ${tokens.length} graduating tokens from PumpPortal`);
      }
    }

    // Sort by market cap descending (closest to $69K graduation first)
    // This shows tokens most likely to graduate soon at the top
    tokens.sort((a, b) => {
      const aMC = a.marketCap || 0;
      const bMC = b.marketCap || 0;
      return bMC - aMC;
    });

    const response = {
      data: tokens,
      total: tokens.length,
      timestamp: Date.now(),
      source: "moralis",
      realtime: pumpPortalService.isConnected(),
    };

    res.json(response);
  } catch (error) {
    console.error("Error fetching graduating coins:", error);
    res.status(500).json({ error: "Failed to fetch graduating coins" });
  }
});

// GET /api/pulse/graduated - Get coins that graduated to Raydium/PumpSwap
// PRIMARY SOURCE: Moralis pump.fun/graduated API (has graduatedAt timestamp)
pulseRoutes.get("/graduated", async (req, res) => {
  try {
    let tokens: any[] = [];

    // PRIMARY: Use Moralis graduated endpoint
    try {
      const moralisTokens = await moralisService.getGraduatedPulsePairs(50);
      tokens = moralisTokens;
      console.log(`📦 Got ${moralisTokens.length} graduated tokens from Moralis`);
    } catch (err) {
      console.error("Moralis graduated tokens error:", err);
    }

    // SUPPLEMENT: Add PumpPortal real-time migrated tokens not in Moralis yet
    const realtimeTokens = pumpPortalService.getMigratedTokens();
    if (realtimeTokens.length > 0) {
      const existingAddresses = new Set(tokens.map((t: any) => t.address));
      const newMigratedTokens = realtimeTokens.filter(
        (t: any) => !existingAddresses.has(t.address)
      );
      if (newMigratedTokens.length > 0) {
        tokens = [...newMigratedTokens, ...tokens]; // Prepend newer
        console.log(`📦 Added ${newMigratedTokens.length} migrated tokens from PumpPortal`);
      }
    }

    const response = {
      data: tokens,
      total: tokens.length,
      timestamp: Date.now(),
      source: "moralis",
      realtime: pumpPortalService.isConnected(),
    };

    res.json(response);
  } catch (error) {
    console.error("Error fetching graduated coins:", error);
    res.status(500).json({ error: "Failed to fetch graduated coins" });
  }
});

// GET /api/pulse/king - Get king of the hill coins
pulseRoutes.get("/king", async (req, res) => {
  try {
    const cacheKey = "pulse:king";
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const tokens = await pumpFunService.getKingOfHillCoins(50);

    const response = {
      data: tokens,
      total: tokens.length,
      timestamp: Date.now(),
      source: "pumpfun",
    };

    await cache.set(cacheKey, JSON.stringify(response), 10);
    res.json(response);
  } catch (error) {
    console.error("Error fetching king of hill coins:", error);
    res.status(500).json({ error: "Failed to fetch king of hill coins" });
  }
});

// GET /api/pulse/realtime/:address - Get real-time OHLCV data
pulseRoutes.get("/realtime/:address", async (req, res) => {
  try {
    const { address } = req.params;

    const to = Math.floor(Date.now() / 1000);
    const from = to - 600; // Last 10 minutes

    const ohlcv = await birdeyeService.getOHLCV(address, "1m", {
      from,
      to,
      limit: 100,
    });

    res.json({
      address,
      timeframe: "1m",
      data: ohlcv,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("Error fetching realtime data:", error);
    res.status(500).json({ error: "Failed to fetch realtime data" });
  }
});

// GET /api/pulse/token/:address - Get enriched token data from multiple sources
pulseRoutes.get("/token/:address", async (req, res) => {
  try {
    const { address } = req.params;

    // First check PumpPortal cache for real-time token data
    const realtimeTokens = pumpPortalService.getRecentNewTokens();
    let tokenData = realtimeTokens.find((t: any) => t.address === address);

    if (!tokenData) {
      // Check graduating tokens
      const graduatingTokens = pumpPortalService.getGraduatingTokens();
      tokenData = graduatingTokens.find((t: any) => t.address === address);
    }

    if (!tokenData) {
      // Check migrated tokens
      const migratedTokens = pumpPortalService.getMigratedTokens();
      tokenData = migratedTokens.find((t: any) => t.address === address);
    }

    if (!tokenData) {
      // Try pump.fun API (for memecoins)
      tokenData = await pumpFunService.getCoin(address);
    }

    if (!tokenData) {
      // Try Moralis API as primary source (reliable for pump.fun tokens with market cap)
      try {
        const moralisData = await moralisService.getTokenData(address);
        if (moralisData) {
          tokenData = {
            address: moralisData.address,
            symbol: moralisData.symbol,
            name: moralisData.name,
            logoUri: moralisData.logoURI,
            price: moralisData.price,
            priceChange24h: moralisData.priceChange24h,
            volume24h: moralisData.volume24h,
            liquidity: moralisData.liquidity,
            marketCap: moralisData.marketCap,
            txCount: 0,
            createdAt: Date.now(),
            source: "moralis",
          };
          console.log(`📦 Got token data from Moralis for ${address}`);
        }
      } catch (err) {
        console.error("Moralis token fetch error:", err);
      }
    }

    if (!tokenData) {
      // Try DexScreener as fallback
      const pairs = await dexScreenerService.getTokenPairs(address);
      if (pairs.length > 0) {
        const pair = pairs[0];
        tokenData = {
          address: pair.baseToken.address,
          symbol: pair.baseToken.symbol,
          name: pair.baseToken.name,
          logoUri: pair.info?.imageUrl,
          price: parseFloat(pair.priceUsd) || 0,
          priceChange24h: pair.priceChange?.h24 || 0,
          volume24h: pair.volume?.h24 || 0,
          liquidity: pair.liquidity?.usd || 0,
          marketCap: pair.marketCap || pair.fdv || 0,
          txCount: (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0),
          createdAt: pair.pairCreatedAt || Date.now(),
          source: "dexscreener",
        };
      }
    }

    if (!tokenData) {
      // Try Birdeye as final fallback
      try {
        const birdeyeData = await birdeyeService.getTokenData(address);
        if (birdeyeData) {
          tokenData = {
            address: birdeyeData.address,
            symbol: birdeyeData.symbol,
            name: birdeyeData.name,
            logoUri: birdeyeData.logoURI,
            price: birdeyeData.price,
            priceChange24h: birdeyeData.priceChange24h,
            volume24h: birdeyeData.volume24h,
            liquidity: birdeyeData.liquidity,
            marketCap: birdeyeData.marketCap,
            txCount: 0,
            createdAt: Date.now(),
            source: "birdeye",
          };
        }
      } catch (err) {
        console.error("Birdeye token fetch error:", err);
      }
    }

    if (!tokenData) {
      return res.status(404).json({ error: "Token not found" });
    }

    // Enrich with Moralis logo if not present
    if (!tokenData.logoUri) {
      const moralisLogo = moralisService.getCachedLogo(address);
      if (moralisLogo) {
        tokenData.logoUri = moralisLogo;
      } else {
        // Trigger async fetch for next time
        moralisService.prefetchLogo(address);
      }
    }

    // Enrich with pump.fun social links if not present
    if (!tokenData.twitter && !tokenData.website && !tokenData.telegram) {
      try {
        const pumpFunData = await pumpFunService.getCoin(address);
        if (pumpFunData) {
          tokenData.twitter = pumpFunData.twitter || tokenData.twitter;
          tokenData.website = pumpFunData.website || tokenData.website;
          tokenData.telegram = pumpFunData.telegram || tokenData.telegram;
          tokenData.description = pumpFunData.description || tokenData.description;
          // Also use pump.fun logo if we don't have one
          if (!tokenData.logoUri && pumpFunData.logoUri) {
            tokenData.logoUri = pumpFunData.logoUri;
          }
        }
      } catch (err) {
        // Silently fail - social links are optional
        console.log(`Could not enrich with pump.fun social links for ${address}`);
      }
    }

    res.json(tokenData);
  } catch (error) {
    console.error("Error fetching token data:", error);
    res.status(500).json({ error: "Failed to fetch token data" });
  }
});

// GET /api/pulse/ohlcv/:address - Get OHLCV candlestick data
// PRIMARY SOURCE: Moralis pairs OHLCV API (1min candles by default)
// FALLBACK: PumpPortal real-time trade tracking, then Moralis swap history
pulseRoutes.get("/ohlcv/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const timeframe = (req.query.timeframe as string) || "1min";
    const fromDate = req.query.fromDate ? parseInt(req.query.fromDate as string, 10) : undefined;
    const toDate = req.query.toDate ? parseInt(req.query.toDate as string, 10) : undefined;

    // Check cache first (30 seconds TTL to prevent rate limiting)
    // Include date range in cache key for different timeframe requests
    const cacheKey = `pulse:ohlcv:${address}:${timeframe}:${fromDate || ""}:${toDate || ""}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      const cachedData = JSON.parse(cached);
      console.log(`📊 [Cache HIT] ${timeframe} for ${address}: ${cachedData.data?.length || 0} candles`);
      return res.json(cachedData);
    }
    console.log(`📊 [Cache MISS] ${timeframe} for ${address}`);

    let source = "moralis";
    let ohlcv: any[] = [];

    // Always subscribe to PumpPortal trades for real-time updates
    pumpPortalService.subscribeTokenTrades([address]);

    // For 1s timeframe: Use per-trade candles (one candle per swap) like pump.fun
    // This shows every individual trade as its own candle for maximum detail
    if (timeframe === "1s") {
      console.log(`📊 [1s] Fetching per-trade candles for ${address}`);
      try {
        // Build per-trade candles from swap history (up to 2000 trades)
        // perTrade=true creates one candle per swap, just like pump.fun's native chart
        ohlcv = await moralisService.getOHLCVFromSwaps(address, 0, 2000, true);
        console.log(`📊 [1s] Got ${ohlcv.length} per-trade candles from swaps`);
        if (ohlcv.length > 0) {
          source = "moralis-swaps-pertrade";
          console.log(`📊 Built ${ohlcv.length} per-trade candles from Moralis swaps for ${address}`);
        }
      } catch (swapError: any) {
        console.warn(`📊 [1s] Moralis swap OHLCV failed for ${address}:`, swapError.message);
      }

      // If swaps didn't return enough, also check PumpPortal for real-time data
      if (ohlcv.length < 10) {
        const pumpPortalOhlcv = pumpPortalService.getTokenOHLCV(address);
        if (pumpPortalOhlcv.length > ohlcv.length) {
          ohlcv = pumpPortalOhlcv;
          source = "pumpportal-realtime";
          console.log(`📊 Got ${ohlcv.length} real-time 1s candles from PumpPortal for ${address}`);
        }
      }
    }

    // For non-1s timeframes: Use Moralis OHLCV API (proper candlestick data from pairs)
    if (timeframe !== "1s" && ohlcv.length < 5) {
      try {
        const moralisOhlcv = await moralisService.getOHLCV(address, timeframe as any, {
          fromDate,
          toDate,
        });
        if (moralisOhlcv.length > ohlcv.length) {
          ohlcv = moralisOhlcv;
          source = "moralis";
          console.log(`📊 Got ${ohlcv.length} ${timeframe} candles from Moralis OHLCV for ${address}`);
        }
      } catch (moralisError: any) {
        // Expected for very new tokens without trading pairs yet
        if (!moralisError.message?.includes("No trading pairs")) {
          console.warn(`Moralis OHLCV failed for ${address}:`, moralisError.message);
        }
      }
    }

    // FALLBACK: Try building OHLCV from swaps for non-1s timeframes if we have nothing
    if (ohlcv.length === 0) {
      try {
        ohlcv = await moralisService.getOHLCVFromSwaps(address, 60000, 300); // 1-minute candles
        if (ohlcv.length > 0) {
          source = "moralis-swaps";
          console.log(`📊 Built ${ohlcv.length} candles from Moralis swaps for ${address}`);
        }
      } catch (swapError) {
        console.warn(`Moralis swap OHLCV failed for ${address}`);
      }
    }

    // FALLBACK 3: Generate flat candles from current price (shows at least something)
    if (ohlcv.length === 0) {
      try {
        const priceData = await moralisService.getTokenPrice(address);
        if (priceData && priceData.usdPrice > 0) {
          const now = Date.now();
          const startTime = Math.floor(now / 60000) * 60000; // Round to minute

          // Create 60 minutes of flat candles
          ohlcv = [];
          for (let i = 59; i >= 0; i--) {
            ohlcv.push({
              timestamp: startTime - (i * 60000),
              open: priceData.usdPrice,
              high: priceData.usdPrice,
              low: priceData.usdPrice,
              close: priceData.usdPrice,
              volume: 0,
            });
          }
          source = "moralis-price";
          console.log(`📊 Generated flat OHLCV for ${address} from price: $${priceData.usdPrice}`);
        }
      } catch (priceError) {
        console.warn(`Failed to get price for ${address}`);
      }
    }

    const response = {
      address,
      timeframe,
      data: ohlcv,
      timestamp: Date.now(),
      source,
      realtime: pumpPortalService.isConnected(),
    };

    // Cache based on source - shorter for real-time PumpPortal data
    // PumpPortal real-time: 2 seconds (allow frequent polling for live updates)
    // Moralis: 30 seconds to prevent rate limiting
    // No data: 5 seconds (retry faster)
    const isRealtimeSource = source.includes("pumpportal");
    const cacheTTL = isRealtimeSource ? 2 : (ohlcv.length > 0 ? 30 : 5);
    await cache.set(cacheKey, JSON.stringify(response), cacheTTL);

    res.json(response);
  } catch (error) {
    console.error("Error fetching pulse OHLCV:", error);
    res.status(500).json({ error: "Failed to fetch OHLCV data" });
  }
});

// GET /api/pulse/image/:address - Get token logo URL from Moralis
// Returns CDN-hosted image URL for reliable image loading
pulseRoutes.get("/image/:address", async (req, res) => {
  try {
    const { address } = req.params;

    // Check cache first
    let logoUrl = moralisService.getCachedLogo(address);

    if (!logoUrl) {
      // Fetch from Moralis
      logoUrl = await moralisService.getTokenLogo(address);
    }

    if (logoUrl) {
      // Return the logo URL - frontend can use this directly
      res.json({ address, logoUrl });
    } else {
      // No logo found
      res.status(404).json({ error: "Logo not found" });
    }
  } catch (error) {
    console.error("Error fetching token logo:", error);
    res.status(500).json({ error: "Failed to fetch token logo" });
  }
});

// GET /api/pulse/metadata/:address - Get full token metadata from Moralis
pulseRoutes.get("/metadata/:address", async (req, res) => {
  try {
    const { address } = req.params;

    const metadata = await moralisService.getTokenMetadata(address);

    if (metadata) {
      res.json(metadata);
    } else {
      res.status(404).json({ error: "Metadata not found" });
    }
  } catch (error) {
    console.error("Error fetching token metadata:", error);
    res.status(500).json({ error: "Failed to fetch token metadata" });
  }
});

// GET /api/pulse/trades/:address - Get recent trades/swaps for a token
// SOURCE: Moralis swaps API
pulseRoutes.get("/trades/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    // Check cache first (10 second TTL)
    const cacheKey = `pulse:trades:${address}:${limit}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const { swaps, cursor } = await moralisService.getTokenSwaps(address, {
      order: "DESC",
      limit,
    });

    // Format swaps for frontend display
    // Moralis swap structure: bought = what wallet received, sold = what wallet paid
    // transactionType: "buy" = wallet bought the token, "sell" = wallet sold the token
    const trades = swaps.map((swap) => {
      // Use transactionType directly from Moralis
      const isBuy = swap.transactionType === "buy";

      // For a buy: bought = the token, sold = SOL/quote
      // For a sell: sold = the token, bought = SOL/quote
      const tokenSide = isBuy ? swap.bought : swap.sold;
      const quoteSide = isBuy ? swap.sold : swap.bought;

      return {
        txHash: swap.transactionHash,
        timestamp: new Date(swap.blockTimestamp).getTime(),
        type: isBuy ? "buy" : "sell",
        wallet: swap.walletAddress,
        tokenAmount: tokenSide?.amount,
        tokenAmountUsd: tokenSide?.usdAmount,
        tokenSymbol: tokenSide?.symbol,
        otherAmount: quoteSide?.amount,
        otherSymbol: quoteSide?.symbol,
        otherAmountUsd: quoteSide?.usdAmount,
        priceUsd: tokenSide?.usdPrice,
        totalValueUsd: swap.totalValueUsd,
        pairLabel: swap.pairLabel,
        exchangeName: swap.exchangeName,
      };
    });

    const response = {
      address,
      trades,
      total: trades.length,
      cursor,
      timestamp: Date.now(),
      source: "moralis",
    };

    await cache.set(cacheKey, JSON.stringify(response), 10);
    res.json(response);
  } catch (error) {
    console.error("Error fetching trades:", error);
    res.status(500).json({ error: "Failed to fetch trades" });
  }
});

// GET /api/pulse/holders/:address - Get holder stats and top holders
// SOURCE: Moralis holders API
pulseRoutes.get("/holders/:address", async (req, res) => {
  try {
    const { address } = req.params;

    // Check cache first (60 second TTL - holder data changes slower)
    const cacheKey = `pulse:holders:${address}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Fetch holder stats and top holders in parallel
    const [stats, topHolders] = await Promise.all([
      moralisService.getHolderStats(address),
      moralisService.getTopHolders(address, 20),
    ]);

    const response = {
      address,
      stats: stats || {
        totalHolders: 0,
        holderChange: {},
      },
      topHolders: topHolders.map((h) => ({
        address: h.ownerAddress,
        balance: h.balanceFormatted,
        percentOfSupply: h.percentageRelativeToTotalSupply,
        usdValue: h.usdValue ? parseFloat(h.usdValue) : undefined,
      })),
      timestamp: Date.now(),
      source: "moralis",
    };

    await cache.set(cacheKey, JSON.stringify(response), 60);
    res.json(response);
  } catch (error) {
    console.error("Error fetching holders:", error);
    res.status(500).json({ error: "Failed to fetch holders" });
  }
});

// GET /api/pulse/stats/:address - Get token trading stats/analytics
// SOURCE: Moralis pair stats API
pulseRoutes.get("/stats/:address", async (req, res) => {
  try {
    const { address } = req.params;

    // Check cache first (30 second TTL)
    const cacheKey = `pulse:stats:${address}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Fetch token data, stats, and pairs in parallel
    const [tokenData, tokenStats, pairs] = await Promise.all([
      moralisService.getTokenData(address),
      moralisService.getTokenStats(address),
      moralisService.getTokenPairs(address),
    ]);

    const mainPair = pairs?.find((p) => !p.inactivePair) || pairs?.[0];

    const response = {
      address,
      price: tokenData?.price || 0,
      priceChange24h: tokenData?.priceChange24h || 0,
      marketCap: tokenData?.marketCap || 0,
      liquidity: mainPair?.liquidityUsd || tokenData?.liquidity || 0,
      volume24h: mainPair?.volume24hrUsd || tokenData?.volume24h || 0,
      stats: tokenStats || {},
      exchange: mainPair?.exchangeName || "Unknown",
      pairAddress: mainPair?.pairAddress,
      timestamp: Date.now(),
      source: "moralis",
    };

    await cache.set(cacheKey, JSON.stringify(response), 30);
    res.json(response);
  } catch (error) {
    console.error("Error fetching token stats:", error);
    res.status(500).json({ error: "Failed to fetch token stats" });
  }
});
