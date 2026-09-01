/**
 * Tiny TTL memo for read-heavy list endpoints.
 *
 * The pulse lists queried ClickHouse (in Chicago) on EVERY request — ~25ms RTT each
 * way plus query time, ~112ms per call, for data that changes once a second and is
 * pushed over the websocket anyway. The HTTP snapshot only has to be one second
 * fresh, so one query per second serves every client instead of one per request.
 *
 * In-flight requests share a single upstream call, so a burst of clients on a cold
 * key produces one query, not N.
 */
type Entry<T> = { value?: T; expires: number; inflight?: Promise<T> };

const store = new Map<string, Entry<any>>();

export async function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit) {
    if (hit.value !== undefined && hit.expires > now) return hit.value;
    if (hit.inflight) return hit.inflight; // someone else is already fetching
  }
  const entry: Entry<T> = hit ?? { expires: 0 };
  entry.inflight = fn()
    .then((v) => {
      entry.value = v;
      entry.expires = Date.now() + ttlMs;
      return v;
    })
    .finally(() => { entry.inflight = undefined; });
  store.set(key, entry);
  return entry.inflight;
}

/** Drop a memo early (e.g. when the feed knows the list just changed). */
export function memoInvalidate(prefix: string) {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
