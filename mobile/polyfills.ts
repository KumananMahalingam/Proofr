/**
 * Runtime polyfills. Must be imported before anything else in the app.
 *
 * 1) base64
 * Hermes does not implement `atob` / `btoa` (facebook/hermes#1178), and Expo's
 * winter runtime covers AbortSignal, DOMException, FormData, TextDecoder, URL
 * and structuredClone but not base64. `@liveblocks/client` needs `atob` to
 * decode the room token and refuses to create a client without it:
 * https://liveblocks.io/docs/errors/liveblocks-client/atob-polyfill
 * Clerk decodes JWTs too, so this is installed globally rather than passed via
 * Liveblocks' `polyfills` client option — one fix covers both.
 *
 * 2) DOM event methods on `window`
 * `@liveblocks/core` sets up a devtools bridge guarded only by
 * `typeof window !== "undefined"`, then calls `window.addEventListener(...)`.
 * React Native *does* define a global `window`, so that guard passes while the
 * method is missing, and the whole package throws at module-evaluation time with
 * `undefined is not a function`. It sits behind `NODE_ENV !== "production"`, so
 * it only affects development builds. Shimming the three methods it uses as
 * no-ops is enough — the devtools panel it talks to cannot exist on a device.
 *
 * Caveat worth knowing: some libraries sniff `window.addEventListener` to decide
 * they are running in a browser. If a dependency starts taking an unexpected
 * web code path, this shim is the first thing to suspect.
 */
import { decode, encode } from "base-64";

const g = globalThis as unknown as {
  atob?: (data: string) => string;
  btoa?: (data: string) => string;
  window?: Record<string, unknown>;
};

if (typeof g.atob === "undefined") {
  g.atob = decode;
}

if (typeof g.btoa === "undefined") {
  g.btoa = encode;
}

if (g.window) {
  const noop = () => {};
  for (const method of ["addEventListener", "removeEventListener", "postMessage"]) {
    if (typeof g.window[method] !== "function") {
      g.window[method] = noop;
    }
  }
}

export {};
