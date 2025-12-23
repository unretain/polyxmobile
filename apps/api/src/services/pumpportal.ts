// PumpPortal WebSocket Service
// Real-time pump.fun data via wss://pumpportal.fun/api/data
// Free API - no key required

import WebSocket from "ws";
import { EventEmitter } from "events";
import { solPriceService } from "./solPrice";
import { moralisService } from "./moralis";
import { prisma } from "../lib/prisma";

const PUMPPORTAL_WS_URL = "wss://pumpportal.fun/api/data";

// IPFS gateways to try in order (some may be faster or more reliable)
// pump.mypinata.cloud is pump.fun's own IPFS gateway - most reliable for pump.fun tokens
const IPFS_GATEWAYS = [
  "https://pump.mypinata.cloud/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://cf-ipfs.com/ipfs/",
  "https://ipfs.io/ipfs/",
];

// Helper to convert IPFS URI to gateway URL
function ipfsToGatewayUrl(uri: string, gateway: string = IPFS_GATEWAYS[0]): string {
  if (uri.startsWith("ipfs://")) {
    return gateway + uri.slice(7);
  }
  if (uri.startsWith("https://ipfs.io/ipfs/")) {
    return gateway + uri.slice(21);
  }
  if (uri.startsWith("https://cf-ipfs.com/ipfs/")) {
    return gateway + uri.slice(25);
  }
  // Already a gateway URL or other format
  return uri;
}

// New token creation event from pump.fun
export interface PumpPortalNewToken {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  bondingCurveKey: string;
  traderPublicKey: string; // creator
  signature: string;
  txType: "create";
  initialBuy: number;
  marketCapSol: number;
  vSolInBondingCurve: number;
  timestamp?: number;
}

// Trade event on a token
export interface PumpPortalTrade {
  mint: string;
  traderPublicKey: string;
  txType: "buy" | "sell";
  tokenAmount: number;
  solAmount: number;
  bondingCurveKey: string;
  vTokensInBondingCurve: number;
  vSolInBondingCurve: number;
  marketCapSol: number;
  signature: string;
  timestamp?: number;
}

// Migration event (graduation to Raydium/PumpSwap)
export interface PumpPortalMigration {
  mint: string;
  signature: string;
  txType: "migration";
  pool?: string; // Raydium pool address
  timestamp?: number;
}

export type PumpPortalEvent = PumpPortalNewToken | PumpPortalTrade | PumpPortalMigration;

