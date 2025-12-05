"use client";

import { Suspense, useMemo, useRef, useEffect, useState, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera, OrbitControls, Text, Line } from "@react-three/drei";
import * as THREE from "three";
import { formatPrice, formatNumber } from "@/lib/utils";
import type { OHLCV } from "@/stores/chartStore";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useThemeStore } from "@/stores/themeStore";
import { FlyControls } from "./FlyControls";
import { DrawingLayer, DrawingToolbar, Drawing, DrawingToolType, DRAWING_COLORS, DEFAULT_LINE_WIDTH } from "./drawing";

// pump.fun tokens have 1 billion supply
const PUMP_FUN_SUPPLY = 1_000_000_000;

// Component to reactively update scene background based on theme
function SceneBackground({ isDark }: { isDark: boolean }) {
  const { scene } = useThree();

  useEffect(() => {
    scene.background = new THREE.Color(isDark ? '#0a0a0a' : '#f9fafb');
  }, [scene, isDark]);

  return null;
}

interface Line3DChartProps {
  data: OHLCV[];
  isLoading?: boolean;
  showMarketCap?: boolean;
  marketCap?: number;
  price?: number; // Actual current price from token data (more accurate than OHLCV last close)
}

// Format for Y-axis labels
// For market cap (Pulse tokens): shows larger values (K, M, B)
// For price (Dashboard tokens): shows smaller decimal values
function formatAxisValue(value: number, isMarketCap: boolean): string {
  if (isMarketCap) {
    // Market cap formatting (larger numbers)
    if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
    return `$${value.toFixed(0)}`;
  }
  // Price formatting (smaller numbers for micro-cap tokens or larger coins)
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  if (value >= 0.0001) return `$${value.toFixed(6)}`;
  return `$${value.toExponential(2)}`;
}

// 3D Line with glow effect
function GlowingLine({
  points,
  color,
  lineWidth = 3,
}: {
  points: THREE.Vector3[];
  color: string;
  lineWidth?: number;
}) {
  return (
    <>
      {/* Main line */}
      <Line
        points={points}
        color={color}
        lineWidth={lineWidth}
        transparent
        opacity={1}
      />
      {/* Glow effect - wider, more transparent line behind */}
      <Line
        points={points}
        color={color}
        lineWidth={lineWidth * 3}
        transparent
        opacity={0.15}
      />
    </>
  );
}

// Pulsing dot at the latest point
function PulsingDot({ position, color }: { position: THREE.Vector3; color: string }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (meshRef.current && glowRef.current) {
      const scale = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.3;
      glowRef.current.scale.setScalar(scale);
    }
  });

  return (
    <group position={position}>
      {/* Core dot */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
      </mesh>
      {/* Pulsing glow */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.3} />
      </mesh>
    </group>
  );
}

