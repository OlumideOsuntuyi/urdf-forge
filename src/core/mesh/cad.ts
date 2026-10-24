/**
 * CAD (STEP / IGES / BREP) import via OpenCascade compiled to WebAssembly (occt-import-js).
 * This module only converts the importer's result; loading the WebAssembly happens in a worker.
 */
import type { Rgba } from "../model";

export type CadFormat = "step" | "iges" | "brep";

export interface OcctMesh {
  name: string;
  color?: [number, number, number];
  attributes: { position: { array: ArrayLike<number> } };
  index: { array: ArrayLike<number> };
}

export interface OcctNode {
  name: string;
  meshes: number[];
  children: OcctNode[];
}

export interface OcctResult {
  success: boolean;
  root: OcctNode;
  meshes: OcctMesh[];
}

export interface CadPart {
  name: string;
  /** Assembly path from the root, excluding the part itself. */
  path: string[];
  /** Triangle soup in metres. */
  positions: Float32Array;
  color: Rgba | null;
}

export function cadFormat(fileName: string): CadFormat | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "step" || ext === "stp") return "step";
  if (ext === "iges" || ext === "igs") return "iges";
  if (ext === "brep" || ext === "brp") return "brep";
  return null;
}

/** Triangulation settings. Finer deflection gives smoother, heavier meshes. */
export interface CadQuality {
  /** Fraction of the model's bounding box size. */
  linearDeflection: number;
  /** Radians. */
  angularDeflection: number;
}

export const CAD_QUALITY = {
  draft: { linearDeflection: 0.004, angularDeflection: 0.8 },
  normal: { linearDeflection: 0.001, angularDeflection: 0.5 },
  fine: { linearDeflection: 0.0003, angularDeflection: 0.25 },
} satisfies Record<string, CadQuality>;

export function occtParams(q: CadQuality) {
  return {
    linearUnit: "meter",
    linearDeflectionType: "bounding_box_ratio",
    linearDeflection: q.linearDeflection,
    angularDeflection: q.angularDeflection,
  };
}

/** Flatten the importer's assembly tree into parts, one per mesh, with unique readable names. */
export function partsFromOcct(result: OcctResult, fallbackName: string, unitScale = 1): CadPart[] {
  if (!result.success) throw new Error("OpenCascade could not read this file.");
  const parts: CadPart[] = [];
  const used = new Map<string, number>();
  const unique = (n: string) => {
    const c = (used.get(n) ?? 0) + 1;
    used.set(n, c);
    return c === 1 ? n : `${n}_${c}`;
  };
  const walk = (node: OcctNode, path: string[]) => {
    const here = node.name ? [...path, node.name] : path;
    for (const mi of node.meshes) {
      const m = result.meshes[mi];
      if (!m) continue;
      const pos = m.attributes.position.array;
      const idx = m.index.array;
      const out = new Float32Array(idx.length * 3);
      for (let i = 0; i < idx.length; i++) {
        const v = idx[i] * 3;
        out[i * 3] = pos[v] * unitScale;
        out[i * 3 + 1] = pos[v + 1] * unitScale;
        out[i * 3 + 2] = pos[v + 2] * unitScale;
      }
      if (!out.length) continue;
      const base = m.name || node.name || fallbackName;
      parts.push({
        name: unique(base),
        path,
        positions: out,
        color: m.color ? [m.color[0], m.color[1], m.color[2], 1] : null,
      });
    }
    node.children.forEach((c) => walk(c, here));
  };
  walk(result.root, []);
  return parts;
}
