/**
 * Tweet preview for the pulse rows' bird icon.
 *
 * A coin's metadata "twitter" field is whatever the deployer typed, so it can be a
 * single tweet, a profile, a community, or junk. Only a STATUS url has a tweet to
 * show; everything else is reported as-is and the UI just links out.
 *
 * We hand the url to Twitter's public oEmbed endpoint (no API key, no auth) and
 * return plain fields rather than its HTML — the caller renders in our own styling,
 * and nothing from a third party reaches the DOM as markup.
 */
import { NextRequest, NextResponse } from "next/server";

// Hosts we will hand to oEmbed. The url comes from on-chain token metadata, i.e.
// from anyone who can pay to deploy a coin — without this it's an open proxy.
const TWITTER_HOSTS = new Set([
  "twitter.com", "www.twitter.com", "mobile.twitter.com",
  "x.com", "www.x.com", "mobile.x.com",
]);

type Preview =
  | { kind: "tweet"; text: string; author: string; handle: string; url: string }
  | { kind: "profile"; handle: string; url: string }
  | { kind: "link"; url: string };

// Reserved path segments that are not usernames.
const NOT_HANDLES = new Set(["i", "intent", "share", "home", "search", "hashtag", "explore", "messages"]);

function decodeEntities(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&amp;/g, "&") // last: so "&amp;lt;" doesn't become "<"
    .trim();
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url") || "";
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
  }
  if (target.protocol !== "https:" || !TWITTER_HOSTS.has(target.hostname.toLowerCase())) {
    return NextResponse.json({ error: "not a twitter url" }, { status: 400 });
  }

  const segments = target.pathname.split("/").filter(Boolean);
  const statusIdx = segments.findIndex((s) => s === "status" || s === "statuses");
  const handle = segments[0] && !NOT_HANDLES.has(segments[0].toLowerCase()) ? segments[0] : "";

  // Not a single tweet -> nothing to preview, say so and let the UI link out.
  if (statusIdx < 1 || !/^\d+$/.test(segments[statusIdx + 1] || "")) {
    const fallback: Preview = handle
      ? { kind: "profile", handle, url: target.toString() }
      : { kind: "link", url: target.toString() };
    return NextResponse.json(fallback, { headers: { "Cache-Control": "public, max-age=3600" } });
  }

  try {
    const oembed = new URL("https://publish.twitter.com/oembed");
    oembed.searchParams.set("url", target.toString());
    oembed.searchParams.set("omit_script", "1");
    oembed.searchParams.set("hide_thread", "1");
    oembed.searchParams.set("dnt", "true");

    const r = await fetch(oembed.toString(), {
      signal: AbortSignal.timeout(4000),
      headers: { accept: "application/json" },
    });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();

    // The tweet body is the first <p> of the returned blockquote.
    const body = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(String(j.html || ""));
    const text = body ? decodeEntities(body[1]) : "";
    if (!text) throw new Error("no body");

    const authorUrl = String(j.author_url || "");
    const preview: Preview = {
      kind: "tweet",
      text,
      author: String(j.author_name || handle),
      handle: authorUrl.split("/").filter(Boolean).pop() || handle,
      url: target.toString(),
    };
    // Tweets are immutable enough to cache hard; this is hovered a lot.
    return NextResponse.json(preview, { headers: { "Cache-Control": "public, max-age=86400" } });
  } catch {
    // Deleted, protected, or oEmbed being slow — degrade to a plain link rather
    // than showing an error in a hover card.
    const fallback: Preview = handle
      ? { kind: "profile", handle, url: target.toString() }
      : { kind: "link", url: target.toString() };
    return NextResponse.json(fallback, { headers: { "Cache-Control": "public, max-age=60" } });
  }
}