// Area fill under the line (3D mesh)
function AreaFill({
  points,
  color,
  baseY,
}: {
  points: THREE.Vector3[];
  color: string;
  baseY: number;
}) {
  const geometry = useMemo(() => {
    if (points.length < 2) return null;

    const shape = new THREE.Shape();
    shape.moveTo(points[0].x, baseY);

    for (const point of points) {
      shape.lineTo(point.x, point.y);
    }

    shape.lineTo(points[points.length - 1].x, baseY);
    shape.lineTo(points[0].x, baseY);

    const extrudeSettings = {
      depth: 0.5,
      bevelEnabled: false,
    };

    return new THREE.ExtrudeGeometry(shape, extrudeSettings);
  }, [points, baseY]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry} position={[0, 0, -0.25]}>
      <meshStandardMaterial
        color={color}
        transparent
        opacity={0.15}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// Grid lines
function ChartGrid({
  width,
  height,
  depth,
}: {
  width: number;
  height: number;
  depth: number;
}) {
  const gridLines = useMemo(() => {
    const lines: JSX.Element[] = [];
    const horizontalCount = 5;
    const verticalCount = 10;

    // Horizontal grid lines
    for (let i = 0; i <= horizontalCount; i++) {
      const y = (i / horizontalCount) * height;
      lines.push(
        <Line
          key={`h-${i}`}
          points={[
            new THREE.Vector3(0, y, -depth / 2),
            new THREE.Vector3(width, y, -depth / 2),
          ]}
          color="#333333"
          lineWidth={1}
          transparent
          opacity={0.3}
        />
      );
    }

    // Vertical grid lines
    for (let i = 0; i <= verticalCount; i++) {
      const x = (i / verticalCount) * width;
      lines.push(
        <Line
          key={`v-${i}`}
          points={[
            new THREE.Vector3(x, 0, -depth / 2),
            new THREE.Vector3(x, height, -depth / 2),
          ]}
          color="#333333"
          lineWidth={1}
          transparent
          opacity={0.2}
        />
      );
    }

    return lines;
  }, [width, height, depth]);

  return <>{gridLines}</>;
}

// Format date for X-axis labels - show year when data spans multiple years
function formatDateLabel(timestamp: number, showYear: boolean): string {
  const date = new Date(timestamp);
  const month = date.toLocaleString('default', { month: 'short' });
  const day = date.getDate();
  if (showYear) {
    const year = date.getFullYear().toString().slice(-2); // Last 2 digits of year
    return `${month} '${year}`;
  }
  return `${month} ${day}`;
}

// Main chart scene
function ChartScene({
  data,
  viewStart,
  viewEnd,
  showMarketCap = false,
  price,
  isFlyMode = false,
  activeTool = null,
  orbitControlsRef,
  isDark = true,
}: {
  data: OHLCV[];
  viewStart: number;
  viewEnd: number;
  showMarketCap?: boolean;
  price?: number;
  isFlyMode?: boolean;
  activeTool?: DrawingToolType;
  orbitControlsRef?: React.RefObject<OrbitControlsImpl | null>;
  isDark?: boolean;
}) {
  const CHART_WIDTH = 12;
  const CHART_HEIGHT = 6;
  const CHART_DEPTH = 3;

  // Get visible data slice
  const visibleData = useMemo(() => {
    if (data.length === 0) return [];
    const startIdx = Math.floor(viewStart * (data.length - 1));
    const endIdx = Math.ceil(viewEnd * (data.length - 1));
    return data.slice(startIdx, endIdx + 1);
  }, [data, viewStart, viewEnd]);

  // Calculate bounds - include current live price so Y-axis reflects current market cap
  const bounds = useMemo(() => {
    if (visibleData.length === 0) {
      return { min: 0, max: 1, range: 1 };
    }

    let min = Infinity;
    let max = -Infinity;

    for (const candle of visibleData) {
      if (isFinite(candle.low) && candle.low > 0) min = Math.min(min, candle.low);
      if (isFinite(candle.high) && candle.high > 0) max = Math.max(max, candle.high);
    }

    // CRITICAL: Include current live price in bounds so Y-axis shows current market cap
    if (price && isFinite(price) && price > 0) {
      min = Math.min(min, price);
      max = Math.max(max, price);
    }

    if (!isFinite(min) || !isFinite(max) || min === max) {
      const mid = isFinite(min) && min > 0 ? min : 1;
      return { min: mid * 0.95, max: mid * 1.05, range: mid * 0.1 };
    }

    const padding = (max - min) * 0.1;
    return { min: min - padding, max: max + padding, range: max - min + padding * 2 };
  }, [visibleData, price]);

  // Calculate price change for color
  const priceChange = useMemo(() => {
    if (visibleData.length < 2) return { isPositive: true };
    const firstPrice = visibleData[0].close;
    const lastPrice = visibleData[visibleData.length - 1].close;
    return { isPositive: lastPrice >= firstPrice };
  }, [visibleData]);

  const lineColor = "#FF6B4A"; // Coral accent color

  // Generate line points
  const linePoints = useMemo(() => {
    if (visibleData.length === 0) return [];

    return visibleData.map((candle, index) => {
      const x = (index / Math.max(1, visibleData.length - 1)) * CHART_WIDTH;
      const y = ((candle.close - bounds.min) / bounds.range) * CHART_HEIGHT;
      return new THREE.Vector3(x, y, 0);
    });
  }, [visibleData, bounds, CHART_WIDTH, CHART_HEIGHT]);

  // Y-axis labels - shows price or market cap depending on token type
  // For Pulse tokens: multiply by supply to show market cap
  // For Dashboard tokens: show actual price
  const yLabels = useMemo(() => {
    const multiplier = showMarketCap ? PUMP_FUN_SUPPLY : 1;
    const labels: { y: number; text: string }[] = [];
    for (let i = 0; i <= 4; i++) {
      const normalizedY = (i / 4) * CHART_HEIGHT;
      const rawValue = bounds.min + (i / 4) * bounds.range;
      const displayValue = rawValue * multiplier;
      const text = formatAxisValue(displayValue, showMarketCap);
      labels.push({ y: normalizedY, text });
    }
    return labels;
  }, [bounds, CHART_HEIGHT, showMarketCap]);

  // X-axis date labels
  const xLabels = useMemo(() => {
    if (visibleData.length === 0) return [];

    // Check if data spans multiple years or is from a different year than current
    const firstYear = new Date(visibleData[0].timestamp).getFullYear();
    const lastYear = new Date(visibleData[visibleData.length - 1].timestamp).getFullYear();
    const currentYear = new Date().getFullYear();
    const showYear = firstYear !== lastYear || firstYear !== currentYear;

    const labels: { x: number; text: string }[] = [];
    // Show 5 date labels evenly spaced
    const labelCount = Math.min(5, visibleData.length);
    for (let i = 0; i < labelCount; i++) {
      const dataIdx = Math.floor((i / (labelCount - 1 || 1)) * (visibleData.length - 1));
      const x = (dataIdx / Math.max(1, visibleData.length - 1)) * CHART_WIDTH;
      const text = formatDateLabel(visibleData[dataIdx].timestamp, showYear);
      labels.push({ x, text });
    }
    return labels;
  }, [visibleData, CHART_WIDTH]);

  // Set up orbit controls target
  useEffect(() => {
    if (orbitControlsRef?.current) {
      orbitControlsRef.current.target.set(CHART_WIDTH / 2, CHART_HEIGHT / 2, 0);
      orbitControlsRef.current.update();
    }
  }, [orbitControlsRef]);

  return (
    <>
      {/* Camera */}
      <PerspectiveCamera
        makeDefault
        position={[CHART_WIDTH / 2, CHART_HEIGHT / 2 + 2, 12]}
        fov={45}
      />

      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 15, 10]} intensity={0.8} />
      <pointLight position={[-5, 10, 5]} intensity={0.3} color="#6366f1" />

      {/* Background plane */}
      <mesh position={[CHART_WIDTH / 2, CHART_HEIGHT / 2, -CHART_DEPTH / 2 - 0.1]}>
        <planeGeometry args={[CHART_WIDTH + 2, CHART_HEIGHT + 2]} />
        <meshBasicMaterial color={isDark ? "#0a0a0a" : "#f9fafb"} />
      </mesh>

      {/* Grid */}
      <ChartGrid width={CHART_WIDTH} height={CHART_HEIGHT} depth={CHART_DEPTH} />

      {/* Area fill */}
      {linePoints.length > 1 && (
        <AreaFill points={linePoints} color={lineColor} baseY={0} />
      )}

      {/* Main line */}
      {linePoints.length > 1 && (
        <GlowingLine points={linePoints} color={lineColor} lineWidth={3} />
      )}

      {/* Pulsing dot at latest point */}
      {linePoints.length > 0 && (
        <PulsingDot position={linePoints[linePoints.length - 1]} color={lineColor} />
      )}

      {/* Y-axis labels */}
      {yLabels.map((label, i) => (
        <Text
          key={`y-label-${i}`}
          position={[-0.3, label.y, 0]}
          fontSize={0.28}
          color={isDark ? "#888888" : "#666666"}
          anchorX="right"
          anchorY="middle"
        >
          {label.text}
        </Text>
      ))}

      {/* Y-axis title */}
      <Text
        position={[-1.8, CHART_HEIGHT / 2, 0]}
        fontSize={0.25}
        color={isDark ? "#aaaaaa" : "#555555"}
        anchorX="center"
        anchorY="middle"
        rotation={[0, 0, Math.PI / 2]}
      >
        {showMarketCap ? "Market Cap" : "Price (USD)"}
      </Text>

      {/* X-axis date labels */}
      {xLabels.map((label, i) => (
        <Text
          key={`x-label-${i}`}
          position={[label.x, -0.4, 0]}
          fontSize={0.22}
          color={isDark ? "#888888" : "#666666"}
          anchorX="center"
          anchorY="top"
        >
          {label.text}
        </Text>
      ))}

      {/* X-axis title */}
      <Text
        position={[CHART_WIDTH / 2, -0.9, 0]}
        fontSize={0.2}
        color={isDark ? "#aaaaaa" : "#555555"}
        anchorX="center"
        anchorY="top"
      >
        Date
      </Text>

      {/* Orbit controls - disabled in fly mode or when drawing */}
      <OrbitControls
        ref={orbitControlsRef as React.RefObject<OrbitControlsImpl>}
        enabled={!isFlyMode && !activeTool}
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2}
        minDistance={5}
        maxDistance={25}
        target={[CHART_WIDTH / 2, CHART_HEIGHT / 2, 0]}
      />
    </>
  );
}

