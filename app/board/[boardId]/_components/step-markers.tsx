import type { CanvasStepMarker } from "./handwriting-overlay";

interface StepMarkersProps {
  steps: CanvasStepMarker[];
}

const ICON_RADIUS = 14;
const TOOLTIP_OFFSET = ICON_RADIUS + 6;
const TOOLTIP_WIDTH = 240;
const TOOLTIP_HEIGHT = 56;

export const StepMarkers = ({ steps }: StepMarkersProps) => {
  if (steps.length === 0) return null;

  return (
    <g pointerEvents="none">
      {steps.map((step) => (
        <g
          key={step.id}
          transform={`translate(${step.x}, ${step.y})`}
          className="transition-opacity duration-200"
        >
          {step.isCorrect ? (
            <>
              <circle
                r={ICON_RADIUS}
                fill="#22c55e"
                stroke="white"
                strokeWidth={2}
              />
              <path
                d="M -6 0 L -2 4 L 6 -4"
                stroke="white"
                strokeWidth={2.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </>
          ) : (
            <>
              <circle
                r={ICON_RADIUS}
                fill="#ef4444"
                stroke="white"
                strokeWidth={2}
              />
              <text
                x={0}
                y={1}
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
                fontWeight={700}
                fontSize={18}
                style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
              >
                !
              </text>
            </>
          )}

          {!step.isCorrect && step.issue && (
            <foreignObject
              x={TOOLTIP_OFFSET}
              y={-TOOLTIP_HEIGHT / 2}
              width={TOOLTIP_WIDTH}
              height={TOOLTIP_HEIGHT}
              style={{ overflow: "visible" }}
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
                    background: "#ef4444",
                    color: "white",
                    fontSize: 12,
                    lineHeight: 1.35,
                    padding: "6px 10px",
                    borderRadius: 8,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                    maxWidth: TOOLTIP_WIDTH - 8,
                  }}
                >
                  {step.issue}
                </div>
              </div>
            </foreignObject>
          )}
        </g>
      ))}
    </g>
  );
};
