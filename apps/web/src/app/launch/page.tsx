"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Rocket, Upload, Loader2, Check, Copy, ExternalLink } from "lucide-react";
import { useMobileWalletStore } from "@/stores/mobileWalletStore";
import { useThemeStore } from "@/stores/themeStore";
import { executeClientPumpCreate } from "@/lib/mobileSwap";
import { shortenAddress } from "@/lib/wallet";

type Phase = "form" | "uploading" | "signing" | "done";

export default function LaunchPage() {
  const router = useRouter();
  const { isDark } = useThemeStore();
  const { wallet } = useMobileWalletStore();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [website, setWebsite] = useState("");
  const [devBuy, setDevBuy] = useState("0");
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ mint: string; explorerUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const onPickImage = (f: File | null) => {
    setImage(f);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  const launch = async () => {
    setError("");
    if (!wallet?.publicKey) {
      router.push("/");
      return;
    }
    if (!name.trim() || !symbol.trim() || !image) {
      setError("Name, ticker and an image are required.");
      return;
    }
    const buy = Number(devBuy) || 0;
    if (buy < 0 || buy > 10) {
      setError("Initial buy must be between 0 and 10 SOL.");
      return;
    }

    try {
      // 1. Metadata to IPFS (proxied — pump.fun blocks browser CORS)
      setPhase("uploading");
      const form = new FormData();
      form.set("file", image);
      form.set("name", name.trim());
      form.set("symbol", symbol.trim().toUpperCase());
      form.set("description", description.trim());
      if (twitter.trim()) form.set("twitter", twitter.trim());
      if (telegram.trim()) form.set("telegram", telegram.trim());
      if (website.trim()) form.set("website", website.trim());
      const up = await fetch("/api/launch/ipfs", { method: "POST", body: form });
      const upJson = await up.json();
      if (!up.ok || !upJson.metadataUri) throw new Error(upJson.error || "Metadata upload failed");

      // 2. Create + sign on this device
      setPhase("signing");
      const mnemonic = await useMobileWalletStore.getState().getMnemonic();
      if (!mnemonic) throw new Error("Wallet locked — re-import your recovery phrase to launch.");
      const res = await executeClientPumpCreate(
        mnemonic,
        { name: name.trim(), symbol: symbol.trim().toUpperCase(), metadataUri: upJson.metadataUri },
        buy
      );
      setResult({ mint: res.mint, explorerUrl: res.explorerUrl });
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Launch failed");
      setPhase("form");
    }
  };

  const copyMint = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.mint);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const card = `rounded-2xl border ${isDark ? "bg-white/[0.04] border-white/10" : "bg-white border-black/10"}`;
  const label = `text-[11px] font-semibold uppercase tracking-[0.14em] ${isDark ? "text-white/50" : "text-black/50"}`;
  const input = `mt-1.5 w-full px-3.5 py-2.5 text-sm rounded-xl border outline-none transition-colors focus:border-[#FF6B4A]/50 ${
    isDark ? "bg-white/5 border-white/10 text-white placeholder-white/25" : "bg-white border-gray-200 text-gray-900 placeholder-gray-400"
  }`;

  const busy = phase === "uploading" || phase === "signing";

  return (
    <div className={`mx-auto max-w-md space-y-4 ${isDark ? "text-white" : "text-gray-900"}`}>
      <div className="px-1 pt-1">
        <h1 className="text-lg md:text-2xl font-bold">Launch</h1>
        <p className={`text-xs md:text-sm ${isDark ? "text-white/50" : "text-gray-500"}`}>
          Create a token on pump.fun — signed on this device, straight into Pulse
        </p>
      </div>

      {phase === "done" && result ? (
        <div className={`${card} p-6 text-center space-y-4`}>
          <Check className="h-12 w-12 mx-auto text-up" />
          <div>
            <p className="text-lg font-semibold">{name} is live</p>
            <p className={`mt-1 text-sm ${isDark ? "text-white/50" : "text-gray-500"}`}>
              ${symbol.toUpperCase()} is trading on its bonding curve now
            </p>
          </div>

          <button
            onClick={copyMint}
            className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border text-sm font-mono transition-colors ${
              isDark ? "bg-white/5 border-white/10 hover:bg-white/10" : "bg-gray-50 border-gray-200 hover:bg-gray-100"
            }`}
          >
            <span className="truncate">{shortenAddress(result.mint, 8)}</span>
            {copied ? <Check className="h-4 w-4 text-up shrink-0" /> : <Copy className="h-4 w-4 opacity-50 shrink-0" />}
          </button>

          <div className="flex gap-2">
            <button
              onClick={() => router.push(`/token/${result.mint}?source=pulse`)}
              className="flex-1 py-3 rounded-xl text-sm font-semibold bg-[#FF6B4A] text-white hover:bg-[#FF8F6B] transition-colors"
            >
              Open chart
            </button>
            <a
              href={result.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center justify-center gap-1.5 px-4 rounded-xl border text-sm transition-colors ${
                isDark ? "border-white/10 text-white/60 hover:bg-white/5" : "border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              Tx <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      ) : (
        <div className={`${card} p-5 space-y-4`}>
          {/* Image + name/ticker */}
          <div className="flex gap-4">
            <button
              onClick={() => fileRef.current?.click()}
              className={`relative h-24 w-24 shrink-0 rounded-2xl border border-dashed overflow-hidden flex flex-col items-center justify-center gap-1 transition-colors ${
                isDark ? "border-white/20 hover:border-[#FF6B4A]/50 text-white/40" : "border-gray-300 hover:border-[#FF6B4A]/50 text-gray-400"
              }`}
            >
              {preview ? (
                <Image src={preview} alt="token" fill className="object-cover" unoptimized />
              ) : (
                <>
                  <Upload className="h-5 w-5" />
                  <span className="text-[10px]">Image</span>
                </>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onPickImage(e.target.files?.[0] ?? null)}
            />
            <div className="flex-1 space-y-3">
              <div>
                <label className={label}>Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="My Coin" className={input} />
              </div>
              <div>
                <label className={label}>Ticker</label>
                <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} maxLength={10} placeholder="COIN" className={`${input} font-mono`} />
              </div>
            </div>
          </div>

          <div>
            <label className={label}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="What is this coin?"
              className={`${input} resize-none`}
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={label}>Twitter</label>
              <input value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="optional" className={input} />
            </div>
            <div>
              <label className={label}>Telegram</label>
              <input value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="optional" className={input} />
            </div>
            <div>
              <label className={label}>Website</label>
              <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="optional" className={input} />
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label className={label}>Initial buy (SOL)</label>
              <span className={`text-[10px] ${isDark ? "text-white/30" : "text-gray-400"}`}>
                your first buy on the fresh curve — 0 is fine
              </span>
            </div>
            <input
              type="number"
              min={0}
              max={10}
              step={0.05}
              value={devBuy}
              onChange={(e) => setDevBuy(e.target.value)}
              className={`${input} font-mono`}
            />
          </div>

          {error && (
            <div className="text-sm text-down bg-down/10 border border-down/20 rounded-xl px-3 py-2">{error}</div>
          )}

          <button
            onClick={launch}
            disabled={busy}
            className="w-full py-3 rounded-xl text-sm font-semibold bg-[#FF6B4A] text-white hover:bg-[#FF8F6B] transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {phase === "uploading" ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Uploading metadata…</>
            ) : phase === "signing" ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Launching on-chain…</>
            ) : (
              <><Rocket className="h-4 w-4" /> Launch token</>
            )}
          </button>

          <p className={`text-[11px] leading-relaxed ${isDark ? "text-white/30" : "text-gray-400"}`}>
            Creates a real token on pump.fun&apos;s bonding curve. The create transaction is signed on this
            device and costs ~0.02 SOL in network fees plus your initial buy.
          </p>
        </div>
      )}
    </div>
  );
}
