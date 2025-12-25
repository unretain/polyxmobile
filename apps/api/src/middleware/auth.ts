import { Request, Response, NextFunction } from "express";

// Internal API key for server-to-server communication
// This should be set in environment variables and shared between Next.js and Express
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

// Routes that don't require authentication
const PUBLIC_ROUTES = new Set([
  "/health",
]);

/**
 * Middleware to verify internal API key for server-to-server communication.
 * Protects against unauthorized access to Birdeye/Moralis API calls.
 */
export function requireInternalApiKey(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Allow public routes
  if (PUBLIC_ROUTES.has(req.path)) {
    return next();
  }

  // Check if INTERNAL_API_KEY is configured
  if (!INTERNAL_API_KEY) {
    console.error("[auth] INTERNAL_API_KEY not configured - blocking all requests");
    return res.status(500).json({ error: "Server configuration error" });
  }

  // Get API key from header
  const providedKey = req.headers["x-internal-api-key"] as string;

  if (!providedKey) {
    console.warn(`[auth] Missing API key for ${req.method} ${req.path} from ${req.ip}`);
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Validate API key (constant-time comparison to prevent timing attacks)
  if (providedKey.length !== INTERNAL_API_KEY.length) {
    console.warn(`[auth] Invalid API key for ${req.method} ${req.path} from ${req.ip}`);
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Use timing-safe comparison
  const crypto = require("crypto");
  const isValid = crypto.timingSafeEqual(
    Buffer.from(providedKey),
    Buffer.from(INTERNAL_API_KEY)
  );

  if (!isValid) {
    console.warn(`[auth] Invalid API key for ${req.method} ${req.path} from ${req.ip}`);
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

/**
 * Rate limiting middleware (basic in-memory implementation)
 * For production, use Redis-based rate limiting
 */
const requestCounts = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(maxRequests: number = 100, windowMs: number = 60000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || "unknown";
    const now = Date.now();

    let record = requestCounts.get(key);

    // Reset if window expired
    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + windowMs };
      requestCounts.set(key, record);
    }

    record.count++;

    // Set rate limit headers
    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - record.count));
    res.setHeader("X-RateLimit-Reset", Math.ceil(record.resetAt / 1000));

    if (record.count > maxRequests) {
      console.warn(`[rateLimit] Rate limit exceeded for ${key}: ${record.count}/${maxRequests}`);
      return res.status(429).json({
        error: "Too many requests",
        retryAfter: Math.ceil((record.resetAt - now) / 1000),
      });
    }

    next();
  };
}

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of requestCounts.entries()) {
    if (now > record.resetAt) {
      requestCounts.delete(key);
    }
  }
}, 5 * 60 * 1000);
