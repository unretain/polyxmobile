"use client";

import { Suspense, useMemo, useRef, useEffect, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { PerspectiveCamera, Text } from "@react-three/drei";
import * as THREE from "three";
import type { OHLCV } from "@/stores/pulseStore";

interface Mini3DChartProps {
  data: OHLCV[];
  isLoading?: boolean;
  showMarketCap?: boolean;
  currentMarketCap?: number;
}

// Pump.fun tokens have 1 billion supply
const PUMP_FUN_SUPPLY = 1_000_000_000;

// Format market cap for Y-axis labels
function formatMC(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

// Format price for Y-axis labels
function formatPrice(value: number): string {
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  if (value >= 0.0001) return `$${value.toFixed(6)}`;
  return `$${value.toExponential(2)}`;
}

// Mini 3D Candlestick component
function MiniCandlestick({
  index,
  open,
  high,
  low,
  close,
  isUp,
  isLatest,
  spacing,
  width,
  depth,
}: {
  index: number;
  open: number;
  high: number;
  low: number;
  close: number;
  isUp: boolean;
  isLatest: boolean;
  spacing: number;
  width: number;
  depth: number;
}) {
  const glowRef = useRef<THREE.Mesh>(null);

  // Calculate body position and height
  const bodyTop = Math.max(open, close);
  const bodyBottom = Math.min(open, close);
  const bodyHeight = Math.max(bodyTop - bodyBottom, 0.05);
  const bodyY = (bodyTop + bodyBottom) / 2;

  // Calculate wick positions
  const upperWickHeight = high - bodyTop;
  const lowerWickHeight = bodyBottom - low;
  const upperWickY = bodyTop + upperWickHeight / 2;
  const lowerWickY = bodyBottom - lowerWickHeight / 2;
  const wickWidth = Math.max(0.02, width * 0.15);

  // Colors - traditional green for up, red for down
  const color = isUp ? "#22c55e" : "#ef4444";

  // Animate latest candle
  useFrame((state) => {
    if (isLatest && glowRef.current) {
      const scale = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.1;
      glowRef.current.scale.setScalar(scale);
    }
  });

  return (
    <group position={[index * spacing, 0, 0]}>
      {/* Body */}
      <mesh position={[0, bodyY, 0]}>
        <boxGeometry args={[width, bodyHeight, depth]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isLatest ? 0.3 : 0}
          metalness={0.4}
          roughness={0.3}
        />
      </mesh>

      {/* Upper wick */}
      {upperWickHeight > 0.01 && (
        <mesh position={[0, upperWickY, 0]}>
          <boxGeometry args={[wickWidth, upperWickHeight, wickWidth]} />
          <meshStandardMaterial color={color} />
        </mesh>
      )}

      {/* Lower wick */}
      {lowerWickHeight > 0.01 && (
        <mesh position={[0, lowerWickY, 0]}>
          <boxGeometry args={[wickWidth, lowerWickHeight, wickWidth]} />
          <meshStandardMaterial color={color} />
        </mesh>
      )}

      {/* Glow for latest */}
      {isLatest && (
        <mesh ref={glowRef} position={[0, bodyY, 0]}>
          <boxGeometry args={[width * 1.4, bodyHeight * 1.3, depth * 1.4]} />
          <meshBasicMaterial color={color} transparent opacity={0.15} />
        </mesh>
      )}
    </group>
  );
}

// Grid for the mini chart with coral accent
function MiniGrid({ width, height }: { width: number; height: number }) {
  return (
    <group>
      {/* Horizontal grid lines */}
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={`grid-h-${i}`} position={[width / 2, (i / 4) * height, -0.5]}>
          <planeGeometry args={[width, 0.02]} />
          <meshBasicMaterial color="#FF6B4A" transparent opacity={0.15} />
        </mesh>
      ))}
      {/* Vertical grid lines */}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
        <mesh key={`grid-v-${i}`} position={[(i / 8) * width, height / 2, -0.5]} rotation={[0, 0, Math.PI / 2]}>
          <planeGeometry args={[height, 0.02]} />
          <meshBasicMaterial color="#FF6B4A" transparent opacity={0.1} />
        </mesh>
      ))}
    </group>
  );
}

// Oscillating camera that swings back and forth (front-facing only)
function OscillatingCamera({
  centerX,
  centerY,
  radius,
  maxAngle = Math.PI / 6, // 30 degrees max swing each way
}: {
  centerX: number;
  centerY: number;
  radius: number;
  maxAngle?: number;
}) {
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);

  useFrame((state) => {
    if (cameraRef.current) {
      // Oscillate between -maxAngle and +maxAngle (front-facing arc)
      const angle = Math.sin(state.clock.elapsedTime * 0.5) * maxAngle;

      // Calculate camera position on the arc
      const x = centerX + Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      const y = centerY + 1; // Slightly above center

      cameraRef.current.position.set(x, y, z);
      cameraRef.current.lookAt(centerX, centerY, 0);
    }
  });

  return (
    <PerspectiveCamera
      ref={cameraRef}
      makeDefault
      position={[centerX, centerY + 1, radius]}
      fov={40}
    />
  );
}

