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

  // Subtle blue/purple tones for volume - distinct from candle colors
  const upColor = new THREE.Color("#3b82f6"); // blue
  const downColor = new THREE.Color("#8b5cf6"); // purple
  const color = isUp ? upColor : downColor;

  const xPosition = index * spacing;
  const yPosition = height / 2;

  // Ensure minimum visible height
  const displayHeight = Math.max(height, 0.05);

  return (
    <mesh position={[xPosition, yPosition, zOffset]}>
      <boxGeometry args={[barWidth, displayHeight, barDepth]} />
      <meshStandardMaterial
        color={color}
        transparent
        opacity={0.4}
        metalness={0.1}
        roughness={0.6}
      />
    </mesh>
  );
}
