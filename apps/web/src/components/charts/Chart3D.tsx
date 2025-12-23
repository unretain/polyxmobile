"use client";

import { Suspense, useMemo, useState, useRef, useEffect, useCallback } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, Environment } from "@react-three/drei";
import * as THREE from "three";

// Component to keep scene background transparent (coral gradient shows through)
function SceneBackground({ isDark }: { isDark: boolean }) {
  const { scene, gl } = useThree();

  useEffect(() => {
    // Keep transparent so coral gradient shows through
    scene.background = null;
    gl.setClearColor(0x000000, 0);
  }, [scene, gl, isDark]);

  return null;
}
import { Candlestick3D } from "./Candlestick3D";
import { VolumeBar3D } from "./VolumeBar3D";
import { ChartGrid } from "./ChartGrid";
import { ChartAxis } from "./ChartAxis";
import { FlyControls } from "./FlyControls";
import { DrawingLayer, DrawingToolbar, Drawing, DrawingToolType, DRAWING_COLORS, DEFAULT_LINE_WIDTH } from "./drawing";
import { formatPrice, formatNumber } from "@/lib/utils";
import type { OHLCV } from "@/stores/chartStore";
import { useThemeStore } from "@/stores/themeStore";

// ============================================================================
// INDEX-BASED VIEW SYSTEM
// ============================================================================
// We use start/end INDICES into the data array, not timestamps.
// This ensures a FIXED number of visible candles regardless of time density.
//
// When data is prepended (historical load), we shift indices to maintain position.
// When data is appended (new candles), indices stay the same (view doesn't move).
// ============================================================================

interface IndexViewRange {
  startIdx: number; // First visible candle index
  endIdx: number;   // Last visible candle index (inclusive)
}

// Visible candle count target - how many candles to show at a time
// How many candles fit in the viewport: CHART_WIDTH (60) / FIXED_SPACING (0.4) = 150
const TARGET_VISIBLE_CANDLES = 150;

// Props for external toolbar rendering
export interface DrawingToolbarRenderProps {
  activeTool: DrawingToolType;
  activeColor: string;
  activeLineWidth: number;
  onToolChange: (tool: DrawingToolType) => void;
  onColorChange: (color: string) => void;
  onLineWidthChange: (width: number) => void;
  onClearAll: () => void;
  drawingCount: number;
}

// Timeline slider - drag to scrub through chart history
// Shows current position in data with a draggable thumb
interface TimelineSliderProps {
  onSeek: (startIdx: number) => void; // Jump to specific start index
  isDark: boolean;
  dataLength: number;
  visibleCount: number;
  startIdx: number; // Current start index in data
}

function TimelineSlider({ onSeek, isDark, dataLength, visibleCount, startIdx }: TimelineSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Calculate the maximum start index (rightmost scroll position)
  const maxStartIdx = Math.max(0, dataLength - visibleCount);

  // Thumb position as percentage (0% = oldest data, 100% = newest data)
  const thumbPercent = useMemo(() => {
    if (maxStartIdx <= 0) return 100; // All data fits, show at end
    return Math.min(100, Math.max(0, (startIdx / maxStartIdx) * 100));
  }, [startIdx, maxStartIdx]);

  // Handle click/drag on track
  const seekToPosition = useCallback((clientX: number) => {
    if (!trackRef.current || maxStartIdx <= 0) return;

    const rect = trackRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newStartIdx = Math.round(percent * maxStartIdx);
    onSeek(newStartIdx);
  }, [maxStartIdx, onSeek]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    seekToPosition(e.clientX);
  }, [seekToPosition]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      seekToPosition(e.clientX);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, seekToPosition]);

  // Show position info
  const positionText = useMemo(() => {
    if (dataLength === 0) return '';
    const endIdx = Math.min(startIdx + visibleCount - 1, dataLength - 1);
    return `${startIdx + 1}-${endIdx + 1}`;
  }, [startIdx, visibleCount, dataLength]);

  return (
    <div className="flex items-center gap-3">
      {/* Timeline slider track */}
      <div
        ref={trackRef}
        onMouseDown={handleMouseDown}
        className={`relative h-6 flex items-center select-none cursor-pointer group`}
        style={{ width: '200px' }}
        title="Click or drag to navigate"
      >
        {/* Track background */}
        <div className={`absolute inset-x-0 h-1.5 top-1/2 -translate-y-1/2 rounded-full ${
          isDark ? 'bg-white/10' : 'bg-black/10'
        }`} />

        {/* Progress fill (from left to thumb) */}
        <div
          className="absolute h-1.5 top-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-[#FF6B4A]/30 to-[#FF6B4A]/60"
          style={{
            left: 0,
            width: `${thumbPercent}%`,
          }}
        />

        {/* Thumb */}
        <div
          className={`absolute w-4 h-4 rounded-full transition-transform duration-100 ${
            isDragging
              ? 'bg-[#FF6B4A] scale-125'
              : 'bg-[#FF6B4A] group-hover:scale-110'
          }`}
          style={{
            left: `calc(${thumbPercent}% - 8px)`,
            boxShadow: isDragging
              ? '0 0 15px rgba(255, 107, 74, 0.8)'
              : '0 0 8px rgba(255, 107, 74, 0.5)',
          }}
        />
      </div>

      {/* Position indicator */}
      <div className={`text-xs font-mono px-2 py-0.5 rounded whitespace-nowrap ${
        isDark ? 'bg-white/5 text-white/50' : 'bg-black/5 text-gray-500'
      }`}>
        {positionText}<span className="opacity-50">/{dataLength}</span>
      </div>
    </div>
  );
}

