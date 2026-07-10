/**
 * Shared Pump.fun gRPC Manager - Simple version
 * Just new pairs from transactions, no metadata
 */

const GRPC_ENDPOINT = process.env.GRPC_ENDPOINT || "";
const GRPC_TOKEN = process.env.GRPC_TOKEN || "";
const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const GRADUATION_MC_SOL = 420;

// Fetch SOL price - try multiple sources
async function fetchSolPrice(): Promise<number> {
  // Try Binance first (most reliable)
  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT");
    const data = await res.json();
    if (data?.price) return parseFloat(data.price);
  } catch {}

  // Fallback to CoinGecko
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    const data = await res.json();
    if (data?.solana?.usd) return data.solana.usd;
  } catch {}

  return 0;
}

const SYSTEM_TOKENS = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);

// Parse pump.fun Create instruction for metadata
// Layout: [8 discriminator][4 name_len][name][4 symbol_len][symbol][4 uri_len][uri]
function parseCreateInstruction(data: Buffer | Uint8Array): { name: string; symbol: string; uri: string } | null {
  try {
    const buf = Buffer.from(data);
    if (buf.length < 20) return null;

    let offset = 8; // Skip discriminator

    // Name
    const nameLen = buf.readUInt32LE(offset);
    offset += 4;
    if (nameLen > 50 || offset + nameLen > buf.length) return null;
    const name = buf.slice(offset, offset + nameLen).toString("utf8").trim();
    offset += nameLen;

    // Symbol
    const symbolLen = buf.readUInt32LE(offset);
    offset += 4;
    if (symbolLen > 15 || offset + symbolLen > buf.length) return null;
    const symbol = buf.slice(offset, offset + symbolLen).toString("utf8").trim();
    offset += symbolLen;

    // URI
    const uriLen = buf.readUInt32LE(offset);
    offset += 4;
    if (uriLen > 300 || offset + uriLen > buf.length) return null;
    const uri = buf.slice(offset, offset + uriLen).toString("utf8").trim();

    if (!name || !symbol) return null;
    return { name, symbol, uri };
  } catch {
    return null;
  }
}

export interface PulseToken {
  address: string;
  symbol: string;
  name: string;
  logoUri: string | null;
  price: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
  marketCapSol: number;
  txCount: number;
  createdAt: number;
  source: string;
  complete: boolean;
  progress: number;
  destination?: string;
}

declare global {
  var __pulseGrpcState: {
    connected: boolean;
    stream: any;
    connecting: boolean;
    solPrice: number;
    solPriceLastFetch: number;
    newTokens: Map<string, PulseToken>;
    graduatingTokens: Map<string, PulseToken>;
    graduatedTokens: Map<string, PulseToken>;
  } | undefined;
}

if (!global.__pulseGrpcState) {
  global.__pulseGrpcState = {
    connected: false,
    stream: null,
    connecting: false,
    solPrice: 0,
    solPriceLastFetch: 0,
    newTokens: new Map(),
    graduatingTokens: new Map(),
    graduatedTokens: new Map(),
  };
}

export const pulseState = global.__pulseGrpcState;

async function ensureSolPrice(): Promise<void> {
  const now = Date.now();
  if (now - pulseState.solPriceLastFetch > 30000 || pulseState.solPrice === 0) {
    const price = await fetchSolPrice();
    if (price > 0) {
      pulseState.solPrice = price;
      pulseState.solPriceLastFetch = now;
      console.log(`[SOL] $${price.toFixed(2)}`);
    }
  }
}

// Create token with metadata from gRPC
function createToken(mint: string, marketCapSol: number, meta?: { name: string; symbol: string; uri: string }): PulseToken {
  return {
    address: mint,
    symbol: meta?.symbol || mint.slice(0, 6),
    name: meta?.name || mint.slice(0, 8),
    logoUri: meta?.uri || null,
    price: 0,
    priceChange24h: 0,
    volume24h: 0,
    liquidity: 0,
    marketCap: marketCapSol * pulseState.solPrice,
    marketCapSol,
    txCount: 0,
    createdAt: Date.now(),
    source: "pump.fun",
    complete: false,
    progress: Math.min(100, (marketCapSol / GRADUATION_MC_SOL) * 100),
  };
}

