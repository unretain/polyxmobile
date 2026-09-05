"use client";

/**
 * Social links under a pulse row's ticker. Hover the bird to read the coin's tweet
 * without leaving the list; click any icon to open it.
 *
 * Three details that matter here:
 *  - The card is rendered through a PORTAL onto document.body. position:fixed alone
 *    was not enough: the pulse column is `backdrop-blur-md overflow-hidden`, and a
 *    filtered element becomes the containing block for fixed descendants AND clips
 *    them. So the card was positioned against the column instead of the viewport and
 *    then cropped away — which is why hovering appeared to do nothing at all.
 *  - The card must be measured and placed from the icon's viewport rect, resolved
 *    once into a final top-left (see open()).
 *  - The row is a <Link>, so these cannot be <a> (nested anchors are invalid and
 *    React strips them). They're buttons that stop propagation and open the tab.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePulsePauseStore, usePulseColumn } from "@/stores/pulsePauseStore";

interface Tweet {
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

const CARD_W = 340;
const CARD_MAX_H = 380;

// Shared across rows and across re-renders: the same coin re-enters the list on
// every websocket snapshot, and a tweet doesn't change.
const cache = new Map<string, Preview>();
const inflight = new Map<string, Promise<Preview | null>>();

function load(url: string): Promise<Preview | null> {
  const hit = cache.get(url);
  if (hit) return Promise.resolve(hit);
  const running = inflight.get(url);
  if (running) return running;
  const p = fetch(`/api/pulse/tweet?url=${encodeURIComponent(url)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j: Preview | null) => {
      if (j) cache.set(url, j);
      return j;
    })
    .catch(() => null)
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

const BirdIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="h-3 w-3 fill-current">
    <path d="M23.643 4.937c-.835.37-1.732.62-2.675.733a4.67 4.67 0 0 0 2.048-2.578 9.3 9.3 0 0 1-2.958 1.13 4.66 4.66 0 0 0-7.938 4.25 13.229 13.229 0 0 1-9.602-4.868c-.4.69-.63 1.49-.63 2.342A4.66 4.66 0 0 0 3.96 9.824a4.647 4.647 0 0 1-2.11-.583v.06a4.66 4.66 0 0 0 3.737 4.568 4.692 4.692 0 0 1-2.104.08 4.661 4.661 0 0 0 4.352 3.234 9.348 9.348 0 0 1-5.786 1.995 9.5 9.5 0 0 1-1.112-.065 13.175 13.175 0 0 0 7.14 2.093c8.57 0 13.255-7.098 13.255-13.254 0-.2-.005-.402-.014-.602a9.47 9.47 0 0 0 2.323-2.41z" />
  </svg>
);

const TgIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="h-3 w-3 fill-current">
    <path d="M11.99 0C5.37 0 0 5.37 0 12s5.37 12 11.99 12C18.62 24 24 18.63 24 12S18.62 0 11.99 0zm5.57 8.16-1.86 8.77c-.14.62-.51.77-1.03.48l-2.85-2.1-1.37 1.32c-.15.15-.28.28-.58.28l.21-2.93 5.34-4.82c.23-.21-.05-.32-.36-.12L8.46 12.6l-2.84-.89c-.62-.19-.63-.62.13-.92l11.1-4.28c.51-.19.96.12.71 1.65z" />
  </svg>
);

const WebIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="h-3 w-3 fill-none stroke-current" strokeWidth="2">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
  </svg>
);

/** One tweet: author line, text, any attached images, and the tweet it quotes.
 *  Plain img on purpose — these are pbs.twimg.com URLs the browser loads directly,
 *  and next/image would route them through the optimizer for no benefit. */
function TweetBody({ t, quoted, isDark }: { t: Tweet; quoted?: Tweet; isDark: boolean }) {
  return (
    <>
      <div className="flex items-center gap-1.5 mb-1.5">
        {t.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.avatar} alt="" className="h-4 w-4 rounded-full object-cover flex-shrink-0" />
        ) : (
          <span className="text-[#1D9BF0]"><BirdIcon /></span>
        )}
        <span className="font-semibold truncate">{t.author}</span>
        <span className={`truncate ${isDark ? "text-white/30" : "text-gray-400"}`}>@{t.handle}</span>
      </div>
      {/* Server-decoded plain text — never third-party markup. */}
      {t.text && <p className="whitespace-pre-wrap break-words leading-snug line-clamp-6">{t.text}</p>}
      {!!t.media?.length && (
        <div className={`mt-2 grid gap-1 ${t.media.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
          {t.media.slice(0, 4).map((m) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={m} src={m} alt="" loading="lazy" className="w-full max-h-40 object-cover border border-white/10" />
          ))}
        </div>
      )}
      {/* Quote tweets: the coin's pitch is often entirely in the tweet it quotes,
          so the outer one alone tells you nothing. */}
      {quoted && (
        <div className={`mt-2 border-l-2 pl-2 ${isDark ? "border-white/15" : "border-gray-300"}`}>
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`font-semibold truncate ${isDark ? "text-white/70" : "text-gray-600"}`}>{quoted.author}</span>
            <span className={`truncate ${isDark ? "text-white/25" : "text-gray-400"}`}>@{quoted.handle}</span>
          </div>
          <p className={`whitespace-pre-wrap break-words leading-snug line-clamp-6 ${isDark ? "text-white/60" : "text-gray-500"}`}>
            {quoted.text}
          </p>
          {!!quoted.media?.length && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={quoted.media[0]} alt="" loading="lazy" className="mt-1 w-full max-h-28 object-cover border border-white/10" />
          )}
        </div>
      )}
    </>
  );
}

/** Open in a new tab without triggering the row <Link> underneath. */
function useOpenTab() {
  return useCallback((url: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);
}

/** Bird + telegram + website, whichever the coin actually has. */
export function SocialIcons({
  twitter, telegram, website, isDark,
}: { twitter?: string; telegram?: string; website?: string; isDark: boolean }) {
  const openTab = useOpenTab();
  if (!twitter && !telegram && !website) return null;
  const dim = isDark ? "text-white/35" : "text-gray-400";
  return (
    <span className="inline-flex items-center gap-1.5">
      {twitter && <TweetHover url={twitter} isDark={isDark} />}
      {telegram && (
        <button
          type="button"
          onClick={openTab(telegram)}
          aria-label="Telegram"
          className={`transition-colors hover:text-[#229ED9] ${dim}`}
        >
          <TgIcon />
        </button>
      )}
      {website && (
        <button
          type="button"
          onClick={openTab(website)}
          aria-label="Website"
          className={`transition-colors hover:text-[#FF6B4A] ${dim}`}
        >
          <WebIcon />
        </button>
      )}
    </span>
  );
}

