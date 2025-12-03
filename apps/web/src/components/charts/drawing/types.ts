import * as THREE from "three";

export type DrawingToolType = "ray" | "segment" | "hline" | "vline" | "freehand" | null;

export interface DrawingPoint {
  x: number; // World X (0-60)
  y: number; // World Y (0-10)
  z: number; // World Z
}

export interface BaseDrawing {
  id: string;
  type: DrawingToolType;
  color: string;
  lineWidth: number;
  createdAt: number;
  locked: boolean;
}

export interface RayDrawing extends BaseDrawing {
  type: "ray";
  startPoint: DrawingPoint;
  direction: DrawingPoint; // Normalized direction vector
}

export interface SegmentDrawing extends BaseDrawing {
  type: "segment";
  startPoint: DrawingPoint;
  endPoint: DrawingPoint;
}

export interface HLineDrawing extends BaseDrawing {
  type: "hline";
  y: number; // World Y position (price level)
  priceValue?: number; // Actual price for display
}

export interface VLineDrawing extends BaseDrawing {
  type: "vline";
  x: number; // World X position (time index)
  timestamp?: number; // Actual timestamp for display
}

export interface FreehandDrawing extends BaseDrawing {
  type: "freehand";
  points: DrawingPoint[];
}

export type Drawing = RayDrawing | SegmentDrawing | HLineDrawing | VLineDrawing | FreehandDrawing;

export interface DrawingState {
  drawings: Drawing[];
  activeDrawing: Partial<Drawing> | null;
  selectedDrawingId: string | null;
  activeTool: DrawingToolType;
  activeColor: string;
  activeLineWidth: number;
  isDrawing: boolean;
}

export interface DrawingContextValue extends DrawingState {
  setActiveTool: (tool: DrawingToolType) => void;
  setActiveColor: (color: string) => void;
  setActiveLineWidth: (width: number) => void;
  addDrawing: (drawing: Drawing) => void;
  updateDrawing: (id: string, updates: Partial<Drawing>) => void;
  deleteDrawing: (id: string) => void;
  clearAllDrawings: () => void;
  selectDrawing: (id: string | null) => void;
  startDrawing: (point: DrawingPoint) => void;
  continueDrawing: (point: DrawingPoint) => void;
  finishDrawing: (point?: DrawingPoint) => void;
  cancelDrawing: () => void;
}

// Chart constants (should match Chart3D)
export const CHART_WIDTH = 60;
export const PRICE_HEIGHT = 10;
export const CHART_DEPTH = 6;
export const VOLUME_Z_OFFSET = 4;

// Default drawing colors
export const DRAWING_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#ffffff", // white
];

export const DEFAULT_LINE_WIDTH = 2;
