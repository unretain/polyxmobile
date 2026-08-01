# ClickHouse feed — Railway deploy

The pump.fun / DEX feed (new pairs, trades, OHLCV, market cap, 24h volume,
graduations) is served from **ClickHouse**, so every user sees the same data,
it survives restarts, and 24h/7d windows are real.

Pipeline:

```
Corvus gRPC ──▶ API ingestor (single connection) ──▶ ClickHouse ──▶ /api/feed/* ──▶ web
```

It's fully optional: if `CLICKHOUSE_URL` is unset, the ingestor and `/api/feed/*`
disable themselves and the app falls back to the in-memory feed + free providers.
**Nothing breaks before ClickHouse exists.**

## 1. Add a ClickHouse service on Railway

1. Railway project → **New → Service → Docker Image**.
2. Image: `clickhouse/clickhouse-server:24-alpine` (or latest `24.*`).
3. **Variables** on the ClickHouse service:
   - `CLICKHOUSE_USER=default`
   - `CLICKHOUSE_PASSWORD=<pick-a-strong-password>`
   - `CLICKHOUSE_DB=default`
   - `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1`
4. **Volume**: mount a volume at `/var/lib/clickhouse` (persistence — required).
5. ClickHouse listens on **8123** (HTTP) internally. You do **not** need a public
   domain; the API talks to it over Railway private networking.

> Memory: ClickHouse likes RAM. On a small Railway plan add these variables to
> keep it from OOMing (also fine on bigger plans):
> `CLICKHOUSE_SKIP_USER_SETUP=0`, and set a server memory cap by mounting a
> config or using the env `MAX_SERVER_MEMORY_USAGE_TO_RAM_RATIO=0.7`.
> If it still OOMs, bump the service's memory to ≥1 GB.

## 2. Point the API service at it

On the **API** service variables, add (use the ClickHouse service's private host —
Railway shows it as `<service-name>.railway.internal`):

```
CLICKHOUSE_URL=http://clickhouse.railway.internal:8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=<same password as above>
CLICKHOUSE_DB=default
```

Keep the existing:
```
GRPC_ENDPOINT=http://tyo.corvus-labs.io:10101      # Corvus (IP-whitelisted)
```

Redeploy the API. On boot you'll see:
```
[clickhouse] schema ready
[ingestor] connected to http://tyo.corvus-labs.io:10101, streaming pump.fun -> ClickHouse
[ingestor] creates=… trades=… grads=… flushed=… conn=true
```

The schema auto-creates on boot (idempotent `CREATE TABLE IF NOT EXISTS`), so
there's no manual migration step.

## 3. Point the web service at the API

On the **web** service, make sure it can reach the API (it already proxies via
`NEXT_PUBLIC_API_URL` + `INTERNAL_API_KEY`). No web-side ClickHouse config is
needed — the web only ever talks to `/api/feed/*` on the API, and auto-detects
availability (cached 60s). Within a minute of ClickHouse coming up, the web's
new-pairs / token / ohlcv / trades routes switch to ClickHouse automatically.

## 4. Corvus connection budget

The **ingestor is the single Corvus consumer** for the feed. To stay within the
trial's connection limit, once ClickHouse is live you can retire the web app's
own gRPC connection (it's only the fallback now) by leaving `GRPC_ENDPOINT`
**unset on the web service** — the web will rely on the ClickHouse feed.

## Tables

| table         | purpose                                            |
|---------------|----------------------------------------------------|
| `tokens`      | one row per launch (CreateEvent), image resolved   |
| `trades`      | every pump.fun trade (TradeEvent), TTL 14d         |
| `graduations` | one row per CompleteEvent (bonding curve filled)   |
| `candles_1m`  | 1-min OHLCV via materialized view; higher TFs roll up |

## Local (optional)

No Docker on the dev box, so validate against the Railway instance, or run
ClickHouse locally and set `CLICKHOUSE_URL=http://localhost:8123` in `apps/api/.env`.
