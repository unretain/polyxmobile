"use client";

/**
 * Filters panel for the pulse lists. One tab per column, each with its own saved set,
 * so "New Pairs" can be wide open while "Migrated" is narrowed to coins still doing
 * volume. Values persist in localStorage.
 */
import { useState } from "react";
import {
  PulseFilter, PulseFilters, TabKey, Range,
  EMPTY_FILTER, activeCount,
} from "@/lib/pulseFilters";

const TABS: { key: TabKey; label: string }[] = [
  { key: "new", label: "New Pairs" },
  { key: "final", label: "Final Stretch" },
  { key: "migrated", label: "Migrated" },
];

const FIELDS: { key: keyof PulseFilter; label: string }[] = [
  { key: "liquidity", label: "Liquidity ($)" },
  { key: "volume", label: "Volume ($)" },
  { key: "marketCap", label: "Market Cap ($)" },
  { key: "curve", label: "B. curve %" },
  { key: "fees", label: "Global Fees Paid (SOL)" },
  { key: "txns", label: "Txns" },
  { key: "buys", label: "Num Buys" },
  { key: "sells", label: "Num Sells" },
];

interface Props {
  filters: PulseFilters;
  onChange: (f: PulseFilters) => void;
  onClose: () => void;
  isDark: boolean;
}

export function FiltersPanel({ filters, onChange, onClose, isDark }: Props) {
  const [tab, setTab] = useState<TabKey>("new");
  // Edited locally, committed on Apply — so half-typed bounds don't thrash the lists.
  const [draft, setDraft] = useState<PulseFilters>(filters);
  const cur = draft[tab];

  const setField = (key: keyof PulseFilter, value: any) =>
    setDraft({ ...draft, [tab]: { ...cur, [key]: value } });

  const setBound = (key: keyof PulseFilter, bound: keyof Range, raw: string) => {
    const r = { ...(cur[key] as Range) };
    const n = raw === "" ? undefined : Number(raw);
    if (n === undefined || Number.isNaN(n)) delete r[bound];
    else r[bound] = n;
    setField(key, r);
  };

  const input = isDark
    ? "bg-black/40 border-white/10 text-white placeholder-white/30"
    : "bg-black/5 border-black/10 text-black placeholder-black/30";
  const panel = isDark ? "bg-[#0d0d12] border-white/10 text-white" : "bg-white border-black/10 text-black";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[6vh] px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full max-w-md rounded-2xl border shadow-2xl ${panel} max-h-[85vh] flex flex-col`}>
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-inherit">
          <h2 className="text-base font-semibold">Filters</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDraft({ ...draft, [tab]: { ...EMPTY_FILTER } })}
              className="text-xs opacity-60 hover:opacity-100"
              title="Reset this tab"
            >
              Reset
            </button>
            <button onClick={onClose} className="opacity-60 hover:opacity-100 text-lg leading-none">×</button>
          </div>
        </div>

        {/* tabs */}
        <div className="flex gap-1 px-3 pt-3">
          {TABS.map((t) => {
            const n = activeCount(draft[t.key]);
            const on = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition flex items-center justify-center gap-1.5 ${
                  on
                    ? isDark ? "bg-white/10" : "bg-black/10"
                    : "opacity-60 hover:opacity-100"
                }`}
              >
                {t.label}
                {n > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/80 text-white">{n}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* body */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] mb-1.5 opacity-60">Search Keywords</label>
              <input
                value={cur.search}
                onChange={(e) => setField("search", e.target.value)}
                placeholder="keyword1, keyword2..."
                className={`w-full px-3 py-2 rounded-lg border text-sm outline-none ${input}`}
              />
            </div>
            <div>
              <label className="block text-[11px] mb-1.5 opacity-60">Exclude Keywords</label>
              <input
                value={cur.exclude}
                onChange={(e) => setField("exclude", e.target.value)}
                placeholder="rug, test..."
                className={`w-full px-3 py-2 rounded-lg border text-sm outline-none ${input}`}
              />
            </div>
          </div>

          {FIELDS.map((f) => {
            const r = cur[f.key] as Range;
            return (
              <div key={String(f.key)}>
                <label className="block text-[11px] mb-1.5 opacity-60">{f.label}</label>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={r.min ?? ""}
                    onChange={(e) => setBound(f.key, "min", e.target.value)}
                    placeholder="Min"
                    className={`w-full px-3 py-2 rounded-lg border text-sm outline-none ${input}`}
                  />
                  <input
                    type="number"
                    inputMode="decimal"
                    value={r.max ?? ""}
                    onChange={(e) => setBound(f.key, "max", e.target.value)}
                    placeholder="Max"
                    className={`w-full px-3 py-2 rounded-lg border text-sm outline-none ${input}`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-inherit">
          <button
            onClick={() => setDraft({ new: { ...EMPTY_FILTER }, final: { ...EMPTY_FILTER }, migrated: { ...EMPTY_FILTER } })}
            className="text-xs opacity-60 hover:opacity-100"
          >
            Clear all
          </button>
          <button
            onClick={() => { onChange(draft); onClose(); }}
            className="px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition"
          >
            Apply All
          </button>
        </div>
      </div>
    </div>
  );
}
