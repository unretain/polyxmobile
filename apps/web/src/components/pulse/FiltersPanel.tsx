"use client";

/**
 * Filters panel for the pulse lists. One tab per column, each with its own saved set,
 * so "New Pairs" can stay wide open while "Migrated" is narrowed to coins still doing
 * volume. Values persist in localStorage.
 *
 * Styling follows the pulse page's own conventions: square corners, bg-[#111] on a
 * blurred black backdrop, #FF6B4A as the accent, white//black alpha borders.
 */
import { useState } from "react";
import { X } from "lucide-react";
import {
  PulseFilter, PulseFilters, TabKey, Range,
  EMPTY_FILTER, activeCount,
} from "@/lib/pulseFilters";

const TABS: { key: TabKey; label: string }[] = [
  { key: "new", label: "new pairs" },
  { key: "final", label: "final stretch" },
  { key: "migrated", label: "migrated" },
];

const FIELDS: { key: keyof PulseFilter; label: string }[] = [
  { key: "liquidity", label: "Liquidity ($)" },
  { key: "volume", label: "Volume ($)" },
  { key: "marketCap", label: "Market Cap ($)" },
  { key: "curve", label: "B. curve %" },
  { key: "fees", label: "Global Fees Paid (SOL)" },
  { key: "age", label: "Age (minutes)" },
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
  // Edited locally and committed on Apply, so half-typed bounds don't thrash the lists.
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

  const field = `w-full px-3 py-2 text-sm border outline-none transition-colors focus:border-[#FF6B4A]/50 ${
    isDark
      ? "bg-white/5 border-white/10 text-white placeholder-white/30"
      : "bg-black/5 border-gray-200 text-gray-900 placeholder-gray-400"
  }`;
  const label = `block text-[11px] mb-1.5 ${isDark ? "text-white/40" : "text-gray-500"}`;
  const divide = isDark ? "border-white/10" : "border-gray-200";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh]">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 backdrop-blur-sm ${isDark ? "bg-black/60" : "bg-black/40"}`}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className={`relative w-full max-w-2xl mx-4 border shadow-2xl flex flex-col max-h-[80vh] ${
          isDark ? "bg-[#111] border-white/10" : "bg-white border-gray-200"
        }`}
      >
        {/* Header */}
        <div className={`flex items-center justify-between p-4 border-b ${divide}`}>
          <h2 className="text-sm font-bold text-[#FF6B4A]">[filters]</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDraft({ ...draft, [tab]: { ...EMPTY_FILTER } })}
              className={`text-xs transition-colors ${
                isDark ? "text-white/40 hover:text-white/70" : "text-gray-400 hover:text-gray-700"
              }`}
            >
              reset tab
            </button>
            <button onClick={onClose} className={isDark ? "text-white/40 hover:text-white" : "text-gray-400 hover:text-gray-900"}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className={`flex border-b ${divide}`}>
          {TABS.map((t) => {
            const n = activeCount(draft[t.key]);
            const on = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 px-3 py-2.5 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 border-b-2 ${
                  on
                    ? "border-[#FF6B4A] text-[#FF6B4A] bg-[#FF6B4A]/5"
                    : `border-transparent ${isDark ? "text-white/40 hover:text-white/70" : "text-gray-400 hover:text-gray-700"}`
                }`}
              >
                [{t.label}]
                {n > 0 && (
                  <span className={`px-1.5 text-[10px] border ${
                    on ? "border-[#FF6B4A]/40 text-[#FF6B4A]" : isDark ? "border-white/15 text-white/40" : "border-gray-200 text-gray-400"
                  }`}>
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={label}>Search Keywords</label>
              <input
                value={cur.search}
                onChange={(e) => setField("search", e.target.value)}
                placeholder="keyword1, keyword2..."
                className={field}
              />
            </div>
            <div>
              <label className={label}>Exclude Keywords</label>
              <input
                value={cur.exclude}
                onChange={(e) => setField("exclude", e.target.value)}
                placeholder="rug, test..."
                className={field}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-4">
            {FIELDS.map((f) => {
              const r = cur[f.key] as Range;
              return (
                <div key={String(f.key)}>
                  <label className={label}>{f.label}</label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      value={r.min ?? ""}
                      onChange={(e) => setBound(f.key, "min", e.target.value)}
                      placeholder="Min"
                      className={field}
                    />
                    <input
                      type="number"
                      inputMode="decimal"
                      value={r.max ?? ""}
                      onChange={(e) => setBound(f.key, "max", e.target.value)}
                      placeholder="Max"
                      className={field}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-between p-4 border-t ${divide}`}>
          <button
            onClick={() =>
              setDraft({ new: { ...EMPTY_FILTER }, final: { ...EMPTY_FILTER }, migrated: { ...EMPTY_FILTER } })
            }
            className={`text-xs transition-colors ${
              isDark ? "text-white/40 hover:text-white/70" : "text-gray-400 hover:text-gray-700"
            }`}
          >
            clear all
          </button>
          <button
            onClick={() => { onChange(draft); onClose(); }}
            className="px-5 py-2 text-sm font-medium bg-[#FF6B4A]/10 text-[#FF6B4A] border border-[#FF6B4A]/30 hover:bg-[#FF6B4A]/20 transition-colors"
          >
            apply all
          </button>
        </div>
      </div>
    </div>
  );
}
