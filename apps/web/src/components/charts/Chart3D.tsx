"use client";

import { Suspense, useMemo, useState, useRef, useEffect, useCallback } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, Environment } from "@react-three/drei";
import * as THREE from "three";

// Component to reactively update scene background based on theme
function SceneBackground({ isDark }: { isDark: boolean }) {
  const { scene } = useThree();

  useEffect(() => {
    scene.background = new THREE.Color(isDark ? '#0a0a0a' : '#f9fafb');
  }, [scene, isDark]);

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

// Speed ball control component - drag left/right with exponential speed increase
interface SpeedBallControlProps {
  onPan: (candles: number) => boolean; // Returns false if hit boundary
  isDark: boolean;
  dataLength: number;
  viewStart: number; // 0-1 position
  viewEnd: number;   // 0-1 position
}

function SpeedBallControl({ onPan, isDark, dataLength, viewStart, viewEnd }: SpeedBallControlProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ballRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0); // -1 to 1, 0 is center
  const [hitBoundary, setHitBoundary] = useState<'left' | 'right' | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const startXRef = useRef(0);
  const containerWidthRef = useRef(0);
  const dragOffsetRef = useRef(0); // Ref to avoid stale closure in interval

  // Check if at boundaries
  const atLeftBoundary = viewStart <= 0.001;
  const atRightBoundary = viewEnd >= 0.999;

  // Keep ref in sync with state
  useEffect(() => {
    dragOffsetRef.current = dragOffset;
  }, [dragOffset]);

  // Calculate candles to pan based on drag offset (exponential)
  const calculatePanSpeed = useCallback((offset: number): number => {
    if (Math.abs(offset) < 0.1) return 0; // Dead zone in center

    // Exponential scaling: further from center = exponentially faster
    // offset is -1 to 1, we want speed to be 1-500+ candles per tick
    const absOffset = Math.abs(offset);
    const direction = offset > 0 ? 1 : -1;

    // Base speed scales with data size
    const baseSpeed = Math.max(1, Math.floor(dataLength / 500));

    // Exponential: at offset 0.1 = slow, at offset 1.0 = very fast
    // Using power of 2.5 for smooth exponential feel
    const speedMultiplier = Math.pow(absOffset, 2.5) * 50;

    return Math.round(direction * baseSpeed * speedMultiplier);
  }, [dataLength]);

  // Interval-based panning (throttled to ~10fps instead of 60fps)
  useEffect(() => {
    if (isDragging) {
      // Pan every 100ms for smoother, less spammy updates
      intervalRef.current = setInterval(() => {
        const candles = calculatePanSpeed(dragOffsetRef.current);
        if (candles !== 0) {
          const success = onPan(candles);
          if (!success) {
            // Hit a boundary
            setHitBoundary(candles < 0 ? 'left' : 'right');
          } else {
            setHitBoundary(null);
          }
        }
      }, 100);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    }
  }, [isDragging, calculatePanSpeed, onPan]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return;
    e.preventDefault();
    setIsDragging(true);
    setHitBoundary(null);
    startXRef.current = e.clientX;
    containerWidthRef.current = containerRef.current.offsetWidth;
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const deltaX = e.clientX - startXRef.current;
      const maxDrag = containerWidthRef.current / 2;

      // Clamp offset to -1 to 1
      const newOffset = Math.max(-1, Math.min(1, deltaX / maxDrag));
      setDragOffset(newOffset);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setDragOffset(0);
      setHitBoundary(null);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Visual feedback: ball position and glow intensity
  const ballStyle = useMemo(() => {
    const translateX = dragOffset * 30; // Max 30px offset visual
    const glowIntensity = Math.abs(dragOffset);
    let glowColor = dragOffset > 0 ? '#10b981' : '#ef4444'; // Green right, red left

    // If hit boundary, use orange/warning color
    if (hitBoundary) {
      glowColor = '#f59e0b'; // Amber for boundary
    }

    return {
      transform: `translateX(${translateX}px)`,
      boxShadow: glowIntensity > 0.1
        ? `0 0 ${10 + glowIntensity * 20}px ${glowColor}`
        : 'none',
      transition: isDragging ? 'none' : 'all 0.2s ease-out',
    };
  }, [dragOffset, isDragging, hitBoundary]);

  // Speed indicator text
  const speedText = useMemo(() => {
    if (hitBoundary) {
      return hitBoundary === 'left' ? '◀ START' : 'END ▶';
    }
    const speed = Math.abs(calculatePanSpeed(dragOffset));
    if (speed === 0) return null;
    return `${speed}/tick`;
  }, [dragOffset, calculatePanSpeed, hitBoundary]);

  // Position indicator (show current position in data)
  const positionText = useMemo(() => {
    if (dataLength === 0) return '';
    const startIdx = Math.floor(viewStart * dataLength);
    const endIdx = Math.floor(viewEnd * dataLength);
    return `${startIdx + 1}-${endIdx}`;
  }, [viewStart, viewEnd, dataLength]);

  return (
    <div className="flex items-center gap-2">
      {/* Position indicator */}
      <div className={`text-xs font-mono ${isDark ? 'text-white/30' : 'text-gray-400'}`}>
        {positionText}
      </div>

      <div
        ref={containerRef}
        className={`relative w-20 h-10 flex items-center justify-center select-none ${
          isDark ? 'bg-white/5' : 'bg-black/5'
        } border ${isDark ? 'border-white/10' : 'border-black/10'} cursor-ew-resize ${
          hitBoundary ? 'animate-pulse' : ''
        }`}
        title="Drag ball left/right to pan - further = faster"
      >
        {/* Direction indicators - highlight if at boundary */}
        <div className={`absolute left-1 text-xs ${
          atLeftBoundary
            ? 'text-amber-500'
            : isDark ? 'text-white/20' : 'text-gray-300'
        }`}>◀</div>
        <div className={`absolute right-1 text-xs ${
          atRightBoundary
            ? 'text-amber-500'
            : isDark ? 'text-white/20' : 'text-gray-300'
        }`}>▶</div>

        {/* Center track line */}
        <div className={`absolute w-12 h-0.5 ${isDark ? 'bg-white/10' : 'bg-black/10'}`} />

        {/* Draggable ball */}
        <div
          ref={ballRef}
          onMouseDown={handleMouseDown}
          className={`w-5 h-5 rounded-full cursor-grab active:cursor-grabbing z-10 ${
            hitBoundary
              ? 'bg-amber-500'
              : isDragging
                ? 'bg-[#FF6B4A]'
                : isDark ? 'bg-white/40 hover:bg-white/60' : 'bg-gray-400 hover:bg-gray-500'
          }`}
          style={ballStyle}
        />

        {/* Speed indicator tooltip */}
        {isDragging && speedText && (
          <div className={`absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 text-xs whitespace-nowrap ${
            hitBoundary
              ? 'bg-amber-500/20 text-amber-500 font-bold'
              : isDark ? 'bg-white/10 text-white/70' : 'bg-black/10 text-gray-600'
          }`}>
            {speedText}
          </div>
        )}
      </div>

      {/* Total candles */}
      <div className={`text-xs font-mono ${isDark ? 'text-white/30' : 'text-gray-400'}`}>
        /{dataLength}
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

export function Chart3D({ data, isLoading, showMarketCap, marketCap, price, onLoadMore, hasMoreData = true, isLoadingMore = false, showDrawingTools = true, renderToolbar, showWatermark = false, theme }: Chart3DProps) {
  const { isDark: globalIsDark } = useThemeStore();
  // Allow theme prop to override global theme
  const isDark = theme ? theme === "dark" : globalIsDark;
  // Debug: log when component receives new data
  console.log('[Chart3D] Render - data.length:', data.length, 'isLoading:', isLoading);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // CRITICAL: Cache last valid data to prevent crashes when parent sends empty array
  const lastValidDataRef = useRef<OHLCV[]>([]);

  // Use cached data if parent sends empty array (prevents chart crash)
  const safeData = useMemo(() => {
    if (data.length > 0) {
      lastValidDataRef.current = data;
      return data;
    }
    // If data is empty but we have cached data, use the cached data
    if (lastValidDataRef.current.length > 0) {
      console.log('[Chart3D] Using cached data, parent sent empty array');
      return lastValidDataRef.current;
    }
    return data;
  }, [data]);

  // Time axis zoom/pan state (CMC style)
  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState(1);
  const [isMounted, setIsMounted] = useState(false);

  // Refs to track current values for event handlers to avoid stale closures
  const viewStartRef = useRef(viewStart);
  const viewEndRef = useRef(viewEnd);

  // Throttle updates
  const lastUpdateTimeRef = useRef(0);

  // Shift+Left-click pan state (use ref for event handler to avoid stale closure)
  // Changed from right-click to left-click because OrbitControls uses right-click for rotation
  const isPanningRef = useRef(false);
  const panStartXRef = useRef(0);
  const panStartViewRef = useRef({ start: 0, end: 0 });

  // Track if shift is held - state for OrbitControls, ref for event handlers
  const [isShiftHeld, setIsShiftHeld] = useState(false);
  const isShiftHeldRef = useRef(false);

  // Y-axis scale state (1.0 = default, >1 = zoomed in, <1 = zoomed out)
  const [yScale, setYScale] = useState(1.0);
  const yScaleRef = useRef(1.0);

  // Hovered candle
  const [hoveredCandle, setHoveredCandle] = useState<OHLCV | null>(null);

  // Fly mode state - toggle with Shift+Enter
  const [isFlyMode, setIsFlyMode] = useState(false);
  const [showFlyModeInstructions, setShowFlyModeInstructions] = useState(false);

  // WebGL context loss recovery
  const [webglKey, setWebglKey] = useState(0);
  const webglContextLostRef = useRef(false);

  // Drawing tools state
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [activeTool, setActiveTool] = useState<DrawingToolType>(null);
  const [activeColor, setActiveColor] = useState(DRAWING_COLORS[0]);
  const [activeLineWidth, setActiveLineWidth] = useState(DEFAULT_LINE_WIDTH);
  const orbitControlsRef = useRef<any>(null);

  // Ensure component is mounted before rendering Canvas to prevent HMR issues
  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  // Handle WebGL context recovery by remounting Canvas
  const handleWebglContextLost = useCallback(() => {
    console.warn('[Chart3D] WebGL context lost - will attempt recovery');
    webglContextLostRef.current = true;
  }, []);

  const handleWebglContextRestored = useCallback(() => {
    console.log('[Chart3D] WebGL context restored');
    webglContextLostRef.current = false;
  }, []);

  // Auto-recover from WebGL context loss after a delay
  useEffect(() => {
    if (webglContextLostRef.current) {
      const timer = setTimeout(() => {
        console.log('[Chart3D] Attempting WebGL recovery by remounting Canvas');
        setWebglKey(k => k + 1);
        webglContextLostRef.current = false;
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [webglKey]);

  // Track previous data to detect when data is replaced vs prepended
  const prevDataRef = useRef<{ length: number; firstTimestamp: number | null; lastTimestamp: number | null }>({
    length: 0,
    firstTimestamp: null,
    lastTimestamp: null
  });

  // Fixed visible window size (200 candles)
  const VISIBLE_CANDLES = 200;

  // Track if user has manually navigated (panned) - if so, don't auto-reset view
  const userHasNavigatedRef = useRef(false);

  // Track the "identity" of the current dataset to detect token/timeframe switches
  // We use the MIDDLE candle's timestamp as a stable identifier
  // This is more stable than first/last which change with prepending/appending
  const currentDataIdentityRef = useRef<number | null>(null);

  // Set view when data changes
  // Uses fixed-width slider (200 candles) that can pan left/right
  useEffect(() => {
    const prevLength = prevDataRef.current.length;
    const prevFirstTs = prevDataRef.current.firstTimestamp;
    const newLength = safeData.length;
    const newFirstTs = safeData.length > 0 ? safeData[0].timestamp : null;
    const newLastTs = safeData.length > 0 ? safeData[safeData.length - 1].timestamp : null;

    if (newLength === 0) {
      prevDataRef.current = { length: 0, firstTimestamp: null, lastTimestamp: null };
      currentDataIdentityRef.current = null;
      userHasNavigatedRef.current = false;
      return;
    }

    // Get middle candle timestamp as stable identity marker
    const midIdx = Math.floor(newLength / 2);
    const midTs = safeData[midIdx]?.timestamp || null;

    // Check if this is a COMPLETELY DIFFERENT dataset (different token or major timeframe change)
    // We detect this by checking if the middle timestamp is wildly different
    const prevIdentity = currentDataIdentityRef.current;
    const identityChanged = prevIdentity === null || midTs === null ||
                           Math.abs(midTs - prevIdentity) > 3600000; // >1 hour difference = different data

    // Only reset view if:
    // 1. Identity changed (different token/timeframe) AND
    // 2. User hasn't manually navigated yet
    if (identityChanged && !userHasNavigatedRef.current) {
      console.log('[Chart3D] New dataset detected - initializing view');
      currentDataIdentityRef.current = midTs;

      if (newLength <= VISIBLE_CANDLES) {
        viewStartRef.current = 0;
        viewEndRef.current = 1;
        setViewStart(0);
        setViewEnd(1);
      } else {
        const visibleRatio = VISIBLE_CANDLES / newLength;
        const newStart = 1 - visibleRatio;
        viewStartRef.current = newStart;
        viewEndRef.current = 1;
        setViewStart(newStart);
        setViewEnd(1);
      }
    } else if (identityChanged && userHasNavigatedRef.current) {
      // New token but user was navigating - reset the navigation flag and initialize
      console.log('[Chart3D] New dataset + user navigated - resetting to new data');
      currentDataIdentityRef.current = midTs;
      userHasNavigatedRef.current = false;

      if (newLength <= VISIBLE_CANDLES) {
        viewStartRef.current = 0;
        viewEndRef.current = 1;
        setViewStart(0);
        setViewEnd(1);
      } else {
        const visibleRatio = VISIBLE_CANDLES / newLength;
        const newStart = 1 - visibleRatio;
        viewStartRef.current = newStart;
        viewEndRef.current = 1;
        setViewStart(newStart);
        setViewEnd(1);
      }
    } else if (newLength > prevLength && prevFirstTs !== null && newFirstTs !== null && newFirstTs < prevFirstTs) {
      // History was prepended (loaded more old data on left)
      // Keep the visible candles the same by adjusting view position
      const addedCandles = newLength - prevLength;
      const visibleRatio = VISIBLE_CANDLES / newLength;

      // Shift view right by the amount of prepended data
      const shiftRatio = addedCandles / newLength;
      const newStart = Math.min(1 - visibleRatio, viewStartRef.current + shiftRatio);
      const newEnd = Math.min(1, newStart + visibleRatio);

      console.log('[Chart3D] History prepended - shifting view by', shiftRatio.toFixed(3));
      viewStartRef.current = newStart;
      viewEndRef.current = newEnd;
      setViewStart(newStart);
      setViewEnd(newEnd);
    }
    // Otherwise: same dataset, user is navigating or data just updated - keep view

    prevDataRef.current = { length: newLength, firstTimestamp: newFirstTs, lastTimestamp: newLastTs };
  }, [safeData]);

  // Detect when user scrolls to left edge and request more data
  useEffect(() => {
    if (viewStart <= 0.01 && hasMoreData && !isLoadingMore && onLoadMore) {
      onLoadMore();
    }
  }, [viewStart, hasMoreData, isLoadingMore, onLoadMore]);

  // Maximum candles to render at once (prevents WebGL crashes)
  // Each candle = 3-4 meshes (body, upper wick, lower wick, glow)
  // 200 candles = ~600-800 meshes which is still safe for WebGL
  const MAX_VISIBLE_CANDLES = 200;

  // Get visible data slice (capped to prevent WebGL context loss)
  const visibleData = useMemo(() => {
    if (safeData.length === 0) {
      return [];
    }

    // Safe index calculation
    const dataLen = safeData.length;
    const startIdx = Math.max(0, Math.floor(viewStart * dataLen));
    const endIdx = Math.min(dataLen - 1, Math.ceil(viewEnd * dataLen));

    // Ensure we get at least one candle
    if (startIdx > endIdx) {
      return safeData.slice(-1); // Return last candle as fallback
    }

    const slice = safeData.slice(startIdx, endIdx + 1);

    // If too many candles, aggregate them into proper OHLCV candles
    if (slice.length > MAX_VISIBLE_CANDLES) {
      // Calculate how many candles to merge into one
      const groupSize = Math.ceil(slice.length / MAX_VISIBLE_CANDLES);
      const aggregated: typeof slice = [];

      for (let i = 0; i < slice.length; i += groupSize) {
        const group = slice.slice(i, Math.min(i + groupSize, slice.length));
        if (group.length === 0) continue;

        // Aggregate the group into a single OHLCV candle
        const aggregatedCandle = {
          timestamp: group[0].timestamp,
          open: group[0].open,
          high: Math.max(...group.map(c => c.high)),
          low: Math.min(...group.map(c => c.low)),
          close: group[group.length - 1].close,
          volume: group.reduce((sum, c) => sum + c.volume, 0),
        };
        aggregated.push(aggregatedCandle);
      }

      console.log('[Chart3D] Aggregated from', slice.length, 'to', aggregated.length, 'candles (group size:', groupSize, ')');
      return aggregated;
    }
    return slice;
  }, [safeData, viewStart, viewEnd]);

  // Chart layout constants
  const CHART_WIDTH = 60;
  const PRICE_HEIGHT = 10;
  const VOLUME_HEIGHT = 3;
  const VOLUME_Z_OFFSET = 4;

  // Calculate spacing based on visible candle count
  const candleCount = visibleData.length || 1;
  const spacing = CHART_WIDTH / candleCount;

  // Candle width - proportional to spacing but ensure visibility
  // Min 0.15 to ensure candles are always visible
  const candleWidth = Math.min(0.9, Math.max(0.15, spacing * 0.75));

  // Candle depth - proportional to spacing
  const candleDepth = Math.min(0.9, Math.max(0.15, spacing * 0.8));

  // Calculate price bounds from visible data (auto-adjusts Y-axis)
  // IMPORTANT: Include current live price so Y-axis reflects current market cap
  const bounds = useMemo(() => {
    if (visibleData.length === 0) {
      return { minPrice: 0, maxPrice: 1, maxVolume: 1, priceRange: 1 };
    }

    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let maxVolume = 0;

    for (const candle of visibleData) {
      // Use open/close for bounds instead of just high/low for smoother visualization
      const candleMin = Math.min(candle.open, candle.close, candle.low);
      const candleMax = Math.max(candle.open, candle.close, candle.high);

      if (isFinite(candleMin) && candleMin > 0) minPrice = Math.min(minPrice, candleMin);
      if (isFinite(candleMax) && candleMax > 0) maxPrice = Math.max(maxPrice, candleMax);
      if (isFinite(candle.volume)) maxVolume = Math.max(maxVolume, candle.volume);
    }

    // CRITICAL: Include current live price in bounds so Y-axis shows current market cap
    // This ensures the displayed "Market Cap: $X" is within the Y-axis range
    if (price && isFinite(price) && price > 0) {
      minPrice = Math.min(minPrice, price);
      maxPrice = Math.max(maxPrice, price);
    }

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

  // Pan by a number of candles (positive = right/newer, negative = left/older)
  // Returns true if pan was successful, false if hit boundary
  const panByCandles = useCallback((candleCount: number): boolean => {
    const dataLen = safeData.length;
    if (dataLen === 0) return false;

    const candleRatio = candleCount / dataLen;
    const fixedRange = Math.min(1, VISIBLE_CANDLES / dataLen);

    const currentStart = viewStartRef.current;
    const currentEnd = viewEndRef.current;

    let newStart = currentStart + candleRatio;
    let newEnd = newStart + fixedRange;

    // Clamp to valid range
    let hitBoundary = false;
    if (newStart < 0) {
      newStart = 0;
      newEnd = fixedRange;
      hitBoundary = candleCount < 0; // Hit left boundary while going left
    }
    if (newEnd > 1) {
      newEnd = 1;
      newStart = Math.max(0, 1 - fixedRange);
      hitBoundary = candleCount > 0; // Hit right boundary while going right
    }

    // Only update if position actually changed
    if (Math.abs(newStart - currentStart) < 0.0001 && Math.abs(newEnd - currentEnd) < 0.0001) {
      return false; // No change
    }

    // Mark that user has manually navigated - prevents auto-reset on data updates
    userHasNavigatedRef.current = true;

    // Update refs immediately so next pan call has correct values
    // (Don't wait for the useEffect to sync them after re-render)
    viewStartRef.current = newStart;
    viewEndRef.current = newEnd;

    setViewStart(newStart);
    setViewEnd(newEnd);

    return !hitBoundary;
  }, [safeData.length]);

  // Scroll wheel to pan time axis left/right - dynamic sensitivity
  // This handler is for the SLIDER area (non-canvas), canvas zoom is handled by OrbitControls
  const handleWheel = useCallback((e: WheelEvent) => {
    // Shift+Scroll is handled by Y-axis scaling effect, skip here
    if (e.shiftKey) return;

    // Only handle wheel on the slider/container area, NOT the canvas
    // Canvas zoom is handled by OrbitControls directly
    const target = e.target as HTMLElement;
    if (target.tagName === 'CANVAS') return;

    e.preventDefault();

    // Throttle wheel events to prevent overwhelming the renderer
    const now = Date.now();
    if (now - lastUpdateTimeRef.current < 50) return; // ~20fps for wheel
    lastUpdateTimeRef.current = now;

    const dataLen = safeData.length;
    if (dataLen === 0) return;

    // Dynamic scroll sensitivity based on data size
    // For small datasets (<500): move ~20 candles per scroll
    // For medium datasets (500-2000): move ~50 candles per scroll
    // For large datasets (>2000): move ~100 candles per scroll
    let candlesPerScroll: number;
    if (dataLen < 500) {
      candlesPerScroll = Math.max(10, Math.floor(dataLen * 0.1)); // 10% of data, min 10
    } else if (dataLen < 2000) {
      candlesPerScroll = 50;
    } else {
      candlesPerScroll = 100;
    }

    const direction = e.deltaY > 0 ? 1 : -1; // Positive = scroll right (newer)
    panByCandles(direction * candlesPerScroll);
  }, [safeData.length, panByCandles]);

  // Keep refs in sync with state
  useEffect(() => {
    viewStartRef.current = viewStart;
    viewEndRef.current = viewEnd;
  }, [viewStart, viewEnd]);

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
    const dataLen = safeData.length;
    const fixedRange = dataLen > 0 ? Math.min(1, VISIBLE_CANDLES / dataLen) : 1;
    const newStart = 1 - fixedRange;
    viewStartRef.current = newStart;
    viewEndRef.current = 1;
    setViewStart(newStart);
    setViewEnd(1);
    setYScale(1.0);
    yScaleRef.current = 1.0;
    // Reset navigation flag so new data will show at end
    userHasNavigatedRef.current = false;
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

  // Shift+Right-click drag to pan X-axis (scroll left/right through time)
  // This pans through the data timeline, NOT the 3D camera
  // When fully zoomed out, initiating pan will auto-zoom to 50% window for meaningful panning
  useEffect(() => {
    if (!isMounted) return;

    const handleMouseDown = (e: MouseEvent) => {
      // Only activate pan if Shift + Right-click (button 2)
      if (!e.shiftKey || e.button !== 2) return;

      // Check if click is within our chart container
      const container = canvasContainerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right ||
          e.clientY < rect.top || e.clientY > rect.bottom) {
        return;
      }

      // If currently showing all data (fully zoomed out), zoom in to 50% window first
      // This allows meaningful panning through historical data
      let currentStart = viewStartRef.current;
      let currentEnd = viewEndRef.current;
      const currentRange = currentEnd - currentStart;

      if (currentRange > 0.9) {
        // Almost fully zoomed out - zoom to show last 50% of data (most recent)
        currentStart = 0.5;
        currentEnd = 1.0;
        setViewStart(currentStart);
        setViewEnd(currentEnd);
        viewStartRef.current = currentStart;
        viewEndRef.current = currentEnd;
      }

      e.preventDefault();
      isPanningRef.current = true;
      panStartXRef.current = e.clientX;
      panStartViewRef.current = { start: currentStart, end: currentEnd };
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isPanningRef.current) return;

      const container = canvasContainerRef.current;
      if (!container) return;

      // Throttle to 30fps
      const now = Date.now();
      if (now - lastUpdateTimeRef.current < 33) return;
      lastUpdateTimeRef.current = now;

      const rect = container.getBoundingClientRect();
      const deltaX = (e.clientX - panStartXRef.current) / rect.width;

      // Pan amount relative to current view range
      const viewRange = panStartViewRef.current.end - panStartViewRef.current.start;
      const panAmount = -deltaX * viewRange; // Negative so drag right = move forward in time

      let newStart = panStartViewRef.current.start + panAmount;
      let newEnd = panStartViewRef.current.end + panAmount;

      // Clamp to valid range
      if (newStart < 0) {
        newEnd -= newStart;
        newStart = 0;
      }
      if (newEnd > 1) {
        newStart -= (newEnd - 1);
        newEnd = 1;
      }

      const clampedStart = Math.max(0, newStart);
      const clampedEnd = Math.min(1, newEnd);
      viewStartRef.current = clampedStart;
      viewEndRef.current = clampedEnd;
      // Mark that user has manually navigated
      userHasNavigatedRef.current = true;
      setViewStart(clampedStart);
      setViewEnd(clampedEnd);
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
              failIfMajorPerformanceCaveat: false
            }}
            onCreated={({ gl, scene }) => {
              console.log('[Chart3D] Canvas created (key:', webglKey, ')');
              // Set scene background based on theme
              scene.background = new THREE.Color(isDark ? '#0a0a0a' : '#f9fafb');
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
            <SpeedBallControl
              onPan={panByCandles}
              isDark={isDark}
              dataLength={safeData.length}
              viewStart={viewStart}
              viewEnd={viewEnd}
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
