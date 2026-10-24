/** Mesh operations used when breaking imports down and making collision geometry. */
import type { Matrix4 } from "three";
import type { Geometry, Vec3 } from "../model";
import { bounds } from "./massprops";

/**
 * Split a triangle soup into connected components (triangles that share a vertex).
 * Components are returned largest first. Tiny fragments below `minTriangles` are merged into
 * the largest component instead of becoming parts of their own.
 */
export function splitComponents(positions: Float32Array, minTriangles = 4): Float32Array[] {
  const n = Math.floor(positions.length / 9);
  if (n === 0) return [];
  const q = 1e6;
  const vid = new Map<string, number>();
  const triVerts = new Int32Array(n * 3);
  for (let i = 0; i < n * 3; i++) {
    const o = i * 3;
    const k = `${Math.round(positions[o] * q)},${Math.round(positions[o + 1] * q)},${Math.round(positions[o + 2] * q)}`;
    let id = vid.get(k);
    if (id === undefined) {
      id = vid.size;
      vid.set(k, id);
    }
    triVerts[i] = id;
  }
  const parent = new Int32Array(vid.size).map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let t = 0; t < n; t++) {
    union(triVerts[t * 3], triVerts[t * 3 + 1]);
    union(triVerts[t * 3], triVerts[t * 3 + 2]);
  }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < n; t++) {
    const r = find(triVerts[t * 3]);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(t);
  }
  const sorted = [...groups.values()].sort((a, b) => b.length - a.length);
  const big = sorted.filter((g) => g.length >= minTriangles);
  const small = sorted.filter((g) => g.length < minTriangles).flat();
  if (!big.length) return [positions.slice()];
  big[0] = big[0].concat(small);
  return big.map((tris) => {
    const out = new Float32Array(tris.length * 9);
    tris.forEach((t, i) => out.set(positions.subarray(t * 9, t * 9 + 9), i * 9));
    return out;
  });
}

/** Vertex-clustering decimation. Fast and robust; good enough for collision meshes. */
export function decimate(positions: Float32Array, targetRatio = 0.25): Float32Array {
  const tris = Math.floor(positions.length / 9);
  if (tris < 32 || targetRatio >= 1) return positions.slice();
  const { min, max } = bounds(positions);
  const size = [0, 1, 2].map((k) => Math.max(max[k] - min[k], 1e-9));
  const grid = Math.max(4, Math.round(Math.cbrt(tris * targetRatio) * 3));
  const cellOf = (i: number) =>
    [0, 1, 2]
      .map((k) => Math.min(grid - 1, Math.floor(((positions[i + k] - min[k]) / size[k]) * grid)))
      .join(",");
  const acc = new Map<string, [number, number, number, number]>();
  for (let i = 0; i < positions.length; i += 3) {
    const c = cellOf(i);
    const a = acc.get(c) ?? [0, 0, 0, 0];
    a[0] += positions[i];
    a[1] += positions[i + 1];
    a[2] += positions[i + 2];
    a[3] += 1;
    acc.set(c, a);
  }
  const out: number[] = [];
  const seen = new Set<string>();
  for (let t = 0; t < positions.length; t += 9) {
    const cs = [cellOf(t), cellOf(t + 3), cellOf(t + 6)];
    if (cs[0] === cs[1] || cs[1] === cs[2] || cs[0] === cs[2]) continue;
    const key = [...cs].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    for (const c of cs) {
      const a = acc.get(c)!;
      out.push(a[0] / a[3], a[1] / a[3], a[2] / a[3]);
    }
  }
  return out.length ? new Float32Array(out) : positions.slice();
}

export function transformPositions(positions: Float32Array, m: Matrix4): Float32Array {
  const e = m.elements;
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i],
      y = positions[i + 1],
      z = positions[i + 2];
    out[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  return out;
}

/** Fit a collision primitive around a mesh given in link coordinates. */
export function fitPrimitive(
  positions: Float32Array,
  kind: "box" | "cylinder" | "sphere",
): { geometry: Exclude<Geometry, { type: "mesh" }>; centre: Vec3 } {
  const { min, max } = bounds(positions);
  const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const centre: Vec3 = [(max[0] + min[0]) / 2, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2];
  if (kind === "box") return { geometry: { type: "box", size }, centre };
  if (kind === "sphere") {
    let r = 0;
    for (let i = 0; i < positions.length; i += 3)
      r = Math.max(
        r,
        Math.hypot(
          positions[i] - centre[0],
          positions[i + 1] - centre[1],
          positions[i + 2] - centre[2],
        ),
      );
    return { geometry: { type: "sphere", radius: r }, centre };
  }
  return {
    geometry: { type: "cylinder", radius: Math.max(size[0], size[1]) / 2, length: size[2] },
    centre,
  };
}

export const UNIT_SCALE = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254 } as const;
export type LengthUnit = keyof typeof UNIT_SCALE;

/** Guess the unit a CAD part was modelled in from its largest extent. */
export function guessUnit(maxExtent: number): LengthUnit {
  if (maxExtent > 20) return "mm";
  if (maxExtent > 3) return "cm";
  return "m";
}

export function scalePositions(positions: Float32Array, s: number): Float32Array {
  if (s === 1) return positions;
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i++) out[i] = positions[i] * s;
  return out;
}

/** Triangle soups for primitives, used for display and physics colliders. */
export function boxPositions(sx: number, sy: number, sz: number): Float32Array {
  const [hx, hy, hz] = [sx / 2, sy / 2, sz / 2];
  const v: Vec3[] = [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, hy, -hz],
    [-hx, hy, -hz],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [hx, hy, hz],
    [-hx, hy, hz],
  ];
  const quads = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ];
  const out: number[] = [];
  for (const [a, b, c, d] of quads) for (const i of [a, b, c, a, c, d]) out.push(...v[i]);
  return new Float32Array(out);
}
