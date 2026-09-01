"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  init,
  dispose,
  registerOverlay,
  registerYAxis,
  type Chart,
  type KLineData,
  type Period,
  type DeepPartial,
  type Styles,
} from "klinecharts";
import {
  Activity,
  Brush,
  ChevronDown,
  Circle as CircleIcon,
  Magnet,
  Minus,
  MousePointer2,
  MoveVertical,
  Ruler,
  Slash,
  Spline,
  Square,
  Trash2,
  TrendingUp,
  Type as TypeIcon,
} from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import type { OHLCV } from "@/stores/pulseStore";

export type Timeframe = "1s" | "5s" | "15s" | "30s" | "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w" | "1M";
type ChartType = "candle" | "line";

// pump.fun tokens have a fixed 1B supply, so market cap = price * 1e9.
const DEFAULT_SUPPLY = 1_000_000_000;

const ACCENT = "#FF6B4A";
const UP = "#22c55e";
const DOWN = "#ef4444";

// Compact USD (market cap) label for the price scale, crosshair and tooltip.
function formatCompactUsd(v: number): string {
  const n = Math.abs(v);
  if (n >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
  if (n >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

/**
 * KLineChart keys bars by their raw millisecond `timestamp`, so the 250ms bars the
 * feed produces survive as distinct candles. (The previous lightweight-charts
 * implementation keyed on integer UNIX *seconds*, which collapsed four sub-second
 * bars into one and dropped three of every four — hence the ms-as-seconds hack it
 * carried. None of that is needed here; we hand over real millisecond timestamps.)
 *
 * The y-axis is registered once, globally, so market-cap values render as $3.7K
 * rather than a per-token price that rounds to $0.00.
 */
const Y_AXIS_NAME = "polyx_mcap";
let yAxisRegistered = false;
function ensureYAxis() {
  if (yAxisRegistered) return;
  registerYAxis({
    name: Y_AXIS_NAME,
    displayValueToText: (value: number) => formatCompactUsd(value),
  });
  yAxisRegistered = true;
}

/**
 * v10 ships only these overlay templates: fibonacciLine, horizontal/vertical
 * straight-ray-segment lines, parallelStraightLine, priceChannelLine, priceLine,
 * rayLine, segment, straightLine, simpleAnnotation, simpleTag and brush.
 *
 * Rect, circle and text are *figure primitives*, not overlays — asking
 * createOverlay for them silently returns null and draws nothing (v9 had them as
 * overlays; v10 dropped them). So we register our own on top of those figures,
 * plus a measure tool, which the library has no equivalent of at all.
 */
const OVERLAY_RECT = "polyxRect";
const OVERLAY_CIRCLE = "polyxCircle";
const OVERLAY_TEXT = "polyxText";
const OVERLAY_MEASURE = "polyxMeasure";

let overlaysRegistered = false;
function ensureOverlays() {
  if (overlaysRegistered) return;
  overlaysRegistered = true;

  const shape = {
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
  };

  registerOverlay({
    ...shape,
    name: OVERLAY_RECT,
    createPointFigures: ({ coordinates }) => {
      if (coordinates.length < 2) return [];
      const [a, b] = coordinates;
      return [
        {
          type: "rect",
          attrs: {
            x: Math.min(a.x, b.x),
            y: Math.min(a.y, b.y),
            width: Math.abs(b.x - a.x),
            height: Math.abs(b.y - a.y),
          },
          styles: {
            style: "stroke_fill",
            color: "rgba(255, 107, 74, 0.15)",
            borderColor: ACCENT,
            borderSize: 1,
          },
        },
      ];
    },
  });

  registerOverlay({
    ...shape,
    name: OVERLAY_CIRCLE,
    // First point is the centre, second sets the radius.
    createPointFigures: ({ coordinates }) => {
      if (coordinates.length < 2) return [];
      const [c, edge] = coordinates;
      const r = Math.hypot(edge.x - c.x, edge.y - c.y);
      return [
        {
          type: "circle",
          attrs: { x: c.x, y: c.y, r },
          styles: {
            style: "stroke_fill",
            color: "rgba(255, 107, 74, 0.12)",
            borderColor: ACCENT,
            borderSize: 1,
          },
        },
      ];
    },
  });

  // One point; the label rides in extendData, set when the overlay is created.
  registerOverlay<string>({
    name: OVERLAY_TEXT,
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 1) return [];
      return [
        {
          type: "text",
          attrs: {
            x: coordinates[0].x,
            y: coordinates[0].y - 6,
            text: overlay.extendData || "Text",
            align: "left",
            baseline: "bottom",
          },
          styles: {
            color: ACCENT,
            size: 12,
            family: "Inter, system-ui, sans-serif",
            weight: "bold",
          },
        },
      ];
    },
  });

  // Measure: drag between two points, read back the move in market cap, percent
  // and bar count. Values come from overlay.points (real data), not pixels.
  registerOverlay({
    ...shape,
    name: OVERLAY_MEASURE,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 2) return [];
      const [a, b] = coordinates;
      const p0 = overlay.points[0];
      const p1 = overlay.points[1];
      const from = p0?.value ?? 0;
      const to = p1?.value ?? 0;
      const diff = to - from;
      const pct = from !== 0 ? (diff / from) * 100 : 0;
      const bars = Math.abs((p1?.dataIndex ?? 0) - (p0?.dataIndex ?? 0));
      const up = diff >= 0;
      const tone = up ? UP : DOWN;

      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      const label = `${up ? "+" : ""}${pct.toFixed(2)}%  ${up ? "+" : "-"}${formatCompactUsd(
        Math.abs(diff)
      )}  ·  ${bars} bar${bars === 1 ? "" : "s"}`;

      return [
        {
          type: "rect",
          attrs: { x, y, width: w, height: h },
          styles: {
            style: "stroke_fill",
            color: up ? "rgba(34, 197, 94, 0.14)" : "rgba(239, 68, 68, 0.14)",
            borderColor: tone,
            borderSize: 1,
          },
        },
        {
          type: "line",
          attrs: { coordinates: [a, b] },
          styles: { style: "dashed", color: tone, size: 1 },
        },
        {
          type: "text",
          attrs: {
            x: x + w / 2,
            y: y - 4,
            text: label,
            align: "center",
            baseline: "bottom",
          },
          styles: {
            color: "#ffffff",
            size: 11,
            family: "Inter, system-ui, sans-serif",
            weight: "bold",
            backgroundColor: tone,
            paddingLeft: 6,
            paddingRight: 6,
            paddingTop: 3,
            paddingBottom: 3,
            borderRadius: 3,
          },
        },
      ];
    },
  });
}

