import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Birdeye API - using internal key
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY_INTERNAL;

// Dashboard tokens to sync and aggregate
const DASHBOARD_TOKENS = [
  { address: "So11111111111111111111111111111111111111112", symbol: "SOL" },
  { address: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", symbol: "JitoSOL" },
  { address: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", symbol: "WETH" },
  { address: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh", symbol: "WBTC" },
  { address: "FUAfBo2jgks6gB4Z4LfZkqSZgzNucisEHqnNebaRxM1P", symbol: "ZEC" },
  { address: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn", symbol: "PUMP" },
  { address: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN", symbol: "TRUMP" },
  { address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK" },
  { address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF" },
  { address: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", symbol: "POPCAT" },
  { address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP" },
  { address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", symbol: "RAY" },
];

interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Fetch OHLCV from Birdeye API
async function fetchBirdeyeOHLCV(address: string, timeframe: string, from: number, to: number): Promise<OHLCV[]> {
  if (!BIRDEYE_API_KEY) {
    throw new Error("BIRDEYE_API_KEY_INTERNAL not set");
  }

  // Birdeye uses uppercase for some timeframes
  const birdeyeType = timeframe === "1d" ? "1D" : timeframe;

  const url = `https://public-api.birdeye.so/defi/ohlcv?address=${address}&type=${birdeyeType}&time_from=${from}&time_to=${to}`;

  const response = await fetch(url, {
    headers: {
      "X-API-KEY": BIRDEYE_API_KEY,
      "x-chain": "solana",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Birdeye API error: ${response.status} - ${text}`);
    throw new Error(`Birdeye API error: ${response.status}`);
  }

  const data = await response.json();

  if (!data.data?.items) {
    return [];
  }

  return data.data.items.map((item: any) => ({
    timestamp: item.unixTime * 1000, // Convert to ms
    open: item.o,
    high: item.h,
    low: item.l,
    close: item.c,
    volume: item.v || 0,
  }));
}

// Store candles in DB
async function storeCandles(tokenAddress: string, timeframe: string, candles: OHLCV[]): Promise<number> {
  let stored = 0;

  for (const candle of candles) {
    try {
      await prisma.candleCache.upsert({
        where: {
          tokenAddress_timeframe_timestamp: {
            tokenAddress,
            timeframe,
            timestamp: new Date(candle.timestamp),
          },
        },
        update: {
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        },
        create: {
          tokenAddress,
          timeframe,
          timestamp: new Date(candle.timestamp),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        },
      });
      stored++;
    } catch (e) {
      // Ignore duplicates
    }
  }

  return stored;
}

function aggregateToWeekly(dailyCandles: Candle[]): Candle[] {
  if (dailyCandles.length === 0) return [];

  const weeklyCandles: Candle[] = [];
  let currentWeek: Candle[] = [];

  for (const candle of dailyCandles) {
    const dayOfWeek = candle.timestamp.getUTCDay();

    if (currentWeek.length === 0) {
      currentWeek.push(candle);
    } else if (dayOfWeek === 0 && currentWeek.length > 0) {
      // Sunday - close week
      weeklyCandles.push({
        timestamp: currentWeek[0].timestamp,
        open: currentWeek[0].open,
        high: Math.max(...currentWeek.map(c => c.high)),
        low: Math.min(...currentWeek.map(c => c.low)),
        close: currentWeek[currentWeek.length - 1].close,
        volume: currentWeek.reduce((sum, c) => sum + c.volume, 0),
      });
      currentWeek = [candle];
    } else {
      currentWeek.push(candle);
    }
  }

  if (currentWeek.length > 0) {
    weeklyCandles.push({
      timestamp: currentWeek[0].timestamp,
      open: currentWeek[0].open,
      high: Math.max(...currentWeek.map(c => c.high)),
      low: Math.min(...currentWeek.map(c => c.low)),
      close: currentWeek[currentWeek.length - 1].close,
      volume: currentWeek.reduce((sum, c) => sum + c.volume, 0),
    });
  }

  return weeklyCandles;
}

function aggregateToMonthly(dailyCandles: Candle[]): Candle[] {
  if (dailyCandles.length === 0) return [];

  const monthlyCandles: Candle[] = [];
  let currentMonth: Candle[] = [];
  let currentMonthKey = "";

  for (const candle of dailyCandles) {
    const year = candle.timestamp.getUTCFullYear();
    const month = candle.timestamp.getUTCMonth();
    const monthKey = `${year}-${month}`;

    if (currentMonth.length === 0) {
      currentMonthKey = monthKey;
      currentMonth.push(candle);
    } else if (monthKey !== currentMonthKey) {
      monthlyCandles.push({
        timestamp: currentMonth[0].timestamp,
        open: currentMonth[0].open,
        high: Math.max(...currentMonth.map(c => c.high)),
        low: Math.min(...currentMonth.map(c => c.low)),
        close: currentMonth[currentMonth.length - 1].close,
        volume: currentMonth.reduce((sum, c) => sum + c.volume, 0),
      });
      currentMonth = [candle];
      currentMonthKey = monthKey;
    } else {
      currentMonth.push(candle);
    }
  }

  if (currentMonth.length > 0) {
    monthlyCandles.push({
      timestamp: currentMonth[0].timestamp,
      open: currentMonth[0].open,
      high: Math.max(...currentMonth.map(c => c.high)),
      low: Math.min(...currentMonth.map(c => c.low)),
      close: currentMonth[currentMonth.length - 1].close,
      volume: currentMonth.reduce((sum, c) => sum + c.volume, 0),
    });
  }

  return monthlyCandles;
}

async function processToken(token: { address: string; symbol: string }) {
  const now = Math.floor(Date.now() / 1000);
  const fiveYearsAgo = now - (5 * 365 * 24 * 60 * 60);

  console.log(`\n📊 Processing ${token.symbol}...`);

  // Step 1: Fetch daily candles from Birdeye (5 years)
  console.log(`  Fetching daily candles from Birdeye (${new Date(fiveYearsAgo * 1000).toISOString().split('T')[0]} to now)...`);

  try {
    const dailyCandles = await fetchBirdeyeOHLCV(token.address, "1D", fiveYearsAgo, now);
    console.log(`  Fetched ${dailyCandles.length} daily candles from Birdeye`);

    if (dailyCandles.length === 0) {
      console.log(`  ⚠️ No daily data available for ${token.symbol}`);
      return { daily: 0, weekly: 0, monthly: 0 };
    }

    // Store daily candles in DB
    const storedDaily = await storeCandles(token.address, "1d", dailyCandles);
    console.log(`  Stored ${storedDaily} daily candles in DB`);

    // Step 2: Read all daily candles from DB (may include older cached data)
    const allDailyCandles = await prisma.candleCache.findMany({
      where: {
        tokenAddress: token.address,
        timeframe: "1d",
      },
      orderBy: { timestamp: "asc" },
    });
    console.log(`  Total daily candles in DB: ${allDailyCandles.length}`);

    if (allDailyCandles.length > 0) {
      const firstDate = allDailyCandles[0].timestamp;
      const lastDate = allDailyCandles[allDailyCandles.length - 1].timestamp;
      console.log(`  Date range: ${firstDate.toISOString().split('T')[0]} to ${lastDate.toISOString().split('T')[0]}`);
    }

    // Step 3: Aggregate to weekly
    const weeklyCandles = aggregateToWeekly(allDailyCandles);
    console.log(`  Aggregated to ${weeklyCandles.length} weekly candles`);

    // Step 4: Aggregate to monthly
    const monthlyCandles = aggregateToMonthly(allDailyCandles);
    console.log(`  Aggregated to ${monthlyCandles.length} monthly candles`);

    // Step 5: Store weekly candles
    for (const candle of weeklyCandles) {
      await prisma.candleCache.upsert({
        where: {
          tokenAddress_timeframe_timestamp: {
            tokenAddress: token.address,
            timeframe: "1w",
            timestamp: candle.timestamp,
          },
        },
        update: {
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        },
        create: {
          tokenAddress: token.address,
          timeframe: "1w",
          timestamp: candle.timestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        },
      });
    }

    // Step 6: Store monthly candles
    for (const candle of monthlyCandles) {
      await prisma.candleCache.upsert({
        where: {
          tokenAddress_timeframe_timestamp: {
            tokenAddress: token.address,
            timeframe: "1M",
            timestamp: candle.timestamp,
          },
        },
        update: {
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        },
        create: {
          tokenAddress: token.address,
          timeframe: "1M",
          timestamp: candle.timestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        },
      });
    }

    console.log(`  ✅ Stored ${weeklyCandles.length} weekly and ${monthlyCandles.length} monthly candles`);

    return { daily: allDailyCandles.length, weekly: weeklyCandles.length, monthly: monthlyCandles.length };
  } catch (error) {
    console.error(`  ❌ Error processing ${token.symbol}:`, error);
    return { daily: 0, weekly: 0, monthly: 0 };
  }
}

async function main() {
  console.log("🚀 Syncing daily candles from Birdeye and aggregating to 1w/1M...\n");
  console.log(`Using Birdeye API key: ${BIRDEYE_API_KEY ? "***" + BIRDEYE_API_KEY.slice(-4) : "NOT SET"}`);

  if (!BIRDEYE_API_KEY) {
    console.error("❌ BIRDEYE_API_KEY_INTERNAL not set!");
    process.exit(1);
  }

  const results: Record<string, { daily: number; weekly: number; monthly: number }> = {};

  for (const token of DASHBOARD_TOKENS) {
    results[token.symbol] = await processToken(token);
    // Rate limit - wait 500ms between tokens
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log("\n\n📈 Summary:");
  console.log("=" .repeat(60));
  for (const [symbol, counts] of Object.entries(results)) {
    console.log(`${symbol.padEnd(10)} Daily: ${counts.daily.toString().padStart(4)} | Weekly: ${counts.weekly.toString().padStart(3)} | Monthly: ${counts.monthly.toString().padStart(2)}`);
  }
  console.log("=" .repeat(60));

  await prisma.$disconnect();
  console.log("\n✅ Done!");
}

main().catch(console.error);
