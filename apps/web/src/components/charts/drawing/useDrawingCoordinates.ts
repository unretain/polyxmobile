import { useCallback } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { DrawingPoint, CHART_WIDTH, PRICE_HEIGHT } from "./types";

export interface ChartBounds {
  minPrice: number;
  maxPrice: number;
  priceRange: number;
}

/**
 * Hook for converting between screen coordinates and 3D world coordinates
 * in the chart's coordinate system
 */
export function useDrawingCoordinates() {
  const { camera, gl, size } = useThree();

  /**
   * Convert screen coordinates (clientX, clientY) to world coordinates on the chart plane
   */
  const screenToWorld = useCallback(
    (clientX: number, clientY: number, planeZ: number = 0): DrawingPoint | null => {
      const canvas = gl.domElement;
      const rect = canvas.getBoundingClientRect();

      // Convert to normalized device coordinates (-1 to +1)
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;

      // Create raycaster
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

      // Create a plane at the specified Z position (chart plane)
      const chartPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZ);

      // Find intersection point
      const worldPoint = new THREE.Vector3();
      const intersected = raycaster.ray.intersectPlane(chartPlane, worldPoint);

      if (!intersected) return null;

      return {
        x: worldPoint.x,
        y: worldPoint.y,
        z: planeZ,
      };
    },
    [camera, gl]
  );

  /**
   * Convert world Y coordinate to price value
   */
  const worldYToPrice = useCallback(
    (worldY: number, bounds: ChartBounds): number => {
      const normalized = worldY / PRICE_HEIGHT;
      return bounds.minPrice + normalized * bounds.priceRange;
    },
    []
  );

  /**
   * Convert price value to world Y coordinate
   */
  const priceToWorldY = useCallback(
    (price: number, bounds: ChartBounds): number => {
      if (bounds.priceRange === 0) return PRICE_HEIGHT / 2;
      const normalized = (price - bounds.minPrice) / bounds.priceRange;
      return Math.max(0, Math.min(PRICE_HEIGHT, normalized * PRICE_HEIGHT));
    },
    []
  );

  /**
   * Convert world X coordinate to data index
   */
  const worldXToIndex = useCallback(
    (worldX: number, dataLength: number): number => {
      if (dataLength === 0) return 0;
      const spacing = CHART_WIDTH / dataLength;
      return Math.round(worldX / spacing);
    },
    []
  );

  /**
   * Convert data index to world X coordinate
   */
  const indexToWorldX = useCallback(
    (index: number, dataLength: number): number => {
      if (dataLength === 0) return 0;
      const spacing = CHART_WIDTH / dataLength;
      return index * spacing;
    },
    []
  );

  /**
   * Clamp a point to valid chart boundaries
   */
  const clampToChart = useCallback((point: DrawingPoint): DrawingPoint => {
    return {
      x: Math.max(0, Math.min(CHART_WIDTH, point.x)),
      y: Math.max(0, Math.min(PRICE_HEIGHT, point.y)),
      z: point.z,
    };
  }, []);

  /**
   * Calculate direction vector from two points (normalized)
   */
  const getDirection = useCallback(
    (start: DrawingPoint, end: DrawingPoint): DrawingPoint => {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const dz = end.z - start.z;
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (length === 0) return { x: 1, y: 0, z: 0 };

      return {
        x: dx / length,
        y: dy / length,
        z: dz / length,
      };
    },
    []
  );

  /**
   * Get a point extended along a ray from start through end
   */
  const extendRay = useCallback(
    (start: DrawingPoint, direction: DrawingPoint, distance: number): DrawingPoint => {
      return {
        x: start.x + direction.x * distance,
        y: start.y + direction.y * distance,
        z: start.z + direction.z * distance,
      };
    },
    []
  );

  /**
   * Snap point to grid (optional, for precision drawing)
   */
  const snapToGrid = useCallback(
    (point: DrawingPoint, gridSizeX: number = 1, gridSizeY: number = 0.5): DrawingPoint => {
      return {
        x: Math.round(point.x / gridSizeX) * gridSizeX,
        y: Math.round(point.y / gridSizeY) * gridSizeY,
        z: point.z,
      };
    },
    []
  );

  return {
    screenToWorld,
    worldYToPrice,
    priceToWorldY,
    worldXToIndex,
    indexToWorldX,
    clampToChart,
    getDirection,
    extendRay,
    snapToGrid,
  };
}
