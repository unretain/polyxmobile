"use client";

import { useState, useRef } from "react";
import {
  Pencil,
  Minus,
  MoveHorizontal,
  MoveVertical,
  TrendingUp,
  Trash2,
  MousePointer2,
} from "lucide-react";
import { DrawingToolType } from "./types";

interface DrawingToolbarProps {
  activeTool: DrawingToolType;
  activeColor: string;
  activeLineWidth: number;
  onToolChange: (tool: DrawingToolType) => void;
  onColorChange: (color: string) => void;
  onLineWidthChange: (width: number) => void;
  onClearAll: () => void;
  drawingCount: number;
  compact?: boolean; // Horizontal scrollable mode for smaller containers
  minimal?: boolean; // Ultra-minimal vertical mode for landing page
}

const tools: { type: DrawingToolType | "select"; icon: React.ReactNode; label: string }[] = [
  { type: "select", icon: <MousePointer2 className="w-4 h-4" />, label: "Select" },
  { type: "segment", icon: <Minus className="w-4 h-4" />, label: "Segment" },
  { type: "ray", icon: <TrendingUp className="w-4 h-4" />, label: "Ray" },
  { type: "hline", icon: <MoveHorizontal className="w-4 h-4" />, label: "H-Line" },
  { type: "vline", icon: <MoveVertical className="w-4 h-4" />, label: "V-Line" },
  { type: "freehand", icon: <Pencil className="w-4 h-4" />, label: "Draw" },
];

