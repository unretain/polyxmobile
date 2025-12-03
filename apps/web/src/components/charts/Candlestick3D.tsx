"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface Candlestick3DProps {
  index: number;
  open: number;
  high: number;
  low: number;
  close: number;
  isUp: boolean;
  isLatest?: boolean;
  spacing?: number;
  width?: number;
  depth?: number;
}

export function Candlestick3D({
  index,
  open,
  high,
  low,
  close,
  isUp,
  isLatest = false,
  spacing = 1.2,
  width = 0.7,
  depth = 0.7,
}: Candlestick3DProps) {
  const bodyRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  // Sanitize inputs to prevent NaN/Infinity values that crash Three.js
  const safeOpen = isFinite(open) ? open : 0;
  const safeClose = isFinite(close) ? close : 0;
  const safeHigh = isFinite(high) ? high : Math.max(safeOpen, safeClose);
  const safeLow = isFinite(low) ? low : Math.min(safeOpen, safeClose);

  // Candlestick dimensions
  const bodyWidth = width;
  const bodyDepth = depth;
  const wickWidth = Math.max(0.03, Math.min(width, depth) * 0.2);

  // Calculate body position and height using safe values
  const bodyTop = Math.max(safeOpen, safeClose);
  const bodyBottom = Math.min(safeOpen, safeClose);

  // For per-trade candles (pump.fun style), the body IS the entire candle
  // High=Max(O,C) and Low=Min(O,C), so there are no wicks
  // For regular candles, we show wicks when H>bodyTop or L<bodyBottom

  // Calculate body height - this IS the price movement for the candle
  const rawBodyHeight = bodyTop - bodyBottom;

  // Minimum body height for visibility - very small for per-trade candles
  // These are thin bars showing price movement between consecutive trades
  const minBodyHeight = 0.05;
  const bodyHeight = Math.max(rawBodyHeight, minBodyHeight);

  // Body Y position: center of the body (between open and close)
  const bodyY = (bodyTop + bodyBottom) / 2;

  // Calculate raw wick heights from actual OHLCV data
  const rawUpperWickHeight = safeHigh - bodyTop;
  const rawLowerWickHeight = bodyBottom - safeLow;

  // Only filter out tiny wicks that are floating point noise
  // Use a very small threshold to show all meaningful wicks
  const wickThreshold = 0.001;
  const upperWickHeight = rawUpperWickHeight > wickThreshold ? rawUpperWickHeight : 0;
  const lowerWickHeight = rawLowerWickHeight > wickThreshold ? rawLowerWickHeight : 0;

  // Position wicks extending from the body edges
  const upperWickY = bodyTop + upperWickHeight / 2;
  const lowerWickY = bodyBottom - lowerWickHeight / 2;

  // Colors
  const upColor = new THREE.Color("#22c55e");
  const downColor = new THREE.Color("#ef4444");
  const color = isUp ? upColor : downColor;
  const emissiveIntensity = isLatest ? 0.4 : 0;

  // Animate latest candle only - skip useFrame for non-latest candles to save GPU
  useFrame(
    isLatest
      ? (state) => {
          if (glowRef.current) {
            const scale = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.08;
            glowRef.current.scale.setScalar(scale);
          }
        }
      : () => {} // No-op for non-latest candles
  );

  const xPosition = index * spacing;

  return (
    <group position={[xPosition, 0, 0]}>
      {/* Candlestick body */}
      <mesh ref={bodyRef} position={[0, bodyY, 0]}>
        <boxGeometry args={[bodyWidth, bodyHeight, bodyDepth]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={emissiveIntensity}
          metalness={0.4}
          roughness={0.3}
        />
      </mesh>

      {/* Upper wick */}
      {upperWickHeight > 0 && (
        <mesh position={[0, upperWickY, 0]}>
          <boxGeometry args={[wickWidth, upperWickHeight, wickWidth]} />
          <meshStandardMaterial color={color} metalness={0.3} roughness={0.4} />
        </mesh>
      )}

      {/* Lower wick */}
      {lowerWickHeight > 0 && (
        <mesh position={[0, lowerWickY, 0]}>
          <boxGeometry args={[wickWidth, lowerWickHeight, wickWidth]} />
          <meshStandardMaterial color={color} metalness={0.3} roughness={0.4} />
        </mesh>
      )}

      {/* Glow effect for latest candle */}
      {isLatest && (
        <mesh ref={glowRef} position={[0, bodyY, 0]}>
          <boxGeometry args={[bodyWidth * 1.3, bodyHeight * 1.2, bodyDepth * 1.3]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.2}
          />
        </mesh>
      )}
    </group>
  );
}
