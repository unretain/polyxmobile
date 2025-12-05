import { Router, Request, Response } from "express";
import { getGrpcService } from "../grpc";
import { Timeframe, TIMEFRAME_MS } from "../ohlcv";

const router = Router();
const grpcService = getGrpcService();

const VALID_TIMEFRAMES: Timeframe[] = ["1s", "5s", "15s", "1m", "5m", "15m", "1h", "4h", "1d"];

// GET /api/ohlcv/candles/:baseMint/:quoteMint
// Query params: timeframe, limit
router.get("/candles/:baseMint/:quoteMint", (req: Request, res: Response) => {
  try {
    const { baseMint, quoteMint } = req.params;
    const timeframe = (req.query.timeframe as Timeframe) || "1m";
    const limit = parseInt(req.query.limit as string) || 100;

    if (!VALID_TIMEFRAMES.includes(timeframe)) {
      return res.status(400).json({
        error: "Invalid timeframe",
        validTimeframes: VALID_TIMEFRAMES,
      });
    }

    const candles = grpcService.getCandles(baseMint, quoteMint, timeframe, limit);

    return res.json({
      baseMint,
      quoteMint,
      timeframe,
      count: candles.length,
      candles,
    });
  } catch (error) {
    console.error("Error fetching candles:", error);
    return res.status(500).json({ error: "Failed to fetch candles" });
  }
});

// GET /api/ohlcv/current/:baseMint/:quoteMint
// Query params: timeframe
router.get("/current/:baseMint/:quoteMint", (req: Request, res: Response) => {
  try {
    const { baseMint, quoteMint } = req.params;
    const timeframe = (req.query.timeframe as Timeframe) || "1m";

    if (!VALID_TIMEFRAMES.includes(timeframe)) {
      return res.status(400).json({
        error: "Invalid timeframe",
        validTimeframes: VALID_TIMEFRAMES,
      });
    }

    const candle = grpcService.getCurrentCandle(baseMint, quoteMint, timeframe);

    if (!candle) {
      return res.status(404).json({ error: "No current candle found" });
    }

    return res.json({
      baseMint,
      quoteMint,
      timeframe,
      candle,
    });
  } catch (error) {
    console.error("Error fetching current candle:", error);
    return res.status(500).json({ error: "Failed to fetch current candle" });
  }
});

// GET /api/ohlcv/price/:baseMint/:quoteMint
router.get("/price/:baseMint/:quoteMint", (req: Request, res: Response) => {
  try {
    const { baseMint, quoteMint } = req.params;
    const price = grpcService.getLastPrice(baseMint, quoteMint);

    if (price === null) {
      return res.status(404).json({ error: "No price data found" });
    }

    return res.json({
      baseMint,
      quoteMint,
      price,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("Error fetching price:", error);
    return res.status(500).json({ error: "Failed to fetch price" });
  }
});

// GET /api/ohlcv/pair/:baseMint/:quoteMint
router.get("/pair/:baseMint/:quoteMint", (req: Request, res: Response) => {
  try {
    const { baseMint, quoteMint } = req.params;
    const stats = grpcService.getPairStats(baseMint, quoteMint);

    if (!stats) {
      return res.status(404).json({ error: "Pair not found" });
    }

    return res.json({
      baseMint,
      quoteMint,
      ...stats,
    });
  } catch (error) {
    console.error("Error fetching pair stats:", error);
    return res.status(500).json({ error: "Failed to fetch pair stats" });
  }
});

// GET /api/ohlcv/pairs
router.get("/pairs", (req: Request, res: Response) => {
  try {
    const pairs = grpcService.getAllPairs();

    // Sort by volume descending
    pairs.sort((a, b) => b.totalVolume - a.totalVolume);

    return res.json({
      count: pairs.length,
      pairs,
    });
  } catch (error) {
    console.error("Error fetching pairs:", error);
    return res.status(500).json({ error: "Failed to fetch pairs" });
  }
});

// GET /api/ohlcv/stats
router.get("/stats", (req: Request, res: Response) => {
  try {
    const stats = grpcService.getStats();
    return res.json(stats);
  } catch (error) {
    console.error("Error fetching stats:", error);
    return res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// GET /api/ohlcv/timeframes
router.get("/timeframes", (req: Request, res: Response) => {
  return res.json({
    timeframes: VALID_TIMEFRAMES.map((tf) => ({
      value: tf,
      durationMs: TIMEFRAME_MS[tf],
      label: getTimeframeLabel(tf),
    })),
  });
});

function getTimeframeLabel(tf: Timeframe): string {
  const labels: Record<Timeframe, string> = {
    "1s": "1 Second",
    "5s": "5 Seconds",
    "15s": "15 Seconds",
    "1m": "1 Minute",
    "5m": "5 Minutes",
    "15m": "15 Minutes",
    "1h": "1 Hour",
    "4h": "4 Hours",
    "1d": "1 Day",
  };
  return labels[tf];
}

export const ohlcvRoutes = router;