export function DrawingToolbar({
  activeTool,
  activeColor,
  onToolChange,
  onColorChange,
  onClearAll,
  drawingCount,
  compact = false,
  minimal = false,
}: DrawingToolbarProps) {
  const [hoveredTool, setHoveredTool] = useState<string | null>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const colorInputCompactRef = useRef<HTMLInputElement>(null);

  // Minimal vertical mode - clean, no popups, just icons
  if (minimal) {
    return (
      <div className="flex flex-col items-center py-2 px-1 gap-0.5">
        {/* Drawing tools */}
        {tools.map((tool) => (
          <button
            key={tool.type}
            onClick={() => onToolChange(tool.type === "select" ? null : tool.type)}
            title={tool.label}
            className={`p-1.5 rounded transition-all ${
              (tool.type === "select" && !activeTool) || activeTool === tool.type
                ? "bg-[#FF6B4A] text-white"
                : "text-white/50 hover:text-white hover:bg-white/10"
            }`}
          >
            {tool.icon}
          </button>
        ))}

        {/* Divider */}
        <div className="w-5 h-px bg-white/10 my-1" />

        {/* Color picker */}
        <button
          onClick={() => colorInputRef.current?.click()}
          title="Color"
          className="p-1.5 rounded hover:bg-white/10 transition-colors"
        >
          <div
            className="w-4 h-4 rounded-full border border-white/20"
            style={{ backgroundColor: activeColor }}
          />
        </button>
        <input
          ref={colorInputRef}
          type="color"
          value={activeColor}
          onChange={(e) => onColorChange(e.target.value)}
          className="absolute opacity-0 w-0 h-0 pointer-events-none"
        />

        {/* Clear all */}
        {drawingCount > 0 && (
          <>
            <div className="w-5 h-px bg-white/10 my-1" />
            <button
              onClick={onClearAll}
              title={`Clear (${drawingCount})`}
              className="p-1.5 rounded text-red-400/50 hover:text-red-400 hover:bg-red-400/10 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    );
  }

  // Compact horizontal mode
  if (compact) {
    return (
      <div className="flex items-center gap-1 bg-white/5 backdrop-blur-md p-1 border border-white/10 shadow-xl overflow-x-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
        {/* Drawing tools */}
        {tools.map((tool) => (
          <button
            key={tool.type}
            onClick={() => onToolChange(tool.type === "select" ? null : tool.type)}
            title={tool.label}
            className={`p-1.5 rounded transition-all flex-shrink-0 ${
              (tool.type === "select" && !activeTool) || activeTool === tool.type
                ? "bg-[#FF6B4A] text-white"
                : "text-white/60 hover:text-white hover:bg-white/10"
            }`}
          >
            {tool.icon}
          </button>
        ))}

        {/* Divider */}
        <div className="w-px h-5 bg-white/10 mx-0.5 flex-shrink-0" />

        {/* Color picker - click opens native color wheel */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => colorInputCompactRef.current?.click()}
            title="Color"
            className="p-1.5 rounded hover:bg-white/10 transition-colors flex items-center justify-center"
          >
            <div
              className="w-4 h-4 rounded-full border border-white/30"
              style={{ backgroundColor: activeColor }}
            />
          </button>
          <input
            ref={colorInputCompactRef}
            type="color"
            value={activeColor}
            onChange={(e) => onColorChange(e.target.value)}
            className="absolute opacity-0 w-0 h-0 pointer-events-none"
          />
        </div>

        {/* Clear all */}
        {drawingCount > 0 && (
          <>
            <div className="w-px h-5 bg-white/10 mx-0.5 flex-shrink-0" />
            <button
              onClick={onClearAll}
              title={`Clear All (${drawingCount})`}
              className="p-1.5 rounded text-red-400/60 hover:text-red-400 hover:bg-red-400/10 transition-colors flex-shrink-0"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    );
  }

  // Default vertical mode (for full chart pages)
  return (
    <div className="flex flex-col gap-1 bg-white/5 backdrop-blur-md p-1.5 border border-white/10 shadow-xl z-20">
      {/* Drawing tools */}
      {tools.map((tool) => (
        <div key={tool.type} className="relative">
          <button
            onClick={() => onToolChange(tool.type === "select" ? null : tool.type)}
            onMouseEnter={() => setHoveredTool(tool.type)}
            onMouseLeave={() => setHoveredTool(null)}
            className={`p-2 rounded transition-all ${
              (tool.type === "select" && !activeTool) || activeTool === tool.type
                ? "bg-[#FF6B4A] text-white"
                : "text-white/60 hover:text-white hover:bg-white/10"
            }`}
          >
            {tool.icon}
          </button>

          {/* Tooltip */}
          {hoveredTool === tool.type && (
            <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-black/90 rounded text-xs text-white whitespace-nowrap z-50 pointer-events-none">
              {tool.label}
            </div>
          )}
        </div>
      ))}

      {/* Divider */}
      <div className="h-px bg-white/10 my-1" />

      {/* Color picker - click opens native color wheel */}
      <div className="relative">
        <button
          onClick={() => colorInputRef.current?.click()}
          onMouseEnter={() => setHoveredTool("color")}
          onMouseLeave={() => setHoveredTool(null)}
          className="p-2 rounded hover:bg-white/10 transition-colors flex items-center justify-center"
        >
          <div
            className="w-4 h-4 rounded-full border border-white/30"
            style={{ backgroundColor: activeColor }}
          />
        </button>
        <input
          ref={colorInputRef}
          type="color"
          value={activeColor}
          onChange={(e) => onColorChange(e.target.value)}
          className="absolute opacity-0 w-0 h-0 pointer-events-none"
        />

        {hoveredTool === "color" && (
          <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-black/90 rounded text-xs text-white whitespace-nowrap z-50 pointer-events-none">
            Color
          </div>
        )}
      </div>

      {/* Divider */}
      {drawingCount > 0 && <div className="h-px bg-white/10 my-1" />}

      {/* Clear all */}
      {drawingCount > 0 && (
        <div className="relative">
          <button
            onClick={onClearAll}
            onMouseEnter={() => setHoveredTool("clear")}
            onMouseLeave={() => setHoveredTool(null)}
            className="p-2 rounded text-red-400/60 hover:text-red-400 hover:bg-red-400/10 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          {hoveredTool === "clear" && (
            <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-black/90 rounded text-xs text-white whitespace-nowrap z-50 pointer-events-none">
              Clear All ({drawingCount})
            </div>
          )}
        </div>
      )}
    </div>
  );
}
