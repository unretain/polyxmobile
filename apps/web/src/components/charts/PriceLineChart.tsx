"use client";

import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { formatPrice, formatNumber } from "@/lib/utils";
import type { OHLCV } from "@/stores/chartStore";

interface PriceLineChartProps {
  data: OHLCV[];
  isLoading?: boolean;
  showMarketCap?: boolean; // Show market cap instead of price for Pulse tokens
  marketCap?: number;
}

export function PriceLineChart({ data, isLoading, showMarketCap, marketCap }: PriceLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [hoveredPoint, setHoveredPoint] = useState<{
    x: number;
    y: number;
    price: number;
    time: Date;
    index: number;
  } | null>(null);

  // Time axis zoom/pan state (CMC style)
  const [viewStart, setViewStart] = useState(0); // Start index as fraction (0-1)
  const [viewEnd, setViewEnd] = useState(1); // End index as fraction (0-1)

  // Dragging state for chart panning
  const isDraggingChartRef = useRef(false);
  const lastMouseXRef = useRef(0);

  // Dragging state for range slider
  const sliderDragRef = useRef<"left" | "right" | "middle" | null>(null);

  // Reset view when data changes
  useEffect(() => {
    setViewStart(0);
    setViewEnd(1);
  }, [data]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Get visible data slice
  const visibleData = useMemo(() => {
    if (data.length === 0) return [];
    const startIdx = Math.floor(viewStart * (data.length - 1));
    const endIdx = Math.ceil(viewEnd * (data.length - 1));
    return data.slice(startIdx, endIdx + 1);
  }, [data, viewStart, viewEnd]);

  // Calculate price bounds from visible data
  const bounds = useMemo(() => {
    if (visibleData.length === 0) return { min: 0, max: 1 };

    let min = Infinity;
    let max = -Infinity;

    for (const candle of visibleData) {
      min = Math.min(min, candle.low);
      max = Math.max(max, candle.high);
    }

    // Add 5% padding
    const padding = (max - min) * 0.05 || min * 0.05;
    return { min: min - padding, max: max + padding };
  }, [visibleData]);

  // Price change calculation (for visible range)
  const priceChange = useMemo(() => {
    if (visibleData.length < 2) return { value: 0, percent: 0, isPositive: true };

    const firstPrice = visibleData[0].close;
    const lastPrice = visibleData[visibleData.length - 1].close;
    const change = lastPrice - firstPrice;
    const percent = (change / firstPrice) * 100;

    return {
      value: change,
      percent,
      isPositive: change >= 0,
    };
  }, [visibleData]);

  // Draw the chart
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || visibleData.length === 0 || dimensions.width === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const width = dimensions.width;
    const height = dimensions.height - 50; // Reserve space for range slider

    // Set canvas size with device pixel ratio for crisp rendering
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Chart padding
    const padding = { top: 60, right: 70, bottom: 30, left: 10 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Helper functions
    const xScale = (index: number) => {
      if (visibleData.length <= 1) return padding.left + chartWidth / 2;
      return padding.left + (index / (visibleData.length - 1)) * chartWidth;
    };
    const yScale = (price: number) => {
      const normalized = (price - bounds.min) / (bounds.max - bounds.min);
      return padding.top + chartHeight - normalized * chartHeight;
    };

    // Draw gradient fill
    const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    const color = priceChange.isPositive ? "16, 185, 129" : "239, 68, 68";
    gradient.addColorStop(0, `rgba(${color}, 0.3)`);
    gradient.addColorStop(1, `rgba(${color}, 0)`);

    ctx.beginPath();
    ctx.moveTo(xScale(0), yScale(visibleData[0].close));
    for (let i = 1; i < visibleData.length; i++) {
      ctx.lineTo(xScale(i), yScale(visibleData[i].close));
    }
    ctx.lineTo(xScale(visibleData.length - 1), height - padding.bottom);
    ctx.lineTo(xScale(0), height - padding.bottom);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw the line
    ctx.beginPath();
    ctx.moveTo(xScale(0), yScale(visibleData[0].close));
    for (let i = 1; i < visibleData.length; i++) {
      ctx.lineTo(xScale(i), yScale(visibleData[i].close));
    }
    ctx.strokeStyle = priceChange.isPositive ? "#10b981" : "#ef4444";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    // Draw Y-axis labels (price)
    ctx.fillStyle = "#888";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";

    const priceSteps = 5;
    for (let i = 0; i <= priceSteps; i++) {
      const price = bounds.min + (bounds.max - bounds.min) * (i / priceSteps);
      const y = yScale(price);
      ctx.fillText(`$${formatPrice(price)}`, width - 5, y + 4);

      // Draw grid line
      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    // Draw X-axis labels (time)
    ctx.textAlign = "center";
    const timeSteps = Math.min(6, visibleData.length);
    if (timeSteps >= 2) {
      const totalMs = visibleData[visibleData.length - 1].timestamp - visibleData[0].timestamp;
      const totalHours = totalMs / (1000 * 60 * 60);

      for (let i = 0; i < timeSteps; i++) {
        const dataIndex = Math.floor((i / (timeSteps - 1)) * (visibleData.length - 1));
        const candle = visibleData[dataIndex];
        if (!candle) continue;

        const time = new Date(candle.timestamp);
        const x = xScale(dataIndex);

        let label: string;
        if (totalHours <= 1) {
          label = time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
        } else if (totalHours <= 24) {
          label = time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
        } else if (totalHours <= 168) {
          label = time.toLocaleDateString("en-US", { weekday: "short", hour: "2-digit" });
        } else {
          label = time.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        }

        ctx.fillStyle = "#888";
        ctx.fillText(label, x, height - 10);
      }
    }
  }, [visibleData, dimensions, bounds, priceChange.isPositive]);

  // Mouse down handler for chart panning
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    isDraggingChartRef.current = true;
    lastMouseXRef.current = e.clientX;
  }, []);

  // Mouse move handler for tooltip and panning
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || visibleData.length === 0) return;

    // Handle chart panning (drag left/right)
    if (isDraggingChartRef.current && e.buttons === 1) {
      const deltaX = e.clientX - lastMouseXRef.current;
      lastMouseXRef.current = e.clientX;

      const rect = canvas.getBoundingClientRect();
      const panAmount = -(deltaX / rect.width) * (viewEnd - viewStart);

      let newStart = viewStart + panAmount;
      let newEnd = viewEnd + panAmount;

      // Clamp to valid range
      if (newStart < 0) {
        newEnd -= newStart;
        newStart = 0;
      }
      if (newEnd > 1) {
        newStart -= (newEnd - 1);
        newEnd = 1;
      }

      setViewStart(Math.max(0, newStart));
      setViewEnd(Math.min(1, newEnd));
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const padding = { left: 10, right: 70 };
    const chartWidth = dimensions.width - padding.left - padding.right;

    const normalizedX = (x - padding.left) / chartWidth;
    const dataIndex = Math.round(normalizedX * (visibleData.length - 1));

    if (dataIndex >= 0 && dataIndex < visibleData.length) {
      const point = visibleData[dataIndex];
      const pointX = padding.left + (dataIndex / (visibleData.length - 1)) * chartWidth;
      const chartHeight = dimensions.height - 50 - 60 - 30; // height - slider - top padding - bottom padding
      const normalized = (point.close - bounds.min) / (bounds.max - bounds.min);
      const pointY = 60 + chartHeight - normalized * chartHeight;

      setHoveredPoint({
        x: pointX,
        y: pointY,
        price: point.close,
        time: new Date(point.timestamp),
        index: dataIndex,
      });
    }
  }, [visibleData, dimensions, bounds, viewStart, viewEnd]);

  const handleMouseUp = useCallback(() => {
    isDraggingChartRef.current = false;
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredPoint(null);
    isDraggingChartRef.current = false;
  }, []);

  // Scroll wheel to zoom time axis
  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    const zoomIn = e.deltaY < 0;
    const zoomFactor = zoomIn ? 0.9 : 1.1;

    // Get mouse position as fraction of chart width
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) / rect.width;

    const currentRange = viewEnd - viewStart;
    const newRange = Math.max(0.05, Math.min(1, currentRange * zoomFactor));

    // Zoom centered on mouse position
    const rangeChange = newRange - currentRange;
    let newStart = viewStart - rangeChange * mouseX;
    let newEnd = viewEnd + rangeChange * (1 - mouseX);

    // Clamp to valid range
    if (newStart < 0) {
      newEnd -= newStart;
      newStart = 0;
    }
    if (newEnd > 1) {
      newStart -= (newEnd - 1);
      newEnd = 1;
    }

    setViewStart(Math.max(0, newStart));
    setViewEnd(Math.min(1, newEnd));
  }, [viewStart, viewEnd]);

  // Range slider handlers
  const handleSliderMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>, handle: "left" | "right" | "middle") => {
    e.preventDefault();
    e.stopPropagation();
    sliderDragRef.current = handle;
    lastMouseXRef.current = e.clientX;
  }, []);

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!sliderDragRef.current || !sliderRef.current) return;

      const rect = sliderRef.current.getBoundingClientRect();
      const deltaX = (e.clientX - lastMouseXRef.current) / rect.width;
      lastMouseXRef.current = e.clientX;

      if (sliderDragRef.current === "left") {
        setViewStart((prev) => Math.max(0, Math.min(viewEnd - 0.05, prev + deltaX)));
      } else if (sliderDragRef.current === "right") {
        setViewEnd((prev) => Math.max(viewStart + 0.05, Math.min(1, prev + deltaX)));
      } else if (sliderDragRef.current === "middle") {
        const range = viewEnd - viewStart;
        let newStart = viewStart + deltaX;
        let newEnd = viewEnd + deltaX;

        if (newStart < 0) {
          newStart = 0;
          newEnd = range;
        }
        if (newEnd > 1) {
          newEnd = 1;
          newStart = 1 - range;
        }

        setViewStart(newStart);
        setViewEnd(newEnd);
      }
    };

    const handleGlobalMouseUp = () => {
      sliderDragRef.current = null;
      isDraggingChartRef.current = false;
    };

    window.addEventListener("mousemove", handleGlobalMouseMove);
    window.addEventListener("mouseup", handleGlobalMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleGlobalMouseMove);
      window.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, [viewStart, viewEnd]);

  // Double-click to reset view
  const handleDoubleClick = useCallback(() => {
    setViewStart(0);
    setViewEnd(1);
  }, []);

  // Current price
  const currentPrice = visibleData.length > 0 ? visibleData[visibleData.length - 1].close : 0;

  return (
    <div ref={containerRef} className="relative h-full w-full bg-card rounded-xl overflow-hidden flex flex-col">
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {/* Price/Market Cap display */}
      <div className="absolute top-4 left-4 z-10">
        {showMarketCap && marketCap ? (
          <>
            <div className="text-xs text-muted-foreground mb-0.5">Market Cap</div>
            <div className="text-2xl font-bold">${formatNumber(marketCap)}</div>
          </>
        ) : (
          <>
            <div className="text-2xl font-bold">${formatPrice(currentPrice)}</div>
            <div className={`text-sm font-medium ${priceChange.isPositive ? "text-green-500" : "text-red-500"}`}>
              {priceChange.isPositive ? "+" : ""}{formatPrice(priceChange.value)} ({priceChange.isPositive ? "+" : ""}{priceChange.percent.toFixed(2)}%)
            </div>
          </>
        )}
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="flex-1 w-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
      />

      {/* Range slider (CMC style) */}
      <div
        ref={sliderRef}
        className="h-10 mx-4 mb-2 relative bg-secondary/50 rounded-lg"
      >
        {/* Mini chart preview */}
        <div className="absolute inset-0 opacity-30">
          {data.length > 1 && bounds.max > bounds.min && (
            <svg viewBox={`0 0 ${data.length} 100`} preserveAspectRatio="none" className="w-full h-full">
              <path
                d={data.map((d, i) => {
                  const range = bounds.max - bounds.min;
                  const y = range > 0 ? Math.max(0, Math.min(100, 100 - ((d.close - bounds.min) / range) * 100)) : 50;
                  return `${i === 0 ? 'M' : 'L'} ${i} ${isFinite(y) ? y : 50}`;
                }).join(" ")}
                fill="none"
                stroke={priceChange.isPositive ? "#10b981" : "#ef4444"}
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}
        </div>

        {/* Dimmed areas outside selection */}
        <div
          className="absolute top-0 bottom-0 left-0 bg-black/50 rounded-l-lg"
          style={{ width: `${viewStart * 100}%` }}
        />
        <div
          className="absolute top-0 bottom-0 right-0 bg-black/50 rounded-r-lg"
          style={{ width: `${(1 - viewEnd) * 100}%` }}
        />

        {/* Selection handles */}
        <div
          className="absolute top-0 bottom-0 cursor-ew-resize flex items-center"
          style={{ left: `${viewStart * 100}%` }}
          onMouseDown={(e) => handleSliderMouseDown(e, "left")}
        >
          <div className="w-2 h-6 bg-primary rounded-sm -ml-1" />
        </div>

        <div
          className="absolute top-0 bottom-0 cursor-ew-resize flex items-center"
          style={{ left: `${viewEnd * 100}%` }}
          onMouseDown={(e) => handleSliderMouseDown(e, "right")}
        >
          <div className="w-2 h-6 bg-primary rounded-sm -ml-1" />
        </div>

        {/* Draggable selection area */}
        <div
          className="absolute top-0 bottom-0 cursor-grab active:cursor-grabbing border-t-2 border-b-2 border-primary/50"
          style={{
            left: `${viewStart * 100}%`,
            width: `${(viewEnd - viewStart) * 100}%`
          }}
          onMouseDown={(e) => handleSliderMouseDown(e, "middle")}
        />
      </div>

      {/* Hover tooltip */}
      {hoveredPoint && (
        <>
          {/* Vertical line */}
          <div
            className="absolute w-px bg-white/30 pointer-events-none"
            style={{
              left: hoveredPoint.x,
              top: 60,
              bottom: 60,
            }}
          />
          {/* Dot */}
          <div
            className={`absolute w-3 h-3 rounded-full border-2 border-white pointer-events-none ${
              priceChange.isPositive ? "bg-green-500" : "bg-red-500"
            }`}
            style={{
              left: hoveredPoint.x - 6,
              top: hoveredPoint.y - 6,
            }}
          />
          {/* Tooltip */}
          <div
            className="absolute bg-black/90 border border-white/20 rounded-lg px-3 py-2 pointer-events-none z-20"
            style={{
              left: Math.min(hoveredPoint.x - 60, dimensions.width - 140),
              top: Math.max(hoveredPoint.y - 70, 10),
            }}
          >
            <div className="text-sm font-semibold">${formatPrice(hoveredPoint.price)}</div>
            <div className="text-xs text-muted-foreground">
              {hoveredPoint.time.toLocaleString()}
            </div>
          </div>
        </>
      )}

      {/* Controls hint */}
      <div className="absolute bottom-14 left-4 rounded bg-black/60 px-3 py-1.5 text-xs text-muted-foreground">
        Scroll: zoom • Drag: pan • Double-click: reset
      </div>
    </div>
  );
}
