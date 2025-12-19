import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Polymarket Gamma API
const GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";

interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  description?: string;
  outcomes: string;
  outcomePrices: string;
  volume: string;
  volumeNum?: number;
  liquidity: string;
  liquidityNum?: number;
  active: boolean;
  closed: boolean;
  endDate: string;
  startDate?: string;
  image?: string;
  icon?: string;
  clobTokenIds?: string;
  groupItemTitle?: string;
  enableOrderBook?: boolean;
}

interface GammaEvent {
  id: string;
  ticker: string;
  slug: string;
  title: string;
  description?: string;
  startDate?: string;
  endDate: string;
  image?: string;
  icon?: string;
  active: boolean;
  closed: boolean;
  volume: number;
  liquidity: number;
  markets: GammaMarket[];
  tags?: Array<{ id: string; label: string; slug: string }>;
}

function detectCategory(tags: string[], question?: string): string {
  const tagStr = tags.map((t) => t.toLowerCase()).join(" ");
  const questionStr = (question || "").toLowerCase();
  const searchStr = tagStr + " " + questionStr;

  const sportsKeywords = ["sports", "nfl", "nba", "mlb", "nhl", "soccer", "football", "basketball", "baseball", "hockey", "tennis", "golf", "mma", "boxing", "f1", "racing", "ufc", "cricket", "rugby", "olympics", "ncaa", "college", "league", "championship", "super bowl", "world cup", "premier league", "playoffs", "mvp"];
  if (sportsKeywords.some(k => searchStr.includes(k))) return "Sports";

  const politicsKeywords = ["politics", "election", "government", "congress", "senate", "president", "vote", "republican", "democrat", "trump", "biden", "political", "governor", "mayor", "legislation", "bill", "law", "supreme court", "cabinet", "administration", "white house", "poll", "nominee"];
  if (politicsKeywords.some(k => searchStr.includes(k))) return "Politics";

  const cryptoKeywords = ["crypto", "bitcoin", "ethereum", "btc", "eth", "defi", "blockchain", "web3", "solana", "sol", "token", "nft", "altcoin", "memecoin", "doge", "xrp", "cardano", "polygon", "binance", "coinbase"];
  if (cryptoKeywords.some(k => searchStr.includes(k))) return "Crypto";

  const businessKeywords = ["business", "economics", "stocks", "finance", "fed", "market", "company", "tech", "stock", "ipo", "earnings", "revenue", "profit", "ceo", "merger", "tesla", "apple", "google", "amazon", "microsoft", "nvidia", "meta", "interest rate", "inflation", "gdp", "recession"];
  if (businessKeywords.some(k => searchStr.includes(k))) return "Business";

  const cultureKeywords = ["culture", "entertainment", "celebrity", "movies", "music", "tv", "streaming", "netflix", "disney", "movie", "film", "actor", "actress", "singer", "album", "grammy", "oscar", "emmy", "award"];
  if (cultureKeywords.some(k => searchStr.includes(k))) return "Culture";

  const scienceKeywords = ["science", "space", "ai", "technology", "climate", "nasa", "spacex", "rocket", "satellite", "mars", "moon", "artificial intelligence", "machine learning", "research", "discovery", "physics", "openai", "anthropic", "gpt"];
  if (scienceKeywords.some(k => searchStr.includes(k))) return "Science";

  return "Other";
}

