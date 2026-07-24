/**
 * Client for the API's ClickHouse-backed feed (/api/feed/*), the shared source
 * of truth. Availability is cached so routes cheaply prefer ClickHouse when it's
 * up and fall back to the in-memory / provider paths when it isn't (e.g. before
 * the ClickHouse service is deployed).
 */
import { fetchInternalApi } from "./config";

let _avail: { ok: boolean; at: number } | null = null;
// Cache "available" for a while (low overhead), but re-check "unavailable" quickly
// so a brief API/ClickHouse blip doesn't strand the site on the fallback feed.
const AVAIL_TTL_OK = 60000;
const AVAIL_TTL_BAD = 8000;

async function feedAvailable(): Promise<boolean> {
  if (_avail) {
    const ttl = _avail.ok ? AVAIL_TTL_OK : AVAIL_TTL_BAD;
    if (Date.now() - _avail.at < ttl) return _avail.ok;
  }
  try {
    const r = await fetchInternalApi("/api/feed/status");
    if (r.ok) {
      const j = await r.json();
      const ok = !!j.connected;
      _avail = { ok, at: Date.now() };
      return ok;
    }
  } catch {
    /* API unreachable */
  }
  _avail = { ok: false, at: Date.now() };
  return false;
}

/** Fetch from the ClickHouse feed, or null if it's unavailable/errored. */
export async function feedFetch(path: string): Promise<any | null> {
  if (!(await feedAvailable())) return null;
  try {
    const r = await fetchInternalApi(path);
    if (r.ok) return await r.json();
  } catch {
    /* fall back */
  }
  return null;
}
