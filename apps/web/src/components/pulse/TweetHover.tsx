"use client";

/**
 * The bird under a pulse row's ticker. Hover it to read the coin's tweet without
 * leaving the list; click to open it.
 *
 * Two details that matter here:
 *  - The card is position:fixed, not absolute. Pulse columns scroll (overflow-y-auto),
 *    and an absolutely positioned card is clipped by that ancestor — it would be cut
 *    off for every row except the middle ones.
 *  - The row is a <Link>, so this cannot be an <a> (nested anchors are invalid and
 *    React strips them). It's a button that stops propagation and opens the tab.
 */
import { useCallback, useRef, useState } from "react";

type Preview =
  | { kind: "tweet"; text: string; author: string; handle: string; url: string }
  | { kind: "profile"; handle: string; url: string }
  | { kind: "link"; url: string };

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

export function TweetHover({ url, isDark }: { url: string; isDark: boolean }) {
  const [preview, setPreview] = useState<Preview | null>(() => cache.get(url) ?? null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Flip above the icon when there isn't room below, so rows near the bottom of
    // the viewport still show the whole card.
    const below = window.innerHeight - r.bottom > 200;
    setPos({ x: Math.min(r.left, window.innerWidth - 340), y: below ? r.bottom + 6 : r.top - 6 });
    load(url).then((p) => p && setPreview(p));
  }, [url]);

  const close = useCallback(() => {
    closeTimer.current = setTimeout(() => setPos(null), 80);
  }, []);

  const openTab = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const flipped = pos !== null && pos.y < 200;

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

      {pos && (
        <div
          onMouseEnter={() => closeTimer.current && clearTimeout(closeTimer.current)}
          onMouseLeave={close}
          onClick={openTab}
          style={{
            position: "fixed",
            left: pos.x,
            top: flipped ? undefined : pos.y,
            bottom: flipped ? window.innerHeight - pos.y : undefined,
            width: 320,
          }}
          className={`z-[100] border p-3 shadow-2xl cursor-pointer text-xs ${
            isDark ? "bg-[#111] border-white/10 text-white/80" : "bg-white border-gray-200 text-gray-700"
          }`}
        >
          {!preview ? (
            <div className={isDark ? "text-white/30" : "text-gray-400"}>loading tweet…</div>
          ) : preview.kind === "tweet" ? (
            <>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[#1D9BF0]">
                  <BirdIcon />
                </span>
                <span className="font-semibold truncate">{preview.author}</span>
                <span className={isDark ? "text-white/30" : "text-gray-400"}>@{preview.handle}</span>
              </div>
              {/* Server-decoded plain text — never third-party markup. */}
              <p className="whitespace-pre-wrap break-words leading-snug line-clamp-6">{preview.text}</p>
            </>
          ) : preview.kind === "profile" ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[#1D9BF0]">
                <BirdIcon />
              </span>
              <span>@{preview.handle}</span>
              <span className={isDark ? "text-white/30" : "text-gray-400"}>· profile, not a tweet</span>
            </div>
          ) : (
            <div className="truncate">{preview.url}</div>
          )}
        </div>
      )}
    </>
  );
}
