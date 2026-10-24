/**
 * Mesh file loaders for URDF/SDF meshes: STL, OBJ and Collada (DAE).
 * Output is a triangle soup in metres in the file's own frame, Z-up, plus a dominant colour.
 * DAE parsing needs DOMParser (available in the webview; tests use happy-dom).
 */
import * as THREE from "three";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import type { Rgba } from "../model";
import { parseStl } from "./stl";

export interface LoadedMesh {
  positions: Float32Array;
  color: Rgba | null;
}

export const MESH_EXTENSIONS = ["stl", "dae", "obj"] as const;

export function meshExtension(name: string): (typeof MESH_EXTENSIONS)[number] | null {
  const ext = name.toLowerCase().split(/[?#]/)[0].split(".").pop() ?? "";
  return (MESH_EXTENSIONS as readonly string[]).includes(ext)
    ? (ext as (typeof MESH_EXTENSIONS)[number])
    : null;
}

export function loadMesh(name: string, bytes: Uint8Array): LoadedMesh {
  const ext = meshExtension(name);
  if (ext === "stl") return { positions: parseStl(bytes).positions, color: null };
  const text = new TextDecoder().decode(bytes);
  if (ext === "obj") return fromObject(new OBJLoader().parse(text));
  if (ext === "dae") {
    const manager = new THREE.LoadingManager();
    // Textures are not used; stop the loader from requesting them.
    manager.setURLModifier(() => "data:,");
    const dae = new ColladaLoader(manager).parse(text, "");
    if (!dae?.scene) throw new Error(`${name}: not a readable Collada file`);
    // ColladaLoader converts Z-up files to three's Y-up. ROS and Gazebo are Z-up, so rotate back:
    // Z_UP files end up unrotated and Y_UP files are turned to stand on Z.
    const root = new THREE.Group();
    root.rotation.x = Math.PI / 2;
    root.add(dae.scene);
    return fromObject(root);
  }
  throw new Error(`${name}: unsupported mesh format`);
}

/** Flatten every mesh under `obj` into one soup, keeping the colour of the largest part. */
function fromObject(obj: THREE.Object3D): LoadedMesh {
  obj.updateMatrixWorld(true);
  const chunks: Float32Array[] = [];
  const colourWeight = new Map<string, { c: Rgba; n: number }>();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry?.attributes.position) return;
    const soup = soupOf(m.geometry, m.matrixWorld);
    if (!soup.length) return;
    chunks.push(soup);
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as
      THREE.MeshStandardMaterial | undefined;
    const col = mat?.color;
    if (col) {
      const c: Rgba = [col.r, col.g, col.b, mat?.opacity ?? 1];
      const k = c.map((v) => v.toFixed(3)).join(",");
      const e = colourWeight.get(k) ?? { c, n: 0 };
      e.n += soup.length;
      colourWeight.set(k, e);
    }
  });
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const positions = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    positions.set(c, o);
    o += c.length;
  }
  const best = [...colourWeight.values()].sort((a, b) => b.n - a.n)[0];
  return { positions, color: best ? best.c : null };
}

function soupOf(g: THREE.BufferGeometry, m: THREE.Matrix4): Float32Array {
  const pos = g.attributes.position;
  const idx = g.index;
  const n = idx ? idx.count : pos.count;
  const out = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const k = idx ? idx.getX(i) : i;
    v.fromBufferAttribute(pos, k).applyMatrix4(m);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  // Drop a trailing partial triangle, if any.
  return out.length % 9 ? out.slice(0, out.length - (out.length % 9)) : out;
}