const fmtClock = (ms: number, tf?: string) => {
  const d = new Date(ms);
  // Daily+ views want a date, intraday wants a clock, sub-minute wants seconds.
  if (tf === "1d" || tf === "1w" || tf === "1M")
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  const seconds = tf === "1s" || tf === "5s" || tf === "15s" || tf === "30s";
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" as const } : {}),
  });
};

const PERIODS: Record<Timeframe, Period> = {
  "1s": { type: "second", span: 1 },
  "5s": { type: "second", span: 5 },
  "15s": { type: "second", span: 15 },
  "30s": { type: "second", span: 30 },
  "1m": { type: "minute", span: 1 },
  "5m": { type: "minute", span: 5 },
  "15m": { type: "minute", span: 15 },
  "1h": { type: "hour", span: 1 },
  "4h": { type: "hour", span: 4 },
  "1d": { type: "day", span: 1 },
  "1w": { type: "week", span: 1 },
  "1M": { type: "month", span: 1 },
};

function buildStyles(isDark: boolean, chartType: ChartType): DeepPartial<Styles> {
  const grid = isDark ? "rgba(255, 107, 74, 0.1)" : "rgba(0, 0, 0, 0.1)";
  const border = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)";
  const text = isDark ? "#888888" : "#333333";

  return {
    grid: {
      show: true,
      horizontal: { show: true, color: grid, style: "dashed" },
      vertical: { show: true, color: grid, style: "dashed" },
    },
    candle: {
      type: chartType === "line" ? "area" : "candle_solid",
      bar: {
        upColor: UP,
        downColor: DOWN,
        noChangeColor: "#888888",
        upBorderColor: UP,
        downBorderColor: DOWN,
        noChangeBorderColor: "#888888",
        upWickColor: UP,
        downWickColor: DOWN,
        noChangeWickColor: "#888888",
      },
      area: {
        lineSize: 2,
        lineColor: ACCENT,
        smooth: false,
        backgroundColor: [
          { offset: 0, color: "rgba(255, 107, 74, 0.28)" },
          { offset: 1, color: "rgba(255, 107, 74, 0.01)" },
        ],
        point: { show: true, color: ACCENT, radius: 4, rippleColor: "rgba(255, 107, 74, 0.3)", rippleRadius: 8 },
      },
      priceMark: {
        show: true,
        high: { show: true, color: text },
        low: { show: true, color: text },
        // The last-price mark takes its colour from the up/down/noChange trio
        // rather than a single `color`; pinning all three to the accent keeps the
        // accent-coloured price line the old chart had.
        last: {
          show: true,
          upColor: ACCENT,
          downColor: ACCENT,
          noChangeColor: ACCENT,
          line: { show: true, style: "dashed" },
          text: { color: "#ffffff" },
        },
      },
      // The page renders its own controls at the top-left; KLineChart's default
      // always-on legend would sit underneath them.
      tooltip: { showRule: "follow_cross", showType: "standard" },
    },
    xAxis: {
      show: true,
      axisLine: { show: true, color: border },
      tickLine: { show: true, color: border },
      tickText: { show: true, color: text },
    },
    yAxis: {
      show: true,
      axisLine: { show: true, color: border },
      tickLine: { show: true, color: border },
      tickText: { show: true, color: text },
    },
    crosshair: {
      show: true,
      horizontal: {
        show: true,
        line: { show: true, style: "dashed", color: ACCENT },
        text: { color: "#ffffff", backgroundColor: ACCENT },
      },
      vertical: {
        show: true,
        line: { show: true, style: "dashed", color: ACCENT },
        text: { color: "#ffffff", backgroundColor: ACCENT },
      },
    },
  };
}

