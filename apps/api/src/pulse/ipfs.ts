/**
 * Reliable IPFS fetching for coin metadata.
 *
 * The old path pinned everything on ONE gateway (dweb.link): a single 8s attempt,
 * retried by sweepImages against that same gateway forever. Every new coin on the
 * network hits it at once, so when it throttles, every logo and every social link
 * stalls together — which is exactly the "source is not reliable" symptom.
 *
 * This races several independent gateways instead. Requests are HEDGED, not blasted:
 * we start one, and only if it hasn't answered in HEDGE_MS do we add the next. Most
 * CIDs resolve on the first gateway (one request, same load as before); slow ones
 * quietly fall through to a competitor instead of blocking for 8 seconds. The first
 * success wins and the losers are aborted.
 *
 * Metadata JSON is cached to disk like images are, so a restart or a repeated CID
 * costs nothing.
 */
import { createHash } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { Agent, setGlobalDispatcher } from "undici";

// Ordered by observed reliability for pump.fun CIDs. pump.fun pins through Pinata,
// so Pinata's own gateway is the origin and usually answers first and warmest.
const GATEWAYS = (process.env.IPFS_GATEWAYS ||
  [
    "https://gateway.pinata.cloud/ipfs/",
    "https://ipfs.io/ipfs/",
    "https://dweb.link/ipfs/",
    "https://w3s.link/ipfs/",
    "https://nftstorage.link/ipfs/",
    "https://cf-ipfs.com/ipfs/",
  ].join(",")
).split(",").map((s) => s.trim()).filter(Boolean);

// Every logo fetch used to pay a fresh TCP (+TLS) handshake — 1-2 extra round trips
// to Chicago or a public gateway on EVERY image. One keep-alive pool per origin means
// only the first fetch pays that; the rest reuse a warm connection.
const agent = new Agent({
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 300_000,
  connections: 64, // plenty of parallelism for a burst of new coins
});
setGlobalDispatcher(agent);

// 1200ms meant a slow first candidate stalled the whole fetch for over a second
// before anything else was even tried. 250ms overlaps the sources instead: the
// origin gateway usually answers inside that window, and if it does not, our node
// and the public gateways are already in flight.
// Metadata resolver on our feed box (see IMG_UPSTREAM). Unset => resolve locally.
const RESOLVE_UPSTREAM = process.env.META_UPSTREAM || "";
const RESOLVE_TIMEOUT_MS = Number(process.env.META_UPSTREAM_TIMEOUT_MS || 3000);

const HEDGE_MS = Number(process.env.IPFS_HEDGE_MS || 250);
const TOTAL_TIMEOUT_MS = Number(process.env.IPFS_TIMEOUT_MS || 12000);
const META_DIR = path.join(process.env.IMG_CACHE_DIR || path.join(process.cwd(), ".imgcache"), "meta");

let metaReady = false;

export async function initIpfsCache() {
  try {
    await fs.mkdir(META_DIR, { recursive: true });
    metaReady = true;
  } catch {
    metaReady = false;
  }
}

