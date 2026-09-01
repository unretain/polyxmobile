/**
 * ClickHouse schema for the pump.fun / DEX feed.
 *
 * Design:
 *  - `tokens`      one row per launch (ReplacingMergeTree dedups by mint).
 *  - `trades`      the append-only firehose; ORDER BY (mint, ts) for fast
 *                  per-token time queries, partitioned by day, TTL 14d.
 *  - `graduations` one row per CompleteEvent (bonding curve filled).
 *  - `candles_1m`  AggregatingMergeTree of 1-minute OHLCV, filled by a
 *                  materialized view off `trades`. Higher timeframes are rolled
 *                  up from this at query time (argMin/argMaxMerge carry open/close).
 *
 * All statements are idempotent (IF NOT EXISTS) so they can run on every boot.
 */
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS tokens (
    mint          String,
    name          String,
    symbol        String,
    uri           String,
    image         String DEFAULT '',
    creator       String DEFAULT '',
    created_at    DateTime64(3),
    created_slot  UInt64 DEFAULT 0,
    ingested_at   DateTime64(3) DEFAULT now64(3)
  ) ENGINE = ReplacingMergeTree(ingested_at)
  ORDER BY mint`,

  // SOL-denominated (price_sol / mcap_sol come straight from on-chain bonding-curve
  // reserves — NO external SOL-price dependency, so they're always correct). USD is
  // computed at read time. This avoids storing $0 when a SOL-price fetch hiccups.
  `CREATE TABLE IF NOT EXISTS trades (
    mint                  String,
    signature             String DEFAULT '',
    slot                  UInt64 DEFAULT 0,
    ts                    DateTime64(3),
    is_buy                UInt8,
    sol_amount            Float64,
    token_amount          Float64,
    price_sol             Float64,
    mcap_sol              Float64,
    real_token_reserves   Float64,
    trader                String DEFAULT '',
    -- Monotonic write order. Block time is only SECOND-precise, so dozens of trades
    -- in one second share an identical ts and argMin/argMax(price, ts) tie — they
    -- returned the same row for open AND close, which rendered every candle flat
    -- (a wick with no body). One decoder writes in stream order, so seq is the true
    -- intra-second ordering. ingested_at can't do this: now64() is evaluated once
    -- per insert block, so a whole batch shares one value.
    seq                   UInt64 DEFAULT 0,
    ingested_at           DateTime64(3) DEFAULT now64(3)
  ) ENGINE = MergeTree
  PARTITION BY toYYYYMMDD(ts)
  ORDER BY (mint, ts)
  TTL toDateTime(ts) + INTERVAL 14 DAY`,

  `CREATE TABLE IF NOT EXISTS graduations (
    mint         String,
    ts           DateTime64(3),
    ingested_at  DateTime64(3) DEFAULT now64(3)
  ) ENGINE = ReplacingMergeTree(ingested_at)
  ORDER BY mint`,

  // Existing deployments predate `seq` — add it in place (no-op once present).
  `ALTER TABLE trades ADD COLUMN IF NOT EXISTS seq UInt64 DEFAULT 0`,

  // Candles in SOL (converted to USD at read). open/close via argMin/argMax on ts.
  `CREATE TABLE IF NOT EXISTS candles_1m (
    mint        String,
    bucket      DateTime,
    open        AggregateFunction(argMin, Float64, DateTime64(3)),
    high        SimpleAggregateFunction(max, Float64),
    low         SimpleAggregateFunction(min, Float64),
    close       AggregateFunction(argMax, Float64, DateTime64(3)),
    volume_sol  SimpleAggregateFunction(sum, Float64),
    trades      SimpleAggregateFunction(sum, UInt64)
  ) ENGINE = AggregatingMergeTree
  ORDER BY (mint, bucket)`,

  `CREATE MATERIALIZED VIEW IF NOT EXISTS candles_1m_mv TO candles_1m AS
    SELECT
      mint,
      toStartOfMinute(ts)          AS bucket,
      argMinState(price_sol, ts)   AS open,
      max(price_sol)               AS high,
      min(price_sol)               AS low,
      argMaxState(price_sol, ts)   AS close,
      sum(sol_amount)              AS volume_sol,
      count()                      AS trades
    FROM trades
    WHERE price_sol > 0
    GROUP BY mint, bucket`,
];