interface KLineChartProps {
  data: OHLCV[];
  isLoading?: boolean;
  timeframe?: Timeframe;
  onTimeframeChange?: (tf: Timeframe) => void;
  showTimeframeSelector?: boolean;
  /** Total token supply used to render market cap instead of raw price. */
  supply?: number;
  /** Controlled Line/Candle mode — when set, overrides the internal toggle. */
  chartType?: ChartType;
  /** The user's own buys/sells on this coin — rendered as B/S bubbles on the chart. */
  userTrades?: { time: number; type: "buy" | "sell" }[];
}

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1h" },
  { value: "4h", label: "4h" },
  { value: "1d", label: "1d" },
];

/**
 * Drawing tools. Every `overlay` here is a built-in KLineChart v10 template, so
 * nothing needs registering — `createOverlay(name)` puts the chart straight into
 * drawing mode and the overlay finishes itself on the last click.
 */
const DRAWING_TOOLS: { overlay: string; label: string; Icon: typeof Minus }[] = [
  { overlay: "segment", label: "Trend line", Icon: Slash },
  { overlay: "rayLine", label: "Ray", Icon: TrendingUp },
  { overlay: "horizontalStraightLine", label: "Horizontal line", Icon: Minus },
  { overlay: "verticalStraightLine", label: "Vertical line", Icon: MoveVertical },
  { overlay: "priceLine", label: "Price line", Icon: Spline },
  { overlay: OVERLAY_RECT, label: "Rectangle", Icon: Square },
  { overlay: OVERLAY_CIRCLE, label: "Circle", Icon: CircleIcon },
  { overlay: "fibonacciLine", label: "Fibonacci retracement", Icon: Activity },
  { overlay: "brush", label: "Freehand", Icon: Brush },
  { overlay: OVERLAY_MEASURE, label: "Measure", Icon: Ruler },
  { overlay: OVERLAY_TEXT, label: "Text", Icon: TypeIcon },
];

