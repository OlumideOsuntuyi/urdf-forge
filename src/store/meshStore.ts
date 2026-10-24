/** Mesh geometry by asset id. Kept outside React state: it is large and never edited in place. */
import { app } from "./app";

const data = new Map<string, Float32Array>();

export const meshStore = {
  get: (id: string) => data.get(id),
  has: (id: string) => data.has(id),
  set(id: string, positions: Float32Array) {
    data.set(id, positions);
    app().bumpMeshes();
  },
  setMany(entries: Iterable<[string, Float32Array]>) {
    for (const [k, v] of entries) data.set(k, v);
    app().bumpMeshes();
  },
  delete(id: string) {
    data.delete(id);
    app().bumpMeshes();
  },
  clear() {
    data.clear();
    app().bumpMeshes();
  },
  entries: () => data.entries(),
  snapshot: () => new Map(data),
};