interface Chart3DProps {
  data: OHLCV[];
  isLoading?: boolean;
  showMarketCap?: boolean; // Show market cap instead of price for Pulse tokens
  marketCap?: number;
  price?: number; // Actual current price from token data (more accurate than OHLCV last close)
  onLoadMore?: () => void; // Callback to load more historical data when scrolling left
  hasMoreData?: boolean; // Whether there's more historical data available
  isLoadingMore?: boolean; // Loading state for fetching more data
  showDrawingTools?: boolean; // Whether to show the drawing toolbar (default: true)
  renderToolbar?: (props: DrawingToolbarRenderProps) => React.ReactNode; // Custom toolbar renderer
  showWatermark?: boolean; // Show embedded watermark in the 3D scene (for free tier)
  theme?: "dark" | "light"; // Override global theme (for embed previews)
  timeframe?: string; // Current timeframe (1s, 1m, 5m, etc.) - used to detect timeframe switches
}

// 3D Watermark component rendered in Three.js scene
// This is rendered INTO the canvas, making it nearly impossible to remove
function Watermark3D({ chartWidth, chartHeight }: { chartWidth: number; chartHeight: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();

  // Update watermark rotation to always face camera
  useEffect(() => {
    const updateRotation = () => {
      if (groupRef.current) {
        // Keep watermark facing the camera
        groupRef.current.lookAt(camera.position);
      }
    };

    // Initial update
    updateRotation();

    // Create an animation frame loop to keep watermark facing camera
    let animationId: number;
    const animate = () => {
      updateRotation();
      animationId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, [camera]);

  // Create canvas texture for the watermark text
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Make it semi-transparent
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.font = 'bold 64px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('POLYX FREE', canvas.width / 2, canvas.height / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, []);

  if (!texture) return null;

  return (
    <group ref={groupRef} position={[chartWidth / 2, chartHeight / 2, 5]}>
      {/* Main watermark - slightly offset */}
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[20, 5]} />
        <meshBasicMaterial map={texture} transparent opacity={0.15} depthWrite={false} />
      </mesh>
      {/* Secondary watermark - rotated */}
      <mesh position={[-8, -2, -2]} rotation={[0, 0, Math.PI / 12]}>
        <planeGeometry args={[16, 4]} />
        <meshBasicMaterial map={texture} transparent opacity={0.08} depthWrite={false} />
      </mesh>
      {/* Third watermark - different angle */}
      <mesh position={[8, 2, -3]} rotation={[0, 0, -Math.PI / 15]}>
        <planeGeometry args={[16, 4]} />
        <meshBasicMaterial map={texture} transparent opacity={0.08} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function Chart3D({ data, isLoading, showMarketCap, marketCap, price, onLoadMore, hasMoreData = true, isLoadingMore = false, showDrawingTools = true, renderToolbar, showWatermark = false, theme, timeframe }: Chart3DProps) {
  const { isDark: globalIsDark } = useThemeStore();
  const isDark = theme ? theme === "dark" : globalIsDark;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // ============================================================================
  // DATA PROCESSING - Sort and validate incoming data
  // ============================================================================
  // NOTE: We NO LONGER cache data across timeframe switches.
  // The old cache (`lastValidDataRef`) caused cross-timeframe data contamination:
  // - Switch 1m → 5m: page clears data, but chart showed cached 1m data
  // - Switch 5m → 1m: page clears data, but chart showed cached 5m data
  // This led to "different 1m chart" bugs when switching timeframes.
  //
  // Now: empty data = show loading spinner. No caching between timeframes.
  // ============================================================================

  const safeData = useMemo(() => {
    // If no data, return empty (will show loading spinner)
    if (data.length === 0) {
      return data;
    }

    let result = data;

    // Ensure data is sorted by timestamp (oldest first)
    // This fixes the "latest candle at beginning" issue
    if (result.length > 1) {
      const first = result[0].timestamp;
      const last = result[result.length - 1].timestamp;

      if (first > last) {
        // Data is in reverse order (newest first), reverse it
        console.log(`[Chart3D] Data was in reverse order, reversing...`);
        result = [...result].reverse();
      }
    }

    return result;
  }, [data]);

  // ============================================================================
  // INDEX-BASED VIEW STATE
  // ============================================================================
  // We track start/end indices into the data array.
  // This ensures FIXED candle count regardless of time density.
  //
  // viewRange.startIdx = first visible candle index
  // viewRange.endIdx = last visible candle index (inclusive)
  // ============================================================================
  const [viewRange, setViewRange] = useState<IndexViewRange>({ startIdx: 0, endIdx: 0 });
  const viewRangeRef = useRef<IndexViewRange>({ startIdx: 0, endIdx: 0 });

  const [isMounted, setIsMounted] = useState(false);
  const lastUpdateTimeRef = useRef(0);

  // Shift+Right-click pan state
  const isPanningRef = useRef(false);
  const panStartXRef = useRef(0);
  const panStartViewRef = useRef<IndexViewRange>({ startIdx: 0, endIdx: 0 });

  const [isShiftHeld, setIsShiftHeld] = useState(false);
  const isShiftHeldRef = useRef(false);

  // Y-axis scale
  const [yScale, setYScale] = useState(1.0);
  const yScaleRef = useRef(1.0);

  const [hoveredCandle, setHoveredCandle] = useState<OHLCV | null>(null);

  // Fly mode
  const [isFlyMode, setIsFlyMode] = useState(false);
  const [showFlyModeInstructions, setShowFlyModeInstructions] = useState(false);

  // WebGL recovery
  const [webglKey, setWebglKey] = useState(0);
  const webglContextLostRef = useRef(false);

  // Drawing tools
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [activeTool, setActiveTool] = useState<DrawingToolType>(null);
  const [activeColor, setActiveColor] = useState(DRAWING_COLORS[0]);
  const [activeLineWidth, setActiveLineWidth] = useState(DEFAULT_LINE_WIDTH);
  const orbitControlsRef = useRef<any>(null);

  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  const handleWebglContextLost = useCallback(() => {
    console.warn('[Chart3D] WebGL context lost');
    webglContextLostRef.current = true;
  }, []);

  const handleWebglContextRestored = useCallback(() => {
    webglContextLostRef.current = false;
  }, []);

  useEffect(() => {
    if (webglContextLostRef.current) {
      const timer = setTimeout(() => {
        setWebglKey(k => k + 1);
        webglContextLostRef.current = false;
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [webglKey]);

  // ============================================================================
  // DATA STATISTICS - Calculate once per data change
  // ============================================================================
  const dataStats = useMemo(() => {
    if (safeData.length === 0) {
      return { minTs: 0, maxTs: 0, avgInterval: 60000, count: 0 };
    }
    const minTs = safeData[0].timestamp;
    const maxTs = safeData[safeData.length - 1].timestamp;
    const totalDuration = maxTs - minTs;
    const avgInterval = safeData.length > 1 ? totalDuration / (safeData.length - 1) : 60000;
    return { minTs, maxTs, avgInterval, count: safeData.length };
  }, [safeData]);

  // Track the previous timeframe and data to detect changes
  const prevTimeframeRef = useRef<string | undefined>(undefined);
  const prevDataLengthRef = useRef<number>(0);
  const prevFirstTsRef = useRef<number>(0);

  // ============================================================================
  // INITIALIZE/UPDATE VIEW RANGE WHEN DATA OR TIMEFRAME CHANGES
  // ============================================================================
  useEffect(() => {
    if (safeData.length === 0) {
      // Data was cleared (e.g., timeframe switch) - reset all tracking
      // so the NEXT data load is treated as a fresh dataset
      prevTimeframeRef.current = undefined;
      prevDataLengthRef.current = 0;
      prevFirstTsRef.current = 0;
      return;
    }

    const firstTs = safeData[0].timestamp;
    const prevLength = prevDataLengthRef.current;
    const newLength = safeData.length;

    // Detect if this is a completely different dataset:
    // 1. Timeframe changed (1s -> 1m, etc.)
    // 2. First load (no previous data)
    // 3. Data was cleared and re-populated (prevTimeframeRef.current is undefined)
    // 4. Current view indices are out of bounds for the new data
    //
    // NOTE: We do NOT check "token changed" by timestamp difference anymore.
    // Different timeframes have wildly different date ranges (1s = hours, 1d = years)
    // which caused false positives when switching DOWN in timeframe (e.g., 1h -> 1s).
    const timeframeChanged = timeframe !== prevTimeframeRef.current && prevTimeframeRef.current !== undefined;
    const isFirstLoad = prevLength === 0;
    const wasCleared = prevTimeframeRef.current === undefined;

    // Check if current view indices are invalid for the new data
    // This catches the case where cached stale data was used to set indices,
    // then real data arrives with fewer candles, making indices out of bounds
    const viewOutOfBounds = viewRangeRef.current.endIdx >= newLength || viewRangeRef.current.startIdx >= newLength;

    const isNewDataset = isFirstLoad || timeframeChanged || wasCleared || viewOutOfBounds;

    if (isNewDataset) {
      // New token/timeframe - initialize to show last N candles
      const startIdx = Math.max(0, newLength - TARGET_VISIBLE_CANDLES);
      const endIdx = newLength - 1;

      console.log(`[Chart3D] NEW DATASET (${newLength} candles, tf=${timeframe}): indices ${startIdx}-${endIdx}${timeframeChanged ? ' [TIMEFRAME]' : ''}${wasCleared ? ' [CLEARED]' : ''}${isFirstLoad ? ' [FIRST]' : ''}${viewOutOfBounds ? ' [OUT_OF_BOUNDS]' : ''}`);

      viewRangeRef.current = { startIdx, endIdx };
      setViewRange({ startIdx, endIdx });

      // Update tracking refs
      prevTimeframeRef.current = timeframe;
      prevDataLengthRef.current = newLength;
      prevFirstTsRef.current = firstTs;
    } else if (newLength > prevLength) {
      // Data was added to same dataset - check if prepended or appended
      const addedCount = newLength - prevLength;
      const currentVisibleCount = viewRangeRef.current.endIdx - viewRangeRef.current.startIdx;

      // Prepend detection: if new first timestamp is older than previous first timestamp
      const wasPrepended = firstTs < prevFirstTsRef.current;

      if (wasPrepended) {
        // Data was PREPENDED (historical data loaded on left)
        // Shift our indices right to keep viewing the same candles
        let newStartIdx = viewRangeRef.current.startIdx + addedCount;
        let newEndIdx = viewRangeRef.current.endIdx + addedCount;

        // Clamp to valid range while PRESERVING visible count
        if (newEndIdx >= newLength) {
          newEndIdx = newLength - 1;
          newStartIdx = Math.max(0, newEndIdx - currentVisibleCount);
        }
        if (newStartIdx < 0) {
          newStartIdx = 0;
          newEndIdx = Math.min(newLength - 1, newStartIdx + currentVisibleCount);
        }

        console.log(`[Chart3D] PREPENDED ${addedCount} (total: ${newLength}), indices -> ${newStartIdx}-${newEndIdx}`);

        viewRangeRef.current = { startIdx: newStartIdx, endIdx: newEndIdx };
        setViewRange({ startIdx: newStartIdx, endIdx: newEndIdx });
      } else {
        console.log(`[Chart3D] APPENDED ${addedCount} (total: ${newLength}), keeping indices`);
      }

      // Update tracking refs
      prevDataLengthRef.current = newLength;
      prevFirstTsRef.current = firstTs;
    } else {
      // Data shrunk or stayed same - just update tracking
      prevDataLengthRef.current = newLength;
      prevFirstTsRef.current = firstTs;
    }
  }, [safeData, timeframe]);

  // ============================================================================
  // DETECT LEFT EDGE FOR LOADING MORE DATA
  // ============================================================================
  useEffect(() => {
    if (safeData.length === 0 || !hasMoreData || isLoadingMore || !onLoadMore) return;

    // If view starts within 10 candles of the beginning, request more
    if (viewRangeRef.current.startIdx <= 10) {
      onLoadMore();
    }
  }, [viewRange, safeData, hasMoreData, isLoadingMore, onLoadMore]);

  // ============================================================================
  // VISIBLE DATA - Uses index range to slice data (FIXED candle count)
  // ============================================================================
  // NOTE: This memo runs BEFORE the view initialization effect in the same render.
  // So when switching timeframes, we may have stale viewRange from the previous
  // timeframe. We must detect this and show correct data anyway.
  // ============================================================================
  const visibleData = useMemo(() => {
    if (safeData.length === 0) {
      return [];
    }

    // Detect if viewRange is stale/uninitialized for this data:
    // 1. Both indices are 0 (initial state)
    // 2. endIdx is beyond the data length (stale from larger dataset)
    // 3. The visible count is wildly different from TARGET (stale from different timeframe)
    const isUninitialized = viewRange.startIdx === 0 && viewRange.endIdx === 0;
    const isOutOfBounds = viewRange.endIdx >= safeData.length;
    const currentVisibleCount = viewRange.endIdx - viewRange.startIdx + 1;
    const expectedMinCount = Math.min(TARGET_VISIBLE_CANDLES, safeData.length);
    // If visible count is less than half of expected and we have more data, it's stale
    const isStaleCount = currentVisibleCount < expectedMinCount / 2 && safeData.length > currentVisibleCount * 2;

    if (isUninitialized || isOutOfBounds || isStaleCount) {
      // Show the most recent N candles until effect properly initializes viewRange
      const startIdx = Math.max(0, safeData.length - TARGET_VISIBLE_CANDLES);
      const endIdx = safeData.length - 1;
      return safeData.slice(startIdx, endIdx + 1);
    }

    // Normal path: use viewRange as-is
    const desiredCount = viewRange.endIdx - viewRange.startIdx + 1;

    // Clamp endIdx first
    let endIdx = Math.min(safeData.length - 1, viewRange.endIdx);

    // Then calculate startIdx to maintain the visible count
    let startIdx = endIdx - desiredCount + 1;

    // If startIdx goes negative, clamp it and adjust endIdx
    if (startIdx < 0) {
      startIdx = 0;
      endIdx = Math.min(safeData.length - 1, startIdx + desiredCount - 1);
    }

    // Safety check - should never happen but just in case
    if (startIdx > endIdx || endIdx < 0) {
      console.warn(`[Chart3D] Invalid indices: ${startIdx}-${endIdx}, falling back to last ${TARGET_VISIBLE_CANDLES}`);
      startIdx = Math.max(0, safeData.length - TARGET_VISIBLE_CANDLES);
      endIdx = safeData.length - 1;
    }

    const slice = safeData.slice(startIdx, endIdx + 1);
    return slice;
  }, [safeData, viewRange]);

  // Chart layout constants
  const CHART_WIDTH = 60; // Viewport width (what camera sees)
  const PRICE_HEIGHT = 10;
  const VOLUME_HEIGHT = 3;
  const VOLUME_Z_OFFSET = 4;

  // FIXED candle size - like TradingView, candles never change size
  const FIXED_SPACING = 0.4;
  const spacing = FIXED_SPACING;
  const candleWidth = FIXED_SPACING * 0.8; // 80% of spacing for slight gap
  const candleDepth = candleWidth;

  // Calculate price bounds from visible data (auto-adjusts Y-axis)
  // IMPORTANT: Uses IQR-based outlier filtering to prevent extreme stretching
  const bounds = useMemo(() => {
    if (visibleData.length === 0) {
      return { minPrice: 0, maxPrice: 1, maxVolume: 1, priceRange: 1 };
    }

    // Collect all prices for outlier detection
    const allPrices: number[] = [];
    let maxVolume = 0;

    for (const candle of visibleData) {
      // Include all price points from each candle
      if (isFinite(candle.open) && candle.open > 0) allPrices.push(candle.open);
      if (isFinite(candle.close) && candle.close > 0) allPrices.push(candle.close);
      if (isFinite(candle.high) && candle.high > 0) allPrices.push(candle.high);
      if (isFinite(candle.low) && candle.low > 0) allPrices.push(candle.low);
      if (isFinite(candle.volume)) maxVolume = Math.max(maxVolume, candle.volume);
    }

    // Include current live price
    if (price && isFinite(price) && price > 0) {
      allPrices.push(price);
    }

    if (allPrices.length === 0) {
      return { minPrice: 0, maxPrice: 1, maxVolume: maxVolume || 1, priceRange: 1 };
    }

    // Sort prices for percentile calculation
    allPrices.sort((a, b) => a - b);

    // Use IQR (Interquartile Range) to filter outliers
    // Q1 = 25th percentile, Q3 = 75th percentile
    const q1Index = Math.floor(allPrices.length * 0.25);
    const q3Index = Math.floor(allPrices.length * 0.75);
    const q1 = allPrices[q1Index];
    const q3 = allPrices[q3Index];
    const iqr = q3 - q1;

    // Define bounds: Q1 - 2*IQR to Q3 + 2*IQR (wider than typical 1.5*IQR for trading charts)
    // This keeps most price action but filters extreme outliers
    const lowerBound = q1 - 2 * iqr;
    const upperBound = q3 + 2 * iqr;

    // Filter prices within bounds (or use percentiles if IQR is 0)
    let filteredPrices = allPrices.filter(p => p >= lowerBound && p <= upperBound);

    // If filtering removed too much data, fall back to 2nd-98th percentile
    if (filteredPrices.length < allPrices.length * 0.5) {
      const p2Index = Math.floor(allPrices.length * 0.02);
      const p98Index = Math.floor(allPrices.length * 0.98);
      filteredPrices = allPrices.slice(p2Index, p98Index + 1);
    }

    // If still empty, use all prices
    if (filteredPrices.length === 0) {
      filteredPrices = allPrices;
    }

    let minPrice = filteredPrices[0];
    let maxPrice = filteredPrices[filteredPrices.length - 1];

    // Fallback for bad data
    if (!isFinite(minPrice) || !isFinite(maxPrice) || minPrice <= 0 || maxPrice <= 0) {
      return { minPrice: 0, maxPrice: 1, maxVolume: maxVolume || 1, priceRange: 1 };
    }

    // Calculate the actual price range from the data
    let priceRange = maxPrice - minPrice;
    const midPrice = (maxPrice + minPrice) / 2;

    // Handle flat data (all same price or very close)
    if (priceRange === 0 || priceRange / midPrice < 0.0001) {
      // Expand to show ±0.5% around the price for flat data
      const halfRange = midPrice * 0.005;
      minPrice = midPrice - halfRange;
      maxPrice = midPrice + halfRange;
      priceRange = maxPrice - minPrice;
    } else {
      // Add padding (10%) to give candles breathing room
      const pricePadding = priceRange * 0.1;
      minPrice = minPrice - pricePadding;
      maxPrice = maxPrice + pricePadding;
      priceRange = maxPrice - minPrice;
    }

    // Don't apply yScale here - we'll use Three.js group scale transform instead
    // This ensures the entire chart (grid, axis, candles) scales together visually

    return {
      minPrice,
      maxPrice,
      maxVolume: maxVolume || 1,
      priceRange,
    };
  }, [visibleData, price]);

  // Camera position
  const cameraPosition = useMemo(() => {
    return [CHART_WIDTH / 2, PRICE_HEIGHT * 0.8, 45] as [number, number, number];
  }, []);

  const targetPosition = useMemo(() => {
    return [CHART_WIDTH / 2, PRICE_HEIGHT / 2, 0] as [number, number, number];
  }, []);

  // Normalize price to 0-PRICE_HEIGHT range
  const normalizePrice = (price: number) => {
    if (!isFinite(price)) return PRICE_HEIGHT / 2;
    if (bounds.priceRange === 0) return PRICE_HEIGHT / 2;
    const normalized = ((price - bounds.minPrice) / bounds.priceRange) * PRICE_HEIGHT;
    // Clamp to valid range (Y scaling is done via group transform)
    return Math.max(0, Math.min(PRICE_HEIGHT, normalized));
  };

  // Normalize volume to 0-VOLUME_HEIGHT range
  const normalizeVolume = (volume: number) => {
    if (bounds.maxVolume === 0) return 0;
    return (volume / bounds.maxVolume) * VOLUME_HEIGHT;
  };

  // Format date range for display
  const dateRange = useMemo(() => {
    if (visibleData.length === 0) return "";
    const startDate = new Date(visibleData[0].timestamp);
    const endDate = new Date(visibleData[visibleData.length - 1].timestamp);
    const formatDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${formatDate(startDate)} - ${formatDate(endDate)}`;
  }, [visibleData]);

  // Price change for visible range (with percent calculation)
  const priceChange = useMemo(() => {
    if (visibleData.length < 2) return { value: 0, percent: 0, isPositive: true };
    const firstPrice = visibleData[0].open;
    const lastPrice = visibleData[visibleData.length - 1].close;
    const change = lastPrice - firstPrice;
    const percent = firstPrice > 0 ? (change / firstPrice) * 100 : 0;
    return { value: change, percent, isPositive: change >= 0 };
  }, [visibleData]);

  // ============================================================================
  // PAN BY CANDLES (index-based navigation)
  // ============================================================================
  // Positive count = pan right (toward newer data)
  // Negative count = pan left (toward older data)
  // Returns true if pan was successful, false if hit boundary
  const panByCandles = useCallback((count: number): boolean => {
    if (safeData.length === 0) return false;

    const visibleCount = viewRangeRef.current.endIdx - viewRangeRef.current.startIdx;
    let newStart = viewRangeRef.current.startIdx + count;
    let newEnd = viewRangeRef.current.endIdx + count;

    let hitBoundary = false;

    // Clamp to data range
    if (newStart < 0) {
      newStart = 0;
      newEnd = visibleCount;
      hitBoundary = count < 0;
    }
    if (newEnd >= safeData.length) {
      newEnd = safeData.length - 1;
      newStart = Math.max(0, newEnd - visibleCount);
      hitBoundary = count > 0;
    }

    // Only update if position actually changed
    if (newStart === viewRangeRef.current.startIdx) {
      return !hitBoundary;
    }

    viewRangeRef.current = { startIdx: newStart, endIdx: newEnd };
    setViewRange({ startIdx: newStart, endIdx: newEnd });

    return !hitBoundary;
  }, [safeData.length]);

  // Seek to a specific start index (used by timeline slider)
  const seekToIndex = useCallback((newStartIdx: number) => {
    if (safeData.length === 0) return;

    const visibleCount = viewRangeRef.current.endIdx - viewRangeRef.current.startIdx;
    const maxStartIdx = Math.max(0, safeData.length - visibleCount - 1);

    // Clamp to valid range
    const clampedStart = Math.max(0, Math.min(maxStartIdx, newStartIdx));
    const newEnd = Math.min(safeData.length - 1, clampedStart + visibleCount);

    viewRangeRef.current = { startIdx: clampedStart, endIdx: newEnd };
    setViewRange({ startIdx: clampedStart, endIdx: newEnd });
  }, [safeData.length]);

  // Scroll wheel to pan time axis left/right
  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.shiftKey) return; // Y-axis scaling handled elsewhere

    const target = e.target as HTMLElement;
    if (target.tagName === 'CANVAS') return;

    e.preventDefault();

    const now = Date.now();
    if (now - lastUpdateTimeRef.current < 50) return;
    lastUpdateTimeRef.current = now;

    if (safeData.length === 0) return;

    // Pan by ~20 candles per scroll
    const direction = e.deltaY > 0 ? 1 : -1;
    panByCandles(direction * 20);
  }, [safeData.length, panByCandles]);

  // Keep refs in sync with state
  useEffect(() => {
    viewRangeRef.current = viewRange;
  }, [viewRange]);

  // Attach wheel event listener with passive: false to allow preventDefault
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  // Double-click to reset view to most recent candles
  const handleDoubleClick = useCallback(() => {
    if (safeData.length === 0) return;

    const startIdx = Math.max(0, safeData.length - TARGET_VISIBLE_CANDLES);
    const endIdx = safeData.length - 1;

    viewRangeRef.current = { startIdx, endIdx };
    setViewRange({ startIdx, endIdx });
    setYScale(1.0);
    yScaleRef.current = 1.0;
  }, [safeData.length]);

  // Track shift key state globally for panning and disabling OrbitControls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        isShiftHeldRef.current = true;
        setIsShiftHeld(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        isShiftHeldRef.current = false;
        setIsShiftHeld(false);
        // Also stop panning when shift is released
        isPanningRef.current = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Shift+Right-click drag to pan X-axis (index-based)
  useEffect(() => {
    if (!isMounted) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (!e.shiftKey || e.button !== 2) return;

      const container = canvasContainerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right ||
          e.clientY < rect.top || e.clientY > rect.bottom) {
        return;
      }

      e.preventDefault();
      isPanningRef.current = true;
      panStartXRef.current = e.clientX;
      panStartViewRef.current = { ...viewRangeRef.current };
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isPanningRef.current) return;

      const container = canvasContainerRef.current;
      if (!container) return;

      const now = Date.now();
      if (now - lastUpdateTimeRef.current < 33) return;
      lastUpdateTimeRef.current = now;

      if (safeData.length === 0) return;

      const rect = container.getBoundingClientRect();
      const deltaX = (e.clientX - panStartXRef.current) / rect.width;

      const visibleCount = panStartViewRef.current.endIdx - panStartViewRef.current.startIdx;

      // Drag right = move toward newer data (positive indices)
      // Use total data length for sensitivity scaling
      const panAmount = Math.round(-deltaX * safeData.length * 0.5);

      let newStart = panStartViewRef.current.startIdx + panAmount;
      let newEnd = panStartViewRef.current.endIdx + panAmount;

      // Clamp to data range
      if (newStart < 0) {
        newStart = 0;
        newEnd = visibleCount;
      }
      if (newEnd >= safeData.length) {
        newEnd = safeData.length - 1;
        newStart = Math.max(0, newEnd - visibleCount);
      }

      viewRangeRef.current = { startIdx: newStart, endIdx: newEnd };
      setViewRange({ startIdx: newStart, endIdx: newEnd });
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 2 && isPanningRef.current) {
        isPanningRef.current = false;
      }
    };

    // Prevent context menu when shift is held (for pan gesture)
    const handleContextMenu = (e: MouseEvent) => {
      if (e.shiftKey) {
        e.preventDefault();
        return false;
      }
    };

    // Use window-level listeners to catch events even when canvas captures them
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('contextmenu', handleContextMenu);

    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [isMounted]);

  // Y-axis scaling with Shift+Scroll
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      // Shift+Scroll = Y-axis zoom
      if (e.shiftKey) {
        e.preventDefault();

        const zoomIn = e.deltaY < 0;
        const zoomFactor = zoomIn ? 1.1 : 0.9;

        const newScale = Math.max(0.5, Math.min(3.0, yScaleRef.current * zoomFactor));
        yScaleRef.current = newScale;
        setYScale(newScale);
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [isMounted]); // Re-run when mounted to ensure container ref is ready

  // Keep yScaleRef in sync
  useEffect(() => {
    yScaleRef.current = yScale;
  }, [yScale]);

  // Toggle fly mode with Shift+Enter
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        setIsFlyMode((prev) => {
          const newMode = !prev;
          if (newMode) {
            // Show instructions when entering fly mode
            setShowFlyModeInstructions(true);
          }
          return newMode;
        });
        console.log("[Chart3D] Fly mode toggled:", !isFlyMode);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFlyMode]);

  // Auto-hide fly mode instructions after 4 seconds
  useEffect(() => {
    if (showFlyModeInstructions) {
      const timer = setTimeout(() => {
        setShowFlyModeInstructions(false);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [showFlyModeInstructions]);

  // Exit fly mode handler
  const handleExitFlyMode = useCallback(() => {
    setIsFlyMode(false);
    console.log("[Chart3D] Exited fly mode");
  }, []);

  // Use actual token price if provided, otherwise fall back to OHLCV last close
  const currentPrice = price ?? (visibleData.length > 0 ? visibleData[visibleData.length - 1].close : 0);

  // Drawing tool handlers
  const handleDrawingComplete = useCallback((drawing: Drawing) => {
    setDrawings((prev) => [...prev, drawing]);
    console.log("[Chart3D] Drawing completed:", drawing.type, drawing.id);
  }, []);

  const handleClearAllDrawings = useCallback(() => {
    setDrawings([]);
    console.log("[Chart3D] All drawings cleared");
  }, []);

  // ESC to deselect drawing tool
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && activeTool) {
        e.preventDefault();
        setActiveTool(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTool]);

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full select-none flex ${renderToolbar ? "flex-row" : "flex-row"} ${renderToolbar ? '' : (isDark ? 'bg-[#0a0a0a]' : 'bg-gray-50')}`}
      onDoubleClick={handleDoubleClick}
    >
      {/* Coral swirl background - only show when not using custom toolbar (landing page has its own) */}
      {!renderToolbar && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px]">
            <div className={`absolute inset-0 bg-gradient-conic from-[#FF6B4A]/30 via-[#FF8F6B]/15 via-[#FF6B4A]/20 to-[#FF6B4A]/30 blur-[80px] animate-slow-spin ${isDark ? '' : 'opacity-50'}`} />
          </div>
          <div className={`absolute inset-0 ${isDark ? 'bg-[#0a0a0a]/60' : 'bg-white/60'}`} />
        </div>
      )}

      {isLoading && (
        <div className={`absolute inset-0 z-10 flex items-center justify-center ${isDark ? 'bg-[#0a0a0a]/80' : 'bg-white/80'}`}>
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FF6B4A] border-t-transparent" />
        </div>
      )}

      {/* Drawing toolbar - use custom renderer if provided, otherwise default */}
      {showDrawingTools && !isFlyMode && !renderToolbar && (
        <div className="flex-shrink-0 p-2 z-20">
          <DrawingToolbar
            activeTool={activeTool}
            activeColor={activeColor}
            activeLineWidth={activeLineWidth}
            onToolChange={setActiveTool}
            onColorChange={setActiveColor}
            onLineWidthChange={setActiveLineWidth}
            onClearAll={handleClearAllDrawings}
            drawingCount={drawings.length}
            isDark={isDark}
          />
        </div>
      )}

      {/* Custom toolbar rendered externally */}
      {renderToolbar && renderToolbar({
        activeTool,
        activeColor,
        activeLineWidth,
        onToolChange: setActiveTool,
        onColorChange: setActiveColor,
        onLineWidthChange: setActiveLineWidth,
        onClearAll: handleClearAllDrawings,
        drawingCount: drawings.length,
      })}

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Price/Market Cap display - HIDDEN on mobile to prevent overlap with candles */}
        {/* When renderToolbar is used or showDrawingTools is false, hide the price display */}
        {!renderToolbar && showDrawingTools && (
          <div className="hidden md:block absolute top-4 left-4 z-10">
            {showMarketCap && marketCap ? (
              <>
                <div className={`text-xs mb-0.5 ${isDark ? 'text-white/50' : 'text-gray-500'}`}>Market Cap</div>
                <div className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>${formatNumber(marketCap)}</div>
              </>
            ) : price ? (
              <div className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>${formatPrice(price)}</div>
            ) : (
              <div className={`text-2xl font-bold ${isDark ? 'text-white/50' : 'text-gray-400'}`}>Loading...</div>
            )}
            <div className={`text-xs ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
              {dateRange} • {visibleData.length}{safeData.length > visibleData.length ? ` of ${safeData.length}` : ''} candles
            </div>
          </div>
        )}

        {/* Price change percentage display - HIDDEN on mobile */}
        {!renderToolbar && showDrawingTools && !isFlyMode && (
          <div className="hidden md:block absolute top-4 z-10 text-right" style={{ right: "200px" }}>
            <div className={`text-sm font-medium ${priceChange.isPositive ? "text-up" : "text-down"}`}>
              {priceChange.isPositive ? "+" : ""}${formatPrice(priceChange.value)} ({priceChange.isPositive ? "+" : ""}{priceChange.percent.toFixed(2)}%)
            </div>
            <div className={`text-xs ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
              visible range
            </div>
          </div>
        )}

        {/* 3D Canvas - keep mounted to prevent WebGL context recreation */}
        <div ref={canvasContainerRef} className="flex-1 relative">
        {isMounted && (
          <Canvas
            key={webglKey}
            className="rounded-xl"
            gl={{
              antialias: true,
              preserveDrawingBuffer: true,
              powerPreference: "high-performance",
              failIfMajorPerformanceCaveat: false,
              alpha: true // Enable transparency for coral gradient to show through
            }}
            onCreated={({ gl, scene }) => {
              console.log('[Chart3D] Canvas created (key:', webglKey, ')');
              // Transparent background to show coral gradient behind
              scene.background = null;
              gl.setClearColor(0x000000, 0); // Fully transparent
              // Handle WebGL context loss
              gl.domElement.addEventListener('webglcontextlost', (e) => {
                console.error('[Chart3D] WebGL context lost!', e);
                e.preventDefault();
                handleWebglContextLost();
              });
              gl.domElement.addEventListener('webglcontextrestored', () => {
                console.log('[Chart3D] WebGL context restored');
                handleWebglContextRestored();
              });
            }}
          >
            <SceneBackground isDark={isDark} />
            <Suspense fallback={null}>
              <PerspectiveCamera makeDefault position={cameraPosition} fov={50} />

              <ambientLight intensity={0.5} />
              <directionalLight position={[10, 20, 10]} intensity={1} />
              <pointLight position={[-10, 10, -10]} intensity={0.4} />

              {/* Wrap entire chart in a group that scales on Y-axis based on yScale */}
              {/* Scale is applied around the chart's vertical center (PRICE_HEIGHT/2) */}
              {visibleData.length > 0 && (
                <group
                  scale={[1, yScale, 1]}
                  position={[0, PRICE_HEIGHT / 2 * (1 - yScale), 0]}
                >
                  {/* Grid and axes */}
                  <ChartGrid width={CHART_WIDTH} height={PRICE_HEIGHT} depth={VOLUME_Z_OFFSET + 4} isDark={isDark} />
                  <ChartAxis
                    minPrice={bounds.minPrice}
                    maxPrice={bounds.maxPrice}
                    candleCount={visibleData.length}
                    chartWidth={CHART_WIDTH}
                    chartHeight={PRICE_HEIGHT}
                    showMarketCap={showMarketCap}
                    data={visibleData}
                    spacing={spacing}
                    isDark={isDark}
                  />

                  {/* Candlesticks */}
                  {visibleData.map((candle, index) => (
                    <Candlestick3D
                      key={`${candle.timestamp}-${index}`}
                      index={index}
                      open={normalizePrice(candle.open)}
                      high={normalizePrice(candle.high)}
                      low={normalizePrice(candle.low)}
                      close={normalizePrice(candle.close)}
                      isUp={candle.close >= candle.open}
                      isLatest={index === visibleData.length - 1}
                      spacing={spacing}
                      width={candleWidth}
                      depth={candleDepth}
                    />
                  ))}

                  {/* Volume bars */}
                  {visibleData.map((candle, index) => (
                    <VolumeBar3D
                      key={`vol-${candle.timestamp}-${index}`}
                      index={index}
                      height={normalizeVolume(candle.volume)}
                      isUp={candle.close >= candle.open}
                      spacing={spacing}
                      width={candleWidth}
                      depth={candleDepth}
                      zOffset={VOLUME_Z_OFFSET}
                    />
                  ))}

                  {/* 3D Watermark - rendered into the canvas for free tier */}
                  {showWatermark && (
                    <Watermark3D chartWidth={CHART_WIDTH} chartHeight={PRICE_HEIGHT} />
                  )}
                </group>
              )}

              {/* OrbitControls - disabled in fly mode, when drawing, or when shift is held for pan */}
              <OrbitControls
                ref={orbitControlsRef}
                enabled={!isFlyMode && !activeTool && !isShiftHeld}
                enablePan={true}
                enableZoom={true}
                enableRotate={true}
                minDistance={15}
                maxDistance={100}
                minPolarAngle={0.2}
                maxPolarAngle={Math.PI / 2.2}
                target={targetPosition}
              />

              {/* Drawing layer */}
              <DrawingLayer
                drawings={drawings}
                activeTool={activeTool}
                activeColor={activeColor}
                activeLineWidth={activeLineWidth}
                onDrawingComplete={handleDrawingComplete}
                enabled={!isFlyMode}
                orbitControlsRef={orbitControlsRef}
              />

              {/* FlyControls - enabled in fly mode */}
              <FlyControls
                enabled={isFlyMode}
                movementSpeed={20}
                lookSpeed={0.002}
                onExit={handleExitFlyMode}
              />

              <Environment preset="night" />
            </Suspense>
          </Canvas>
        )}
        {/* Overlay message when no data */}
        {isMounted && visibleData.length === 0 && !isLoading && (
          <div className={`absolute inset-0 flex items-center justify-center ${isDark ? 'text-white/50 bg-[#0a0a0a]/80' : 'text-gray-500 bg-white/80'}`}>
            No chart data available
          </div>
        )}
        </div>

        {/* Speed ball control - hide when using custom toolbar (compact mode) or when showDrawingTools is false */}
        {!renderToolbar && showDrawingTools && (
          <div className="mx-4 mb-2 flex items-center justify-center">
            <TimelineSlider
              onSeek={seekToIndex}
              isDark={isDark}
              dataLength={safeData.length}
              visibleCount={visibleData.length}
              startIdx={Math.max(0, Math.min(viewRange.startIdx, safeData.length - visibleData.length))}
            />
          </div>
        )}
      </div>

      {/* Loading more indicator */}
      {isLoadingMore && (
        <div className={`absolute top-4 right-4 z-10 flex items-center gap-2 backdrop-blur-md border px-3 py-1.5 ${
          isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'
        }`}>
          <div className="h-3 w-3 animate-spin rounded-full border border-[#FF6B4A] border-t-transparent" />
          <span className={`text-xs ${isDark ? 'text-white/50' : 'text-gray-500'}`}>Loading more...</span>
        </div>
      )}

      {/* Fly mode hint - shown above chart when not in fly mode (only when drawing tools visible), HIDDEN on mobile */}
      {showDrawingTools && !isFlyMode && (
        <div className="hidden md:block absolute top-4 right-4 z-10">
          <div className={`border px-3 py-1.5 text-xs ${isDark ? 'bg-[#FF6B4A]/10 border-[#FF6B4A]/30' : 'bg-[#FF6B4A]/10 border-[#FF6B4A]/40'}`}>
            <span className="text-[#FF6B4A] font-medium">Shift+Enter</span>
            <span className={isDark ? 'text-white/50' : 'text-gray-500'}> for fly mode</span>
          </div>
        </div>
      )}

      {/* Fly mode instructions - shown for 4 seconds after entering fly mode */}
      {isFlyMode && showFlyModeInstructions && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none animate-in fade-in duration-300">
          <div className={`flex flex-col items-center gap-2 backdrop-blur-md px-6 py-4 border border-[#FF6B4A]/50 ${
            isDark ? 'bg-[#0a0a0a]/90' : 'bg-white/90'
          }`}>
            <div className="text-[#FF6B4A] font-bold text-lg">FLY MODE</div>
            <div className={`text-xs text-center space-y-1 ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
              <p>Click to lock mouse - ESC to exit</p>
              <p className="font-mono">W/S: Forward/Back - A/D: Strafe</p>
              <p className="font-mono">Q/E: Down/Up - Shift: Speed boost</p>
            </div>
          </div>
        </div>
      )}

      {/* Fly mode active indicator - shown in corner when in fly mode */}
      {isFlyMode && !showFlyModeInstructions && (
        <div className="absolute top-4 right-4 z-10">
          <div className="bg-[#FF6B4A]/20 border border-[#FF6B4A] px-3 py-1.5 text-xs">
            <span className="text-[#FF6B4A] font-bold">FLY MODE</span>
            <span className={isDark ? 'text-white/50' : 'text-gray-500'}> - ESC to exit</span>
          </div>
        </div>
      )}

      {/* Controls hint - only shown when drawing tools visible, HIDDEN on mobile */}
      {showDrawingTools && (
        <div className={`hidden md:block absolute bottom-14 left-4 backdrop-blur-md border px-3 py-1.5 text-xs ${
          isDark ? 'bg-white/5 border-white/10 text-white/50' : 'bg-black/5 border-black/10 text-gray-500'
        }`}>
          {isFlyMode ? (
            "WASD: move - Q/E: up/down - Mouse: look - Shift: speed - ESC: exit"
          ) : (
            "Drag: rotate - Scroll: zoom - Shift+Scroll: scale Y - Shift+Right-drag: pan history - Double-click: reset"
          )}
        </div>
      )}
    </div>
  );
}