// Indicators drawn over the candles themselves vs. those needing their own pane
// below. `paneId` is what decides: an id the chart doesn't know yet makes a pane.
const MAIN_INDICATORS = ["MA", "EMA", "BOLL", "SAR"] as const;
const SUB_INDICATORS = ["VOL", "MACD", "RSI", "KDJ"] as const;
const CANDLE_PANE = "candle_pane";
const subPaneId = (name: string) => `pane_${name}`;

export function KLineChart({
  data,
  isLoading,
  timeframe = "1m",
  onTimeframeChange,
  showTimeframeSelector = false,
  supply = DEFAULT_SUPPLY,
  chartType: chartTypeProp,
  userTrades,
}: KLineChartProps) {
  const { isDark } = useThemeStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const [bubbles, setBubbles] = useState<{ x: number; y: number; type: "buy" | "sell" }[]>([]);
  const [internalChartType, setInternalChartType] = useState<ChartType>("candle");
  const chartType = chartTypeProp ?? internalChartType;
  const [chartReady, setChartReady] = useState(false);
  // Toolbar state
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [magnet, setMagnet] = useState(false);
  const [activeIndicators, setActiveIndicators] = useState<string[]>([]);
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false);
  const [textPromptOpen, setTextPromptOpen] = useState(false);
  const [textDraft, setTextDraft] = useState("");

  // Latest converted bars, read by the data loader (which is registered once and
  // must not close over a stale `data`).
  const barsRef = useRef<KLineData[]>([]);
  // The bar-push callback KLineChart hands us via subscribeBar. Live updates go
  // through this instead of a full reload, so the user's zoom/pan is preserved.
  const pushBarRef = useRef<((d: KLineData) => void) | null>(null);
  // Bars as of the previous render, to decide append-vs-reload.
  const prevBarsRef = useRef<KLineData[]>([]);
  const tfRef = useRef(timeframe);
  useEffect(() => {
    tfRef.current = timeframe;
  }, [timeframe]);

  // Convert OHLCV -> KLineData, scaling price into market cap (price * supply) so
  // the chart reads in dollars people recognise ($3.7K) instead of $0.00.
  const bars: KLineData[] = (data || [])
    .filter((d) => d && typeof d.timestamp === "number")
    .map((d) => ({
      timestamp: d.timestamp,
      open: d.open * supply,
      high: d.high * supply,
      low: d.low * supply,
      close: d.close * supply,
      volume: d.volume,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
  barsRef.current = bars;

  // ---- init (once) --------------------------------------------------------
  // Unlike the old implementation, theme and timeframe changes never tear the
  // chart down — setStyles / setPeriod handle them in place.
  useEffect(() => {
    if (!containerRef.current) return;
    ensureYAxis();
    ensureOverlays();

    const chart = init(containerRef.current, {
      formatter: {
        formatDate: ({ timestamp, type }) =>
          // Crosshair wants full precision; the axis follows the timeframe.
          fmtClock(timestamp, type === "xAxis" ? tfRef.current : "1s"),
        formatBigNumber: (value) => formatCompactUsd(Number(value)),
      },
      styles: buildStyles(isDark, chartType),
    });
    if (!chart) return;
    chartRef.current = chart;

    chart.setDataLoader({
      getBars: ({ type, callback }) => {
        // We always hold the entire series in memory, so there is nothing to page
        // in: answer the initial load with everything and refuse both directions.
        if (type === "init") callback(barsRef.current.slice(), false);
        else callback([], false);
      },
      subscribeBar: ({ callback }) => {
        pushBarRef.current = callback;
      },
      unsubscribeBar: () => {
        pushBarRef.current = null;
      },
    });

    chart.overrideYAxis({ name: Y_AXIS_NAME, paneId: "candle_pane" });
    chart.setSymbol({ ticker: "POLYX", pricePrecision: 2, volumePrecision: 0 });
    chart.setPeriod(PERIODS[tfRef.current]);
    prevBarsRef.current = [];
    setChartReady(true);

    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(containerRef.current);

    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      dispose(chart);
      chartRef.current = null;
      pushBarRef.current = null;
      prevBarsRef.current = [];
      setChartReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- theme / chart type -------------------------------------------------
  useEffect(() => {
    if (!chartReady || !chartRef.current) return;
    chartRef.current.setStyles(buildStyles(isDark, chartType));
  }, [isDark, chartType, chartReady]);

  // ---- timeframe ----------------------------------------------------------
  // setPeriod re-runs the loader, which is what we want: a timeframe switch is a
  // different series and should refit rather than append.
  useEffect(() => {
    if (!chartReady || !chartRef.current) return;
    prevBarsRef.current = [];
    chartRef.current.setPeriod(PERIODS[timeframe]);
  }, [timeframe, chartReady]);

  // ---- data ---------------------------------------------------------------
  useEffect(() => {
    const chart = chartRef.current;
    if (!chartReady || !chart) return;

    const next = barsRef.current;
    const prev = prevBarsRef.current;

    if (next.length === 0) {
      prevBarsRef.current = [];
      return;
    }

    // A genuinely different series (coin switch, history reload, pruned window)
    // needs a full reload; a longer array with the same anchor is the live feed
    // appending, which must not reset the viewport.
    const isSameSeries =
      prev.length > 0 &&
      next.length >= prev.length &&
      next[0].timestamp === prev[0].timestamp;

    if (!isSameSeries) {
      // resetData drops the cache so the loader is asked for the new series.
      chart.resetData();
      prevBarsRef.current = next.slice();
      return;
    }

    // Push the tail: the last bar we already showed may have been revised in
    // place (still-open candle), and anything past it is new.
    const push = pushBarRef.current;
    if (!push) return;
    for (let i = prev.length - 1; i < next.length; i++) {
      const bar = next[i];
      const old = prev[i];
      // `open` belongs in this comparison: continuity rewrites a bar's open when the
      // one before it closes, and leaving it out meant that correction never reached
      // the chart — the bar kept the disconnected open it was first pushed with.
      if (
        old &&
        old.timestamp === bar.timestamp &&
        old.open === bar.open &&
        old.close === bar.close &&
        old.high === bar.high &&
        old.low === bar.low
      )
        continue;
      push(bar);
    }
    prevBarsRef.current = next.slice();
  }, [data, chartReady, supply]);

  // ---- toolbar actions ----------------------------------------------------
  const armOverlay = useCallback(
    (overlay: string, extendData?: string) => {
      const chart = chartRef.current;
      if (!chart) return;
      setActiveTool(overlay);
      chart.createOverlay({
        name: overlay,
        mode: magnet ? "weak_magnet" : "normal",
        extendData,
        // Drop back to the cursor once the shape is finished, rather than
        // leaving the chart armed to draw another one on the next click.
        onDrawEnd: () => {
          setActiveTool(null);
          return false;
        },
      });
    },
    [magnet]
  );

  const selectTool = useCallback(
    (overlay: string) => {
      if (!chartRef.current) return;
      // Clicking the active tool again returns to the cursor.
      if (activeTool === overlay) {
        setActiveTool(null);
        setTextPromptOpen(false);
        return;
      }
      // Text needs its label before it can be placed, so the tool opens an input
      // first and only arms the overlay once there's something to draw.
      if (overlay === OVERLAY_TEXT) {
        setTextPromptOpen(true);
        setActiveTool(null);
        return;
      }
      setTextPromptOpen(false);
      armOverlay(overlay);
    },
    [activeTool, armOverlay]
  );

  const commitText = useCallback(() => {
    const label = textDraft.trim();
    if (!label) return;
    setTextPromptOpen(false);
    setTextDraft("");
    armOverlay(OVERLAY_TEXT, label);
  }, [textDraft, armOverlay]);

  const toggleMagnet = useCallback(() => {
    setMagnet((m) => {
      const next = !m;
      // Apply to shapes already on the chart too, not just the next one drawn.
      chartRef.current?.overrideOverlay({ mode: next ? "weak_magnet" : "normal" });
      return next;
    });
  }, []);

  const clearDrawings = useCallback(() => {
    // removeOverlay with no filter clears them all.
    chartRef.current?.removeOverlay();
    setActiveTool(null);
  }, []);

  const toggleIndicator = useCallback((name: string, main: boolean) => {
    const chart = chartRef.current;
    if (!chart) return;
    const paneId = main ? CANDLE_PANE : subPaneId(name);
    setActiveIndicators((prev) => {
      if (prev.includes(name)) {
        chart.removeIndicator({ paneId, name });
        return prev.filter((n) => n !== name);
      }
      // isStack keeps multiple main-pane indicators (MA + BOLL) on one axis
      // instead of the later one replacing the earlier.
      chart.createIndicator({ name, paneId }, main);
      return [...prev, name];
    });
  }, []);

  // ---- B/S trade bubbles --------------------------------------------------
  // Positioned as an HTML overlay at the exact buy/sell time+price, recomputed on
  // pan / zoom / resize / data so each bubble stays pinned to its real transaction.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chartReady || !chart) return;

    const compute = () => {
      const cands = barsRef.current;
      const out: { x: number; y: number; type: "buy" | "sell" }[] = [];
      if (cands.length) {
        for (const t of userTrades || []) {
          // Snap to the nearest candle by time — a trade's timestamp often runs a
          // few seconds ahead of the last candle (pipeline lag), and the nearest
          // candle IS the trade's candle.
          let nearest = cands[0];
          let best = Infinity;
          for (const c of cands) {
            const d = Math.abs(c.timestamp / 1000 - t.time); // userTrades are in seconds
            if (d < best) {
              best = d;
              nearest = c;
            }
          }
          const px = chart.convertToPixel(
            { timestamp: nearest.timestamp, value: nearest.high },
            { paneId: "candle_pane" }
          ) as { x?: number; y?: number };
          if (px?.x == null || px?.y == null) continue;
          // Both buy and sell bubbles sit ABOVE the candle (anchored to the high).
          out.push({ x: px.x, y: px.y - 16, type: t.type });
        }
      }
      // Stack bubbles landing on the same candle so a buy + sell on one bar don't
      // overlap — each subsequent one sits above the previous.
      const seen = new Map<number, number>();
      for (const b of out) {
        const k = Math.round(b.x);
        const n = seen.get(k) || 0;
        b.y -= n * 22;
        seen.set(k, n + 1);
      }
      setBubbles(out);
    };

    compute();
    chart.subscribeAction("onVisibleRangeChange", compute);
    chart.subscribeAction("onZoom", compute);
    chart.subscribeAction("onScroll", compute);
    const ro = new ResizeObserver(compute);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => {
      chart.unsubscribeAction("onVisibleRangeChange", compute);
      chart.unsubscribeAction("onZoom", compute);
      chart.unsubscribeAction("onScroll", compute);
      ro.disconnect();
    };
  }, [userTrades, chartReady, data, supply]);

  // NOTE: no early returns for loading/empty — the chart container below must
  // ALWAYS be in the DOM so KLineChart can initialise on mount. The chart mounts
  // (hidden) at page load before OHLCV arrives; if we early-return here the
  // container never exists, init never runs, and the chart stays blank forever.
  // Loading/empty are rendered as overlays instead.
  const toolBtn = (active: boolean) =>
    `flex items-center justify-center h-7 w-7 rounded transition-colors ${
      active
        ? "bg-[#FF6B4A] text-white"
        : isDark
        ? "text-white/50 hover:bg-white/10 hover:text-white/80"
        : "text-gray-500 hover:bg-black/5 hover:text-gray-800"
    }`;

  return (
    <div className={`h-full w-full flex ${isDark ? "bg-[#0a0a0a]" : "bg-gray-50"}`}>
      {/* Drawing toolbar — a real column rather than an overlay, so it never
          covers candles on the left edge of the plot. */}
      <div
        className={`flex flex-col items-center gap-0.5 py-2 px-1 border-r flex-shrink-0 ${
          isDark ? "border-white/10" : "border-black/10"
        }`}
      >
        <button
          onClick={() => {
            setActiveTool(null);
            setTextPromptOpen(false);
          }}
          title="Cursor"
          className={toolBtn(activeTool === null && !textPromptOpen)}
        >
          <MousePointer2 className="h-3.5 w-3.5" />
        </button>

        {DRAWING_TOOLS.map(({ overlay, label, Icon }) => (
          <button
            key={overlay}
            onClick={() => selectTool(overlay)}
            title={label}
            className={toolBtn(
              activeTool === overlay || (overlay === OVERLAY_TEXT && textPromptOpen)
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}

        <div className={`my-1 h-px w-5 ${isDark ? "bg-white/10" : "bg-black/10"}`} />

        <button
          onClick={toggleMagnet}
          title={magnet ? "Magnet: on (snaps to price)" : "Magnet: off"}
          className={toolBtn(magnet)}
        >
          <Magnet className="h-3.5 w-3.5" />
        </button>
        <button onClick={clearDrawings} title="Remove all drawings" className={toolBtn(false)}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Chart column */}
      <div className="relative flex-1 min-w-0">
      {/* Text tool: type the label, then click the chart to place it */}
      {textPromptOpen && (
        <div
          className={`absolute top-10 left-2 z-30 flex items-center gap-1 p-1 rounded border shadow-lg ${
            isDark ? "bg-[#141414] border-white/10" : "bg-white border-black/10"
          }`}
        >
          <input
            autoFocus
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitText();
              if (e.key === "Escape") {
                setTextPromptOpen(false);
                setTextDraft("");
              }
            }}
            placeholder="Label, then click chart"
            className={`px-1.5 py-1 text-[10px] rounded outline-none w-40 ${
              isDark
                ? "bg-white/5 text-white/80 placeholder:text-white/25"
                : "bg-black/5 text-gray-700 placeholder:text-gray-400"
            }`}
          />
          <button
            onClick={commitText}
            className="px-2 py-1 text-[10px] font-medium rounded bg-[#FF6B4A] text-white"
          >
            Add
          </button>
        </div>
      )}
      {/* Controls */}
      <div className="absolute top-2 left-2 right-2 z-10 flex justify-between">
        {showTimeframeSelector && onTimeframeChange ? (
          <div className="flex gap-0.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.value}
                onClick={() => onTimeframeChange(tf.value)}
                className={`px-1.5 py-1 text-[9px] font-medium rounded transition-colors ${
                  timeframe === tf.value
                    ? "bg-[#FF6B4A] text-white"
                    : isDark
                    ? "bg-white/10 text-white/60 hover:bg-white/20"
                    : "bg-black/5 text-gray-500 hover:bg-black/10"
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>
        ) : (
          <div />
        )}

        <div className="flex gap-1 items-start">
          {/* Indicators */}
          <div className="relative">
            <button
              onClick={() => setIndicatorMenuOpen((o) => !o)}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                activeIndicators.length
                  ? "bg-[#FF6B4A] text-white"
                  : isDark
                  ? "bg-white/10 text-white/60 hover:bg-white/20"
                  : "bg-black/5 text-gray-500 hover:bg-black/10"
              }`}
            >
              Indicators
              {activeIndicators.length > 0 && ` (${activeIndicators.length})`}
              <ChevronDown className="h-3 w-3" />
            </button>

            {indicatorMenuOpen && (
              <div
                className={`absolute right-0 mt-1 w-36 rounded border shadow-lg overflow-hidden ${
                  isDark ? "bg-[#141414] border-white/10" : "bg-white border-black/10"
                }`}
              >
                {[
                  { title: "Overlay", names: MAIN_INDICATORS, main: true },
                  { title: "Separate pane", names: SUB_INDICATORS, main: false },
                ].map((group) => (
                  <div key={group.title}>
                    <div
                      className={`px-2 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wide ${
                        isDark ? "text-white/30" : "text-gray-400"
                      }`}
                    >
                      {group.title}
                    </div>
                    {group.names.map((name) => {
                      const on = activeIndicators.includes(name);
                      return (
                        <button
                          key={name}
                          onClick={() => toggleIndicator(name, group.main)}
                          className={`w-full flex items-center justify-between px-2 py-1 text-[10px] transition-colors ${
                            isDark
                              ? "text-white/70 hover:bg-white/10"
                              : "text-gray-600 hover:bg-black/5"
                          }`}
                        >
                          {name}
                          {on && <span className="text-[#FF6B4A]">●</span>}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Chart type toggle — hidden when the page controls Line/Candle */}
          {!chartTypeProp &&
            (["line", "candle"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setInternalChartType(t)}
                className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                  chartType === t
                    ? "bg-[#FF6B4A] text-white"
                    : isDark
                    ? "bg-white/10 text-white/60 hover:bg-white/20"
                    : "bg-black/5 text-gray-500 hover:bg-black/10"
                }`}
              >
                {t === "line" ? "Line" : "Candle"}
              </button>
            ))}
        </div>
      </div>

      {/* Chart container — always mounted so the chart can attach even before data */}
      <div ref={containerRef} className="h-full w-full" />

      {/* B/S trade bubbles — pinned to the exact tx time+price. Bevel/emboss via
          radial gradient + inset highlight/shadow, white Inter letter. */}
      <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
        {bubbles.map((b, i) => (
          <div
            key={i}
            className="absolute flex items-center justify-center rounded-full"
            style={{
              left: `${b.x}px`,
              top: `${b.y}px`,
              width: 20,
              height: 20,
              transform: "translate(-50%, -50%)",
              fontFamily: "Inter, system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 11,
              lineHeight: 1,
              color: "#ffffff",
              background:
                b.type === "buy"
                  ? "radial-gradient(circle at 35% 30%, #5cf08a, #16a34a 68%, #12833c)"
                  : "radial-gradient(circle at 35% 30%, #fb8a8a, #dc2626 68%, #b01c1c)",
              boxShadow:
                "inset 1px 1px 1.5px rgba(255,255,255,0.55), inset -1.5px -1.5px 2px rgba(0,0,0,0.45), 0 1px 2px rgba(0,0,0,0.55)",
              border: "1px solid rgba(0,0,0,0.25)",
            }}
          >
            {b.type === "buy" ? "B" : "S"}
          </div>
        ))}
      </div>

      {/* Loading / empty as overlays (never early-return the container away) */}
      {isLoading && (!data || data.length === 0) && (
        <div className={`absolute inset-0 flex items-center justify-center ${isDark ? "bg-[#0a0a0a]" : "bg-gray-50"}`}>
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FF6B4A] border-t-transparent" />
            <span className={`text-sm ${isDark ? "text-white/50" : "text-gray-500"}`}>Loading chart...</span>
          </div>
        </div>
      )}
      {!isLoading && (!data || data.length === 0) && (
        <div
          className={`absolute inset-0 flex items-center justify-center text-sm ${
            isDark ? "bg-[#0a0a0a] text-white/40" : "bg-gray-50 text-gray-400"
          }`}
        >
          No price data available
        </div>
      )}
      </div>
    </div>
  );
}
