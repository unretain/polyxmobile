"use client";

import { useMemo } from "react";
import { Line } from "@react-three/drei";
import * as THREE from "three";

interface ChartGridProps {
  width: number;
  height: number;
  depth: number;
}

export function ChartGrid({ width, height, depth }: ChartGridProps) {
  const gridColor = new THREE.Color("#1a1a1a");
  const accentColor = new THREE.Color("#FF6B4A");

  // Generate floor grid lines
  const floorLines = useMemo(() => {
    const lines: [THREE.Vector3, THREE.Vector3][] = [];
    const divisionsX = Math.ceil(width / 5);
    const divisionsZ = Math.ceil(depth / 5);

    // X-direction lines (along width)
    for (let i = 0; i <= divisionsZ; i++) {
      const z = (i / divisionsZ) * depth - depth / 2;
      lines.push([
        new THREE.Vector3(0, 0, z),
        new THREE.Vector3(width, 0, z),
      ]);
    }

    // Z-direction lines (along depth)
    for (let i = 0; i <= divisionsX; i++) {
      const x = (i / divisionsX) * width;
      lines.push([
        new THREE.Vector3(x, 0, -depth / 2),
        new THREE.Vector3(x, 0, depth / 2),
      ]);
    }

    return lines;
  }, [width, depth]);

  // Generate back wall grid lines
  const backWallLines = useMemo(() => {
    const lines: [THREE.Vector3, THREE.Vector3][] = [];
    const divisionsX = Math.ceil(width / 5);
    const divisionsY = Math.ceil(height / 2);
    const backZ = -depth / 2;

    // Horizontal lines
    for (let i = 0; i <= divisionsY; i++) {
      const y = (i / divisionsY) * height;
      lines.push([
        new THREE.Vector3(0, y, backZ),
        new THREE.Vector3(width, y, backZ),
      ]);
    }

    // Vertical lines
    for (let i = 0; i <= divisionsX; i++) {
      const x = (i / divisionsX) * width;
      lines.push([
        new THREE.Vector3(x, 0, backZ),
        new THREE.Vector3(x, height, backZ),
      ]);
    }

    return lines;
  }, [width, height, depth]);

  // Generate side wall grid lines (left side)
  const sideWallLines = useMemo(() => {
    const lines: [THREE.Vector3, THREE.Vector3][] = [];
    const divisionsZ = Math.ceil(depth / 5);
    const divisionsY = Math.ceil(height / 2);

    // Horizontal lines
    for (let i = 0; i <= divisionsY; i++) {
      const y = (i / divisionsY) * height;
      lines.push([
        new THREE.Vector3(0, y, -depth / 2),
        new THREE.Vector3(0, y, depth / 2),
      ]);
    }

    // Vertical lines (along Z)
    for (let i = 0; i <= divisionsZ; i++) {
      const z = (i / divisionsZ) * depth - depth / 2;
      lines.push([
        new THREE.Vector3(0, 0, z),
        new THREE.Vector3(0, height, z),
      ]);
    }

    return lines;
  }, [height, depth]);

  return (
    <group>
      {/* Floor grid */}
      {floorLines.map((line, index) => (
        <Line
          key={`floor-${index}`}
          points={line}
          color={gridColor}
          lineWidth={0.5}
          transparent
          opacity={0.4}
        />
      ))}

      {/* Back wall grid */}
      {backWallLines.map((line, index) => (
        <Line
          key={`back-${index}`}
          points={line}
          color={accentColor}
          lineWidth={0.5}
          transparent
          opacity={0.15}
        />
      ))}

      {/* Side wall grid */}
      {sideWallLines.map((line, index) => (
        <Line
          key={`side-${index}`}
          points={line}
          color={gridColor}
          lineWidth={0.5}
          transparent
          opacity={0.2}
        />
      ))}

      {/* Floor plane for depth perception */}
      <mesh position={[width / 2, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width + 4, depth + 4]} />
        <meshStandardMaterial
          color="#0a0a0a"
          transparent
          opacity={0.8}
        />
      </mesh>
    </group>
  );
}
