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
