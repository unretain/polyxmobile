import Redis from "ioredis";

// Simple in-memory cache fallback when Redis is not available
class MemoryCache {
  private cache: Map<string, { value: string; expiry: number }> = new Map();

  async get(key: string): Promise<string | null> {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }

    return item.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.cache.set(key, {
      value,
      expiry: Date.now() + ttlSeconds * 1000,
    });
  }

  async del(key: string): Promise<void> {
    this.cache.delete(key);
  }
}

class CacheService {
  private redis: Redis | null = null;
  private memoryCache: MemoryCache = new MemoryCache();
  private useRedis: boolean = false;

  constructor() {
    this.initRedis();
  }

  private async initRedis() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      console.log("📦 Using in-memory cache (REDIS_URL not configured)");
      return;
    }

    try {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      });

      await this.redis.connect();
      this.useRedis = true;
      console.log("🔴 Redis connected");
    } catch (error) {
      console.log("📦 Redis not available, using in-memory cache");
      this.redis = null;
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.useRedis && this.redis) {
      try {
        return await this.redis.get(key);
      } catch (error) {
        console.error("Redis get error:", error);
        return this.memoryCache.get(key);
      }
    }
    return this.memoryCache.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.useRedis && this.redis) {
      try {
        await this.redis.setex(key, ttlSeconds, value);
        return;
      } catch (error) {
        console.error("Redis set error:", error);
      }
    }
    await this.memoryCache.set(key, value, ttlSeconds);
  }

  async del(key: string): Promise<void> {
    if (this.useRedis && this.redis) {
      try {
        await this.redis.del(key);
        return;
      } catch (error) {
        console.error("Redis del error:", error);
      }
    }
    await this.memoryCache.del(key);
  }
}

export const cache = new CacheService();
