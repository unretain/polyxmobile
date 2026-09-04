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

interface Tweet {
  text: string;
  author: string;
  handle: string;
  url: string;
}

type Preview =
  | ({ kind: "tweet"; quoted?: Tweet } & Tweet)
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

/** Pull one tweet from oEmbed. Returns the body plus every link inside it, because
 *  a quote tweet's target is only present as a trailing t.co link. */
async function fetchTweet(url: string): Promise<{ tweet: Tweet; links: string[] } | null> {
  const oembed = new URL("https://publish.twitter.com/oembed");
  oembed.searchParams.set("url", url);
  oembed.searchParams.set("omit_script", "1");
  oembed.searchParams.set("hide_thread", "1");
  oembed.searchParams.set("dnt", "true");

  const r = await fetch(oembed.toString(), {
    signal: AbortSignal.timeout(4000),
    headers: { accept: "application/json" },
  });
  if (!r.ok) return null;
  const j = await r.json();
  const html = String(j.html || "");

  const body = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(html);
  if (!body) return null;
  const inner = body[1];
  const links = [...inner.matchAll(/href="(https:\/\/t\.co\/[^"]+)"/g)].map((m) => m[1]);
  // Twitter appends a bare "pic.twitter.com/xxxx" for attached media. It isn't part
  // of what the author wrote and there's no image to show it next to.
  const text = decodeEntities(inner).replace(/\s*pic\.twitter\.com\/\w+\s*$/i, "").trim();
  if (!text) return null;

  const authorUrl = String(j.author_url || "");
  return {
    tweet: {
      text,
      author: String(j.author_name || ""),
      handle: authorUrl.split("/").filter(Boolean).pop() || "",
      url,
    },
    links,
  };
}

/** t.co hides the destination, so a quoted tweet can only be found by following the
 *  redirect. HEAD, one hop, short timeout — this runs on a hover. */
async function resolveShortLink(link: string): Promise<string | null> {
  try {
    const r = await fetch(link, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(2500),
    });
    return r.url || null;
  } catch {
    return null;
  }
}

function statusId(u: string): string | null {
  try {
    const p = new URL(u);
    if (!TWITTER_HOSTS.has(p.hostname.toLowerCase())) return null;
    const seg = p.pathname.split("/").filter(Boolean);
    const i = seg.findIndex((s) => s === "status" || s === "statuses");
    return i >= 1 && /^\d+$/.test(seg[i + 1] || "") ? seg[i + 1] : null;
  } catch {
    return null;
  }
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
    const main = await fetchTweet(target.toString());
    if (!main) throw new Error("no body");

    // A quote tweet shows up as a trailing t.co link pointing at another status.
    // Resolve at most two candidates and stop at the first that is one — a tweet can
    // legitimately link to articles, images and its own permalink too.
    const selfId = statusId(target.toString());
    let quoted: Tweet | undefined;
    for (const link of main.links.slice(-2).reverse()) {
      const dest = await resolveShortLink(link);
      if (!dest) continue;
      const id = statusId(dest);
      if (!id || id === selfId) continue;
      const q = await fetchTweet(dest);
      if (q) {
        quoted = q.tweet;
        // Twitter appends the quoted permalink to the body; it's redundant once the
        // quoted tweet is rendered underneath.
        main.tweet.text = main.tweet.text.replace(link, "").trim();
      }
      break;
    }

    const preview: Preview = {
      kind: "tweet",
      ...main.tweet,
      author: main.tweet.author || handle,
      handle: main.tweet.handle || handle,
      quoted,
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
