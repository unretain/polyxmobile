"use client";

import { Suspense, useMemo, useRef, useEffect, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { PerspectiveCamera, Text, Line } from "@react-three/drei";
import * as THREE from "three";

interface PricePoint {
  t: number; // Unix timestamp
  p: number; // Probability (0-1)
}

interface Probability3DChartProps {
  data: PricePoint[];
  isLoading?: boolean;
  currentProbability?: number;
}

// 3D Line with glow effect
function GlowingLine({
  points,
  color,
  lineWidth = 2,
}: {
  points: THREE.Vector3[];
  color: string;
  lineWidth?: number;
}) {
  return (
    <>
      <Line points={points} color={color} lineWidth={lineWidth} transparent opacity={1} />
      <Line points={points} color={color} lineWidth={lineWidth * 3} transparent opacity={0.2} />
    </>
  );
}

// Pulsing dot at the latest point
function PulsingDot({ position, color }: { position: THREE.Vector3; color: string }) {
  const glowRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (glowRef.current) {
      const scale = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.3;
      glowRef.current.scale.setScalar(scale);
    }
  });

  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
      </mesh>
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.3} />
      </mesh>
    </group>
  );
}

// Area fill under the line
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
      depth: 0.3,
      bevelEnabled: false,
    };

    return new THREE.ExtrudeGeometry(shape, extrudeSettings);
  }, [points, baseY]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry} position={[0, 0, -0.15]}>
      <meshStandardMaterial color={color} transparent opacity={0.15} side={THREE.DoubleSide} />
    </mesh>
  );
}

// Grid for the chart
function ChartGrid({ width, height }: { width: number; height: number }) {
  return (
    <group>
      {/* Horizontal grid lines at 25%, 50%, 75% */}
      {[0.25, 0.5, 0.75, 1].map((y) => (
        <mesh key={`h-${y}`} position={[width / 2, y * height, -0.4]}>
          <planeGeometry args={[width, 0.01]} />
          <meshBasicMaterial color="#FF6B4A" transparent opacity={0.15} />
        </mesh>
      ))}
      {/* Vertical grid lines */}
      {[0.25, 0.5, 0.75, 1].map((x) => (
        <mesh key={`v-${x}`} position={[x * width, height / 2, -0.4]} rotation={[0, 0, Math.PI / 2]}>
          <planeGeometry args={[height, 0.01]} />
          <meshBasicMaterial color="#FF6B4A" transparent opacity={0.1} />
        </mesh>
      ))}
    </group>
  );
}

// Oscillating camera
function OscillatingCamera({
  centerX,
  centerY,
  radius,
  maxAngle = Math.PI / 8,
}: {
  centerX: number;
  centerY: number;
  radius: number;
  maxAngle?: number;
}) {
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);

  useFrame((state) => {
    if (cameraRef.current) {
      const angle = Math.sin(state.clock.elapsedTime * 0.4) * maxAngle;
      const x = centerX + Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      const y = centerY + 0.5;

      cameraRef.current.position.set(x, y, z);
      cameraRef.current.lookAt(centerX, centerY, 0);
    }
  });

  return (
    <PerspectiveCamera
      ref={cameraRef}
      makeDefault
      position={[centerX, centerY + 0.5, radius]}
      fov={35}
    />
  );
}

