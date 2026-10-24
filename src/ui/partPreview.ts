/** Flat-shaded isometric drawing of a triangle soup on a 2D canvas (cheap thumbnails). */
import * as THREE from "three";
import { poseToMatrix } from "@/core/math";
import type { PartGeometry, PartLink } from "@/core/parts/types";
import type { Rgba } from "@/core/model";

export interface ColoredSoup {
  positions: Float32Array;
  color: Rgba;
}

function primitiveSoup(g: PartGeometry): Float32Array {
  if (g.type === "mesh") return g.positions;
  let geo: THREE.BufferGeometry;
  if (g.type === "box") geo = new THREE.BoxGeometry(...g.size);
  else if (g.type === "sphere") geo = new THREE.SphereGeometry(g.radius, 20, 12);
  else geo = new THREE.CylinderGeometry(g.radius, g.radius, g.length, 24).rotateX(Math.PI / 2);
  const ng = geo.toNonIndexed();
  const out = new Float32Array(ng.attributes.position.array);
  geo.dispose();
  ng.dispose();
  return out;
}

/** Every visual of a built part in the part root's frame (zero joint positions). */
export function partSoups(links: PartLink[]): ColoredSoup[] {
  const world = new Map<string, THREE.Matrix4>();
  const out: ColoredSoup[] = [];
  const pending = [...links];
  for (let guard = 0; pending.length && guard < links.length * 2 + 2; guard++) {
    const l = pending.shift()!;
    const parent = l.parent ? world.get(l.parent) : new THREE.Matrix4();
    if (!parent) {
      pending.push(l);
      continue;
    }
    const w = parent.clone().multiply(poseToMatrix(l.origin));
    world.set(l.key, w);
    for (const v of l.visuals) {
      const m = w.clone().multiply(poseToMatrix(v.origin));
      const src = primitiveSoup(v.geometry);
      const e = m.elements;
      const p = new Float32Array(src.length);
      for (let i = 0; i < src.length; i += 3) {
        const x = src[i],
          y = src[i + 1],
          z = src[i + 2];
        p[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
        p[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        p[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
      out.push({ positions: p, color: v.color });
    }
  }
  return out;
}

export function drawSoups(
  cv: HTMLCanvasElement,
  soups: ColoredSoup[],
  width: number,
  height: number,
) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = width * dpr;
  cv.height = height * dpr;
  const ctx = cv.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const ca = Math.cos(-0.75),
    sa = Math.sin(-0.75),
    ce = Math.cos(0.55),
    se = Math.sin(0.55);
  const proj = (x: number, y: number, z: number): [number, number, number] => {
    const x1 = x * ca - y * sa;
    const y1 = x * sa + y * ca;
    return [x1, z * ce - y1 * se, y1 * ce + z * se];
  };
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  const total = soups.reduce((a, s) => a + s.positions.length / 9, 0);
  const step = Math.max(1, Math.floor(total / 9000));
  const tris: { p: [number, number, number][]; d: number; l: number; c: Rgba }[] = [];
  for (const s of soups) {
    const pos = s.positions;
    for (let t = 0; t + 8 < pos.length; t += 9 * step) {
      const p = [
        proj(pos[t], pos[t + 1], pos[t + 2]),
        proj(pos[t + 3], pos[t + 4], pos[t + 5]),
        proj(pos[t + 6], pos[t + 7], pos[t + 8]),
      ];
      const ux = p[1][0] - p[0][0],
        uy = p[1][1] - p[0][1],
        uz = p[1][2] - p[0][2];
      const vx = p[2][0] - p[0][0],
        vy = p[2][1] - p[0][1],
        vz = p[2][2] - p[0][2];
      const nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      for (const q of p) {
        minX = Math.min(minX, q[0]);
        maxX = Math.max(maxX, q[0]);
        minY = Math.min(minY, q[1]);
        maxY = Math.max(maxY, q[1]);
      }
      tris.push({
        p,
        d: (p[0][2] + p[1][2] + p[2][2]) / 3,
        l: Math.abs((nx * 0.3 + ny * 0.65 + nz * 0.7) / len),
        c: s.color,
      });
    }
  }
  if (!tris.length) return;
  tris.sort((a, b) => b.d - a.d);
  const sc = Math.min((width - 10) / (maxX - minX || 1), (height - 10) / (maxY - minY || 1));
  const ox = width / 2 - ((minX + maxX) / 2) * sc;
  const oy = height / 2 + ((minY + maxY) / 2) * sc;
  for (const t of tris) {
    const k = 0.35 + 0.65 * t.l;
    ctx.fillStyle = `rgb(${t.c[0] * 255 * k},${t.c[1] * 255 * k},${t.c[2] * 255 * k})`;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(ox + t.p[0][0] * sc, oy - t.p[0][1] * sc);
    ctx.lineTo(ox + t.p[1][0] * sc, oy - t.p[1][1] * sc);
    ctx.lineTo(ox + t.p[2][0] * sc, oy - t.p[2][1] * sc);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
