import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TradeStatus } from "@prisma/client";
import { config } from "@/lib/config";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const MORALIS_API_URL = "https://solana-gateway.moralis.io";

// Simple token stats for SwapWidget
async function getTokenStats(userId: string, tokenMint: string) {
  const trades = await prisma.trade.findMany({
    where: {
      userId,
      status: TradeStatus.SUCCESS,
      OR: [
        { inputMint: SOL_MINT, outputMint: tokenMint },
        { inputMint: tokenMint, outputMint: SOL_MINT },
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  let totalBought = 0;
  let totalSold = 0;
  let totalSolSpent = 0;
  let totalSolReceived = 0;

  for (const trade of trades) {
    const isBuy = trade.inputMint === SOL_MINT;

    if (isBuy) {
      // Token amounts are stored as raw UI values (e.g., 353079 = 353079 tokens)
      // SOL amounts are in lamports (divide by 1e9)
      const tokenAmount = Number(trade.amountOut);
      const solAmount = Number(trade.amountIn) / 1e9;
      totalBought += tokenAmount;
      totalSolSpent += solAmount;
    } else {
      const tokenAmount = Number(trade.amountIn);
      const solAmount = Number(trade.amountOut) / 1e9;
      totalSold += tokenAmount;
      totalSolReceived += solAmount;
    }
  }

  const holding = Math.max(0, totalBought - totalSold);
  let pnlPercent = 0;
  if (totalSolSpent > 0) {
    pnlPercent = ((totalSolReceived - totalSolSpent) / totalSolSpent) * 100;
  }

  return NextResponse.json({
    bought: totalBought,
    sold: totalSold,
    holding,
    pnlPercent,
  });
}

interface DailyPnL {
  date: string; // YYYY-MM-DD
  pnl: number;
  trades: number;
  volume: number;
}

interface Position {
  mint: string;
  symbol: string;
  name: string; // Token name
  image: string | null; // Token logo URL
  totalBought: number; // Total tokens bought
  totalSold: number; // Total tokens sold
  avgBuyPrice: number; // Average buy price in SOL
  avgSellPrice: number; // Average sell price in SOL
  totalBuyCost: number; // Total SOL spent buying
  totalSellRevenue: number; // Total SOL received from selling
  currentBalance: number; // Current token balance
  realizedPnl: number; // PnL from closed positions (sells)
  unrealizedPnl: number; // PnL from open positions (needs current price)
  trades: number;
  lastTradeAt: Date | null;
}

// GET /api/trading/pnl
export async function GET(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const { searchParams } = req.nextUrl;
    const tokenMint = searchParams.get("tokenMint");

    // If tokenMint is provided, return simple stats for SwapWidget
    if (tokenMint) {
      return getTokenStats(session.user.id, tokenMint);
    }

    const period = searchParams.get("period") || "30d"; // 1d, 7d, 30d, all
    const year = parseInt(searchParams.get("year") || new Date().getFullYear().toString());
    const month = parseInt(searchParams.get("month") || (new Date().getMonth() + 1).toString());

    // Calculate date range for DISPLAY (not for fetching)
    let displayStartDate: Date;
    const displayEndDate = new Date();
    displayEndDate.setHours(23, 59, 59, 999);

    switch (period) {
      case "1d":
        displayStartDate = new Date();
        displayStartDate.setHours(0, 0, 0, 0);
        break;
      case "7d":
        displayStartDate = new Date();
        displayStartDate.setDate(displayStartDate.getDate() - 7);
        displayStartDate.setHours(0, 0, 0, 0);
        break;
      case "30d":
        displayStartDate = new Date();
        displayStartDate.setDate(displayStartDate.getDate() - 30);
        displayStartDate.setHours(0, 0, 0, 0);
        break;
      case "calendar":
        // Full month for calendar view
        displayStartDate = new Date(year, month - 1, 1);
        displayEndDate.setFullYear(year, month - 1);
        displayEndDate.setDate(new Date(year, month, 0).getDate());
        break;
      default:
        displayStartDate = new Date(0); // All time
    }

    // Fetch ALL confirmed trades for cumulative PnL calculation
    const allTrades = await prisma.trade.findMany({
      where: {
        userId: session.user.id,
        status: TradeStatus.SUCCESS,
      },
      orderBy: { confirmedAt: "asc" },
    });

    // Separate trades: those before display period (for cumulative baseline) and during display period
    const trades = allTrades.filter(t => {
      const tradeDate = t.confirmedAt || t.createdAt;
      return tradeDate >= displayStartDate && tradeDate <= displayEndDate;
    });

    const tradesBeforePeriod = allTrades.filter(t => {
      const tradeDate = t.confirmedAt || t.createdAt;
      return tradeDate < displayStartDate;
    });

    // Calculate cumulative PnL baseline from trades BEFORE the display period
    // This is needed so the chart starts at the correct cumulative value
    let cumulativePnLBaseline = 0;
    const baselinePositions = new Map<string, { avgBuyPrice: number; totalBought: number; totalBuyCost: number }>();

    for (const trade of tradesBeforePeriod) {
      const isBuy = trade.inputMint === SOL_MINT;
      const tokenMint = isBuy ? trade.outputMint : trade.inputMint;

      // SOL in lamports (divide by 1e9), tokens are stored as UI values
      const solAmount = isBuy
        ? Number(trade.amountIn) / 1e9
        : Number(trade.amountOut) / 1e9;
      const tokenAmount = isBuy
        ? Number(trade.amountOut)
        : Number(trade.amountIn);

      if (!baselinePositions.has(tokenMint)) {
        baselinePositions.set(tokenMint, { avgBuyPrice: 0, totalBought: 0, totalBuyCost: 0 });
      }
      const pos = baselinePositions.get(tokenMint)!;

      if (isBuy) {
        pos.totalBought += tokenAmount;
        pos.totalBuyCost += solAmount;
        pos.avgBuyPrice = pos.totalBuyCost / pos.totalBought;
      } else {
        // Calculate realized PnL for sells before the period
        const costBasis = pos.avgBuyPrice * tokenAmount;
        const tradePnl = solAmount - costBasis;
        cumulativePnLBaseline += tradePnl;
      }
    }

    // Calculate daily PnL
    const dailyPnLMap = new Map<string, DailyPnL>();
    const positions = new Map<string, Position>();

    // First, process ALL trades to build complete positions (for accurate cost basis and totals)
    // This ensures positions show up even if all trades were outside the display period
    const allPositions = new Map<string, Position>();

    for (const trade of allTrades) {
      const isBuy = trade.inputMint === SOL_MINT;
      const tokenMint = isBuy ? trade.outputMint : trade.inputMint;
      const tokenSymbol = isBuy ? trade.outputSymbol : trade.inputSymbol;
      const tradeDate = trade.confirmedAt || trade.createdAt;

      // SOL in lamports (divide by 1e9), tokens are stored as UI values
      const solAmount = isBuy
        ? Number(trade.amountIn) / 1e9
        : Number(trade.amountOut) / 1e9;
      const tokenAmount = isBuy
        ? Number(trade.amountOut)
        : Number(trade.amountIn);

      if (!allPositions.has(tokenMint)) {
        allPositions.set(tokenMint, {
          mint: tokenMint,
          symbol: tokenSymbol,
          name: "",
          image: null,
          totalBought: 0,
          totalSold: 0,
          avgBuyPrice: 0,
          avgSellPrice: 0,
          totalBuyCost: 0,
          totalSellRevenue: 0,
          currentBalance: 0,
          realizedPnl: 0,
          unrealizedPnl: 0,
          trades: 0,
          lastTradeAt: null,
        });
      }
      const pos = allPositions.get(tokenMint)!;
      pos.trades++;
      pos.lastTradeAt = tradeDate;

      if (isBuy) {
        pos.totalBought += tokenAmount;
        pos.totalBuyCost += solAmount;
        pos.currentBalance += tokenAmount;
        pos.avgBuyPrice = pos.totalBuyCost / pos.totalBought;
      } else {
        pos.totalSold += tokenAmount;
        pos.totalSellRevenue += solAmount;
        pos.currentBalance -= tokenAmount;
        if (pos.totalSold > 0) {
          pos.avgSellPrice = pos.totalSellRevenue / pos.totalSold;
        }

        // Calculate realized PnL for this sell
        const costBasis = pos.avgBuyPrice * tokenAmount;
        const sellRevenue = solAmount;
        const tradePnl = sellRevenue - costBasis;
        pos.realizedPnl += tradePnl;
      }
    }

    // Initialize display period positions with baseline data (for accurate cost basis)
    for (const [mint, baseline] of baselinePositions) {
      positions.set(mint, {
        mint,
        symbol: "",
        name: "",
        image: null,
        totalBought: baseline.totalBought,
        totalSold: 0,
        avgBuyPrice: baseline.avgBuyPrice,
        avgSellPrice: 0,
        totalBuyCost: baseline.totalBuyCost,
        totalSellRevenue: 0,
        currentBalance: baseline.totalBought, // Will be adjusted by sells
        realizedPnl: 0, // Only track PnL during display period
        unrealizedPnl: 0,
        trades: 0,
        lastTradeAt: null,
      });
    }

    for (const trade of trades) {
      const tradeDate = trade.confirmedAt || trade.createdAt;
      const dateKey = tradeDate.toISOString().split("T")[0];

      // Initialize daily entry
      if (!dailyPnLMap.has(dateKey)) {
        dailyPnLMap.set(dateKey, {
          date: dateKey,
          pnl: 0,
          trades: 0,
          volume: 0,
        });
      }
      const daily = dailyPnLMap.get(dateKey)!;
      daily.trades++;

      const isBuy = trade.inputMint === SOL_MINT;
      const tokenMint = isBuy ? trade.outputMint : trade.inputMint;
      const tokenSymbol = isBuy ? trade.outputSymbol : trade.inputSymbol;

      // SOL in lamports (divide by 1e9), tokens are stored as UI values
      const solAmount = isBuy
        ? Number(trade.amountIn) / 1e9
        : Number(trade.amountOut) / 1e9;
      const tokenAmount = isBuy
        ? Number(trade.amountOut)
        : Number(trade.amountIn);

      daily.volume += solAmount;

      // Initialize position
      if (!positions.has(tokenMint)) {
        positions.set(tokenMint, {
          mint: tokenMint,
          symbol: tokenSymbol,
          name: "",
          image: null,
          totalBought: 0,
          totalSold: 0,
          avgBuyPrice: 0,
          avgSellPrice: 0,
          totalBuyCost: 0,
          totalSellRevenue: 0,
          currentBalance: 0,
          realizedPnl: 0,
          unrealizedPnl: 0,
          trades: 0,
          lastTradeAt: null,
        });
      }
      const pos = positions.get(tokenMint)!;
      pos.trades++;
      pos.lastTradeAt = tradeDate;

      if (isBuy) {
        // Buying tokens with SOL
        pos.totalBought += tokenAmount;
        pos.totalBuyCost += solAmount;
        pos.currentBalance += tokenAmount;
        pos.avgBuyPrice = pos.totalBuyCost / pos.totalBought;
      } else {
        // Selling tokens for SOL
        pos.totalSold += tokenAmount;
        pos.totalSellRevenue += solAmount;
        pos.currentBalance -= tokenAmount;
        if (pos.totalSold > 0) {
          pos.avgSellPrice = pos.totalSellRevenue / pos.totalSold;
        }

        // Calculate realized PnL for this sell
        // PnL = (sell price - avg buy price) * tokens sold
        const costBasis = pos.avgBuyPrice * tokenAmount;
        const sellRevenue = solAmount;
        const tradePnl = sellRevenue - costBasis;
        pos.realizedPnl += tradePnl;
        daily.pnl += tradePnl;
      }
    }

    // Convert to arrays and sort
    const dailyPnL = Array.from(dailyPnLMap.values()).sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Use allPositions for the positions list - this includes ALL trades, not just display period
    // This ensures positions show up even if all trades were outside the current display window
    const positionsArray = Array.from(allPositions.values())
      .filter(p => p.trades > 0)
      .sort((a, b) => (b.lastTradeAt?.getTime() || 0) - (a.lastTradeAt?.getTime() || 0));

    // Fetch token metadata from database
    const tokenMints = positionsArray.map(p => p.mint);
    const tokenMetadata = await prisma.token.findMany({
      where: { address: { in: tokenMints } },
      select: { address: true, name: true, symbol: true, logoUri: true },
    });
    const tokenMap = new Map(tokenMetadata.map(t => [t.address, t]));

    // Find tokens missing from database
    const missingMints = tokenMints.filter(mint => !tokenMap.has(mint));

    // Fetch missing token metadata from Moralis
    if (missingMints.length > 0 && config.moralisApiKey) {
      const moralisPromises = missingMints.map(async (mint) => {
        try {
          const res = await fetch(
            `${MORALIS_API_URL}/token/mainnet/${mint}/metadata`,
            {
              headers: {
                accept: "application/json",
                "X-API-Key": config.moralisApiKey,
              },
              signal: AbortSignal.timeout(5000),
            }
          );

          if (res.ok) {
            const data = await res.json();

            if (data) {
              const tokenInfo = {
                address: mint,
                name: data.name || data.symbol || mint.slice(0, 8),
                symbol: data.symbol || mint.slice(0, 6),
                logoUri: data.logo || null,
              };

              tokenMap.set(mint, tokenInfo);

              // Cache in database (fire and forget)
              prisma.token.upsert({
                where: { address: mint },
                create: {
                  address: mint,
                  name: tokenInfo.name,
                  symbol: tokenInfo.symbol,
                  decimals: parseInt(data.decimals || "6"),
                  logoUri: tokenInfo.logoUri,
                },
                update: {
                  name: tokenInfo.name,
                  symbol: tokenInfo.symbol,
                  logoUri: tokenInfo.logoUri,
                },
              }).catch(() => {});
            }
          }
        } catch {
          // Silently fail - token just won't have metadata
        }
      });

      await Promise.allSettled(moralisPromises);
    }

    // Enrich positions with token metadata
    for (const pos of positionsArray) {
      const token = tokenMap.get(pos.mint);
      if (token) {
        pos.name = token.name;
        pos.symbol = token.symbol || pos.symbol;
        pos.image = token.logoUri;
      }
    }

    // Calculate totals for the DISPLAY PERIOD (not all time)
    // Period PnL = sum of daily PnL in the display period
    const periodRealizedPnl = dailyPnL.reduce((sum, d) => sum + d.pnl, 0);
    const periodVolume = dailyPnL.reduce((sum, d) => sum + d.volume, 0);
    const periodTrades = dailyPnL.reduce((sum, d) => sum + d.trades, 0);

    // All-time totals (for reference)
    const allTimeRealizedPnl = positionsArray.reduce((sum, p) => sum + p.realizedPnl, 0);
    const allTimeVolume = allTrades.reduce((sum, t) => {
      const isBuy = t.inputMint === SOL_MINT;
      const solAmount = isBuy ? Number(t.amountIn) / 1e9 : Number(t.amountOut) / 1e9;
      return sum + solAmount;
    }, 0);
    const allTimeTrades = allTrades.length;

    // Use period-specific values in summary (what the user is viewing)
    const totalRealizedPnl = period === "all" ? allTimeRealizedPnl : periodRealizedPnl;
    const totalVolume = period === "all" ? allTimeVolume : periodVolume;
    const totalTrades = period === "all" ? allTimeTrades : periodTrades;

    // Calculate streak
    let currentStreak = 0;
    let bestStreak = 0;
    let tempStreak = 0;

    for (const day of dailyPnL) {
      if (day.pnl > 0) {
        tempStreak++;
        if (tempStreak > bestStreak) {
          bestStreak = tempStreak;
        }
      } else {
        tempStreak = 0;
      }
    }

    // Check current streak (from today backwards)
    const sortedDesc = [...dailyPnL].reverse();
    for (const day of sortedDesc) {
      if (day.pnl > 0) {
        currentStreak++;
      } else {
        break;
      }
    }

    // Generate calendar data if requested
    let calendarData: Record<string, DailyPnL> = {};
    if (period === "calendar") {
      const daysInMonth = new Date(year, month, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        calendarData[dateStr] = dailyPnLMap.get(dateStr) || {
          date: dateStr,
          pnl: 0,
          trades: 0,
          volume: 0,
        };
      }
    }

    return NextResponse.json({
      period,
      startDate: displayStartDate.toISOString(),
      endDate: displayEndDate.toISOString(),

      // Cumulative PnL from trades BEFORE the display period
      // Use this as the starting point for cumulative charts
      cumulativePnLBaseline,

      // Summary
      summary: {
        totalRealizedPnl,
        totalVolume,
        totalTrades,
        currentStreak,
        bestStreak,
        winRate: dailyPnL.filter(d => d.pnl > 0).length / Math.max(dailyPnL.length, 1),
      },

      // Daily PnL for charts
      dailyPnL,

      // Calendar data (only for calendar period)
      calendarData: period === "calendar" ? calendarData : undefined,

      // Positions
      positions: positionsArray.map(p => ({
        ...p,
        lastTradeAt: p.lastTradeAt?.toISOString() || null,
        isOpen: p.currentBalance > 0.000001, // Account for dust
      })),

      // Active positions (have balance)
      activePositions: positionsArray.filter(p => p.currentBalance > 0.000001),

      // Closed positions (sold all)
      closedPositions: positionsArray.filter(p => p.currentBalance <= 0.000001 && p.totalSold > 0),
    });
  } catch (error) {
    console.error("PnL error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to calculate PnL" },
      { status: 500 }
    );
  }
}