function ChartScene({
  data,
  currentProbability,
}: {
  data: PricePoint[];
  currentProbability?: number;
}) {
  const CHART_WIDTH = 6;
  const CHART_HEIGHT = 2;

  // Generate line points for both YES and NO from probability data
  const { yesLinePoints, noLinePoints } = useMemo(() => {
    if (data.length === 0) {
      return { yesLinePoints: [], noLinePoints: [] };
    }

    // Always use 0-100% range for consistency
    const minP = 0;
    const maxP = 1;
    const range = maxP - minP;

    const yesPts = data.map((point, i) => {
      const x = (i / Math.max(1, data.length - 1)) * CHART_WIDTH;
      const y = ((point.p - minP) / range) * CHART_HEIGHT;
      return new THREE.Vector3(x, y, 0);
    });

    // No probability is inverse of Yes
    const noPts = data.map((point, i) => {
      const x = (i / Math.max(1, data.length - 1)) * CHART_WIDTH;
      const noProb = 1 - point.p;
      const y = ((noProb - minP) / range) * CHART_HEIGHT;
      return new THREE.Vector3(x, y, 0);
    });

    return { yesLinePoints: yesPts, noLinePoints: noPts };
  }, [data, CHART_WIDTH, CHART_HEIGHT]);

  // Y-axis labels (0% to 100%)
  const yLabels = useMemo(() => {
    const labels: { y: number; text: string }[] = [];
    for (let i = 0; i <= 4; i++) {
      const normalizedY = (i / 4) * CHART_HEIGHT;
      const value = i * 25;
      labels.push({ y: normalizedY, text: `${value}%` });
    }
    return labels;
  }, [CHART_HEIGHT]);

  const yesColor = "#22c55e"; // Green
  const noColor = "#ef4444"; // Red

  return (
    <>
      <OscillatingCamera
        centerX={CHART_WIDTH / 2}
        centerY={CHART_HEIGHT / 2}
        radius={6}
        maxAngle={Math.PI / 10}
      />

      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={0.8} />
      <pointLight position={[-5, 5, -5]} intensity={0.3} color="#FF6B4A" />

      {/* Background */}
      <mesh position={[CHART_WIDTH / 2, CHART_HEIGHT / 2, -0.6]}>
        <planeGeometry args={[CHART_WIDTH + 1, CHART_HEIGHT + 1]} />
        <meshBasicMaterial color="#0a0a0a" transparent opacity={0.7} />
      </mesh>

      <ChartGrid width={CHART_WIDTH} height={CHART_HEIGHT} />

      {/* Y-axis labels */}
      {yLabels.map((label, i) => (
        <Text
          key={`y-${i}`}
          position={[-0.3, label.y, 0]}
          fontSize={0.15}
          color="#666666"
          anchorX="right"
          anchorY="middle"
        >
          {label.text}
        </Text>
      ))}

      {/* YES line (green) */}
      {yesLinePoints.length > 1 && <GlowingLine points={yesLinePoints} color={yesColor} lineWidth={2} />}

      {/* NO line (red) */}
      {noLinePoints.length > 1 && <GlowingLine points={noLinePoints} color={noColor} lineWidth={2} />}

      {/* Pulsing dots at latest positions */}
      {yesLinePoints.length > 0 && <PulsingDot position={yesLinePoints[yesLinePoints.length - 1]} color={yesColor} />}
      {noLinePoints.length > 0 && <PulsingDot position={noLinePoints[noLinePoints.length - 1]} color={noColor} />}

      {/* Labels for Yes and No at end */}
      {currentProbability !== undefined && yesLinePoints.length > 0 && (
        <>
          <Text
            position={[yesLinePoints[yesLinePoints.length - 1].x + 0.25, yesLinePoints[yesLinePoints.length - 1].y, 0]}
            fontSize={0.14}
            color={yesColor}
            anchorX="left"
            anchorY="middle"
            fontWeight="bold"
          >
            {Math.round(currentProbability * 100)}% Yes
          </Text>
          <Text
            position={[noLinePoints[noLinePoints.length - 1].x + 0.25, noLinePoints[noLinePoints.length - 1].y, 0]}
            fontSize={0.14}
            color={noColor}
            anchorX="left"
            anchorY="middle"
            fontWeight="bold"
          >
            {Math.round((1 - currentProbability) * 100)}% No
          </Text>
        </>
      )}
    </>
  );
}

export function Probability3DChart({
  data,
  isLoading,
  currentProbability,
}: Probability3DChartProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  if (isLoading && data.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-white/5 border border-white/10">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#FF6B4A] border-t-transparent" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-white/5 border border-white/10 text-white/40 text-xs">
        No data
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden bg-white/5 border border-white/10 relative">
      {/* Subtle glow background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150px] h-[150px]">
          <div
            className="absolute inset-0 blur-[30px] animate-slow-spin"
            style={{
              background: "conic-gradient(from 0deg, #22c55e30, #ef444410, #22c55e20, #ef444430)"
            }}
          />
        </div>
        <div className="absolute inset-0 bg-[#0a0a0a]/50" />
      </div>

      {isMounted && (
        <Canvas gl={{ antialias: true, alpha: true }}>
          <Suspense fallback={null}>
            <ChartScene data={data} currentProbability={currentProbability} />
          </Suspense>
        </Canvas>
      )}
    </div>
  );
}
