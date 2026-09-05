/**
 * Tweet preview for the pulse rows' bird icon.
 *
 * A coin's metadata "twitter" field is whatever the deployer typed: a single tweet,
 * a profile, a community, or junk. Each is handled separately.
 *
 * PRIMARY SOURCE is Twitter's syndication endpoint (cdn.syndication.twimg.com), the
 * one embedded tweets use. It needs no key and returns structured JSON — text,
 * author, avatar, media, and the QUOTED TWEET inline. That last part is why it
 * replaced oEmbed here: oEmbed exposes a quote only as a trailing t.co link, so
 * showing it meant a HEAD to unwrap the link plus a second oEmbed — three round
 * trips, ~1.5-2.3s. This is one call at ~120-450ms. oEmbed stays as a fallback.
 *
 * Nothing third-party is returned as markup; the client renders plain fields.
 */
import { NextRequest, NextResponse } from "next/server";

// Hosts we will act on. The url comes from on-chain token metadata, i.e. from anyone
// who can pay to deploy a coin — without this it's an open proxy.
const TWITTER_HOSTS = new Set([
  "twitter.com", "www.twitter.com", "mobile.twitter.com",
  "x.com", "www.x.com", "mobile.x.com",
]);

// Reserved path segments that are not usernames.
const NOT_HANDLES = new Set(["i", "intent", "share", "home", "search", "hashtag", "explore", "messages"]);

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export interface Tweet {
  text: string;
  author: string;
  handle: string;
  url: string;
  avatar?: string;
  media?: string[];
}

type Preview =
  | ({ kind: "tweet"; quoted?: Tweet } & Tweet)
  | { kind: "profile"; handle: string; url: string; author?: string; avatar?: string; latest?: Tweet }
  | { kind: "link"; url: string };

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

/**
 * Trim the trailing t.co that Twitter appends for attached media or a quoted tweet.
 * `display_text_range` is the authoritative answer and is measured in CODE POINTS,
 * so it must be sliced off the spread array, not with String.slice.
 */
function displayText(t: any): string {
  const raw = String(t?.text || "");
  const r = t?.display_text_range;
  if (Array.isArray(r) && r.length === 2 && Number.isFinite(r[1])) {
    const cps = [...raw];
    const out = cps.slice(Number(r[0]) || 0, Number(r[1])).join("").trim();
    if (out) return out;
  }
  return raw.replace(/\s*https:\/\/t\.co\/\w+\s*$/i, "").trim();
}

function photos(t: any): string[] {
  return (t?.mediaDetails || [])
    .filter((m: any) => m?.media_url_https)
    .map((m: any) => String(m.media_url_https))
    .slice(0, 4);
}

function toTweet(t: any, url: string): Tweet {
  return {
    text: displayText(t),
    author: String(t?.user?.name || ""),
    handle: String(t?.user?.screen_name || ""),
    url,
    avatar: t?.user?.profile_image_url_https ? String(t.user.profile_image_url_https) : undefined,
    media: photos(t),
  };
}

/** One keyless call: text, author, avatar, media, and the quoted tweet. */
async function fromSyndication(id: string, url: string): Promise<Preview | null> {
  const r = await fetch(
    `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(id)}&lang=en&token=a`,
    { signal: AbortSignal.timeout(5000), headers: { "user-agent": UA, accept: "application/json" } }
  );
  if (!r.ok) return null;
  const j = await r.json();
  if (!j || (!j.text && !(j.mediaDetails || []).length)) return null;
  const main = toTweet(j, url);
  const q = j.quoted_tweet;
  return {
    kind: "tweet",
    ...main,
    quoted: q
      ? toTweet(q, `https://x.com/${q?.user?.screen_name || "i"}/status/${q?.id_str || ""}`)
      : undefined,
  };
}

/** Fallback: the public oEmbed endpoint. No media, no avatar, no quoted tweet. */
async function fromOEmbed(url: string, handle: string): Promise<Preview | null> {
  const o = new URL("https://publish.twitter.com/oembed");
  o.searchParams.set("url", url);
  o.searchParams.set("omit_script", "1");
  o.searchParams.set("hide_thread", "1");
  o.searchParams.set("dnt", "true");
  const r = await fetch(o.toString(), {
    signal: AbortSignal.timeout(4000),
    headers: { accept: "application/json" },
  });
  if (!r.ok) return null;
  const j = await r.json();
  const body = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(String(j.html || ""));
  if (!body) return null;
  const text = decodeEntities(body[1]).replace(/\s*pic\.twitter\.com\/\w+\s*$/i, "").trim();
  if (!text) return null;
  const authorUrl = String(j.author_url || "");
  return {
    kind: "tweet",
    text,
    author: String(j.author_name || handle),
    handle: authorUrl.split("/").filter(Boolean).pop() || handle,
    url,
  };
}

/**
 * Best-effort newest tweet for a PROFILE link (a large share of coin metadata points
 * at a profile, not a post). There is no keyless API for this: oEmbed on a profile
 * returns only a bare "Posts by @x" link, and the syndication timeline is heavily
 * rate limited — it answered 429 on the first try from here. So this is attempted
 * cheaply and the card falls back to showing the profile itself.
 *
 * An X API bearer token would make this reliable and is the right fix if profiles
 * matter: GET /2/users/by/username/:handle?expansions=pinned_tweet_id.
 */
async function profileLatest(handle: string): Promise<Tweet | undefined> {
  try {
    const r = await fetch(
      `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(handle)}`,
      { signal: AbortSignal.timeout(3000), headers: { "user-agent": UA } }
    );
    if (!r.ok) return undefined;
    const html = await r.text();
    const m = /<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
    if (!m) return undefined;
    const data = JSON.parse(m[1]);
    const entries = data?.props?.pageProps?.timeline?.entries || [];
    const first = entries.find((e: any) => e?.content?.tweet)?.content?.tweet;
    if (!first) return undefined;
    return toTweet(first, `https://x.com/${handle}/status/${first.id_str || ""}`);
  } catch {
    return undefined;
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
  const id = statusIdx >= 1 && /^\d+$/.test(segments[statusIdx + 1] || "") ? segments[statusIdx + 1] : "";

  // Profile (or community/search) link — no single tweet to show.
  if (!id) {
    if (!handle) {
      return NextResponse.json({ kind: "link", url: target.toString() } as Preview, {
        headers: { "Cache-Control": "public, max-age=3600" },
      });
    }
    const latest = await profileLatest(handle);
    return NextResponse.json(
      { kind: "profile", handle, url: target.toString(), latest, avatar: latest?.avatar } as Preview,
      { headers: { "Cache-Control": `public, max-age=${latest ? 900 : 300}` } }
    );
  }

  try {
    const preview =
      (await fromSyndication(id, target.toString())) ??
      (await fromOEmbed(target.toString(), handle));
    if (!preview) throw new Error("no tweet");
    // Tweets are immutable enough to cache hard; this is hovered a lot.
    return NextResponse.json(preview, { headers: { "Cache-Control": "public, max-age=86400" } });
  } catch {
    // Deleted, protected, or both sources being slow — degrade to a plain link
    // rather than showing an error inside a hover card.
    const fallback: Preview = handle
      ? { kind: "profile", handle, url: target.toString() }
      : { kind: "link", url: target.toString() };
    return NextResponse.json(fallback, { headers: { "Cache-Control": "public, max-age=60" } });
  }
}