class PumpPortalService extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private isConnecting = false;
  private subscribedTokens: Set<string> = new Set();
  private subscribedAccounts: Set<string> = new Set();
  private isSubscribedToNewTokens = false;
  private isSubscribedToMigrations = false;

  // Recent tokens cache for the Pulse page
  private recentNewTokens: PumpPortalNewToken[] = [];
  private recentMigrations: PumpPortalMigration[] = [];
  private graduatingTokens: Map<string, PumpPortalNewToken> = new Map(); // Tokens near graduation
  private maxCacheSize = 100;
  private graduationThresholdSol = 400; // ~$60k at $150 SOL - close to $69k graduation

  // 1-second OHLCV tracking for real-time charts
  private tradeOHLCV: Map<string, { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[]> = new Map();
  private maxOHLVCacheSeconds = 300; // Keep 5 minutes of 1s candles per token

  // Image URL cache - maps mint address to resolved image URL
  private imageCache: Map<string, string> = new Map();
  private imageFetchQueue: Map<string, Promise<string | undefined>> = new Map();

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  // Fetch image URL from IPFS metadata with retry and gateway fallback
  private async fetchImageFromMetadata(uri: string, mint: string): Promise<string | undefined> {
    // Check cache first
    if (this.imageCache.has(mint)) {
      return this.imageCache.get(mint);
    }

    // Check if already fetching
    if (this.imageFetchQueue.has(mint)) {
      return this.imageFetchQueue.get(mint);
    }

    // Create fetch promise with retry logic across multiple gateways
    const fetchPromise = (async () => {
      // Extract the IPFS CID from the URI
      let ipfsCid = uri;
      if (uri.startsWith("ipfs://")) {
        ipfsCid = uri.slice(7);
      } else if (uri.startsWith("https://")) {
        // Extract CID from various gateway URLs
        const match = uri.match(/\/ipfs\/([^/?]+)/);
        if (match) {
          ipfsCid = match[1];
        }
      }

      // Try each gateway with retries
      for (const gateway of IPFS_GATEWAYS) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const metadataUrl = gateway + ipfsCid;
            const response = await fetch(metadataUrl, {
              signal: AbortSignal.timeout(10000), // 10 second timeout
              headers: {
                'Accept': 'application/json',
              },
            });

            if (!response.ok) {
              if (attempt === 0) continue; // Try again on same gateway
              break; // Move to next gateway
            }

            const metadata = await response.json();
            const imageUrl = metadata.image || metadata.image_uri;

            if (imageUrl) {
              // Convert IPFS image URL to gateway URL (use pump.fun's Pinata gateway for reliability)
              const resolvedImageUrl = ipfsToGatewayUrl(imageUrl, "https://pump.mypinata.cloud/ipfs/");
              this.imageCache.set(mint, resolvedImageUrl);
              return resolvedImageUrl;
            }
            // No image in metadata, no point trying other gateways
            return undefined;
          } catch (error) {
            // Continue to next attempt/gateway
            if (attempt === 1) {
              // Log only after second failed attempt on this gateway
              // console.debug(`Gateway ${gateway} failed for ${mint}`);
            }
          }
        }
      }

      // All gateways failed
      console.warn(`All IPFS gateways failed for ${mint}`);
      return undefined;
    })();

    this.imageFetchQueue.set(mint, fetchPromise);

    // Clean up queue after completion
    fetchPromise.finally(() => {
      this.imageFetchQueue.delete(mint);
    });

    return fetchPromise;
  }

  // Get cached image URL or undefined
  getCachedImageUrl(mint: string): string | undefined {
    return this.imageCache.get(mint);
  }

  // Trigger background image fetch for a token
  prefetchImage(uri: string, mint: string): void {
    if (!this.imageCache.has(mint) && uri) {
      this.fetchImageFromMetadata(uri, mint).catch(() => {});
    }
  }

  // Connect to PumpPortal WebSocket
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      if (this.isConnecting) {
        this.once("connected", resolve);
        return;
      }

      this.isConnecting = true;
      console.log("🔌 Connecting to PumpPortal WebSocket...");

      this.ws = new WebSocket(PUMPPORTAL_WS_URL);

      this.ws.on("open", () => {
        console.log("✅ Connected to PumpPortal WebSocket");
        this.isConnecting = false;
        this.reconnectAttempts = 0;

        // Resubscribe to previous subscriptions
        this.resubscribe();

        this.emit("connected");
        resolve();
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          console.error("Failed to parse PumpPortal message:", error);
        }
      });

      this.ws.on("close", () => {
        console.log("🔌 PumpPortal WebSocket closed");
        this.isConnecting = false;
        this.emit("disconnected");
        this.attemptReconnect();
      });

      this.ws.on("error", (error) => {
        console.error("PumpPortal WebSocket error:", error);
        this.isConnecting = false;
        if (this.reconnectAttempts === 0) {
          reject(error);
        }
      });
    });
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("Max reconnect attempts reached for PumpPortal");
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`🔄 Reconnecting to PumpPortal in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch(console.error);
    }, delay);
  }

  private resubscribe() {
    // Resubscribe to new tokens
    if (this.isSubscribedToNewTokens) {
      this.send({ method: "subscribeNewToken" });
    }

    // Resubscribe to migrations
    if (this.isSubscribedToMigrations) {
      this.send({ method: "subscribeMigration" });
    }

    // Resubscribe to specific tokens
    if (this.subscribedTokens.size > 0) {
      this.send({
        method: "subscribeTokenTrade",
        keys: Array.from(this.subscribedTokens),
      });
    }

    // Resubscribe to specific accounts
    if (this.subscribedAccounts.size > 0) {
      this.send({
        method: "subscribeAccountTrade",
        keys: Array.from(this.subscribedAccounts),
      });
    }
  }

  private send(payload: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private handleMessage(message: any) {
    // Add timestamp if not present
    if (!message.timestamp) {
      message.timestamp = Date.now();
    }

    if (message.txType === "create") {
      // New token created
      const token = message as PumpPortalNewToken;
      this.addToCache(this.recentNewTokens, token);
      this.emit("newToken", token);

      // Emit initial pair data (may not have logo yet)
      const initialPairData = this.mapToNewPairToken(token);
      this.emit("pulse:newPair", initialPairData);

      // Fetch logo - try Moralis first, then fall back to IPFS
      moralisService.getTokenLogo(token.mint).then((logo) => {
        if (logo) {
          // Cache in our local image cache too
          this.imageCache.set(token.mint, logo);
          // Emit updated token with logo
          this.emit("pulse:tokenUpdate", {
            address: token.mint,
            logoUri: logo,
          });
        } else if (token.uri) {
          // Moralis returned null (token not indexed yet) - try IPFS
          this.fetchImageFromMetadata(token.uri, token.mint).then((ipfsLogo) => {
            if (ipfsLogo) {
              this.emit("pulse:tokenUpdate", {
                address: token.mint,
                logoUri: ipfsLogo,
              });
            }
          });
        }
      }).catch(() => {
        // Moralis error - try IPFS as fallback
        if (token.uri) {
          this.fetchImageFromMetadata(token.uri, token.mint).then((ipfsLogo) => {
            if (ipfsLogo) {
              this.emit("pulse:tokenUpdate", {
                address: token.mint,
                logoUri: ipfsLogo,
              });
            }
          });
        }
      });

      // Auto-subscribe to trades for this token to track graduation
      this.subscribeTokenTrades([token.mint]);
    } else if (message.txType === "buy" || message.txType === "sell") {
      // Trade event - track market cap for graduating tokens
      const trade = message as PumpPortalTrade;
      this.emit("trade", trade);

      // Build 1-second OHLCV from trade events
      this.updateTradeOHLCV(trade);

      // Check if this token is approaching graduation threshold
      if (trade.marketCapSol >= this.graduationThresholdSol) {
        // Find the token in recent tokens or create a stub
        const existingToken = this.recentNewTokens.find(t => t.mint === trade.mint);
        if (existingToken) {
          // Update market cap and add to graduating
          const updated = { ...existingToken, marketCapSol: trade.marketCapSol, vSolInBondingCurve: trade.vSolInBondingCurve };
          this.graduatingTokens.set(trade.mint, updated);
          this.emit("pulse:graduating", this.mapToNewPairToken(updated));
        }
      }
    } else if (message.txType === "migration") {
      // Migration to Raydium/PumpSwap
      const migration = message as PumpPortalMigration;
      this.addToCache(this.recentMigrations, migration);

      // Remove from graduating tokens if present
      this.graduatingTokens.delete(migration.mint);

      // Find the token data to include in migration event
      const tokenData = this.recentNewTokens.find(t => t.mint === migration.mint);

      this.emit("migration", migration);
      this.emit("pulse:migrated", { ...migration, tokenData: tokenData ? this.mapToNewPairToken(tokenData) : null });
    }
  }

  private addToCache<T extends { mint?: string }>(cache: T[], item: T) {
    cache.unshift(item);
    if (cache.length > this.maxCacheSize) {
      const removed = cache.pop();
      // Unsubscribe from old token trades to prevent memory leak
      if (removed?.mint && this.subscribedTokens.has(removed.mint)) {
        this.unsubscribeTokenTrades([removed.mint]);
      }
    }
  }

  // Map PumpPortal token to our NewPairToken format
  private mapToNewPairToken(token: PumpPortalNewToken) {
    // Get real SOL price from Jupiter API
    const solPrice = solPriceService.getPriceSync();

    // Try to get cached image URL from Moralis (CDN-hosted, reliable)
    // If not yet fetched, try IPFS cache as fallback, otherwise trigger prefetch
    let imageUrl = moralisService.getCachedLogo(token.mint);

    if (!imageUrl) {
      // Fallback to IPFS cache
      imageUrl = this.getCachedImageUrl(token.mint);
    }

    if (!imageUrl) {
      // Trigger background fetch from Moralis (more reliable than IPFS)
      moralisService.prefetchLogo(token.mint);
      // Also try IPFS as backup
      if (token.uri) {
        this.prefetchImage(token.uri, token.mint);
      }
    }

    // Calculate market cap from PumpPortal's marketCapSol field
    // This is the accurate market cap provided by PumpPortal
    const marketCapSol = token.marketCapSol || 0;
    let marketCapUsd = marketCapSol * solPrice;

    // If marketCapSol is not available, estimate from bonding curve
    // New tokens start around 30 SOL in bonding curve
    if (!marketCapUsd || marketCapUsd < 1000) {
      const estimatedMarketCapSol = Math.max(token.vSolInBondingCurve || 30, 30);
      marketCapUsd = estimatedMarketCapSol * solPrice;
    }

    // Price estimation: Use vTokensInBondingCurve if available, otherwise estimate
    // Bonding curve starts with ~1B tokens, price = marketCap / tokensInCurve
    // Note: This is an estimate for display; actual trade prices use trade amounts
    const vTokens = (token as any).vTokensInBondingCurve || 1_000_000_000;
    const price = marketCapUsd / vTokens;

    // Calculate liquidity from bonding curve SOL amount
    const liquiditySol = token.vSolInBondingCurve || 0;
    const liquidityUsd = liquiditySol * solPrice;

    return {
      address: token.mint,
      symbol: token.symbol || "???",
      name: token.name || "Unknown",
      logoUri: imageUrl,
      price: price,
      priceChange24h: 0,
      volume24h: liquidityUsd, // Initial volume is the liquidity
      liquidity: liquidityUsd,
      marketCap: marketCapUsd,
      txCount: 1,
      createdAt: token.timestamp || Date.now(),
      source: "pump.fun",
      creator: token.traderPublicKey,
      complete: false,
      bondingCurve: token.bondingCurveKey,
    };
  }

  // Subscribe to new token creation events
  subscribeNewTokens() {
    this.isSubscribedToNewTokens = true;
    this.send({ method: "subscribeNewToken" });
    console.log("📡 Subscribed to PumpPortal new tokens");
  }

  // Unsubscribe from new token events
  unsubscribeNewTokens() {
    this.isSubscribedToNewTokens = false;
    this.send({ method: "unsubscribeNewToken" });
  }

  // Subscribe to migration events (graduation)
  subscribeMigrations() {
    this.isSubscribedToMigrations = true;
    this.send({ method: "subscribeMigration" });
    console.log("📡 Subscribed to PumpPortal migrations");
  }

  // Subscribe to trades on specific tokens
  subscribeTokenTrades(tokenAddresses: string[]) {
    tokenAddresses.forEach((addr) => this.subscribedTokens.add(addr));
    this.send({
      method: "subscribeTokenTrade",
      keys: tokenAddresses,
    });
  }

  // Unsubscribe from specific tokens
  unsubscribeTokenTrades(tokenAddresses: string[]) {
    tokenAddresses.forEach((addr) => this.subscribedTokens.delete(addr));
    this.send({
      method: "unsubscribeTokenTrade",
      keys: tokenAddresses,
    });
  }

  // Subscribe to trades by specific accounts (wallets)
  subscribeAccountTrades(accountAddresses: string[]) {
    accountAddresses.forEach((addr) => this.subscribedAccounts.add(addr));
    this.send({
      method: "subscribeAccountTrade",
      keys: accountAddresses,
    });
  }

  // Get recent new tokens from cache
  getRecentNewTokens() {
    return this.recentNewTokens.map((t) => this.mapToNewPairToken(t));
  }

  // Get token by address from any cache
  getTokenByAddress(address: string) {
    // Check recent new tokens
    const newToken = this.recentNewTokens.find(t => t.mint === address);
    if (newToken) {
      return this.mapToNewPairToken(newToken);
    }

    // Check graduating tokens
    const graduatingToken = this.graduatingTokens.get(address);
    if (graduatingToken) {
      return this.mapToNewPairToken(graduatingToken);
    }

    // Check migrated tokens
    const migratedData = this.recentMigrations.find(m => m.mint === address);
    if (migratedData) {
      const tokenData = this.recentNewTokens.find(t => t.mint === address);
      if (tokenData) {
        return {
          ...this.mapToNewPairToken(tokenData),
          complete: true,
          pool: migratedData.pool,
        };
      }
    }

    return null;
  }

  // Get graduating tokens (tokens near $69k market cap)
  getGraduatingTokens() {
    return Array.from(this.graduatingTokens.values())
      .sort((a, b) => b.marketCapSol - a.marketCapSol)
      .map((t) => this.mapToNewPairToken(t));
  }

  // Get recent migrations from cache
  getRecentMigrations() {
    return this.recentMigrations;
  }

  // Get migrated tokens with full token data
  // Returns only tokens that have actual data (from cache or graduating tokens)
  // Tokens without data should be fetched from Moralis by the caller
  getMigratedTokens() {
    return this.recentMigrations
      .map((m) => {
        // First check recent new tokens
        let tokenData = this.recentNewTokens.find(t => t.mint === m.mint);

        // Also check graduating tokens (more likely to have up-to-date data)
        if (!tokenData) {
          tokenData = this.graduatingTokens.get(m.mint);
        }

        if (tokenData) {
          return {
            ...this.mapToNewPairToken(tokenData),
            complete: true,
            pool: m.pool,
            migratedAt: m.timestamp || Date.now(),
          };
        }

        // Return null for tokens without data - caller should fetch from Moralis
        return null;
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);
  }

  // Update 1-second OHLCV from trade event
  // IMPORTANT: Also persists to database for pre-graduation OHLCV retention
  private updateTradeOHLCV(trade: PumpPortalTrade) {
    // Get real SOL price from Jupiter API
    const solPrice = solPriceService.getPriceSync();

    const solAmount = trade.solAmount || 0;
    const tokenAmount = trade.tokenAmount || 0;

    // Volume in USD for this trade
    const volumeUsd = solAmount * solPrice;

    // Calculate price directly from trade amounts (most accurate)
    // Price = (SOL paid * SOL price) / tokens received
    // This works regardless of token supply
    let priceUsd = 0;
    if (tokenAmount > 0 && solAmount > 0) {
      priceUsd = (solAmount * solPrice) / tokenAmount;
    }

    // Keep timestamp in milliseconds for consistency
    const timestamp = trade.timestamp || Date.now();
    // Round to nearest second (in ms)
    const candleTime = Math.floor(timestamp / 1000) * 1000;

    let candles = this.tradeOHLCV.get(trade.mint) || [];
    const lastCandle = candles[candles.length - 1];

    // Skip if price is invalid (0 or negative)
    if (!priceUsd || priceUsd <= 0) {
      return;
    }

    // PERSIST TO DATABASE: Store trade for pre-graduation OHLCV
    // This ensures bonding curve trades are available after graduation
    this.persistTradeToDb(trade, priceUsd, volumeUsd, tokenAmount, timestamp).catch((err) => {
      // Log error but don't fail - in-memory OHLCV still works
      console.error(`[PumpPortal] Failed to persist trade to DB:`, err);
    });

    if (lastCandle && lastCandle.timestamp === candleTime) {
      // Update existing candle for this second
      lastCandle.high = Math.max(lastCandle.high, priceUsd);
      lastCandle.low = Math.min(lastCandle.low, priceUsd);
      lastCandle.close = priceUsd;
      lastCandle.volume += volumeUsd;
    } else {
      // Create new candle for this second
      const newCandle = {
        timestamp: candleTime,
        open: priceUsd,
        high: priceUsd,
        low: priceUsd,
        close: priceUsd,
        volume: volumeUsd,
      };
      candles.push(newCandle);

      // Keep only recent candles (5 minutes worth)
      const cutoff = Date.now() - (this.maxOHLVCacheSeconds * 1000);
      candles = candles.filter(c => c.timestamp >= cutoff);
      this.tradeOHLCV.set(trade.mint, candles);
    }

    // Emit real-time OHLCV update
    this.emit("ohlcv:update", { mint: trade.mint, candle: candles[candles.length - 1] });
  }

  // Persist PumpPortal trade to TokenSwap table
  // This is CRITICAL for retaining pre-graduation OHLCV data
  private async persistTradeToDb(
    trade: PumpPortalTrade,
    priceUsd: number,
    volumeUsd: number,
    tokenAmount: number,
    timestamp: number
  ): Promise<void> {
    try {
      await prisma.tokenSwap.create({
        data: {
          tokenAddress: trade.mint,
          txHash: trade.signature,
          timestamp: new Date(timestamp),
          type: trade.txType,
          walletAddress: trade.traderPublicKey,
          tokenAmount: tokenAmount,
          solAmount: trade.solAmount || 0,
          priceUsd: priceUsd,
          totalValueUsd: volumeUsd,
        },
      });
    } catch (err: any) {
      // Ignore duplicate key errors - trade already stored
      if (err.code === "P2002") {
        return;
      }
      throw err;
    }
  }

  // Get 1-second OHLCV data for a token (with gaps filled)
  getTokenOHLCV(mint: string): { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[] {
    // Return only raw candles with actual trades - no gap filling
    // This matches pump.fun's native chart behavior where candles only appear when trades happen
    return this.tradeOHLCV.get(mint) || [];
  }

  // Check if connected
  isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // Disconnect
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const pumpPortalService = new PumpPortalService();