export async function initPulseGrpc(): Promise<void> {
  if (pulseState.connected || pulseState.connecting || !GRPC_ENDPOINT || !GRPC_TOKEN) return;

  pulseState.connecting = true;

  try {
    await ensureSolPrice();

    const { default: Client, CommitmentLevel } = await import("@triton-one/yellowstone-grpc");
    const { PublicKey } = await import("@solana/web3.js");

    const client = new Client(GRPC_ENDPOINT, GRPC_TOKEN, {
      "grpc.max_receive_message_length": 64 * 1024 * 1024, // 64MB
    });
    pulseState.stream = await client.subscribe();

    pulseState.stream.on("data", async (update: any) => {
      if (update.transaction) {
        const tx = update.transaction.transaction;
        if (!tx?.meta) return;

        const logs = tx.meta.logMessages || [];
        const logsStr = logs.join(" ");

        const accountKeys = tx.transaction?.message?.accountKeys?.map(
          (k: Uint8Array) => new PublicKey(k).toBase58()
        ) || [];

        const isPumpFun = accountKeys.includes(PUMP_FUN_PROGRAM);

        // Parse SOL flow
        const preBalances = tx.meta.preBalances || [];
        const postBalances = tx.meta.postBalances || [];
        let solFlow = 0;
        for (let i = 0; i < Math.min(preBalances.length, postBalances.length); i++) {
          solFlow += (Number(postBalances[i]) - Number(preBalances[i])) / 1e9;
        }

        const postTokenBalances = tx.meta.postTokenBalances || [];
        for (const bal of postTokenBalances) {
          const mint = bal.mint;
          if (!mint || SYSTEM_TOKENS.has(mint)) continue;

          // New token from Create
          if (isPumpFun && logsStr.includes("Create") && !pulseState.newTokens.has(mint)) {
            let devBuySol = Math.abs(solFlow) > 0.01 ? Math.abs(solFlow) : 0;
            const mcSol = 28 + (devBuySol * 2);

            // Parse metadata from Create instruction (outer + inner)
            let meta: { name: string; symbol: string; uri: string } | undefined;

            // Try outer instructions
            const instructions = tx.transaction?.message?.instructions || [];
            for (const ix of instructions) {
              const progIdx = ix.programIdIndex;
              if (progIdx !== undefined && accountKeys[progIdx] === PUMP_FUN_PROGRAM && ix.data) {
                const data = typeof ix.data === "string" ? Buffer.from(ix.data, "base64") : Buffer.from(ix.data);
                const parsed = parseCreateInstruction(data);
                if (parsed) {
                  meta = parsed;
                  break;
                }
              }
            }

            // Try inner instructions if outer didn't work
            if (!meta) {
              const innerIxs = tx.meta?.innerInstructions || [];
              for (const inner of innerIxs) {
                for (const ix of inner.instructions || []) {
                  const progIdx = ix.programIdIndex;
                  if (progIdx !== undefined && accountKeys[progIdx] === PUMP_FUN_PROGRAM && ix.data) {
                    const data = typeof ix.data === "string" ? Buffer.from(ix.data, "base64") : Buffer.from(ix.data);
                    const parsed = parseCreateInstruction(data);
                    if (parsed) {
                      meta = parsed;
                      break;
                    }
                  }
                }
                if (meta) break;
              }
            }

            pulseState.newTokens.set(mint, createToken(mint, mcSol, meta));
            console.log(`[NEW] ${meta?.symbol || mint.slice(0, 8)} - ${meta?.name || "?"} MC: ${mcSol.toFixed(1)} SOL`);

            if (pulseState.newTokens.size > 100) {
              const oldest = pulseState.newTokens.keys().next().value;
              if (oldest) pulseState.newTokens.delete(oldest);
            }
          }

          // Track buys/sells
          if (isPumpFun && (logsStr.includes("Buy") || logsStr.includes("Sell"))) {
            const token = pulseState.newTokens.get(mint) || pulseState.graduatingTokens.get(mint);
            if (token) {
              const mcChange = Math.abs(solFlow) * 1.5;
              const newMcSol = Math.max(0, token.marketCapSol + (solFlow > 0 ? mcChange : -mcChange));
              const progress = Math.min(100, (newMcSol / GRADUATION_MC_SOL) * 100);

              token.marketCapSol = newMcSol;
              token.marketCap = newMcSol * pulseState.solPrice;
              token.progress = progress;
              token.txCount++;

              if (progress >= 30 && !pulseState.graduatingTokens.has(mint)) {
                pulseState.newTokens.delete(mint);
                pulseState.graduatingTokens.set(mint, token);
                console.log(`[GRADUATING] ${mint.slice(0, 8)} ${progress.toFixed(0)}%`);
              }
            }
          }

          // Graduation via migrate
          if (isPumpFun && (logsStr.includes("Withdraw") || logsStr.includes("migrate"))) {
            const existing = pulseState.newTokens.get(mint) || pulseState.graduatingTokens.get(mint);
            if (existing && !pulseState.graduatedTokens.has(mint)) {
              pulseState.newTokens.delete(mint);
              pulseState.graduatingTokens.delete(mint);
              existing.complete = true;
              existing.destination = "pumpswap";
              pulseState.graduatedTokens.set(mint, existing);
              console.log(`[GRADUATED] ${mint.slice(0, 8)}`);

              if (pulseState.graduatedTokens.size > 50) {
                const oldest = pulseState.graduatedTokens.keys().next().value;
                if (oldest) pulseState.graduatedTokens.delete(oldest);
              }
            }
          }
        }
      }
    });

    pulseState.stream.on("error", (err: Error) => {
      console.error("[gRPC] Error:", err.message);
      pulseState.connected = false;
      pulseState.stream = null;
      pulseState.connecting = false;
    });

    pulseState.stream.on("end", () => {
      pulseState.connected = false;
      pulseState.stream = null;
      pulseState.connecting = false;
    });

    await new Promise<void>((resolve, reject) => {
      pulseState.stream.write({
        slots: {},
        accounts: {},
        transactions: {
          pumpfun: {
            vote: false,
            failed: false,
            accountInclude: [PUMP_FUN_PROGRAM],
            accountExclude: [],
            accountRequired: [],
          },
        },
        transactionsStatus: {},
        blocks: {},
        blocksMeta: {},
        entry: {},
        commitment: CommitmentLevel.CONFIRMED,
        accountsDataSlice: [],
      }, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });

    pulseState.connected = true;
    pulseState.connecting = false;
    console.log("[gRPC] Connected");
  } catch (err) {
    console.error("[gRPC] Init failed:", err);
    pulseState.connecting = false;
  }
}

export async function getNewTokens(limit: number = 50): Promise<PulseToken[]> {
  await ensureSolPrice();
  return Array.from(pulseState.newTokens.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export async function getGraduatingTokens(limit: number = 20): Promise<PulseToken[]> {
  await ensureSolPrice();
  return Array.from(pulseState.graduatingTokens.values())
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, limit);
}

export async function getGraduatedTokens(limit: number = 20): Promise<PulseToken[]> {
  await ensureSolPrice();
  return Array.from(pulseState.graduatedTokens.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export function getSolPrice(): number {
  return pulseState.solPrice;
}

export function isConnected(): boolean {
  return pulseState.connected;
}
