import type { Viewport } from "./Viewport";

let current: Viewport | null = null;

export const viewportRef = {
  get: () => current,
  set: (v: Viewport | null) => {
    current = v;
  },
};
