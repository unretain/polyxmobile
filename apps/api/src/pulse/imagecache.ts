/**
 * Local disk cache for coin logos.
 *
 * Before: /img?u=<ipfs-url> fetched the gateway on EVERY miss, so the first view of
 * a coin paid a 1-10s IPFS round trip (and a cold Cloudflare edge paid it again per
 * PoP). IPFS gateways are the slow part, not us.
 *
 * Now: we fetch each image ONCE, write the bytes to local NVMe, and serve every
 * later request off disk. resolveImage() prefetches the moment a coin is discovered,
 * so by the time a user scrolls to it the bytes are already local.
 *
 * Keyed by URL hash, not mint: the same IPFS CID is often reused across coins, and
 * a mint can have its metadata re-resolved.
 */
import { createHash } from "crypto";
import { createReadStream } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import { hedgedFetch, initIpfsCache } from "./ipfs";

// On the feed box this should point at NVMe (e.g. /mnt/images). Locally it falls
// back to a gitignored dir under the API.
const DIR = process.env.IMG_CACHE_DIR || path.join(process.cwd(), ".imgcache");
const MAX_BYTES = Number(process.env.IMG_CACHE_MAX_GB || 20) * 1024 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// Our image origin on the feed box (permanent NVMe cache + local IPFS node).
// Unset => straight to the gateways.
const IMG_UPSTREAM = process.env.IMG_UPSTREAM || "";
const UPSTREAM_TIMEOUT_MS = Number(process.env.IMG_UPSTREAM_TIMEOUT_MS || 4000);
const FETCH_TIMEOUT_MS = 10000;

const EXT_BY_CT: Record<string, string> = {
  "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
  "image/gif": "gif", "image/svg+xml": "svg", "image/avif": "avif", "image/bmp": "bmp",
};
const CT_BY_EXT: Record<string, string> = {
  webp: "image/webp", png: "image/png", jpg: "image/jpeg", gif: "image/gif",
  svg: "image/svg+xml", avif: "image/avif", bmp: "image/bmp",
};

// hash -> extension, for the files we know are on disk. Built once at boot so a
// hit costs a Map lookup instead of a stat().
const index = new Map<string, string>();
const inflight = new Map<string, Promise<CachedImage | null>>();
let ready = false;

export interface CachedImage {
  file: string;        // absolute path on disk
  contentType: string;
  size: number;
}

const keyOf = (url: string) => createHash("sha1").update(url).digest("hex");

const THUMB_PX = Number(process.env.IMG_THUMB_PX || 256);

/**
 * Downscale to a webp thumbnail. Falls back to the original bytes if sharp is
 * unavailable (optional native dep) or the image can't be decoded — the cache
 * still works, it just stores the full-size file.
 */
async function thumbnail(raw: Buffer, ct: string): Promise<{ buf: Buffer; ext: string }> {
  const orig = { buf: raw, ext: EXT_BY_CT[ct] || "bin" };
  if (ct === "image/gif" || ct === "image/svg+xml") return orig;
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(raw, { failOn: "none" })
      .resize(THUMB_PX, THUMB_PX, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();
    return out.length && out.length < raw.length ? { buf: out, ext: "webp" } : orig;
  } catch {
    return orig;
  }
}

export async function initImageCache() {
  try {
    await fs.mkdir(DIR, { recursive: true });
    await initIpfsCache(); // metadata JSON cache lives under DIR/meta
    const files = await fs.readdir(DIR, { withFileTypes: true });
    for (const e of files) {
      if (!e.isFile()) continue; // skip the meta/ subdir
      const dot = e.name.lastIndexOf(".");
      if (dot > 0) index.set(e.name.slice(0, dot), e.name.slice(dot + 1));
    }
    ready = true;
    console.log(`[imgcache] ${index.size} images ready in ${DIR} (cap ${MAX_BYTES / 1e9}GB)`);
    setInterval(() => { evict().catch(() => {}); }, 10 * 60 * 1000);
  } catch (e) {
    console.warn("[imgcache] disabled:", (e as Error).message);
  }
}

