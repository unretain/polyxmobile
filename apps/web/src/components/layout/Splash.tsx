"use client";

import { useEffect, useState } from "react";

/**
 * Branded splash shown on every full page load (not SPA navigations — this
 * component mounts once per document). Fades out as soon as the app has
 * hydrated, so it costs ~400ms of brand instead of a flash of empty page.
 */
export function Splash() {
  const [phase, setPhase] = useState<"visible" | "fading" | "gone">("visible");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("fading"), 350);
    const t2 = setTimeout(() => setPhase("gone"), 750);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  if (phase === "gone") return null;

  return (
    <div
      className={`fixed inset-0 z-[200] flex items-center justify-center bg-[#0a0a0a] transition-opacity duration-400 ${
        phase === "fading" ? "opacity-0" : "opacity-100"
      }`}
      style={{ pointerEvents: phase === "fading" ? "none" : "auto" }}
    >
      <span className="text-4xl font-bold tracking-tight text-white">
        [poly<span className="text-[#FF6B4A]">x</span>]
      </span>
    </div>
  );
}
