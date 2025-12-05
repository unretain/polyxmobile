"use client";

import { Suspense, useMemo, useRef, useState, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera, Text, Line, OrbitControls, Billboard } from "@react-three/drei";
import * as THREE from "three";
import { useThemeStore } from "@/stores/themeStore";
import { FlyControls } from "./FlyControls";

interface PricePoint {
  t: number;
  p: number;
}

type CameraMode = "orbit" | "fly" | "auto";

interface Interactive3DChartProps {
  data: PricePoint[];
  isLoading?: boolean;
  currentProbability?: number;
  cameraMode?: CameraMode;
  onCameraModeChange?: (mode: CameraMode) => void;
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
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
      </mesh>
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.3} />
      </mesh>
    </group>
  );
}

// Enhanced grid with depth
function ChartGrid3D({ width, height, depth }: { width: number; height: number; depth: number }) {
  return (
    <group>
      {/* Back panel */}
      <mesh position={[width / 2, height / 2, -depth / 2]}>
        <planeGeometry args={[width + 0.5, height + 0.5]} />
        <meshBasicMaterial color="#0a0a0a" transparent opacity={0.8} />
      </mesh>

      {/* Floor */}
      <mesh position={[width / 2, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width + 0.5, depth]} />
        <meshBasicMaterial color="#0a0a0a" transparent opacity={0.5} />
      </mesh>

      {/* Horizontal grid lines */}
      {[0.25, 0.5, 0.75, 1].map((y) => (
        <mesh key={`h-${y}`} position={[width / 2, y * height, -depth / 2]}>
          <planeGeometry args={[width, 0.01]} />
          <meshBasicMaterial color="#FF6B4A" transparent opacity={0.15} />
        </mesh>
      ))}

      {/* Vertical grid lines */}
      {[0.25, 0.5, 0.75, 1].map((x) => (
        <mesh key={`v-${x}`} position={[x * width, height / 2, -depth / 2]} rotation={[0, 0, Math.PI / 2]}>
          <planeGeometry args={[height, 0.01]} />
          <meshBasicMaterial color="#FF6B4A" transparent opacity={0.1} />
        </mesh>
      ))}

      {/* Depth lines */}
      {[0, 0.5, 1].map((z) => (
        <Line
          key={`d-${z}`}
          points={[
            new THREE.Vector3(0, 0, -z * depth / 2),
            new THREE.Vector3(width, 0, -z * depth / 2),
          ]}
          color="#FF6B4A"
          lineWidth={1}
          transparent
          opacity={0.1}
        />
      ))}
    </group>
  );
}

// Auto-rotating camera
function AutoCamera({
  centerX,
  centerY,
  radius,
  enabled,
}: {
  centerX: number;
  centerY: number;
  radius: number;
  enabled: boolean;
}) {
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);

  useFrame((state) => {
    if (!enabled || !cameraRef.current) return;

    const angle = state.clock.elapsedTime * 0.3;
    const x = centerX + Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    const y = centerY + 1 + Math.sin(state.clock.elapsedTime * 0.5) * 0.5;

    cameraRef.current.position.set(x, y, z);
    cameraRef.current.lookAt(centerX, centerY, 0);
  });

  return (
    <PerspectiveCamera
      ref={cameraRef}
      makeDefault={enabled}
      position={[centerX, centerY + 1, radius]}
      fov={40}
    />
  );
}

