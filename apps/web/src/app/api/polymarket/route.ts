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
  groupItemTitle?: string; // For multi-option markets, this is the outcome name
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
  enableOrderBook?: boolean;
  negRisk?: boolean;
  markets: GammaMarket[];
  tags?: Array<{ id: string; label: string; slug: string }>;
}

export interface PriceHistory {
  t: number; // Unix timestamp
  p: number; // Price
}

function detectCategory(tags: string[], question?: string): string {
  // Combine tags and question for keyword matching
  const tagStr = tags.map((t) => t.toLowerCase()).join(" ");
  const questionStr = (question || "").toLowerCase();
  const searchStr = tagStr + " " + questionStr;

  // Sports - check for any sports-related keywords
  const sportsKeywords = ["sports", "nfl", "nba", "mlb", "nhl", "soccer", "football", "basketball", "baseball", "hockey", "tennis", "golf", "mma", "boxing", "f1", "racing", "ufc", "cricket", "rugby", "olympics", "ncaa", "college", "league", "championship", "super bowl", "world cup", "premier league", "playoffs", "mvp", "quarterback", "touchdown", "goal", "match", "game", "team", "coach", "player"];
  if (sportsKeywords.some(k => searchStr.includes(k))) {
    return "Sports";
  }

  // Politics - check for political keywords
  const politicsKeywords = ["politics", "election", "government", "congress", "senate", "president", "vote", "republican", "democrat", "trump", "biden", "political", "governor", "mayor", "legislation", "bill", "law", "supreme court", "cabinet", "administration", "white house", "poll", "nominee", "impeach", "constitutional", "primary", "electoral", "ballot"];
  if (politicsKeywords.some(k => searchStr.includes(k))) {
    return "Politics";
  }

  // Crypto - check for crypto keywords
  const cryptoKeywords = ["crypto", "bitcoin", "ethereum", "btc", "eth", "defi", "blockchain", "web3", "solana", "sol", "token", "nft", "altcoin", "memecoin", "doge", "xrp", "cardano", "polygon", "binance", "coinbase", "usdt", "usdc", "stablecoin", "halving", "mining", "wallet", "exchange"];
  if (cryptoKeywords.some(k => searchStr.includes(k))) {
    return "Crypto";
  }

  // Business - check for business keywords
  const businessKeywords = ["business", "economics", "stocks", "finance", "fed", "market", "company", "tech", "stock", "ipo", "earnings", "revenue", "profit", "ceo", "merger", "acquisition", "tesla", "apple", "google", "amazon", "microsoft", "nvidia", "meta", "interest rate", "inflation", "gdp", "recession", "s&p", "dow", "nasdaq", "tariff", "trade", "economic"];
  if (businessKeywords.some(k => searchStr.includes(k))) {
    return "Business";
  }

  // Culture - check for culture/entertainment keywords
  const cultureKeywords = ["culture", "entertainment", "celebrity", "movies", "music", "tv", "streaming", "netflix", "disney", "movie", "film", "actor", "actress", "singer", "album", "grammy", "oscar", "emmy", "award", "pop", "hip hop", "tiktok", "youtube", "influencer", "viral", "show", "series", "concert", "tour", "kardashian", "kanye", "taylor swift"];
  if (cultureKeywords.some(k => searchStr.includes(k))) {
    return "Culture";
  }

  // Science - check for science keywords
  const scienceKeywords = ["science", "space", "ai", "technology", "climate", "nasa", "spacex", "rocket", "satellite", "mars", "moon", "artificial intelligence", "machine learning", "research", "discovery", "physics", "chemistry", "biology", "medical", "vaccine", "health", "fda", "drug", "weather", "hurricane", "earthquake", "pandemic", "virus", "agi", "openai", "anthropic", "gpt"];
  if (scienceKeywords.some(k => searchStr.includes(k))) {
    return "Science";
  }

  return "Other";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "markets";
  const tokenId = searchParams.get("tokenId");
  const interval = searchParams.get("interval") || "max";
  const category = searchParams.get("category");

  try {
    // Fetch ALL events (including multi-outcome) sorted by volume
    // Using /events endpoint which returns complete market data for each event
    if (action === "markets") {
      const allEvents: GammaEvent[] = [];
      const BATCH_SIZE = 100;
      let offset = 0;
      let hasMore = true;

      // Paginate through all events
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

          // Safety limit - max 1000 events (each can have many markets)
          if (offset >= 1000 || batch.length < BATCH_SIZE) {
            hasMore = false;
          }
        }
      }

      const transformedMarkets: any[] = [];

      // Process each event
      for (const event of allEvents) {
        if (!event.active || event.closed) {
          continue;
        }

        // Filter to only active, open markets with order book
        const activeMarkets = event.markets.filter(
          (m) => m.active && !m.closed && m.enableOrderBook
        );

        if (activeMarkets.length === 0) {
          continue;
        }

        // Determine if this is a multi-outcome event
        // Multi-outcome events have markets with groupItemTitle set
        const hasGroupItems = activeMarkets.some((m) => m.groupItemTitle);
        const isMultiOutcome = hasGroupItems || activeMarkets.length > 1;

        // Determine category
        const detectedCategory = detectCategory(
          event.tags?.map((t) => t.label) || [],
          event.title
        );

        if (isMultiOutcome && hasGroupItems) {
          // Multi-outcome event - each market is an outcome
          const outcomes: { name: string; probability: number; tokenId: string; volume: number }[] = [];

          for (const market of activeMarkets) {
            let probability = 0.5;
            let tokenId = "";

            try {
              const prices = JSON.parse(market.outcomePrices);
              // First price is the Yes probability for this outcome
              probability = parseFloat(prices[0]) || 0.5;
            } catch {}

            try {
              if (market.clobTokenIds) {
                const tokenIds = JSON.parse(market.clobTokenIds);
                tokenId = tokenIds[0] || "";
              }
            } catch {}

            outcomes.push({
              name: market.groupItemTitle || market.question,
              probability,
              tokenId,
              volume: market.volumeNum || parseFloat(market.volume) || 0,
            });
          }

          // Sort outcomes by probability descending
          outcomes.sort((a, b) => b.probability - a.probability);

          transformedMarkets.push({
            id: event.id,
            question: event.title,
            slug: event.slug,
            description: event.description,
            outcomes: outcomes.map((o) => o.name),
            outcomeProbabilities: outcomes.map((o) => o.probability),
            outcomeTokenIds: outcomes.map((o) => o.tokenId),
            outcomeVolumes: outcomes.map((o) => o.volume),
            isMultiOutcome: true,
            volume: event.volume || 0,
            liquidity: event.liquidity || 0,
            endDate: event.endDate,
            startDate: event.startDate,
            category: detectedCategory,
            image: event.image,
            icon: event.icon,
            tags: event.tags?.map((t) => t.label) || [],
          });
        } else {
          // Binary Yes/No market (single market in event)
          const market = activeMarkets[0];

          try {
            const outcomes = JSON.parse(market.outcomes);
            const outcomeLabels = outcomes.map((o: string) => o.toLowerCase());
            const isYesNo = outcomeLabels.includes("yes") && outcomeLabels.includes("no");

            if (!isYesNo || outcomes.length !== 2) {
              continue; // Skip non-binary standalone markets
            }

            let yesProbability = 0.5;
            try {
              const prices = JSON.parse(market.outcomePrices);
              const yesIndex = outcomes.findIndex((o: string) => o.toLowerCase() === "yes");
              yesProbability = yesIndex >= 0 ? parseFloat(prices[yesIndex]) || 0.5 : parseFloat(prices[0]) || 0.5;
            } catch {}

            let tokenIds: string[] = [];
            try {
              if (market.clobTokenIds) {
                tokenIds = JSON.parse(market.clobTokenIds);
              }
            } catch {}

            const volume = market.volumeNum || parseFloat(market.volume) || 0;
            const liquidity = market.liquidityNum || parseFloat(market.liquidity) || 0;

            transformedMarkets.push({
              id: market.id,
              question: event.title || market.question,
              slug: event.slug || market.slug,
              description: event.description || market.description,
              outcomes: ["Yes", "No"],
              outcomeProbabilities: [yesProbability, 1 - yesProbability],
              outcomeTokenIds: tokenIds,
              outcomeVolumes: [volume * yesProbability, volume * (1 - yesProbability)],
              isMultiOutcome: false,
              volume: event.volume || volume,
              liquidity: event.liquidity || liquidity,
              endDate: market.endDate,
              startDate: market.startDate,
              category: detectedCategory,
              image: event.image || market.image,
              icon: event.icon || market.icon,
              tags: event.tags?.map((t) => t.label) || [],
            });
          } catch {
            continue;
          }
        }
      }

      // Sort by volume descending
      transformedMarkets.sort((a, b) => b.volume - a.volume);

      // Filter by category if specified
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
      id: "mock-btc-price",
      question: "What price will Bitcoin hit in 2025?",
      slug: "bitcoin-price-2025",
      outcomes: ["↑ 1,000,000", "↑ 250,000", "↑ 200,000", "↑ 170,000", "↑ 150,000", "↑ 140,000", "↑ 130,000", "↑ 120,000"],
      outcomeProbabilities: [0.01, 0.01, 0.01, 0.01, 0.01, 0.02, 0.03, 0.06],
      outcomeTokenIds: ["mock-1m", "mock-250k", "mock-200k", "mock-170k", "mock-150k", "mock-140k", "mock-130k", "mock-120k"],
      outcomeVolumes: [6549547, 5636675, 9693828, 3384332, 11683141, 4063502, 8713068, 1962559],
      isMultiOutcome: true,
      volume: 76528582,
      liquidity: 5000000,
      endDate: "2026-01-01T00:00:00Z",
      category: "Crypto",
      tags: ["Crypto", "Bitcoin"],
    },
    {
      id: "mock-eth-price",
      question: "What price will Ethereum hit in 2025?",
      slug: "ethereum-price-2025",
      outcomes: ["↑ 17,000", "↑ 14,000", "↑ 12,000", "↑ 10,000", "↑ 8,000"],
      outcomeProbabilities: [0.01, 0.01, 0.05, 0.15, 0.30],
      outcomeTokenIds: ["mock-eth-17k", "mock-eth-14k", "mock-eth-12k", "mock-eth-10k", "mock-eth-8k"],
      outcomeVolumes: [500000, 800000, 1500000, 3000000, 5000000],
      isMultiOutcome: true,
      volume: 15000000,
      liquidity: 2000000,
      endDate: "2026-01-01T00:00:00Z",
      category: "Crypto",
      tags: ["Crypto", "Ethereum"],
    },
    {
      id: "mock-fed",
      question: "Will the Fed cut rates in December?",
      slug: "fed-rate-cut-dec",
      outcomes: ["Yes", "No"],
      outcomeProbabilities: [0.78, 0.22],
      outcomeTokenIds: ["mock-fed-yes", "mock-fed-no"],
      outcomeVolumes: [1400000, 400000],
      isMultiOutcome: false,
      volume: 1800000,
      liquidity: 320000,
      endDate: "2024-12-18T23:59:59Z",
      category: "Business",
      tags: ["Fed", "Economics"],
    },
    {
      id: "mock-btc-dec",
      question: "Bitcoin above __ on December 3?",
      slug: "btc-dec-3",
      outcomes: ["78,000", "80,000", "82,000", "85,000"],
      outcomeProbabilities: [1.0, 1.0, 0.95, 0.70],
      outcomeTokenIds: ["mock-btc-78", "mock-btc-80", "mock-btc-82", "mock-btc-85"],
      outcomeVolumes: [200000, 300000, 400000, 500000],
      isMultiOutcome: true,
      volume: 1400000,
      liquidity: 200000,
      endDate: "2024-12-04T00:00:00Z",
      category: "Crypto",
      tags: ["Crypto", "Bitcoin"],
    },
    {
      id: "mock-lighter",
      question: "Lighter market cap (FDV) one day after launch?",
      slug: "lighter-fdv",
      outcomes: [">$1B", ">$2B", ">$5B", ">$10B"],
      outcomeProbabilities: [0.73, 0.71, 0.45, 0.20],
      outcomeTokenIds: ["mock-l-1b", "mock-l-2b", "mock-l-5b", "mock-l-10b"],
      outcomeVolumes: [5000000, 4000000, 2000000, 1000000],
      isMultiOutcome: true,
      volume: 13000000,
      liquidity: 1500000,
      endDate: "2025-01-15T00:00:00Z",
      category: "Crypto",
      tags: ["Crypto", "DeFi"],
    },
    {
      id: "mock-chiefs",
      question: "Chiefs to win Super Bowl?",
      slug: "chiefs-super-bowl",
      outcomes: ["Yes", "No"],
      outcomeProbabilities: [0.35, 0.65],
      outcomeTokenIds: ["mock-chiefs-yes", "mock-chiefs-no"],
      outcomeVolumes: [262500, 487500],
      isMultiOutcome: false,
      volume: 750000,
      liquidity: 180000,
      endDate: "2025-02-09T23:59:59Z",
      category: "Sports",
      tags: ["Sports", "NFL", "Super Bowl"],
    },
  ];
}