// Sync all markets from Polymarket to database
export async function POST(request: Request) {
  // Optional: Add auth check for cron/admin only
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // Allow if no secret configured (dev) or if secret matches
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[Polymarket Sync] Starting sync...");
    const startTime = Date.now();

    // Fetch events from Gamma API
    const allEvents: GammaEvent[] = [];
    const BATCH_SIZE = 100;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const url = `${GAMMA_API}/events?limit=${BATCH_SIZE}&offset=${offset}&closed=false&order=volume&ascending=false`;
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Gamma API error: ${response.status}`);
      }

      const batch: GammaEvent[] = await response.json();
      if (batch.length === 0) {
        hasMore = false;
      } else {
        allEvents.push(...batch);
        offset += BATCH_SIZE;
        if (offset >= 500 || batch.length < BATCH_SIZE) {
          hasMore = false;
        }
      }
    }

    console.log(`[Polymarket Sync] Fetched ${allEvents.length} events`);

    let eventsUpserted = 0;
    let marketsUpserted = 0;

    // Process each event
    for (const event of allEvents) {
      if (!event.active || event.closed) continue;

      const activeMarkets = event.markets.filter(
        (m) => m.active && !m.closed && m.enableOrderBook !== false
      );

      if (activeMarkets.length === 0) continue;

      const category = detectCategory(
        event.tags?.map((t) => t.label) || [],
        event.title
      );

      // Upsert event
      await prisma.polymarketEvent.upsert({
        where: { id: event.id },
        update: {
          title: event.title,
          description: event.description,
          category,
          image: event.image,
          icon: event.icon,
          volume: event.volume || 0,
          liquidity: event.liquidity || 0,
          startDate: event.startDate ? new Date(event.startDate) : null,
          endDate: new Date(event.endDate),
          active: event.active,
          closed: event.closed,
        },
        create: {
          id: event.id,
          slug: event.slug,
          title: event.title,
          description: event.description,
          category,
          image: event.image,
          icon: event.icon,
          volume: event.volume || 0,
          liquidity: event.liquidity || 0,
          startDate: event.startDate ? new Date(event.startDate) : null,
          endDate: new Date(event.endDate),
          active: event.active,
          closed: event.closed,
        },
      });
      eventsUpserted++;

      // Process markets for this event
      for (const market of activeMarkets) {
        let probability = 0.5;
        let tokenId: string | null = null;
        let outcome = market.groupItemTitle || "Yes";

        try {
          const prices = JSON.parse(market.outcomePrices);
          probability = parseFloat(prices[0]) || 0.5;
        } catch {}

        try {
          if (market.clobTokenIds) {
            const tokenIds = JSON.parse(market.clobTokenIds);
            tokenId = tokenIds[0] || null;
          }
        } catch {}

        const volume = market.volumeNum || parseFloat(market.volume) || 0;

        await prisma.polymarketMarket.upsert({
          where: { id: market.id },
          update: {
            question: market.question,
            outcome,
            probability,
            tokenId,
            volume,
          },
          create: {
            id: market.id,
            eventId: event.id,
            question: market.question,
            outcome,
            probability,
            tokenId,
            volume,
          },
        });
        marketsUpserted++;
      }
    }

    // Mark old events as inactive
    await prisma.polymarketEvent.updateMany({
      where: {
        updatedAt: {
          lt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Not updated in 24h
        },
      },
      data: {
        active: false,
      },
    });

    const duration = Date.now() - startTime;
    console.log(`[Polymarket Sync] Complete in ${duration}ms - ${eventsUpserted} events, ${marketsUpserted} markets`);

    return NextResponse.json({
      success: true,
      eventsUpserted,
      marketsUpserted,
      duration,
    });
  } catch (error) {
    console.error("[Polymarket Sync] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}

// Sync price history for a specific market
export async function PUT(request: Request) {
  try {
    const { tokenId, marketId } = await request.json();

    if (!tokenId || !marketId) {
      return NextResponse.json({ error: "Missing tokenId or marketId" }, { status: 400 });
    }

    // Fetch price history from CLOB API
    const response = await fetch(
      `${CLOB_API}/prices-history?market=${tokenId}&interval=max&fidelity=100`,
      {
        headers: { Accept: "application/json" },
      }
    );

    if (!response.ok) {
      return NextResponse.json({ error: "Failed to fetch price history" }, { status: 500 });
    }

    const data = await response.json();
    const history = data.history || [];

    if (history.length === 0) {
      return NextResponse.json({ success: true, count: 0 });
    }

    // Batch upsert price history
    const priceData = history.map((point: { t: number; p: number }) => ({
      marketId,
      timestamp: new Date(point.t < 10000000000 ? point.t * 1000 : point.t),
      probability: point.p,
    }));

    // Delete old and insert new (simpler than upserting hundreds of records)
    await prisma.polymarketPriceHistory.deleteMany({
      where: { marketId },
    });

    await prisma.polymarketPriceHistory.createMany({
      data: priceData,
    });

    return NextResponse.json({
      success: true,
      count: priceData.length,
    });
  } catch (error) {
    console.error("[Polymarket Price Sync] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Price sync failed" },
      { status: 500 }
    );
  }
}
