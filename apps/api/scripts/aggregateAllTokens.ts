import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Dashboard tokens to aggregate
const DASHBOARD_TOKENS = [
  "So11111111111111111111111111111111111111112", // SOL
  "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", // JitoSOL
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", // WETH
  "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh", // WBTC
  "FUAfBo2jgks6gB4Z4LfZkqSZgzNucisEHqnNebaRxM1P", // ZEC
  "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn", // PUMP
  "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN", // TRUMP
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", // WIF
  "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", // POPCAT
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", // JUP
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", // RAY
];

interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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

async function aggregateToken(tokenAddress: string) {
  // Get all daily candles for this token
  const dailyCandles = await prisma.candleCache.findMany({
    where: {
      tokenAddress,
      timeframe: "1d",
    },
    orderBy: { timestamp: "asc" },
  });

  if (dailyCandles.length === 0) {
    console.log(`  No daily candles for ${tokenAddress.substring(0, 8)}...`);
    return { weekly: 0, monthly: 0 };
  }

  console.log(`  Found ${dailyCandles.length} daily candles`);

  // Aggregate to weekly
  const weeklyCandles = aggregateToWeekly(dailyCandles);
  console.log(`  Aggregated to ${weeklyCandles.length} weekly candles`);

  // Aggregate to monthly
  const monthlyCandles = aggregateToMonthly(dailyCandles);
  console.log(`  Aggregated to ${monthlyCandles.length} monthly candles`);

  // Store weekly candles
  for (const candle of weeklyCandles) {
    await prisma.candleCache.upsert({
      where: {
        tokenAddress_timeframe_timestamp: {
          tokenAddress,
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
        tokenAddress,
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

  // Store monthly candles
  for (const candle of monthlyCandles) {
    await prisma.candleCache.upsert({
      where: {
        tokenAddress_timeframe_timestamp: {
          tokenAddress,
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
        tokenAddress,
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

  return { weekly: weeklyCandles.length, monthly: monthlyCandles.length };
}

async function main() {
  console.log("Aggregating 1w and 1M candles for all dashboard tokens...\n");

  for (const tokenAddress of DASHBOARD_TOKENS) {
    console.log(`\nProcessing ${tokenAddress.substring(0, 8)}...`);
    const result = await aggregateToken(tokenAddress);
    console.log(`  Stored: ${result.weekly} weekly, ${result.monthly} monthly`);
  }

  console.log("\n Done!");
  await prisma.$disconnect();
}

main().catch(console.error);