/** Disk hit, or null. Cheap — no IO beyond the stat we need for Content-Length. */
export async function get(url: string): Promise<CachedImage | null> {
  if (!ready) return null;
  const key = keyOf(url);
  const ext = index.get(key);
  if (!ext) return null;
  const file = path.join(DIR, `${key}.${ext}`);
  try {
    const st = await fs.stat(file);
    return { file, contentType: CT_BY_EXT[ext] || "application/octet-stream", size: st.size };
  } catch {
    index.delete(key); // file vanished (evicted//manual delete) — fall through to refetch
    return null;
  }
}

/**
 * Fetch + store. Concurrent callers for the same URL share one fetch, so a burst
 * of viewers hitting a brand-new coin still only pulls from IPFS once.
 */
export async function fetchAndStore(url: string): Promise<CachedImage | null> {
  if (!ready) return null;
  const key = keyOf(url);
  const existing = inflight.get(key);
  if (existing) return existing;

  const p = (async (): Promise<CachedImage | null> => {
    try {
      // Our own image origin on the feed box first: it keeps a permanent thumbnail
      // cache on NVMe next to our IPFS node, so this is usually one hop to an
      // already-transcoded webp. That matters most on Railway, whose disk is
      // ephemeral — without it every deploy re-pays an IPFS fetch for every logo.
      let r: Response | null = null;
      let preThumbed = false;
      if (IMG_UPSTREAM) {
        try {
          const up = await fetch(`${IMG_UPSTREAM}?u=${encodeURIComponent(url)}`, {
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
          });
          if (up.ok) { r = up; preThumbed = true; }
        } catch { /* upstream down — fall through to the gateways */ }
      }
      // Fallback: hedged multi-gateway, so one slow/throttling gateway never decides
      // whether a coin has a logo.
      if (!r) r = await hedgedFetch(url);
      if (!r) return null;
      const ct = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!ct.startsWith("image/")) return null;
      const raw = Buffer.from(await r.arrayBuffer());
      if (!raw.length || raw.length > MAX_IMAGE_BYTES) return null;
      // Coin logos render at ~40px but are routinely shipped as 1-2MB PNGs. Store a
      // 256px webp (retina-safe for every list row we draw) — typically 10-40x
      // smaller, which matters far more than latency on a phone. Animated GIFs and
      // SVGs are passed through untouched: one loses animation, the other is already tiny.
      // Bytes from our own origin are already transcoded — re-encoding them would burn
      // CPU on the API for no size win.
      const { buf, ext } = preThumbed
        ? { buf: raw, ext: EXT_BY_CT[ct] || "bin" }
        : await thumbnail(raw, ct);
      const file = path.join(DIR, `${key}.${ext}`);
      // tmp + rename so a reader never sees a half-written file
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, buf);
      await fs.rename(tmp, file);
      index.set(key, ext);
      return { file, contentType: CT_BY_EXT[ext] || ct, size: buf.length };
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

/** Warm the cache off the hot path — fire-and-forget at coin discovery. */
export function prefetch(url: string) {
  if (!ready || !url || !/^https?:\/\//i.test(url)) return;
  if (index.has(keyOf(url)) || inflight.has(keyOf(url))) return;
  fetchAndStore(url).catch(() => {});
}

export function openStream(img: CachedImage) {
  return createReadStream(img.file);
}

export function imageCacheStats() {
  return { dir: DIR, count: index.size, ready };
}

/** Keep the cache under its size cap, oldest-first (coins go stale fast). */
async function evict() {
  if (!ready) return;
  const entries = await fs.readdir(DIR, { withFileTypes: true });
  const stats: { f: string; size: number; mtime: number }[] = [];
  let total = 0;
  for (const e of entries) {
    if (!e.isFile()) continue; // never evict the meta/ subdir itself
    try {
      const st = await fs.stat(path.join(DIR, e.name));
      stats.push({ f: e.name, size: st.size, mtime: st.mtimeMs });
      total += st.size;
    } catch { /* raced with another evict */ }
  }
  if (total <= MAX_BYTES) return;
  stats.sort((a, b) => a.mtime - b.mtime);
  const target = MAX_BYTES * 0.8;
  let removed = 0;
  for (const s of stats) {
    if (total <= target) break;
    try {
      await fs.unlink(path.join(DIR, s.f));
      const dot = s.f.lastIndexOf(".");
      if (dot > 0) index.delete(s.f.slice(0, dot));
      total -= s.size;
      removed++;
    } catch { /* already gone */ }
  }
  console.log(`[imgcache] evicted ${removed} images, now ${(total / 1e9).toFixed(1)}GB`);
}
