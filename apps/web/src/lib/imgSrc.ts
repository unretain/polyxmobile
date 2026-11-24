/**
 * Rewrite a coin logo onto our own origin.
 *
 * The API stamps logo URLs as `<PUBLIC_API_URL>/img?u=<src>` (its disk-backed
 * image cache). Historically that host was images.polyx.trade / api.polyx.trade —
 * both of which have been unreachable at times, so every avatar on the site broke
 * even though the page itself loaded fine.
 *
 * Fix: recognize the stamp by SHAPE (`/img?u=…` with an http(s) `u`), not by host,
 * and rewrite it to `/imgp/img?u=…`, which next.config.ts proxies server-side to
 * the API origin that this deployment actually uses. The browser then fetches the
 * logo over the same connection that served the page. Unstamped URLs pass through.
 */
export function imgSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  // Already relative (or already proxied) — nothing to do.
  if (url.startsWith("/")) return url;
  try {
    const u = new URL(url);
    const original = u.searchParams.get("u") || "";
    const isStamp = u.pathname === "/img" && /^https?:\/\//.test(original);
    if (isStamp) return `/imgp/img?u=${encodeURIComponent(original)}`;
    // Legacy stamped form on the old image host: /i/<hash>.webp?u=<src>
    if (u.hostname.toLowerCase() === "images.polyx.trade") {
      return /^https?:\/\//.test(original)
        ? `/imgp/img?u=${encodeURIComponent(original)}`
        : `/imgp${u.pathname}${u.search}`;
    }
    return url;
  } catch {
    return url;
  }
}
