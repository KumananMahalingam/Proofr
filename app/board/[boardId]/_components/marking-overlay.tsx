"use client";

import { useState } from "react";

export interface MarkedLine {
  lineNumber: number;
  content: string;
  yPositionPercent: number;
  correct: boolean;
  explanation: string | null;
}

interface MarkingOverlayProps {
  bounds: { x: number; y: number; width: number; height: number } | null;
  results: MarkedLine[];
}

const ICON_RADIUS = 10;
const HORIZONTAL_GAP = 48;
const TOOLTIP_WIDTH = 240;
const TOOLTIP_HEIGHT = 56;

/**
 * Renders a tick/cross next to each line of the student's submitted working.
 * Positions are derived from `yPositionPercent` reported by the marker API,
 * mapped against `bounds` (the same region that was captured and sent to the
 * model). All children must live INSIDE the camera-transformed <g> so they
 * pan/zoom in lock-step with the canvas content.
 */
export const MarkingOverlay = ({ bounds, results }: MarkingOverlayProps) => {
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  if (!bounds || results.length === 0) return null;

  const iconX = bounds.x + bounds.width + HORIZONTAL_GAP;

  return (
    <g>
      {results.map((result) => {
        const iconY =
          bounds.y + (result.yPositionPercent / 100) * bounds.height;

        if (result.correct) {
          return (
            <g
              key={result.lineNumber}
              transform={`translate(${iconX}, ${iconY})`}
              pointerEvents="none"
            >
              <circle
                r={ICON_RADIUS}
                fill="#22c55e"
                stroke="white"
                strokeWidth={1.5}
                opacity={0.95}
              />
              <path
                d="M -4 0 L -1 3 L 4.5 -3"
                stroke="white"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </g>
          );
        }

        const isHovered = hoveredId === result.lineNumber;

        return (
          <g
            key={result.lineNumber}
            transform={`translate(${iconX}, ${iconY})`}
            style={{ cursor: "pointer" }}
            onPointerEnter={() => setHoveredId(result.lineNumber)}
            onPointerLeave={() =>
              setHoveredId((curr) =>
                curr === result.lineNumber ? null : curr
              )
            }
          >
            <circle
              r={ICON_RADIUS}
              fill="#ef4444"
              stroke="white"
              strokeWidth={1.5}
              opacity={0.95}
            />
            <text
              x={0}
              y={1}
              textAnchor="middle"
              dominantBaseline="central"
              fill="white"
              fontWeight={700}
              fontSize={14}
              style={{
                fontFamily: "ui-sans-serif, system-ui, sans-serif",
                userSelect: "none",
              }}
              pointerEvents="none"
            >
              !
            </text>

            {isHovered && result.explanation && (
              <foreignObject
                x={ICON_RADIUS + 6}
                y={-TOOLTIP_HEIGHT / 2}
                width={TOOLTIP_WIDTH}
                height={TOOLTIP_HEIGHT}
                style={{ overflow: "visible" }}
                pointerEvents="none"
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    height: "100%",
                    fontFamily: "ui-sans-serif, system-ui, sans-serif",
                  }}
                >
                  <div
                    style={{
                      background: "#1a1a2e",
                      color: "rgba(255,255,255,0.92)",
                      fontSize: 12,
                      lineHeight: 1.4,
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.1)",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
                      maxWidth: TOOLTIP_WIDTH - 8,
                    }}
                  >
                    {result.explanation}
                  </div>
                </div>
              </foreignObject>
            )}
          </g>
        );
      })}
    </g>
  );
};
