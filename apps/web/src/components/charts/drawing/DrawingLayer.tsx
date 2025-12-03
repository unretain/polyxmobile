"use client";

import { useRef, useMemo, useEffect, useState, useCallback } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import {
  Drawing,
  DrawingPoint,
  DrawingToolType,
  RayDrawing,
  SegmentDrawing,
  HLineDrawing,
  VLineDrawing,
  FreehandDrawing,
  CHART_WIDTH,
  PRICE_HEIGHT,
} from "./types";
import { useDrawingCoordinates } from "./useDrawingCoordinates";

interface DrawingLayerProps {
  drawings: Drawing[];
  activeTool: DrawingToolType;
  activeColor: string;
  activeLineWidth: number;
  onDrawingComplete: (drawing: Drawing) => void;
  onDrawingUpdate?: (id: string, updates: Partial<Drawing>) => void;
  enabled: boolean;
  orbitControlsRef?: React.RefObject<any>;
}

// Generate unique ID
const generateId = () => `drawing-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Convert DrawingPoint to THREE.Vector3
const toVector3 = (point: DrawingPoint): THREE.Vector3 => {
  return new THREE.Vector3(point.x, point.y, point.z);
};

// Individual drawing renderers
function RayDrawingMesh({ drawing }: { drawing: RayDrawing }) {
  const rayLength = 200; // Extend far enough
  const endPoint = {
    x: drawing.startPoint.x + drawing.direction.x * rayLength,
    y: drawing.startPoint.y + drawing.direction.y * rayLength,
    z: drawing.startPoint.z + drawing.direction.z * rayLength,
  };

  const points = useMemo(
    () => [toVector3(drawing.startPoint), toVector3(endPoint)],
    [drawing.startPoint, endPoint]
  );

  return (
    <Line
      points={points}
      color={drawing.color}
      lineWidth={drawing.lineWidth}
      transparent
      opacity={0.9}
    />
  );
}

function SegmentDrawingMesh({ drawing }: { drawing: SegmentDrawing }) {
  const points = useMemo(
    () => [toVector3(drawing.startPoint), toVector3(drawing.endPoint)],
    [drawing.startPoint, drawing.endPoint]
  );

  return (
    <Line
      points={points}
      color={drawing.color}
      lineWidth={drawing.lineWidth}
      transparent
      opacity={0.9}
    />
  );
}

function HLineDrawingMesh({ drawing }: { drawing: HLineDrawing }) {
  const points = useMemo(
    () => [
      new THREE.Vector3(0, drawing.y, 0.1),
      new THREE.Vector3(CHART_WIDTH, drawing.y, 0.1),
    ],
    [drawing.y]
  );

  return (
    <Line
      points={points}
      color={drawing.color}
      lineWidth={drawing.lineWidth}
      dashed
      dashSize={0.5}
      gapSize={0.3}
      transparent
      opacity={0.8}
    />
  );
}

function VLineDrawingMesh({ drawing }: { drawing: VLineDrawing }) {
  const points = useMemo(
    () => [
      new THREE.Vector3(drawing.x, 0, 0.1),
      new THREE.Vector3(drawing.x, PRICE_HEIGHT, 0.1),
    ],
    [drawing.x]
  );

  return (
    <Line
      points={points}
      color={drawing.color}
      lineWidth={drawing.lineWidth}
      dashed
      dashSize={0.5}
      gapSize={0.3}
      transparent
      opacity={0.8}
    />
  );
}

function FreehandDrawingMesh({ drawing }: { drawing: FreehandDrawing }) {
  const points = useMemo(() => {
    if (drawing.points.length < 2) return null;

    // Create smooth curve through points
    const curvePoints = drawing.points.map(toVector3);

    // If we have enough points, use CatmullRomCurve3 for smoothing
    if (curvePoints.length >= 3) {
      const curve = new THREE.CatmullRomCurve3(curvePoints, false, "catmullrom", 0.5);
      return curve.getPoints(Math.max(50, curvePoints.length * 3));
    }

    return curvePoints;
  }, [drawing.points]);

  if (!points || points.length < 2) return null;

  return (
    <Line
      points={points}
      color={drawing.color}
      lineWidth={drawing.lineWidth}
      transparent
      opacity={0.9}
    />
  );
}

// Preview drawing while creating
function DrawingPreview({
  tool,
  startPoint,
  currentPoint,
  points,
  color,
  lineWidth,
}: {
  tool: DrawingToolType;
  startPoint: DrawingPoint | null;
  currentPoint: DrawingPoint | null;
  points: DrawingPoint[];
  color: string;
  lineWidth: number;
}) {
  if (!tool) return null;

  // Freehand preview
  if (tool === "freehand" && points.length >= 2) {
    const linePoints = points.map(toVector3);
    return (
      <Line
        points={linePoints}
        color={color}
        lineWidth={lineWidth}
        transparent
        opacity={0.6}
      />
    );
  }

  if (!startPoint || !currentPoint) return null;

  // Ray preview
  if (tool === "ray") {
    const dx = currentPoint.x - startPoint.x;
    const dy = currentPoint.y - startPoint.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) return null;

    const direction = { x: dx / length, y: dy / length, z: 0 };
    const endPoint = {
      x: startPoint.x + direction.x * 200,
      y: startPoint.y + direction.y * 200,
      z: startPoint.z,
    };

    return (
      <Line
        points={[toVector3(startPoint), toVector3(endPoint)]}
        color={color}
        lineWidth={lineWidth}
        transparent
        opacity={0.6}
      />
    );
  }

  // Segment preview
  if (tool === "segment") {
    return (
      <Line
        points={[toVector3(startPoint), toVector3(currentPoint)]}
        color={color}
        lineWidth={lineWidth}
        transparent
        opacity={0.6}
      />
    );
  }

  // Horizontal line preview
  if (tool === "hline") {
    return (
      <Line
        points={[
          new THREE.Vector3(0, currentPoint.y, 0.1),
          new THREE.Vector3(CHART_WIDTH, currentPoint.y, 0.1),
        ]}
        color={color}
        lineWidth={lineWidth}
        dashed
        dashSize={0.5}
        gapSize={0.3}
        transparent
        opacity={0.5}
      />
    );
  }

  // Vertical line preview
  if (tool === "vline") {
    return (
      <Line
        points={[
          new THREE.Vector3(currentPoint.x, 0, 0.1),
          new THREE.Vector3(currentPoint.x, PRICE_HEIGHT, 0.1),
        ]}
        color={color}
        lineWidth={lineWidth}
        dashed
        dashSize={0.5}
        gapSize={0.3}
        transparent
        opacity={0.5}
      />
    );
  }

  return null;
}

export function DrawingLayer({
  drawings,
  activeTool,
  activeColor,
  activeLineWidth,
  onDrawingComplete,
  enabled,
  orbitControlsRef,
}: DrawingLayerProps) {
  const { gl } = useThree();
  const { screenToWorld, getDirection, clampToChart } = useDrawingCoordinates();

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<DrawingPoint | null>(null);
  const [currentPoint, setCurrentPoint] = useState<DrawingPoint | null>(null);
  const [freehandPoints, setFreehandPoints] = useState<DrawingPoint[]>([]);

  // Refs for event handling
  const isDrawingRef = useRef(false);
  const startPointRef = useRef<DrawingPoint | null>(null);

  // Disable orbit controls when drawing
  useEffect(() => {
    if (orbitControlsRef?.current && enabled && activeTool) {
      orbitControlsRef.current.enabled = !isDrawing;
    }
  }, [isDrawing, enabled, activeTool, orbitControlsRef]);

  const handlePointerDown = useCallback(
    (event: PointerEvent) => {
      if (!enabled || !activeTool) return;

      event.preventDefault();
      event.stopPropagation();

      const point = screenToWorld(event.clientX, event.clientY, 0.1);
      if (!point) return;

      const clampedPoint = clampToChart(point);

      // For single-click tools (hline, vline)
      if (activeTool === "hline") {
        const drawing: HLineDrawing = {
          id: generateId(),
          type: "hline",
          y: clampedPoint.y,
          color: activeColor,
          lineWidth: activeLineWidth,
          createdAt: Date.now(),
          locked: false,
        };
        onDrawingComplete(drawing);
        return;
      }

      if (activeTool === "vline") {
        const drawing: VLineDrawing = {
          id: generateId(),
          type: "vline",
          x: clampedPoint.x,
          color: activeColor,
          lineWidth: activeLineWidth,
          createdAt: Date.now(),
          locked: false,
        };
        onDrawingComplete(drawing);
        return;
      }

      // For multi-point tools
      setIsDrawing(true);
      isDrawingRef.current = true;
      setStartPoint(clampedPoint);
      startPointRef.current = clampedPoint;
      setCurrentPoint(clampedPoint);

      if (activeTool === "freehand") {
        setFreehandPoints([clampedPoint]);
      }
    },
    [enabled, activeTool, activeColor, activeLineWidth, screenToWorld, clampToChart, onDrawingComplete]
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      if (!enabled || !activeTool) return;

      const point = screenToWorld(event.clientX, event.clientY, 0.1);
      if (!point) return;

      const clampedPoint = clampToChart(point);
      setCurrentPoint(clampedPoint);

      if (isDrawingRef.current && activeTool === "freehand") {
        setFreehandPoints((prev) => {
          // Only add point if it's far enough from the last point
          const lastPoint = prev[prev.length - 1];
          if (lastPoint) {
            const dx = clampedPoint.x - lastPoint.x;
            const dy = clampedPoint.y - lastPoint.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 0.3) return prev; // Minimum distance threshold
          }
          return [...prev, clampedPoint];
        });
      }
    },
    [enabled, activeTool, screenToWorld, clampToChart]
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent) => {
      if (!isDrawingRef.current || !activeTool) return;

      const point = screenToWorld(event.clientX, event.clientY, 0.1);
      const endPoint = point ? clampToChart(point) : currentPoint;

      if (!startPointRef.current || !endPoint) {
        setIsDrawing(false);
        isDrawingRef.current = false;
        setStartPoint(null);
        setFreehandPoints([]);
        return;
      }

      // Create the drawing based on tool type
      if (activeTool === "ray") {
        const direction = getDirection(startPointRef.current, endPoint);
        const drawing: RayDrawing = {
          id: generateId(),
          type: "ray",
          startPoint: startPointRef.current,
          direction,
          color: activeColor,
          lineWidth: activeLineWidth,
          createdAt: Date.now(),
          locked: false,
        };
        onDrawingComplete(drawing);
      } else if (activeTool === "segment") {
        const drawing: SegmentDrawing = {
          id: generateId(),
          type: "segment",
          startPoint: startPointRef.current,
          endPoint,
          color: activeColor,
          lineWidth: activeLineWidth,
          createdAt: Date.now(),
          locked: false,
        };
        onDrawingComplete(drawing);
      } else if (activeTool === "freehand" && freehandPoints.length >= 2) {
        const drawing: FreehandDrawing = {
          id: generateId(),
          type: "freehand",
          points: [...freehandPoints, endPoint],
          color: activeColor,
          lineWidth: activeLineWidth,
          createdAt: Date.now(),
          locked: false,
        };
        onDrawingComplete(drawing);
      }

      // Reset state
      setIsDrawing(false);
      isDrawingRef.current = false;
      setStartPoint(null);
      startPointRef.current = null;
      setFreehandPoints([]);
    },
    [
      activeTool,
      activeColor,
      activeLineWidth,
      currentPoint,
      freehandPoints,
      screenToWorld,
      clampToChart,
      getDirection,
      onDrawingComplete,
    ]
  );

  // Attach event listeners to canvas
  useEffect(() => {
    if (!enabled || !activeTool) return;

    const canvas = gl.domElement;

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointerleave", handlePointerUp);

    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointerleave", handlePointerUp);
    };
  }, [enabled, activeTool, gl, handlePointerDown, handlePointerMove, handlePointerUp]);

  return (
    <group>
      {/* Render all completed drawings */}
      {drawings.map((drawing) => {
        switch (drawing.type) {
          case "ray":
            return <RayDrawingMesh key={drawing.id} drawing={drawing} />;
          case "segment":
            return <SegmentDrawingMesh key={drawing.id} drawing={drawing} />;
          case "hline":
            return <HLineDrawingMesh key={drawing.id} drawing={drawing} />;
          case "vline":
            return <VLineDrawingMesh key={drawing.id} drawing={drawing} />;
          case "freehand":
            return <FreehandDrawingMesh key={drawing.id} drawing={drawing} />;
          default:
            return null;
        }
      })}

      {/* Render preview while drawing */}
      {enabled && activeTool && (
        <DrawingPreview
          tool={activeTool}
          startPoint={startPoint}
          currentPoint={currentPoint}
          points={freehandPoints}
          color={activeColor}
          lineWidth={activeLineWidth}
        />
      )}
    </group>
  );
}
