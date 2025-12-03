import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { cache } from "../lib/cache";

export const trendingRoutes = Router();

const querySchema = z.object({
  period: z.enum(["1h", "6h", "24h"]).default("24h"),
  limit: z.coerce.number().min(1).max(50).default(10),
});

// GET /api/trending - Get trending tokens
trendingRoutes.get("/", async (req, res) => {
  try {
    const query = querySchema.parse(req.query);
    const { period, limit } = query;

    // Try cache first
    const cacheKey = `trending:${period}:${limit}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Get tokens with highest volume in the period
    // For now, we just sort by volume24h since we don't have hourly data yet
    const tokens = await prisma.token.findMany({
      where: {
        volume24h: { not: null },
      },
      orderBy: {
        volume24h: "desc",
      },
      take: limit,
    });

    const response = {
      period,
      data: tokens,
    };

    // Cache for 60 seconds
    await cache.set(cacheKey, JSON.stringify(response), 60);

    res.json(response);
  } catch (error) {
    console.error("Error fetching trending:", error);
    res.status(500).json({ error: "Failed to fetch trending tokens" });
  }
});

// GET /api/trending/gainers - Top gainers
trendingRoutes.get("/gainers", async (req, res) => {
  try {
    const limit = z.coerce.number().min(1).max(50).default(10).parse(req.query.limit);

    const cacheKey = `trending:gainers:${limit}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const tokens = await prisma.token.findMany({
      where: {
        priceChange24h: { not: null },
      },
      orderBy: {
        priceChange24h: "desc",
      },
      take: limit,
    });

    await cache.set(cacheKey, JSON.stringify(tokens), 60);
    res.json(tokens);
  } catch (error) {
    console.error("Error fetching gainers:", error);
    res.status(500).json({ error: "Failed to fetch gainers" });
  }
});

// GET /api/trending/losers - Top losers
trendingRoutes.get("/losers", async (req, res) => {
  try {
    const limit = z.coerce.number().min(1).max(50).default(10).parse(req.query.limit);

    const cacheKey = `trending:losers:${limit}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const tokens = await prisma.token.findMany({
      where: {
        priceChange24h: { not: null },
      },
      orderBy: {
        priceChange24h: "asc",
      },
      take: limit,
    });

    await cache.set(cacheKey, JSON.stringify(tokens), 60);
    res.json(tokens);
  } catch (error) {
    console.error("Error fetching losers:", error);
    res.status(500).json({ error: "Failed to fetch losers" });
  }
});
