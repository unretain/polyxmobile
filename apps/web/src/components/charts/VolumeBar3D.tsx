"use client";

import * as THREE from "three";

interface VolumeBar3DProps {
  index: number;
  height: number;
  isUp: boolean;
  spacing?: number;
  width?: number;
  depth?: number;
  zOffset?: number;
}

export function VolumeBar3D({
  index,
  height,
  isUp,
  spacing = 1.2,
  width = 0.7,
  depth = 0.7,
  zOffset = 6
}: VolumeBar3DProps) {
  const barWidth = width;
  const barDepth = depth;

  const upColor = new THREE.Color("#22c55e");
  const downColor = new THREE.Color("#ef4444");
  const color = isUp ? upColor : downColor;

  const xPosition = index * spacing;
  const yPosition = height / 2; // Center the bar vertically

  // Ensure minimum visible height
  const displayHeight = Math.max(height, 0.1);

  return (
    <mesh position={[xPosition, yPosition, zOffset]}>
      <boxGeometry args={[barWidth, displayHeight, barDepth]} />
      <meshStandardMaterial
        color={color}
        transparent
        opacity={0.6}
        metalness={0.2}
        roughness={0.5}
      />
    </mesh>
  );
}
