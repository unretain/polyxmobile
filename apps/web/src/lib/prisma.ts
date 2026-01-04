import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Use connection pooling to limit DB connections
// Supabase session mode has limited pool size (~15-20 connections)
// We limit web frontend to 2 connections to leave room for API
const databaseUrl = process.env.DATABASE_URL || "";
const urlWithPooling = databaseUrl.includes("?")
  ? `${databaseUrl}&connection_limit=2`
  : `${databaseUrl}?connection_limit=2`;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    datasources: {
      db: {
        url: urlWithPooling,
      },
    },
  });

// Cache the client in both dev and production to prevent connection exhaustion
globalForPrisma.prisma = prisma;
