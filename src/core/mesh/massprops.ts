import type { Matrix4 } from "three";
import type { Geometry, Inertia, Vec3 } from "../model";
import { shiftInertia } from "../math";

export interface MassProps {
  /** Volume (m^3 for metre input). Mass at unit density. */
  volume: number;
  com: Vec3;
  /** Inertia about the COM at unit density. */
  inertia: Inertia;
  watertight: boolean;
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

function transformer(m?: Matrix4) {
  if (!m) return null;
  const e = m.elements;
  return (x: number, y: number, z: number): Vec3 => [
    e[0] * x + e[4] * y + e[8] * z + e[12],
    e[1] * x + e[5] * y + e[9] * z + e[13],
    e[2] * x + e[6] * y + e[10] * z + e[14],
  ];
}

export function bounds(positions: Float32Array, m?: Matrix4): Bounds {
  const tf = transformer(m);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    const p: Vec3 = tf
      ? tf(positions[i], positions[i + 1], positions[i + 2])
      : [positions[i], positions[i + 1], positions[i + 2]];
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
  }
  if (min[0] === Infinity) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

/**
 * Exact volume, centre of mass and inertia of the solid bounded by a closed triangle soup,
 * at unit density, by the divergence theorem. Orientation-independent: an inside-out mesh
 * gives the same answer as an outward-wound one.
 */
export function massProperties(positions: Float32Array, m?: Matrix4): MassProps | null {
  const tf = transformer(m);
  let vol = 0;
  let cx = 0,
    cy = 0,
    cz = 0;
  let ix = 0,
    iy = 0,
    iz = 0,
    pyz = 0,
    pxz = 0,
    pxy = 0;
  const P = positions;
  for (let t = 0; t + 8 < P.length; t += 9) {
    let a: Vec3 = [P[t], P[t + 1], P[t + 2]];
    let b: Vec3 = [P[t + 3], P[t + 4], P[t + 5]];
    let c: Vec3 = [P[t + 6], P[t + 7], P[t + 8]];
    if (tf) {
      a = tf(...a);
      b = tf(...b);
      c = tf(...c);
    }
    const [ax, ay, az] = a;
    const [bx, by, bz] = b;
    const [qx, qy, qz] = c;
    const d = ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
    const v = d / 6;
    vol += v;
    cx += (v * (ax + bx + qx)) / 4;
    cy += (v * (ay + by + qy)) / 4;
    cz += (v * (az + bz + qz)) / 4;
    ix += d * (ax * ax + bx * bx + qx * qx + ax * bx + bx * qx + qx * ax);
    iy += d * (ay * ay + by * by + qy * qy + ay * by + by * qy + qy * ay);
    iz += d * (az * az + bz * bz + qz * qz + az * bz + bz * qz + qz * az);
    pyz +=
      d *
      (2 * (ay * az + by * bz + qy * qz) +
        ay * bz +
        az * by +
        by * qz +
        bz * qy +
        ay * qz +
        az * qy);
    pxz +=
      d *
      (2 * (ax * az + bx * bz + qx * qz) +
        ax * bz +
        az * bx +
        bx * qz +
        bz * qx +
        ax * qz +
        az * qx);
    pxy +=
      d *
      (2 * (ax * ay + bx * by + qx * qy) +
        ax * by +
        ay * bx +
        bx * qy +
        by * qx +
        ax * qy +
        ay * qx);
  }
  if (Math.abs(vol) < 1e-18) return null;
  const com: Vec3 = [cx / vol, cy / vol, cz / vol];
  const s = vol > 0 ? 1 : -1;
  ix = (ix / 60) * s;
  iy = (iy / 60) * s;
  iz = (iz / 60) * s;
  pyz = (pyz / 120) * s;
  pxz = (pxz / 120) * s;
  pxy = (pxy / 120) * s;
  const V = Math.abs(vol);
  const [gx, gy, gz] = com;
  // Inertia about the origin, then shifted to the COM.
  const inertia: Inertia = {
    ixx: iy + iz - V * (gy * gy + gz * gz),
    iyy: ix + iz - V * (gx * gx + gz * gz),
    izz: ix + iy - V * (gx * gx + gy * gy),
    ixy: -pxy + V * gx * gy,
    iyz: -pyz + V * gy * gz,
    ixz: -pxz + V * gx * gz,
  };
  return { volume: V, com, inertia, watertight: isWatertight(positions) };
}

/** Every edge is shared by exactly two triangles, once in each direction. */
export function isWatertight(positions: Float32Array, eps = 1e-6): boolean {
  if (positions.length < 9) return false;
  const q = 1 / eps;
  const key = (i: number) =>
    `${Math.round(positions[i] * q)},${Math.round(positions[i + 1] * q)},${Math.round(positions[i + 2] * q)}`;
  const edges = new Map<string, number>();
  for (let t = 0; t + 8 < positions.length; t += 9) {
    const k = [key(t), key(t + 3), key(t + 6)];
    if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue; // degenerate
    for (const [a, b] of [
      [k[0], k[1]],
      [k[1], k[2]],
      [k[2], k[0]],
    ]) {
      const e = `${a}|${b}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  if (!edges.size) return false;
  for (const [e, c] of edges) {
    const [a, b] = e.split("|");
    if (c !== 1 || edges.get(`${b}|${a}`) !== 1) return false;
  }
  return true;
}

/** Unit-density mass properties of a primitive centred on its own origin. */
export function primitiveMassProps(g: Exclude<Geometry, { type: "mesh" }>): MassProps {
  const zero = { ixy: 0, iyz: 0, ixz: 0 };
  if (g.type === "box") {
    const [x, y, z] = g.size;
    const v = x * y * z;
    return {
      volume: v,
      com: [0, 0, 0],
      inertia: {
        ixx: (v * (y * y + z * z)) / 12,
        iyy: (v * (x * x + z * z)) / 12,
        izz: (v * (x * x + y * y)) / 12,
        ...zero,
      },
      watertight: true,
    };
  }
  if (g.type === "sphere") {
    const v = (4 / 3) * Math.PI * g.radius ** 3;
    const i = 0.4 * v * g.radius ** 2;
    return {
      volume: v,
      com: [0, 0, 0],
      inertia: { ixx: i, iyy: i, izz: i, ...zero },
      watertight: true,
    };
  }
  const r = g.radius;
  const h = g.length;
  const v = Math.PI * r * r * h;
  const side = (v * (3 * r * r + h * h)) / 12;
  return {
    volume: v,
    com: [0, 0, 0],
    inertia: { ixx: side, iyy: side, izz: (v * r * r) / 2, ...zero },
    watertight: true,
  };
}

/** Combine parts (each with COM-relative inertia) into one body about the combined COM. */
export function combine(parts: MassProps[]): MassProps | null {
  const vol = parts.reduce((a, p) => a + p.volume, 0);
  if (!parts.length || vol <= 0) return null;
  const com = [0, 1, 2].map(
    (i) => parts.reduce((a, p) => a + p.volume * p.com[i], 0) / vol,
  ) as Vec3;
  const I: Inertia = { ixx: 0, iyy: 0, izz: 0, ixy: 0, iyz: 0, ixz: 0 };
  for (const p of parts) {
    const s = shiftInertia(p.inertia, p.volume, [
      p.com[0] - com[0],
      p.com[1] - com[1],
      p.com[2] - com[2],
    ]);
    for (const k of Object.keys(I) as (keyof Inertia)[]) I[k] += s[k];
  }
  return { volume: vol, com, inertia: I, watertight: parts.every((p) => p.watertight) };
}
