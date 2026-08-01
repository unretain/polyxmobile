import { createClient, ClickHouseClient } from "@clickhouse/client";
import { SCHEMA_STATEMENTS } from "./schema";

/**
 * ClickHouse connection. Configured entirely via env so it's optional:
 * if CLICKHOUSE_URL is unset, the whole ingestion/read layer is disabled and
 * the app falls back to provider-based routes — the DB can never block boot.
 *
 * Railway: add a ClickHouse service, then set on the API service:
 *   CLICKHOUSE_URL=http://<clickhouse-host>:8123
 *   CLICKHOUSE_USER=default
 *   CLICKHOUSE_PASSWORD=<password>
 *   CLICKHOUSE_DB=default
 */
let client: ClickHouseClient | null = null;

export function clickhouseEnabled(): boolean {
  return !!process.env.CLICKHOUSE_URL;
}

export function getClickHouse(): ClickHouseClient | null {
  if (!clickhouseEnabled()) return null;
  if (!client) {
    client = createClient({
      url: process.env.CLICKHOUSE_URL,
      username: process.env.CLICKHOUSE_USER || "default",
      password: process.env.CLICKHOUSE_PASSWORD || "",
      database: process.env.CLICKHOUSE_DB || "default",
      // Keep the HTTP connection warm; large-ish batches from the ingestor.
      max_open_connections: 10,
      request_timeout: 30000,
    });
  }
  return client;
}

let schemaReady = false;

export async function initClickHouseSchema(): Promise<boolean> {
  const ch = getClickHouse();
  if (!ch) {
    console.log("[clickhouse] CLICKHOUSE_URL not set — ingestion & CH reads disabled");
    return false;
  }
  try {
    for (const stmt of SCHEMA_STATEMENTS) {
      await ch.command({ query: stmt });
    }
    schemaReady = true;
    console.log("[clickhouse] schema ready");
    return true;
  } catch (err) {
    console.error("[clickhouse] schema init failed:", (err as Error).message);
    return false;
  }
}

export function isClickHouseReady(): boolean {
  return schemaReady;
}
