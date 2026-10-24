import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { Inertia, Pose, Vec3 } from "./model";

/** URDF rpy is R = Rz(yaw) * Ry(pitch) * Rx(roll), i.e. three.js Euler order "ZYX". */
export function rpyToQuat(rpy: Vec3): Quaternion {
  return new Quaternion().setFromEuler(new Euler(rpy[0], rpy[1], rpy[2], "ZYX"));
}

export function quatToRpy(q: Quaternion): Vec3 {
  const e = new Euler().setFromQuaternion(q, "ZYX");
  return [e.x, e.y, e.z];
}

export function poseToMatrix(p: Pose, scale?: Vec3): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...p.xyz),
    rpyToQuat(p.rpy),
    scale ? new Vector3(...scale) : new Vector3(1, 1, 1),
  );
}

export function matrixToPose(m: Matrix4): Pose {
  const p = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  m.decompose(p, q, s);
  return { xyz: [p.x, p.y, p.z], rpy: quatToRpy(q) };
}

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 1];
}

/** Parallel-axis shift of an inertia tensor about the COM to a point offset by d. */
export function shiftInertia(I: Inertia, mass: number, d: Vec3): Inertia {
  const [x, y, z] = d;
  return {
    ixx: I.ixx + mass * (y * y + z * z),
    iyy: I.iyy + mass * (x * x + z * z),
    izz: I.izz + mass * (x * x + y * y),
    ixy: I.ixy - mass * x * y,
    iyz: I.iyz - mass * y * z,
    ixz: I.ixz - mass * x * z,
  };
}

/** R * I * R^T for a rotation given as a quaternion. */
export function rotateInertia(I: Inertia, q: Quaternion): Inertia {
  const e = new Matrix4().makeRotationFromQuaternion(q).elements;
  const R = [
    [e[0], e[4], e[8]],
    [e[1], e[5], e[9]],
    [e[2], e[6], e[10]],
  ];
  const T = [
    [I.ixx, I.ixy, I.ixz],
    [I.ixy, I.iyy, I.iyz],
    [I.ixz, I.iyz, I.izz],
  ];
  const RT = R.map((row) => [0, 1, 2].map((j) => row.reduce((s, v, k) => s + v * T[k][j], 0)));
  const out = RT.map((row) => [0, 1, 2].map((j) => row.reduce((s, v, k) => s + v * R[j][k], 0)));
  return {
    ixx: out[0][0],
    iyy: out[1][1],
    izz: out[2][2],
    ixy: out[0][1],
    iyz: out[1][2],
    ixz: out[0][2],
  };
}

export function scaleInertia(I: Inertia, k: number): Inertia {
  return {
    ixx: I.ixx * k,
    iyy: I.iyy * k,
    izz: I.izz * k,
    ixy: I.ixy * k,
    iyz: I.iyz * k,
    ixz: I.ixz * k,
  };
}

/** Principal moments and axes of a symmetric 3x3 tensor (Jacobi). Columns of `vectors` are axes. */
export function eigenSym3(a: Inertia): { values: Vec3; vectors: number[][] } {
  let m = [
    [a.ixx, a.ixy, a.ixz],
    [a.ixy, a.iyy, a.iyz],
    [a.ixz, a.iyz, a.izz],
  ];
  let v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 32; sweep++) {
    const off = m[0][1] ** 2 + m[0][2] ** 2 + m[1][2] ** 2;
    if (off < 1e-30) break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (Math.abs(m[p][q]) < 1e-30) continue;
      const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      const mm = m.map((r) => r.slice());
      for (let k = 0; k < 3; k++) {
        mm[p][k] = c * m[p][k] - s * m[q][k];
        mm[q][k] = s * m[p][k] + c * m[q][k];
      }
      const m2 = mm.map((r) => r.slice());
      for (let k = 0; k < 3; k++) {
        m2[k][p] = c * mm[k][p] - s * mm[k][q];
        m2[k][q] = s * mm[k][p] + c * mm[k][q];
      }
      m = m2;
      const vv = v.map((r) => r.slice());
      for (let k = 0; k < 3; k++) {
        vv[k][p] = c * v[k][p] - s * v[k][q];
        vv[k][q] = s * v[k][p] + c * v[k][q];
      }
      v = vv;
    }
  }
  return { values: [m[0][0], m[1][1], m[2][2]], vectors: v };
}

/** Format a number for XML: fixed precision, trailing zeros trimmed, no "-0". */
export function fmt(v: number, precision = 8): string {
  if (!Number.isFinite(v) || Math.abs(v) < 1e-12) return "0";
  const s = v.toFixed(precision).replace(/\.?0+$/, "");
  return s === "-0" || s === "" ? "0" : s;
}

export function fmt3(v: readonly number[], precision = 8): string {
  return [0, 1, 2].map((i) => fmt(v[i] ?? 0, precision)).join(" ");
}