export function TweetHover({ url, isDark }: { url: string; isDark: boolean }) {
  const [preview, setPreview] = useState<Preview | null>(() => cache.get(url) ?? null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setCardOpen = usePulsePauseStore((s) => s.setCardOpen);
  // Which column this row lives in, so opening a card holds THAT column only.
  const column = usePulseColumn();

  // document.body doesn't exist during SSR; the portal can only mount client-side.
  useEffect(() => setMounted(true), []);

  const open = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Resolve the FINAL top-left here and render with left/top only.
    //
    // The previous version stored y as either a top or a bottom depending on which
    // way it flipped, then re-derived "did I flip?" from `y < 200` at render — which
    // is a different question entirely. Any row in the top 200px of the viewport was
    // treated as flipped when it wasn't, and the card landed nowhere near its bird.
    //
    // Sits to the RIGHT of the icon so it never covers the row you're pointing at,
    // falling back to the left side when that would run off the edge.
    const M = 8;
    let left = r.right + M;
    if (left + CARD_W > window.innerWidth - M) left = r.left - CARD_W - M;
    if (left < M) left = Math.max(M, window.innerWidth - CARD_W - M);
    let top = r.top - 8;
    if (top + CARD_MAX_H > window.innerHeight - M) top = window.innerHeight - CARD_MAX_H - M;
    setPos({ x: left, y: Math.max(M, top) });
    setCardOpen(column);
    load(url).then((p) => p && setPreview(p));
  }, [url, setCardOpen, column]);

  const close = useCallback(() => {
    closeTimer.current = setTimeout(() => {
      setPos(null);
      setCardOpen(null);
    }, 80);
  }, [setCardOpen]);

  // Releasing the pause on unmount matters: the list is frozen while the card is
  // open, and a frozen list is exactly what stops this row from being unmounted —
  // but a filter change or tab switch can still pull it, and the board would then
  // stay stuck forever with no pointer anywhere near it.
  useEffect(() => () => setCardOpen(null), [setCardOpen]);

  const openTab = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        onMouseEnter={open}
        onMouseLeave={close}
        onClick={openTab}
        aria-label="View tweet"
        className={`transition-colors ${isDark ? "text-white/35 hover:text-[#1D9BF0]" : "text-gray-400 hover:text-[#1D9BF0]"}`}
      >
        <BirdIcon />
      </button>

      {pos && mounted && createPortal(
        <div
          onMouseEnter={() => closeTimer.current && clearTimeout(closeTimer.current)}
          onMouseLeave={close}
          onClick={openTab}
          style={{
            position: "fixed",
            left: pos.x,
            top: pos.y,
            width: CARD_W,
            maxHeight: CARD_MAX_H,
            overflowY: "auto",
            zIndex: 2147483000, // above the pulse chrome, whatever it stacks at
          }}
          className={`border p-3 shadow-2xl cursor-pointer text-xs ${
            isDark ? "bg-[#111] border-white/10 text-white/80" : "bg-white border-gray-200 text-gray-700"
          }`}
        >
          {!preview ? (
            <div className={isDark ? "text-white/30" : "text-gray-400"}>loading tweet…</div>
          ) : preview.kind === "tweet" ? (
            <TweetBody t={preview} quoted={preview.quoted} isDark={isDark} />
          ) : preview.kind === "profile" ? (
            preview.latest ? (
              <>
                <div className={`mb-1.5 text-[10px] uppercase tracking-wide ${isDark ? "text-white/30" : "text-gray-400"}`}>
                  latest from @{preview.handle}
                </div>
                <TweetBody t={preview.latest} isDark={isDark} />
              </>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="text-[#1D9BF0]"><BirdIcon /></span>
                <span>@{preview.handle}</span>
                <span className={isDark ? "text-white/30" : "text-gray-400"}>· profile</span>
              </div>
            )
          ) : (
            <div className="truncate">{preview.url}</div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