function ChartScene({
  data,
  currentProbability,
  cameraMode,
}: {
  data: PricePoint[];
  currentProbability?: number;
  cameraMode: CameraMode;
}) {
  const CHART_WIDTH = 8;
  const CHART_HEIGHT = 3;
  const CHART_DEPTH = 2;

  const { yesLinePoints, noLinePoints } = useMemo(() => {
    if (data.length === 0) {
      return { yesLinePoints: [], noLinePoints: [] };
    }

    const minP = 0;
    const maxP = 1;
    const range = maxP - minP;

    const yesPts = data.map((point, i) => {
      const x = (i / Math.max(1, data.length - 1)) * CHART_WIDTH;
      const y = ((point.p - minP) / range) * CHART_HEIGHT;
      return new THREE.Vector3(x, y, 0);
    });

    const noPts = data.map((point, i) => {
      const x = (i / Math.max(1, data.length - 1)) * CHART_WIDTH;
      const noProb = 1 - point.p;
      const y = ((noProb - minP) / range) * CHART_HEIGHT;
      return new THREE.Vector3(x, y, 0);
    });

    return { yesLinePoints: yesPts, noLinePoints: noPts };
  }, [data]);

  const yLabels = useMemo(() => {
    const labels: { y: number; text: string }[] = [];
    for (let i = 0; i <= 4; i++) {
      const normalizedY = (i / 4) * CHART_HEIGHT;
      const value = i * 25;
      labels.push({ y: normalizedY, text: `${value}%` });
    }
    return labels;
  }, []);

  const yesColor = "#22c55e";
  const noColor = "#ef4444";

  return (
    <>
      {/* Camera modes */}
      {cameraMode === "orbit" && (
        <>
          <PerspectiveCamera
            makeDefault
            position={[CHART_WIDTH / 2, CHART_HEIGHT / 2 + 2, 8]}
            fov={40}
          />
          <OrbitControls
            enablePan={true}
            enableZoom={true}
            enableRotate={true}
            target={[CHART_WIDTH / 2, CHART_HEIGHT / 2, 0]}
            minDistance={3}
            maxDistance={20}
          />
        </>
      )}

      {cameraMode === "fly" && (
        <>
          <PerspectiveCamera
            makeDefault
            position={[CHART_WIDTH / 2, CHART_HEIGHT / 2 + 2, 8]}
            fov={40}
          />
          <FlyControls
            enabled={true}
            movementSpeed={10}
            lookSpeed={0.002}
          />
        </>
      )}

      {cameraMode === "auto" && (
        <AutoCamera
          centerX={CHART_WIDTH / 2}
          centerY={CHART_HEIGHT / 2}
          radius={8}
          enabled={true}
        />
      )}

      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]} intensity={0.8} />
      <pointLight position={[-5, 5, -5]} intensity={0.3} color="#FF6B4A" />
      <pointLight position={[CHART_WIDTH, CHART_HEIGHT, 5]} intensity={0.2} color="#22c55e" />

      <ChartGrid3D width={CHART_WIDTH} height={CHART_HEIGHT} depth={CHART_DEPTH} />

      {/* Y-axis labels - using Billboard to always face camera */}
      {yLabels.map((label, i) => (
        <Billboard key={`y-${i}`} position={[-0.4, label.y, 0.5]} follow={true}>
          <Text
            fontSize={0.2}
            color="#666666"
            anchorX="right"
            anchorY="middle"
          >
            {label.text}
          </Text>
        </Billboard>
      ))}

      {/* YES line (no area fill - cleaner look) */}
      {yesLinePoints.length > 1 && (
        <GlowingLine points={yesLinePoints} color={yesColor} lineWidth={3} />
      )}

      {/* NO line (no area fill - cleaner look) */}
      {noLinePoints.length > 1 && (
        <GlowingLine points={noLinePoints} color={noColor} lineWidth={3} />
      )}

      {/* Pulsing dots */}
      {yesLinePoints.length > 0 && <PulsingDot position={yesLinePoints[yesLinePoints.length - 1]} color={yesColor} />}
      {noLinePoints.length > 0 && <PulsingDot position={noLinePoints[noLinePoints.length - 1]} color={noColor} />}

      {/* Labels - using Billboard to always face camera */}
      {currentProbability !== undefined && yesLinePoints.length > 0 && noLinePoints.length > 0 && (
        <>
          <Billboard position={[yesLinePoints[yesLinePoints.length - 1].x + 0.5, yesLinePoints[yesLinePoints.length - 1].y, 0.5]} follow={true}>
            <Text
              fontSize={0.2}
              color={yesColor}
              anchorX="left"
              anchorY="middle"
              fontWeight="bold"
            >
              {Math.round(currentProbability * 100)}% Yes
            </Text>
          </Billboard>
          <Billboard position={[noLinePoints[noLinePoints.length - 1].x + 0.5, noLinePoints[noLinePoints.length - 1].y, 0.5]} follow={true}>
            <Text
              fontSize={0.2}
              color={noColor}
              anchorX="left"
              anchorY="middle"
              fontWeight="bold"
            >
              {Math.round((1 - currentProbability) * 100)}% No
            </Text>
          </Billboard>
        </>
      )}

      {/* Title floating above - using Billboard */}
      <Billboard position={[CHART_WIDTH / 2, CHART_HEIGHT + 0.5, 0.5]} follow={true}>
        <Text
          fontSize={0.25}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
        >
          Price History
        </Text>
      </Billboard>
    </>
  );
}

export function Interactive3DChart({
  data,
  isLoading,
  currentProbability,
  cameraMode = "orbit",
}: Interactive3DChartProps) {
  const { isDark } = useThemeStore();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  if (isLoading && data.length === 0) {
    return (
      <div className={`h-full w-full flex items-center justify-center ${isDark ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FF6B4A] border-t-transparent" />
          <span className={`text-sm ${isDark ? 'text-white/50' : 'text-gray-500'}`}>Loading chart...</span>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={`h-full w-full flex items-center justify-center text-sm ${
        isDark ? 'bg-[#0a0a0a] text-white/40' : 'bg-gray-50 text-gray-400'
      }`}>
        No price history available
      </div>
    );
  }

  return (
    <div className={`h-full w-full relative ${isDark ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
      {/* Ambient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px]">
          <div
            className={`absolute inset-0 blur-[60px] animate-slow-spin ${isDark ? '' : 'opacity-50'}`}
            style={{
              background: "conic-gradient(from 0deg, #22c55e20, #ef444410, #22c55e10, #ef444420)"
            }}
          />
        </div>
      </div>

      {isMounted && (
        <Canvas gl={{ antialias: true, alpha: true }}>
          <Suspense fallback={null}>
            <ChartScene data={data} currentProbability={currentProbability} cameraMode={cameraMode} />
          </Suspense>
        </Canvas>
      )}
    </div>
  );
}
