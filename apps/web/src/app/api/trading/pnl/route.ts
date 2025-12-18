import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TradeStatus } from "@prisma/client";

const SOL_MINT = "So11111111111111111111111111111111111111112";

interface DailyPnL {
  date: string; // YYYY-MM-DD
  pnl: number;
  trades: number;
  volume: number;
}

interface Position {
  mint: string;
  symbol: string;
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
    const period = searchParams.get("period") || "30d"; // 1d, 7d, 30d, all
    const year = parseInt(searchParams.get("year") || new Date().getFullYear().toString());
    const month = parseInt(searchParams.get("month") || (new Date().getMonth() + 1).toString());

    // Calculate date range
    let startDate: Date;
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    switch (period) {
      case "1d":
        startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        break;
      case "7d":
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "30d":
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "calendar":
        // Full month for calendar view
        startDate = new Date(year, month - 1, 1);
        endDate.setFullYear(year, month - 1);
        endDate.setDate(new Date(year, month, 0).getDate());
        break;
      default:
        startDate = new Date(0); // All time
    }

    // Fetch all confirmed trades for the user in the period
    const trades = await prisma.trade.findMany({
      where: {
        userId: session.user.id,
        status: TradeStatus.CONFIRMED,
        confirmedAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { confirmedAt: "asc" },
    });

    // Calculate daily PnL
    const dailyPnLMap = new Map<string, DailyPnL>();
    const positions = new Map<string, Position>();

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

      // Parse amounts (assuming 9 decimals for SOL, varies for tokens)
      const solAmount = isBuy
        ? Number(trade.amountIn) / 1e9
        : Number(trade.amountOut) / 1e9;
      const tokenAmount = isBuy
        ? Number(trade.amountOut) / 1e6 // Most tokens are 6 decimals
        : Number(trade.amountIn) / 1e6;

      daily.volume += solAmount;

      // Initialize position
      if (!positions.has(tokenMint)) {
        positions.set(tokenMint, {
          mint: tokenMint,
          symbol: tokenSymbol,
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

    const positionsArray = Array.from(positions.values())
      .filter(p => p.trades > 0)
      .sort((a, b) => (b.lastTradeAt?.getTime() || 0) - (a.lastTradeAt?.getTime() || 0));

    // Calculate totals
    const totalRealizedPnl = positionsArray.reduce((sum, p) => sum + p.realizedPnl, 0);
    const totalVolume = dailyPnL.reduce((sum, d) => sum + d.volume, 0);
    const totalTrades = trades.length;

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
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),

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
