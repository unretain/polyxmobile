/**
 * Solana on-chain data utilities
 * Replaces Birdeye/Moralis for token metadata and prices
 */

import { Connection, PublicKey } from "@solana/web3.js";

// Metaplex Token Metadata Program
const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

// RPC URL - use Helius free tier (better rate limits than public mainnet)
// Helius free: ~10 req/s vs public mainnet: ~2 req/s
const RPC_URL = process.env.SOLANA_RPC_URL || "https://mainnet.helius-rpc.com/?api-key=1d8740dc-e5f4-421c-b823-e1bad1889eff";

// Create connection (reusable) - HTTP only, no WebSocket
let _connection: Connection | null = null;
export function getConnection(): Connection {
  if (!_connection) {
    _connection = new Connection(RPC_URL, {
      commitment: "confirmed",
      // Disable WebSocket - not all RPCs support it
      disableRetryOnRateLimit: false,
    });
  }
  return _connection;
}

// Token metadata interface
export interface TokenMetadata {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  image?: string;
  description?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
}

// Jupiter price response
export interface JupiterPrice {
  id: string;
  mintSymbol: string;
  vsToken: string;
  vsTokenSymbol: string;
  price: number;
}

/**
 * Derive Metaplex metadata PDA from mint address
 */
export function getMetadataPDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    METADATA_PROGRAM_ID
  );
  return pda;
}

/**
 * Parse Metaplex metadata from account data
 */
function parseMetaplexMetadata(data: Buffer): { name: string; symbol: string; uri: string } | null {
  try {
    // Metaplex metadata structure (simplified):
    // [0]: key (1 byte)
    // [1-32]: update authority (32 bytes)
    // [33-64]: mint (32 bytes)
    // [65]: name length (4 bytes LE)
    // [69+]: name string (32 bytes max, null-padded)
    // Then symbol length, symbol, uri length, uri

    let offset = 1 + 32 + 32; // Skip key, update_authority, mint

    // Read name (length prefix is 4 bytes LE, then 32 bytes max string)
    const nameLen = data.readUInt32LE(offset);
    offset += 4;
    const name = data.slice(offset, offset + 32).toString("utf8").replace(/\0/g, "").trim();
    offset += 32;

    // Read symbol
    const symbolLen = data.readUInt32LE(offset);
    offset += 4;
    const symbol = data.slice(offset, offset + 10).toString("utf8").replace(/\0/g, "").trim();
    offset += 10;

    // Read uri
    const uriLen = data.readUInt32LE(offset);
    offset += 4;
    const uri = data.slice(offset, offset + 200).toString("utf8").replace(/\0/g, "").trim();

    return { name, symbol, uri };
  } catch (e) {
    console.error("Failed to parse Metaplex metadata:", e);
    return null;
  }
}

/**
 * Fetch token metadata from Metaplex on-chain
 */
export async function getTokenMetadata(mint: string): Promise<TokenMetadata | null> {
  try {
    const connection = getConnection();
    const mintPubkey = new PublicKey(mint);
    const metadataPDA = getMetadataPDA(mintPubkey);

    const accountInfo = await connection.getAccountInfo(metadataPDA);
    if (!accountInfo?.data) {
      return null;
    }

    const parsed = parseMetaplexMetadata(accountInfo.data);
    if (!parsed) {
      return null;
    }

    const metadata: TokenMetadata = {
      mint,
      name: parsed.name,
      symbol: parsed.symbol,
      uri: parsed.uri,
    };

    // Fetch off-chain metadata from URI (for image, description, socials)
    if (parsed.uri && parsed.uri.startsWith("http")) {
      try {
        const res = await fetch(parsed.uri, {
          signal: AbortSignal.timeout(5000),
          headers: { "Accept": "application/json" }
        });
        if (res.ok) {
          const json = await res.json();
          metadata.image = json.image;
          metadata.description = json.description;
          metadata.twitter = json.twitter || json.extensions?.twitter;
          metadata.telegram = json.telegram || json.extensions?.telegram;
          metadata.website = json.website || json.extensions?.website;
        }
      } catch (e) {
        // URI fetch failed, continue without off-chain data
      }
    }

    return metadata;
  } catch (e) {
    console.error(`Failed to fetch metadata for ${mint}:`, e);
    return null;
  }
}

/**
 * Batch fetch token metadata (parallel with rate limiting)
 */
export async function getTokenMetadataBatch(mints: string[], concurrency = 5): Promise<Map<string, TokenMetadata>> {
  const results = new Map<string, TokenMetadata>();

  // Process in batches
  for (let i = 0; i < mints.length; i += concurrency) {
    const batch = mints.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (mint) => {
        const metadata = await getTokenMetadata(mint);
        return { mint, metadata };
      })
    );

    for (const { mint, metadata } of batchResults) {
      if (metadata) {
        results.set(mint, metadata);
      }
    }

    // Small delay between batches to avoid rate limits
    if (i + concurrency < mints.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return results;
}

/**
 * Get token price from Jupiter (free API, no key needed)
 */
export async function getTokenPrice(mint: string): Promise<number | null> {
  try {
    const res = await fetch(`https://price.jup.ag/v6/price?ids=${mint}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    return data.data?.[mint]?.price || null;
  } catch (e) {
    console.error(`Failed to fetch price for ${mint}:`, e);
    return null;
  }
}

/**
 * Batch fetch token prices from Jupiter
 */
export async function getTokenPrices(mints: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();

  if (mints.length === 0) return prices;

  try {
    // Jupiter supports up to 100 tokens per request
    const chunks = [];
    for (let i = 0; i < mints.length; i += 100) {
      chunks.push(mints.slice(i, i + 100));
    }

    for (const chunk of chunks) {
      const ids = chunk.join(",");
      const res = await fetch(`https://price.jup.ag/v6/price?ids=${ids}`, {
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = await res.json();
        for (const mint of chunk) {
          const price = data.data?.[mint]?.price;
          if (price) {
            prices.set(mint, price);
          }
        }
      }
    }
  } catch (e) {
    console.error("Failed to fetch prices from Jupiter:", e);
  }

  return prices;
}

/**
 * Get SOL price in USD
 */
export async function getSolPrice(): Promise<number> {
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const price = await getTokenPrice(SOL_MINT);
  return price || 0;
}

/**
 * Get token supply (for market cap calculation)
 */
export async function getTokenSupply(mint: string): Promise<number | null> {
  try {
    const connection = getConnection();
    const mintPubkey = new PublicKey(mint);
    const supply = await connection.getTokenSupply(mintPubkey);
    return supply.value.uiAmount;
  } catch (e) {
    console.error(`Failed to fetch supply for ${mint}:`, e);
    return null;
  }
}

/**
 * Calculate market cap from price and supply
 */
export async function getMarketCap(mint: string): Promise<number | null> {
  const [price, supply] = await Promise.all([
    getTokenPrice(mint),
    getTokenSupply(mint),
  ]);

  if (price === null || supply === null) return null;
  return price * supply;
}
