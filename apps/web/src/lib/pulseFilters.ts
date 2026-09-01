/**
 * Pulse list filters — one set per tab (New Pairs / Final Stretch / Migrated).
 *
 * Applied in BOTH places on purpose:
 *  - as query params on the HTTP fetch, so the server narrows a 24h window down to
 *    what you asked for (the migrated list can reach back hours now, and you do not
 *    want 100 dead coins crowding out the ones still trading), and
 *  - client-side on whatever is in the store, because the websocket pushes a fresh
 *    unfiltered snapshot every second and would otherwise undo the filtering.
 */

export type Range = { min?: number; max?: number };

export interface PulseFilter {
  search: string;    // comma-separated keywords, matched on name + symbol
  exclude: string;   // comma-separated keywords to reject
  liquidity: Range;  // USD
  volume: Range;     // USD (24h)
  marketCap: Range;  // USD
  curve: Range;      // bonding-curve %
  fees: Range;       // SOL, actually paid (not derived from volume)
  txns: Range;
  buys: Range;
  sells: Range;
}

export type TabKey = "new" | "final" | "migrated";
export type PulseFilters = Record<TabKey, PulseFilter>;

export const EMPTY_FILTER: PulseFilter = {
  search: "", exclude: "",
  liquidity: {}, volume: {}, marketCap: {}, curve: {}, fees: {}, txns: {}, buys: {}, sells: {},
};

export const EMPTY_FILTERS: PulseFilters = {
  new: { ...EMPTY_FILTER },
  final: { ...EMPTY_FILTER },
  migrated: { ...EMPTY_FILTER },
};

const KEY = "polyx.pulse.filters.v1";

export function loadFilters(): PulseFilters {
  if (typeof window === "undefined") return EMPTY_FILTERS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY_FILTERS;
    const parsed = JSON.parse(raw);
    // Merge over defaults so a saved set from an older build can't drop new fields.
    return {
      new: { ...EMPTY_FILTER, ...(parsed.new || {}) },
      final: { ...EMPTY_FILTER, ...(parsed.final || {}) },
      migrated: { ...EMPTY_FILTER, ...(parsed.migrated || {}) },
    };
  } catch {
    return EMPTY_FILTERS;
  }
}

export function saveFilters(f: PulseFilters) {
  try { window.localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* private mode */ }
}

/** How many bounds/keywords are set — drives the little count badge on each tab. */
export function activeCount(f: PulseFilter): number {
  let n = 0;
  if (f.search.trim()) n++;
  if (f.exclude.trim()) n++;
  for (const k of ["liquidity", "volume", "marketCap", "curve", "fees", "txns", "buys", "sells"] as const) {
    const r = f[k];
    if (r?.min !== undefined) n++;
    if (r?.max !== undefined) n++;
  }
  return n;
}

const words = (s: string) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

/**
 * A MISSING metric is unknown, not zero.
 *
 * Treating it as 0 emptied whole columns: not every source carries every field (the
 * in-memory feed has no buy/sell counts), so `Num Buys >= 1` scored every one of those
 * rows as 0 and filtered them all out. A filter silently deleting the list because the
 * data lacks a column is worse than one that lets an unknown through.
 */
const inRange = (v: number | undefined | null, r: Range) => {
  if (r.min === undefined && r.max === undefined) return true;
  if (v === undefined || v === null || Number.isNaN(Number(v))) return true; // unknown -> keep
  const x = Number(v);
  if (r.min !== undefined && x < r.min) return false;
  if (r.max !== undefined && x > r.max) return false;
  return true;
};

export function matchesFilter(t: any, f: PulseFilter): boolean {
  const hay = `${t.name || ""} ${t.symbol || ""}`.toLowerCase();
  const inc = words(f.search);
  if (inc.length && !inc.some((w) => hay.includes(w))) return false;
  const exc = words(f.exclude);
  if (exc.length && exc.some((w) => hay.includes(w))) return false;
  return (
    inRange(t.liquidity, f.liquidity) &&
    inRange(t.volume24h, f.volume) &&
    inRange(t.marketCap, f.marketCap) &&
    inRange(t.progress, f.curve) &&
    inRange(t.feesPaidSol, f.fees) &&
    inRange(t.txCount, f.txns) &&
    inRange(t.buys, f.buys) &&
    inRange(t.sells, f.sells)
  );
}

export function applyFilter<T>(tokens: T[], f: PulseFilter): T[] {
  return tokens.filter((t) => matchesFilter(t, f));
}

/** Filter set -> query string for the API (server-side narrowing). */
export function toQuery(f: PulseFilter): string {
  const p = new URLSearchParams();
  const put = (k: string, v?: number) => { if (v !== undefined && Number.isFinite(v)) p.set(k, String(v)); };
  if (f.search.trim()) p.set("search", f.search.trim());
  if (f.exclude.trim()) p.set("exclude", f.exclude.trim());
  put("minLiq", f.liquidity.min);   put("maxLiq", f.liquidity.max);
  put("minVol", f.volume.min);      put("maxVol", f.volume.max);
  put("minMcap", f.marketCap.min);  put("maxMcap", f.marketCap.max);
  put("minCurve", f.curve.min);     put("maxCurve", f.curve.max);
  put("minFees", f.fees.min);       put("maxFees", f.fees.max);
  put("minTx", f.txns.min);         put("maxTx", f.txns.max);
  put("minBuys", f.buys.min);       put("maxBuys", f.buys.max);
  put("minSells", f.sells.min);     put("maxSells", f.sells.max);
  const s = p.toString();
  return s ? `&${s}` : "";
}
