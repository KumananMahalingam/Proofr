// Learn more: https://docs.expo.dev/guides/customizing-metro/
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

/**
 * Pin every @liveblocks entry point to the same module format (ESM).
 *
 * Why this is needed — Liveblocks reports it directly:
 *
 *   Multiple copies of Liveblocks are being loaded in your project.
 *   - @liveblocks/core 3.24.1 (esm) (already loaded)
 *   - @liveblocks/core 3.24.1 (cjs) (trying to load this now)
 *
 * All four packages are `"type": "module"` and publish an exports map with a
 * non-standard `"module"` condition nested inside `"require"`:
 *
 *   "require": { "module": "./dist/index.js", "default": "./dist/index.cjs" }
 *
 * Left to Metro's defaults, `@liveblocks/client` matches the ESM build while
 * `@liveblocks/react/suspense` matches the CJS one. Each pulls in its own copy
 * of `@liveblocks/core`, and core's duplicate detection throws on the second.
 * Pinning them all to one format is what fixes it — ESM specifically, because
 * that is the copy that loads first and succeeds today.
 *
 * Two things not to do:
 *  - Do NOT set `unstable_enablePackageExports = false` globally. Convex
 *    resolves its `./react` and `./react-clerk` subpaths through its exports
 *    map, so that breaks `convex/react` instead.
 *  - Do NOT mix formats across these entries. That is the exact bug above.
 *
 * Unrelated but adjacent: @liveblocks/core also throws at import time in dev
 * because its devtools bridge calls `window.addEventListener`, which React
 * Native lacks. That is handled by the shim in polyfills.ts, not here.
 *
 * Revisit if Liveblocks ships a corrected exports map.
 */
const liveblocksDist = (pkg, file) =>
  path.join(__dirname, "node_modules", "@liveblocks", pkg, "dist", file);

const LIVEBLOCKS_ESM = {
  "@liveblocks/client": liveblocksDist("client", "index.js"),
  "@liveblocks/core": liveblocksDist("core", "index.js"),
  "@liveblocks/react": liveblocksDist("react", "index.js"),
  "@liveblocks/react/suspense": liveblocksDist("react", "suspense.js"),
  "@liveblocks/react/_private": liveblocksDist("react", "_private.js"),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const filePath = LIVEBLOCKS_ESM[moduleName];
  if (filePath) {
    return { type: "sourceFile", filePath };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
