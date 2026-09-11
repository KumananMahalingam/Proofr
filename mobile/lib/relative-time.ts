/**
 * Minimal replacement for `date-fns`' `formatDistanceToNow`.
 *
 * The web board card used date-fns for the "2 hours ago" label. Adding a date
 * library to the bundle for one string is not worth it, and this covers the range
 * a board list actually needs.
 */
export function formatDistanceToNow(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

  if (seconds < 45) return "just now";

  const units: Array<[label: string, seconds: number]> = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];

  for (const [label, unitSeconds] of units) {
    const value = Math.floor(seconds / unitSeconds);
    if (value >= 1) {
      return `${value} ${label}${value === 1 ? "" : "s"} ago`;
    }
  }

  return "just now";
}

/**
 * Deterministic accent colour for a board preview.
 *
 * The web app stored a random `/placeholders/N.svg` path per board and served it
 * from `public/`. Those files do not exist on a device, so the preview is
 * generated from the board id instead — stable across launches and devices, and
 * with no assets to ship.
 */
const PREVIEW_PALETTE = [
  ["#3b82f6", "#1e3a8a"],
  ["#8b5cf6", "#4c1d95"],
  ["#ec4899", "#831843"],
  ["#f97316", "#7c2d12"],
  ["#10b981", "#064e3b"],
  ["#06b6d4", "#164e63"],
  ["#eab308", "#713f12"],
  ["#ef4444", "#7f1d1d"],
] as const;

export function previewColors(id: string): readonly [string, string] {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return PREVIEW_PALETTE[Math.abs(hash) % PREVIEW_PALETTE.length];
}