export function Line3DChart({
  data,
  isLoading,
  showMarketCap = false,
  marketCap,
  price,
}: Line3DChartProps) {
  const { isDark } = useThemeStore();
  const [isMounted, setIsMounted] = useState(false);
  const orbitControlsRef = useRef<OrbitControlsImpl | null>(null);

  // Fly mode state - toggle with Shift+Enter
  const [isFlyMode, setIsFlyMode] = useState(false);
  const [showFlyModeInstructions, setShowFlyModeInstructions] = useState(false);

  // Drawing tools state
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [activeTool, setActiveTool] = useState<DrawingToolType>(null);
  const [activeColor, setActiveColor] = useState(DRAWING_COLORS[0]);
  const [activeLineWidth, setActiveLineWidth] = useState(DEFAULT_LINE_WIDTH);

  // Ensure component is mounted before rendering Canvas to prevent HMR issues
  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

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
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
  }, []);

  // Drawing tool handlers
  const handleDrawingComplete = useCallback((drawing: Drawing) => {
    setDrawings((prev) => [...prev, drawing]);
  }, []);

  const handleClearAllDrawings = useCallback(() => {
    setDrawings([]);
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

  // Calculate price change for display - use the actual token price for current value
  // This shows the change from the first data point to the CURRENT price (not last OHLCV close)
  const priceChange = useMemo(() => {
    if (data.length === 0) return { value: 0, percent: 0, isPositive: true };
    const firstPrice = data[0].close;
    // Use actual token price if available, otherwise use last OHLCV close
    const currentPrice = price ?? data[data.length - 1].close;
    const change = currentPrice - firstPrice;
    const percent = firstPrice > 0 ? (change / firstPrice) * 100 : 0;
    return { value: change, percent, isPositive: change >= 0 };
  }, [data, price]);

  // Format date range for display
  const dateRange = useMemo(() => {
    if (data.length === 0) return "";
    const startDate = new Date(data[0].timestamp);
    const endDate = new Date(data[data.length - 1].timestamp);
    const formatDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${formatDate(startDate)} - ${formatDate(endDate)}`;
  }, [data]);

  if (data.length === 0 && !isLoading) {
    return (
      <div className={`h-full w-full flex items-center justify-center ${isDark ? 'bg-[#0a0a0a] text-white/50' : 'bg-gray-50 text-black/50'}`}>
        No data available
      </div>
    );
  }

  return (
    <div className={`relative h-full w-full overflow-hidden flex flex-row ${isDark ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
      {/* Coral swirl background - like landing page */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px]">
          <div className={`absolute inset-0 bg-gradient-conic from-[#FF6B4A]/30 via-[#FF8F6B]/15 via-[#FF6B4A]/20 to-[#FF6B4A]/30 blur-[80px] animate-slow-spin ${isDark ? '' : 'opacity-50'}`} />
        </div>
        <div className={`absolute inset-0 ${isDark ? 'bg-[#0a0a0a]/60' : 'bg-white/60'}`} />
      </div>

      {isLoading && (
        <div className={`absolute inset-0 z-10 flex items-center justify-center ${isDark ? 'bg-[#0a0a0a]/80' : 'bg-white/80'}`}>
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FF6B4A] border-t-transparent" />
        </div>
      )}

      {/* Drawing toolbar - hidden in fly mode */}
      {!isFlyMode && (
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
          />
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Price/Market Cap display */}
        <div className="absolute top-4 left-4 z-10">
          {showMarketCap && marketCap ? (
            <>
              <div className={`text-xs mb-0.5 ${isDark ? 'text-white/50' : 'text-black/50'}`}>Market Cap</div>
              <div className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>${formatNumber(marketCap)}</div>
            </>
          ) : price ? (
            <div className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>${formatPrice(price)}</div>
          ) : (
            <div className={`text-2xl font-bold ${isDark ? 'text-white/50' : 'text-black/50'}`}>Loading...</div>
          )}
          <div className={`text-xs ${isDark ? 'text-white/50' : 'text-black/50'}`}>
            {dateRange} • {data.length} points
          </div>
        </div>

        {/* Price change percentage display - positioned to left of fly mode hint */}
        {!isFlyMode && (
          <div className="absolute top-4 z-10 text-right" style={{ right: "200px" }}>
            <div className={`text-sm font-medium ${priceChange.isPositive ? "text-up" : "text-down"}`}>
              {priceChange.isPositive ? "+" : ""}${formatPrice(priceChange.value)} ({priceChange.isPositive ? "+" : ""}{priceChange.percent.toFixed(2)}%)
            </div>
            <div className={`text-xs ${isDark ? 'text-white/50' : 'text-black/50'}`}>
              visible range
            </div>
          </div>
        )}

        {/* 3D Canvas */}
        <div className="flex-1 min-h-0">
          {isMounted && (
            <Canvas gl={{ antialias: true, alpha: true }}>
              <SceneBackground isDark={isDark} />
              <Suspense fallback={null}>
                <ChartScene
                  data={data}
                  viewStart={0}
                  viewEnd={1}
                  showMarketCap={showMarketCap}
                  price={price}
                  isFlyMode={isFlyMode}
                  activeTool={activeTool}
                  orbitControlsRef={orbitControlsRef}
                  isDark={isDark}
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
                  movementSpeed={15}
                  lookSpeed={0.002}
                  onExit={handleExitFlyMode}
                />
              </Suspense>
            </Canvas>
          )}
        </div>

        {/* Controls hint */}
        <div className={`absolute bottom-4 left-4 backdrop-blur-md border px-3 py-1.5 text-xs ${
          isDark ? 'bg-white/5 border-white/10 text-white/50' : 'bg-black/5 border-black/10 text-black/50'
        }`}>
          {isFlyMode ? (
            "WASD: move • Q/E: up/down • Mouse: look • Shift: speed • ESC: exit"
          ) : (
            "Drag: rotate • Scroll: zoom"
          )}
        </div>
      </div>

      {/* Fly mode hint - shown when not in fly mode */}
      {!isFlyMode && (
        <div className="absolute top-4 right-4 z-10">
          <div className="bg-[#FF6B4A]/10 border border-[#FF6B4A]/30 px-3 py-1.5 text-xs">
            <span className="text-[#FF6B4A] font-medium">Shift+Enter</span>
            <span className={isDark ? 'text-white/50' : 'text-black/50'}> for fly mode</span>
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
            <div className={`text-xs text-center space-y-1 ${isDark ? 'text-white/50' : 'text-black/50'}`}>
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
            <span className={isDark ? 'text-white/50' : 'text-black/50'}> - ESC to exit</span>
          </div>
        </div>
      )}
    </div>
  );
}
