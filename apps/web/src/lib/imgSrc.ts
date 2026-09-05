/**
 * Rewrite a coin logo onto our own origin.
 *
 * The API stamps absolute URLs (https://images.polyx.trade/i/<hash>.webp?u=<src>).
 * That makes every logo depend on a SECOND host being reachable from the browser,
 * which is not a safe assumption: networks that interfere with TLS to *.polyx.trade
 * break some connections and not others, so the page loads with a half-broken grid
 * of avatars showing alt text.
 *
 * `/imgp/*` is rewritten to the image origin server-side (see next.config.ts), so the
 * bytes come back over the connection that already worked — the one that served the
 * page. Anything not pointing at the image host is returned untouched.
 */
const IMG_HOSTS = ["images.polyx.trade"];

export function imgSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  // Already relative (or already proxied) — nothing to do.
  if (url.startsWith("/")) return url;
  try {
    const u = new URL(url);
    if (!IMG_HOSTS.includes(u.hostname.toLowerCase())) return url;
    return `/imgp${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}