/** `<cid>` / `<cid>/path` out of any gateway URL or ipfs:// URI, else null. */
export function cidPath(u: string): string | null {
  const m = u.match(/\/ipfs\/([A-Za-z0-9]+(?:\/[^?#]*)?)/) || u.match(/^ipfs:\/\/(.+)$/i);
  return m ? m[1].replace(/^\/+/, "") : null;
}

/**
 * Fetch a URL, racing IPFS gateways when it is a CID. Returns the winning Response,
 * or null if every candidate failed.
 */
export async function hedgedFetch(url: string): Promise<Response | null> {
  const cid = cidPath(url);
  // The URL's OWN host goes first. For a brand-new coin that host is the uploader's
  // own pinning gateway (…mypinata.cloud/ipfs/…) where the bytes were just published
  // — it is warm and answers in ~50ms. Our node has to do a cold DHT lookup for a CID
  // that is seconds old (0.3-1.8s), so leading with it made every FIRST view slow;
  // rewriting the host away entirely was worse, it threw out the fastest source we had.
  // Our node still gets a near-simultaneous shot, wins on everything already pinned,
  // and covers CIDs whose origin gateway has gone away.
  const candidates = cid
    ? [...new Set([...(/^https?:\/\//i.test(url) ? [url] : []), ...GATEWAYS.map((g) => g + cid)])]
    : [url];

  const controllers: AbortController[] = [];
  const deadline = AbortSignal.timeout(TOTAL_TIMEOUT_MS);
  let settled = false;
  // The winner's controller must NEVER be aborted: the response body is still
  // streaming when we return it, so aborting it here makes the caller's .json() /
  // .arrayBuffer() throw. Aborting every controller on success is exactly that bug —
  // it silently killed every metadata and image fetch.
  let winner: AbortController | null = null;

  const abortLosers = () => {
    for (const c of controllers) {
      if (c === winner) continue;
      try { c.abort(); } catch { /* already done */ }
    }
  };

  const attempt = (u: string): Promise<{ r: Response; ac: AbortController }> => {
    const ac = new AbortController();
    controllers.push(ac);
    // Deadline cancels in-flight attempts, but never the one we already handed back.
    deadline.addEventListener("abort", () => { if (ac !== winner) { try { ac.abort(); } catch {} } }, { once: true });
    return fetch(u, { redirect: "follow", signal: ac.signal }).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return { r, ac };
    });
  };

  return new Promise<Response | null>((resolve) => {
    let idx = 0;
    let pending = 0;
    let timer: NodeJS.Timeout | null = null;

    const finish = (won: { r: Response; ac: AbortController } | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      winner = won?.ac ?? null;
      abortLosers(); // free the gateway connections we no longer need
      resolve(won?.r ?? null);
    };

    const launch = () => {
      if (settled || idx >= candidates.length) {
        if (pending === 0 && !settled) finish(null);
        return;
      }
      const u = candidates[idx++];
      pending++;
      attempt(u)
        .then((won) => finish(won))
        .catch(() => {
          pending--;
          // A failure frees the slot immediately — try the next gateway now rather
          // than waiting out the hedge timer.
          if (!settled) launch();
        });
      if (idx < candidates.length) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(launch, HEDGE_MS);
      }
    };

    deadline.addEventListener("abort", () => finish(null), { once: true });
    launch();
  });
}

/**
 * Is this a URL we are willing to fetch on a user's behalf?
 *
 * The old /img route used a hardcoded 13-host allowlist, which blocked ~40% of real
 * coin logos — every new launchpad ships its own CDN (j7tracker, uxento, padre.gg,
 * solanatracker, twimg, googleapis, ...) and the list can never keep up. A coin whose
 * logo host isn't listed just 400s forever.
 *
 * So: allow any PUBLIC http(s) host, and block the thing the allowlist was actually
 * protecting against — SSRF into our own network. We resolve the hostname first and
 * refuse loopback/private/link-local/CGNAT targets.
 */
function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const parts = v4.split(".");
  if (parts.length === 4) {
    const [a, b] = parts.map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;             // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;    // 172.16/12
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;   // CGNAT
    if (a >= 224) return true;                            // multicast / reserved
    return false;
  }
  const s = ip.toLowerCase();
  if (s === "::1" || s === "::") return true;
  if (s.startsWith("fc") || s.startsWith("fd")) return true; // unique-local
  if (s.startsWith("fe80")) return true;                     // link-local
  return false;
}

export async function isPublicHttpUrl(u: string): Promise<boolean> {
  let url: URL;
  try { url = new URL(u); } catch { return false; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  try {
    const { lookup } = await import("dns/promises");
    const addrs = await lookup(url.hostname, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false; // unresolvable host
  }
}

const keyOf = (u: string) => createHash("sha1").update(u).digest("hex");

/**
 * Coin metadata JSON, disk-cached. Returns null on a genuine failure so the caller
 * can retry later; a successful fetch is cached forever (CIDs are immutable).
 */
export async function fetchMetadata(uri: string): Promise<any | null> {
  const file = path.join(META_DIR, `${keyOf(uri)}.json`);
  if (metaReady) {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch { /* not cached yet */ }
  }
  // Ask our box to do the resolve. It sits in a datacenter with the coin CIDs already
  // pinned locally, so it answers in ~50ms and ALSO starts pulling the image bytes, so
  // the follow-up image request is a cache hit. Doing this here costs one round trip
  // instead of two (metadata, then image) from wherever the API happens to run.
  if (RESOLVE_UPSTREAM) {
    try {
      const r = await fetch(`${RESOLVE_UPSTREAM}?u=${encodeURIComponent(uri)}`, {
        signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
      });
      if (r.ok) {
        const j = await r.json();
        if (j && typeof j === "object" && (j as any).image) {
          if (metaReady) {
            try {
              const tmp = `${file}.${process.pid}.tmp`;
              await fs.writeFile(tmp, JSON.stringify(j));
              await fs.rename(tmp, file);
            } catch { /* cache write is best-effort */ }
          }
          return j;
        }
      }
    } catch { /* upstream down — resolve it ourselves below */ }
  }
  const res = await hedgedFetch(uri);
  if (!res) return null;
  try {
    const j = await res.json();
    if (metaReady && j && typeof j === "object") {
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(j));
      await fs.rename(tmp, file);
    }
    return j;
  } catch {
    return null;
  }
}
