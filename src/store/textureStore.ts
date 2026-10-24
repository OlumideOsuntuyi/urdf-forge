/** Texture image bytes (JPEG/PNG) by key. Like meshStore: outside React state, saved with projects. */
import { app } from "./app";

const data = new Map<string, Uint8Array>();

export const textureStore = {
  get: (key: string) => data.get(key),
  has: (key: string) => data.has(key),
  set(key: string, bytes: Uint8Array) {
    data.set(key, bytes);
    app().bumpMeshes();
  },
  setMany(entries: Iterable<[string, Uint8Array]>) {
    for (const [k, v] of entries) data.set(k, v);
    app().bumpMeshes();
  },
  clear() {
    data.clear();
    app().bumpMeshes();
  },
  entries: () => data.entries(),
  snapshot: () => new Map(data),
};

export function textureMime(key: string): string {
  return /\.png$/i.test(key) ? "image/png" : "image/jpeg";
}