function ChartScene({
  data,
  showMarketCap,
}: {
  data: OHLCV[];
  showMarketCap?: boolean;
}) {
  const CHART_WIDTH = 8;
  const CHART_HEIGHT = 3;

  // Calculate bounds
  const bounds = useMemo(() => {
    if (data.length === 0) {
      return { min: 0, max: 1, range: 1 };
    }

    let min = Infinity;
    let max = -Infinity;

    for (const candle of data) {
      if (isFinite(candle.low) && candle.low > 0) min = Math.min(min, candle.low);
      if (isFinite(candle.high) && candle.high > 0) max = Math.max(max, candle.high);
    }

    if (!isFinite(min) || !isFinite(max) || min === max) {
      const mid = isFinite(min) && min > 0 ? min : 1;
      return { min: mid * 0.95, max: mid * 1.05, range: mid * 0.1 };
    }

    const padding = (max - min) * 0.1;
    return { min: min - padding, max: max + padding, range: max - min + padding * 2 };
  }, [data]);

  // Normalize price to chart height
  const normalizePrice = (price: number) => {
    if (bounds.range === 0) return CHART_HEIGHT / 2;
    return ((price - bounds.min) / bounds.range) * CHART_HEIGHT;
  };

  // Calculate spacing and dimensions
  const candleCount = data.length || 1;
  const spacing = CHART_WIDTH / candleCount;
  const candleWidth = Math.min(0.4, Math.max(0.05, spacing * 0.7));
  const candleDepth = Math.min(0.4, Math.max(0.05, spacing * 0.6));

  // Y-axis labels (convert to MC if needed)
  const yLabels = useMemo(() => {
    const labels: { y: number; text: string }[] = [];
    for (let i = 0; i <= 2; i++) {
      const normalizedY = (i / 2) * CHART_HEIGHT;
      const value = bounds.min + (i / 2) * bounds.range;
      const displayValue = showMarketCap ? value * PUMP_FUN_SUPPLY : value;
      const text = showMarketCap ? formatMC(displayValue) : formatPrice(displayValue);
      labels.push({ y: normalizedY, text });
    }
    return labels;
  }, [bounds, showMarketCap, CHART_HEIGHT]);

  return (
    <>
      {/* Oscillating camera - swings back and forth, stays front-facing */}
      <OscillatingCamera
        centerX={CHART_WIDTH / 2}
        centerY={CHART_HEIGHT / 2}
        radius={8}
        maxAngle={Math.PI / 6} // 30 degrees each way
      />

      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={0.8} />
      <pointLight position={[-5, 5, -5]} intensity={0.3} />

      {/* Background */}
      <mesh position={[CHART_WIDTH / 2, CHART_HEIGHT / 2, -1]}>
        <planeGeometry args={[CHART_WIDTH + 2, CHART_HEIGHT + 2]} />
        <meshBasicMaterial color="#0a0a0a" transparent opacity={0.5} />
      </mesh>

      {/* Grid */}
      <MiniGrid width={CHART_WIDTH} height={CHART_HEIGHT} />

      {/* Y-axis labels */}
      {yLabels.map((label, i) => (
        <Text
          key={`y-label-${i}`}
          position={[-0.5, label.y, 0]}
          fontSize={0.22}
          color="#666666"
          anchorX="right"
          anchorY="middle"
        >
          {label.text}
        </Text>
      ))}

      {/* Candlesticks */}
      {data.map((candle, index) => (
        <MiniCandlestick
          key={`${candle.timestamp}-${index}`}
          index={index}
          open={normalizePrice(candle.open)}
          high={normalizePrice(candle.high)}
          low={normalizePrice(candle.low)}
          close={normalizePrice(candle.close)}
          isUp={candle.close >= candle.open}
          isLatest={index === data.length - 1}
          spacing={spacing}
          width={candleWidth}
          depth={candleDepth}
        />
      ))}

    </>
  );
}

export function Mini3DChart({
  data,
  isLoading,
  showMarketCap = false,
  currentMarketCap,
}: Mini3DChartProps) {
  const [isMounted, setIsMounted] = useState(false);

  // Ensure component is mounted before rendering Canvas to prevent HMR issues
  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  // Generate mock data if no real data (for new tokens with no trades yet)
  const displayData = useMemo(() => {
    if (data.length > 0) return data;

    // No mock data generation - just return empty array
    // The "No data" state will show, which is more accurate than fake data
    return [];
  }, [data]);

  if (isLoading && displayData.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-white/5 border border-white/10">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#22c55e] border-t-transparent" />
      </div>
    );
  }

  if (displayData.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-white/5 border border-white/10 text-white/50 text-xs">
        No data
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden bg-white/5 border border-white/10 relative">
      {/* Coral swirl background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[200px] h-[200px]">
          <div className="absolute inset-0 bg-gradient-conic from-[#FF6B4A]/25 via-[#FF8F6B]/10 via-[#FF6B4A]/15 to-[#FF6B4A]/25 blur-[40px] animate-slow-spin" />
        </div>
        <div className="absolute inset-0 bg-[#0a0a0a]/40" />
      </div>
      {isMounted && (
        <Canvas gl={{ antialias: true, alpha: true }}>
          <Suspense fallback={null}>
            <ChartScene
              data={displayData}
              showMarketCap={showMarketCap}
            />
          </Suspense>
        </Canvas>
      )}
    </div>
  );
}
