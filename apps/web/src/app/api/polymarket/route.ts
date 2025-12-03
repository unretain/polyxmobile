import { NextResponse } from "next/server";

// Polymarket Gamma API endpoint
const GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";

interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  description?: string;
  outcomes: string; // JSON string array
  outcomePrices: string; // JSON string array
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
  conditionId?: string;
  enableOrderBook?: boolean;
  clobTokenIds?: string; // JSON string array
  events?: Array<{
    id: string;
    slug: string;
    title: string;
    tags?: Array<{ id: string; label: string; slug: string }>;
  }>;
}

export interface PriceHistory {
  t: number; // Unix timestamp
  p: number; // Price
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "markets";
  const tokenId = searchParams.get("tokenId");
  const interval = searchParams.get("interval") || "max";
  const category = searchParams.get("category");

  try {
    // Fetch ALL binary (Yes/No) markets sorted by volume
    if (action === "markets") {
      const allMarkets: GammaMarket[] = [];
      const BATCH_SIZE = 100;
      let offset = 0;
      let hasMore = true;

      // Paginate through all markets (don't filter by tag_id - it's unreliable)
      while (hasMore) {
        const url = `${GAMMA_API}/markets?limit=${BATCH_SIZE}&offset=${offset}&closed=false&order=volume&ascending=false`;

        const response = await fetch(url, {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Gamma API error: ${response.status}`);
        }

        const batch: GammaMarket[] = await response.json();

        if (batch.length === 0) {
          hasMore = false;
        } else {
          allMarkets.push(...batch);
          offset += BATCH_SIZE;

          // Safety limit - max 2000 markets
          if (offset >= 2000 || batch.length < BATCH_SIZE) {
            hasMore = false;
          }
        }
      }

      // Dedupe markets by ID (API can return duplicates across batches)
      const seenIds = new Set<string>();
      const uniqueMarkets = allMarkets.filter((market) => {
        if (seenIds.has(market.id)) return false;
        seenIds.add(market.id);
        return true;
      });

      // Transform and filter markets - ONLY Yes/No binary markets
      const transformedMarkets = uniqueMarkets
        .filter((market) => {
          // Must be active with order book
          if (!market.active || market.closed || !market.enableOrderBook) {
            return false;
          }

          // Parse outcomes - only keep binary Yes/No markets
          try {
            const outcomes = JSON.parse(market.outcomes);
            // Only include markets with exactly 2 outcomes
            if (outcomes.length !== 2) {
              return false;
            }
            // Check if it's a Yes/No market (not multi-option like team selections)
            const outcomeLabels = outcomes.map((o: string) => o.toLowerCase());
            const isYesNo = outcomeLabels.includes("yes") && outcomeLabels.includes("no");
            return isYesNo;
          } catch {
            return false;
          }
        })
        .map((market) => {
          // Parse outcome prices
          let yesProbability = 0.5;
          try {
            const prices = JSON.parse(market.outcomePrices);
            const outcomes = JSON.parse(market.outcomes);
            // Find the Yes outcome index
            const yesIndex = outcomes.findIndex((o: string) => o.toLowerCase() === "yes");
            yesProbability = yesIndex >= 0 ? parseFloat(prices[yesIndex]) || 0.5 : parseFloat(prices[0]) || 0.5;
          } catch {
            // Keep default
          }

          // Parse tokenIds
          let tokenIds: string[] = [];
          try {
            if (market.clobTokenIds) {
              tokenIds = JSON.parse(market.clobTokenIds);
            }
          } catch {
            // Keep empty
          }

          // Determine category from event tags
          let detectedCategory = "Other";
          const event = market.events?.[0];
          if (event?.tags?.length) {
            const tagLabels = event.tags.map((t) => t.label.toLowerCase());
            if (tagLabels.some((t) => ["sports", "nfl", "nba", "mlb", "soccer", "football", "basketball", "baseball", "hockey", "tennis", "golf", "mma", "boxing", "f1", "racing"].includes(t))) {
              detectedCategory = "Sports";
            } else if (tagLabels.some((t) => ["politics", "election", "government", "congress", "senate", "president", "vote", "republican", "democrat"].includes(t))) {
              detectedCategory = "Politics";
            } else if (tagLabels.some((t) => ["crypto", "bitcoin", "ethereum", "btc", "eth", "defi", "blockchain", "web3"].includes(t))) {
              detectedCategory = "Crypto";
            } else if (tagLabels.some((t) => ["business", "economics", "stocks", "finance", "fed", "market", "company", "tech"].includes(t))) {
              detectedCategory = "Business";
            } else if (tagLabels.some((t) => ["culture", "entertainment", "celebrity", "movies", "music", "tv", "streaming"].includes(t))) {
              detectedCategory = "Culture";
            } else if (tagLabels.some((t) => ["science", "space", "ai", "technology", "climate"].includes(t))) {
              detectedCategory = "Science";
            }
          }

          const volume = market.volumeNum || parseFloat(market.volume) || 0;
          const liquidity = market.liquidityNum || parseFloat(market.liquidity) || 0;

          return {
            id: market.id,
            question: market.question,
            slug: event?.slug || market.slug,
            description: market.description,
            outcomes: ["Yes", "No"],
            yesProbability,
            noProbability: 1 - yesProbability,
            volume,
            liquidity,
            endDate: market.endDate,
            startDate: market.startDate,
            category: detectedCategory,
            image: market.image,
            icon: market.icon,
            tokenIds,
            conditionId: market.conditionId,
            tags: event?.tags?.map((t) => t.label) || [],
          };
        });

      // Already sorted by volume from API, but ensure it
      transformedMarkets.sort((a, b) => b.volume - a.volume);

      // Filter by category if specified (do this AFTER sorting)
      const categoryMap: Record<string, string> = {
        sports: "Sports",
        politics: "Politics",
        crypto: "Crypto",
        business: "Business",
        "pop-culture": "Culture",
        science: "Science",
      };

      if (category && category !== "all" && categoryMap[category]) {
        const targetCategory = categoryMap[category];
        const filtered = transformedMarkets.filter((m) => m.category === targetCategory);
        return NextResponse.json(filtered);
      }

      return NextResponse.json(transformedMarkets);
    }

    // Fetch tags/categories
    if (action === "categories") {
      return NextResponse.json([
        { id: "all", label: "All", slug: "all" },
        { id: "sports", label: "Sports", slug: "sports" },
        { id: "politics", label: "Politics", slug: "politics" },
        { id: "crypto", label: "Crypto", slug: "crypto" },
        { id: "business", label: "Business", slug: "business" },
        { id: "pop-culture", label: "Culture", slug: "pop-culture" },
        { id: "science", label: "Science", slug: "science" },
      ]);
    }

    // Fetch price history for a specific token
    if (action === "price-history" && tokenId) {
      const response = await fetch(
        `${CLOB_API}/prices-history?market=${tokenId}&interval=${interval}&fidelity=100`,
        {
          headers: { Accept: "application/json" },
          next: { revalidate: 300 },
        }
      );

      if (!response.ok) {
        const mockHistory = generateMockPriceHistory(interval);
        return NextResponse.json({ history: mockHistory });
      }

      const data = await response.json();
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Polymarket API error:", error);

    if (action === "markets") {
      return NextResponse.json(getMockMarkets());
    }

    if (action === "price-history") {
      const mockHistory = generateMockPriceHistory(interval);
      return NextResponse.json({ history: mockHistory });
    }

    return NextResponse.json(
      { error: "Failed to fetch data" },
      { status: 500 }
    );
  }
}

function generateMockPriceHistory(interval: string): PriceHistory[] {
  const now = Date.now();
  const history: PriceHistory[] = [];

  let points = 100;
  let timeStep = 3600000;

  switch (interval) {
    case "1h":
      points = 60;
      timeStep = 60000;
      break;
    case "6h":
      points = 72;
      timeStep = 300000;
      break;
    case "1d":
      points = 96;
      timeStep = 900000;
      break;
    case "1w":
      points = 168;
      timeStep = 3600000;
      break;
    case "1m":
      points = 30;
      timeStep = 86400000;
      break;
    case "max":
      points = 200;
      timeStep = 86400000;
      break;
  }

  let price = 0.3 + Math.random() * 0.4;

  for (let i = points; i >= 0; i--) {
    const timestamp = Math.floor((now - i * timeStep) / 1000);
    history.push({ t: timestamp, p: price });

    const drift = (0.5 - price) * 0.02;
    const noise = (Math.random() - 0.5) * 0.05;
    price = Math.max(0.01, Math.min(0.99, price + drift + noise));
  }

  return history;
}

function getMockMarkets() {
  return [
    {
      id: "mock-1",
      question: "Will Bitcoin reach $100,000 by end of 2024?",
      slug: "bitcoin-100k-2024",
      outcomes: ["Yes", "No"],
      yesProbability: 0.42,
      noProbability: 0.58,
      volume: 2500000,
      liquidity: 450000,
      endDate: "2024-12-31T23:59:59Z",
      category: "Crypto",
      tokenIds: ["mock-btc-yes", "mock-btc-no"],
      tags: ["Crypto", "Bitcoin"],
    },
    {
      id: "mock-2",
      question: "Will the Fed cut rates in December 2024?",
      slug: "fed-rate-cut-dec-2024",
      outcomes: ["Yes", "No"],
      yesProbability: 0.78,
      noProbability: 0.22,
      volume: 1800000,
      liquidity: 320000,
      endDate: "2024-12-18T23:59:59Z",
      category: "Business",
      tokenIds: ["mock-fed-yes", "mock-fed-no"],
      tags: ["Fed", "Economics"],
    },
    {
      id: "mock-3",
      question: "Will Ethereum ETF be approved by January 2025?",
      slug: "eth-etf-jan-2025",
      outcomes: ["Yes", "No"],
      yesProbability: 0.65,
      noProbability: 0.35,
      volume: 980000,
      liquidity: 210000,
      endDate: "2025-01-31T23:59:59Z",
      category: "Crypto",
      tokenIds: ["mock-eth-yes", "mock-eth-no"],
      tags: ["Crypto", "Ethereum", "ETF"],
    },
    {
      id: "mock-4",
      question: "Chiefs to win Super Bowl?",
      slug: "chiefs-super-bowl",
      outcomes: ["Yes", "No"],
      yesProbability: 0.35,
      noProbability: 0.65,
      volume: 750000,
      liquidity: 180000,
      endDate: "2025-02-09T23:59:59Z",
      category: "Sports",
      tokenIds: ["mock-chiefs-yes", "mock-chiefs-no"],
      tags: ["Sports", "NFL", "Super Bowl"],
    },
    {
      id: "mock-5",
      question: "Will SpaceX Starship complete orbital flight?",
      slug: "spacex-starship-orbital",
      outcomes: ["Yes", "No"],
      yesProbability: 0.85,
      noProbability: 0.15,
      volume: 620000,
      liquidity: 145000,
      endDate: "2024-12-31T23:59:59Z",
      category: "Science",
      tokenIds: ["mock-spacex-yes", "mock-spacex-no"],
      tags: ["Science", "Space", "SpaceX"],
    },
    {
      id: "mock-6",
      question: "Will Tesla stock reach $400 by Q1 2025?",
      slug: "tesla-400-q1-2025",
      outcomes: ["Yes", "No"],
      yesProbability: 0.31,
      noProbability: 0.69,
      volume: 890000,
      liquidity: 195000,
      endDate: "2025-03-31T23:59:59Z",
      category: "Business",
      tokenIds: ["mock-tsla-yes", "mock-tsla-no"],
      tags: ["Business", "Stocks", "Tesla"],
    },
  ];
}
