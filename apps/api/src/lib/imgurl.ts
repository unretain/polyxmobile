/**
 * THE logo URL builder. One copy, imported by both the live feed and the ClickHouse
 * query layer.
 *
 * There used to be two near-identical `proxyImg` functions, and they drifted: the
 * ClickHouse one still dropped `ipfs://` URLs (browsers can't load those, so the coin
 * silently had no logo) and still pointed at the API host after the feed had been
 * moved to the image origin. Since most list rows are served FROM ClickHouse, fixing
 * only the feed copy fixed almost nothing.
 *
 * Output, when IMG_PUBLIC_BASE is set:
 *   https://images.polyx.trade/i/<sha1(src)>.webp?u=<src>
 * The extension is there because Cloudflare's default cache keys off one — `/img?u=…`
 * has none, so every view would punch through to the origin. `u` is the source for a
 * cold miss; the hash is the key the image service stores under.
 */
import { createHash } from "crypto";

const PUBLIC_API_URL = process.env.PUBLIC_API_URL || "https://api.polyx.trade";
const IMG_PUBLIC_BASE = (process.env.IMG_PUBLIC_BASE || "").replace(/\/$/, "");

export function proxyImg(u: string | null): string | null {
  if (!u) return u;
  if (u.startsWith(PUBLIC_API_URL)) return u;
  if (IMG_PUBLIC_BASE && u.startsWith(IMG_PUBLIC_BASE)) return u;
  // ipfs://<cid> must be rewritten too — handed to a browser as-is it is a dead link.
  if (!/^(https?|ipfs):\/\//i.test(u)) return u;
  if (IMG_PUBLIC_BASE) {
    const key = createHash("sha1").update(u).digest("hex");
    return `${IMG_PUBLIC_BASE}/i/${key}.webp?u=${encodeURIComponent(u)}`;
  }
  return `${PUBLIC_API_URL}/img?u=${encodeURIComponent(u)}`;
}
