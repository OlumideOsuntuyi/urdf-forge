/**
 * Wheeled drive: differential / skid steer, mecanum and omni bases, with optional steerable
 * wheels. Wheels are found from geometry (horizontal axle, touching the ground) so imported
 * robots whose drives are all "none" work too.
 *
 * Also hosts the small geometry helpers the other behaviours share.
 */
import { Matrix4, Quaternion, Vector3 } from "three";
import {
  childrenOf,
  jointName,
  linkById,
  meshById,
  rootLinks,
  type Geometry,
  type Link,
  type Pose,
  type RobotModel,
  type Vec3,
} from "@/core/model";
import { clampJoint, linkWorldMatrices } from "@/core/kinematics";
import { normalize, poseToMatrix } from "@/core/math";
import type { Behavior, BehaviorFactory, JointCommands } from "./types";

// ------------------------------------------------------------------ shared helpers

export const isRotary = (l: Link) => l.joint.type === "revolute" || l.joint.type === "continuous";
export const isArticulated = (l: Link) =>
  l.joint.type === "revolute" || l.joint.type === "continuous" || l.joint.type === "prismatic";

/** True when the link hangs from an existing parent (so its joint means something). */
export const hasParent = (model: RobotModel, l: Link) => !!linkById(model, l.parentId);

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Link frames expressed in the robot frame (the first root link's frame: +X forward, +Z up). */
export function robotFrames(
  model: RobotModel,
  values: Record<string, number> = {},
): Map<string, Matrix4> {
  const W = linkWorldMatrices(model, values);
  const root = rootLinks(model)[0];
  const inv = root && W.has(root.id) ? W.get(root.id)!.clone().invert() : new Matrix4();
  for (const [id, m] of W) W.set(id, m.clone().premultiply(inv));
  return W;
}

/** The joint axis of `link` in the robot frame (unit vector). */
export function jointAxisIn(frames: Map<string, Matrix4>, link: Link): Vector3 {
  const m = frames.get(link.id) ?? new Matrix4();
  return new Vector3(...normalize(link.joint.axis)).transformDirection(m);
}

export function originOf(frames: Map<string, Matrix4>, id: string): Vector3 {
  return new Vector3().setFromMatrixPosition(frames.get(id) ?? new Matrix4());
}

const SPHERE_DIRS: Vector3[] = (() => {
  const out: Vector3[] = [];
  for (const x of [-1, 0, 1])
    for (const y of [-1, 0, 1])
      for (const z of [-1, 0, 1]) if (x || y || z) out.push(new Vector3(x, y, z).normalize());
  return out;
})();

/** Sample points (geometry frame) that bound a primitive or a mesh's bounding box. */
function shapePoints(model: RobotModel, g: Geometry): Vector3[] {
  const pts: Vector3[] = [];
  const box = (min: Vec3, max: Vec3) => {
    for (const x of [min[0], max[0]])
      for (const y of [min[1], max[1]])
        for (const z of [min[2], max[2]]) pts.push(new Vector3(x, y, z));
  };
  if (g.type === "box")
    box(
      [-g.size[0] / 2, -g.size[1] / 2, -g.size[2] / 2],
      [g.size[0] / 2, g.size[1] / 2, g.size[2] / 2],
    );
  else if (g.type === "sphere")
    for (const d of SPHERE_DIRS) pts.push(d.clone().multiplyScalar(g.radius));
  else if (g.type === "cylinder") {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      for (const z of [-g.length / 2, g.length / 2])
        pts.push(new Vector3(g.radius * Math.cos(a), g.radius * Math.sin(a), z));
    }
  } else {
    const asset = meshById(model, g.meshId);
    if (asset) box(asset.bbox.min, asset.bbox.max);
  }
  return pts;
}

interface Placed {
  origin: Pose;
  geometry: Geometry;
}

const geomMatrix = (s: Placed) =>
  poseToMatrix(s.origin, s.geometry.type === "mesh" ? s.geometry.scale : undefined);

/** Shapes used for geometric reasoning: collisions when present, else visuals. */
export function linkShapes(link: Link): Placed[] {
  return link.collisions.length ? link.collisions : link.visuals;
}

/** Bounding sample points of a link's geometry, in the link frame. */
export function linkPoints(model: RobotModel, link: Link): Vector3[] {
  const out: Vector3[] = [];
  for (const s of linkShapes(link)) {
    const m = geomMatrix(s);
    for (const p of shapePoints(model, s.geometry)) out.push(p.applyMatrix4(m));
  }
  return out;
}

/** Lowest point of each link (robot frame) and of the whole robot. */
export function lowestPoints(
  model: RobotModel,
  frames: Map<string, Matrix4>,
): { minZ: number; maxZ: number; perLink: Map<string, { z: number; local: Vector3 }> } {
  let minZ = Infinity;
  let maxZ = -Infinity;
  const perLink = new Map<string, { z: number; local: Vector3 }>();
  for (const L of model.links) {
    const m = frames.get(L.id);
    if (!m) continue;
    let best: { z: number; local: Vector3 } | null = null;
    for (const p of linkPoints(model, L)) {
      const w = p.clone().applyMatrix4(m);
      if (!best || w.z < best.z) best = { z: w.z, local: p };
      minZ = Math.min(minZ, w.z);
      maxZ = Math.max(maxZ, w.z);
    }
    if (!best) {
      // No geometry: use the link origin.
      const z = originOf(frames, L.id).z;
      best = { z, local: new Vector3() };
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    perLink.set(L.id, best);
  }
  return { minZ, maxZ, perLink };
}

export function descendants(model: RobotModel, id: string): Link[] {
  const out: Link[] = [];
  const seen = new Set<string>([id]);
  const walk = (pid: string) => {
    for (const c of childrenOf(model, pid)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

/** Small deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ------------------------------------------------------------------ wheels

export interface WheelInfo {
  linkId: string;
  name: string;
  /** Wheel centre in the robot frame. */
  position: Vec3;
  /** Spin axis in the robot frame. */
  axis: Vec3;
  /** Horizontal direction the centre moves for a positive spin (axis x up). */
  rollDir: Vec3;
  radius: number;
  side: "left" | "right" | "center";
  kind: "standard" | "mecanum" | "omni";
  /** Revolute joint about vertical that steers this wheel, if any. */
  steerLinkId: string | null;
  /** Steering joint value per radian of yaw (left) about robot +Z: +1 or -1. */
  steerSign: number;
  /** Joint velocity limit in rad/s (Infinity when not set). */
  maxRate: number;
}

const CASTER = /caster|castor/i;

/** Radius about the axle (axis in the link frame) from the link's shapes. */
export function wheelRadius(model: RobotModel, link: Link, axleLocal: Vector3): number | null {
  const axle = axleLocal.clone().normalize();
  const u = new Vector3(1, 0, 0);
  if (Math.abs(u.dot(axle)) > 0.9) u.set(0, 1, 0);
  u.sub(axle.clone().multiplyScalar(u.dot(axle))).normalize();
  const v = new Vector3().crossVectors(axle, u);
  const perp = (p: Vector3) =>
    p
      .clone()
      .sub(axle.clone().multiplyScalar(p.dot(axle)))
      .length();
  for (const shapes of [link.collisions, link.visuals]) {
    let r = 0;
    for (const s of shapes) {
      const g = s.geometry;
      const m = geomMatrix(s);
      const centre = new Vector3().setFromMatrixPosition(m);
      if (g.type === "sphere") {
        r = Math.max(r, g.radius + perp(centre));
        continue;
      }
      if (g.type === "cylinder") {
        const q = new Quaternion();
        m.decompose(new Vector3(), q, new Vector3());
        const cylAxis = new Vector3(0, 0, 1).applyQuaternion(q);
        if (Math.abs(cylAxis.dot(axle)) > 0.9) {
          r = Math.max(r, g.radius + perp(centre));
          continue;
        }
      }
      for (const p0 of shapePoints(model, g)) {
        const p = p0.applyMatrix4(m);
        r = Math.max(r, Math.abs(p.dot(u)), Math.abs(p.dot(v)));
      }
    }
    if (r > 1e-4) return r;
  }
  return null;
}

function wheelKind(model: RobotModel, link: Link): WheelInfo["kind"] {
  const names = [link.name, jointName(link)];
  for (const v of link.visuals)
    if (v.geometry.type === "mesh") {
      const a = meshById(model, v.geometry.meshId);
      if (a) names.push(a.name, a.origin, a.file);
    }
  const s = names.join(" ");
  if (/mecanum/i.test(s)) return "mecanum";
  if (/omni|holonomic/i.test(s)) return "omni";
  return "standard";
}

/** Drive wheels of the robot (casters and non-touching rotors excluded). */
export function findWheels(model: RobotModel): WheelInfo[] {
  const frames = robotFrames(model);
  const { minZ } = lowestPoints(model, frames);
  const up = new Vector3(0, 0, 1);
  const out: WheelInfo[] = [];
  for (const L of model.links) {
    if (!hasParent(model, L)) continue;
    const isWheel =
      L.joint.type === "continuous" || (L.drive.mode === "wheel" && L.joint.type === "revolute");
    if (!isWheel || L.joint.mimic) continue;
    if (CASTER.test(L.name) || CASTER.test(jointName(L))) continue;
    const axis = jointAxisIn(frames, L);
    if (Math.abs(axis.z) > 0.35) continue; // not roughly horizontal
    // Nothing articulated may hang below a wheel (rules out arm joints that happen to be continuous).
    if (descendants(model, L.id).some(isArticulated)) continue;

    // Casters swivel freely about vertical; steering joints are limited revolutes.
    const parent = linkById(model, L.parentId)!;
    let steerLinkId: string | null = null;
    let steerSign = 1;
    if (hasParent(model, parent) && isRotary(parent)) {
      const pa = jointAxisIn(frames, parent);
      if (Math.abs(pa.z) > 0.8) {
        if (parent.joint.type === "continuous" || CASTER.test(parent.name)) continue;
        steerLinkId = parent.id;
        steerSign = pa.z > 0 ? 1 : -1;
      }
    }

    const axleLocal = new Vector3(...normalize(L.joint.axis));
    const r = wheelRadius(model, L, axleLocal);
    const pos = originOf(frames, L.id);
    if (r === null) {
      if (!/wheel/i.test(L.name + jointName(L))) continue;
    } else if (Number.isFinite(minZ) && pos.z - r > minZ + Math.max(0.02, 0.35 * r)) continue;

    const roll = new Vector3().crossVectors(axis, up);
    roll.z = 0;
    if (roll.lengthSq() < 1e-8) continue;
    roll.normalize();
    out.push({
      linkId: L.id,
      name: L.name,
      position: pos.toArray() as Vec3,
      axis: axis.toArray() as Vec3,
      rollDir: roll.toArray() as Vec3,
      radius: r ?? 0.05,
      side: pos.y > 1e-3 ? "left" : pos.y < -1e-3 ? "right" : "center",
      kind: wheelKind(model, L),
      steerLinkId,
      steerSign,
      maxRate: L.joint.velocity > 0 ? L.joint.velocity : Infinity,
    });
  }
  return out;
}

// ------------------------------------------------------------------ behaviour

const MAX_SPEED = 0.6;
const MAX_TURN = 1.5;
const LIN_ACCEL = 1.2;
const ANG_ACCEL = 4;
const STEER_RATE = 1.5;
const MAX_STEER = 0.6;

const step = (cur: number, target: number, rate: number) => cur + clamp(target - cur, -rate, rate);

function makeDrive(model: RobotModel, wheels: WheelInfo[], holonomic: boolean): Behavior {
  const cx = wheels.reduce((s, w) => s + w.position[0], 0) / wheels.length;
  const cy = wheels.reduce((s, w) => s + w.position[1], 0) / wheels.length;
  const vmax = Math.min(MAX_SPEED, ...wheels.map((w) => 0.9 * w.maxRate * w.radius));
  const steerLinks = new Map<string, { link: Link; sign: number; dx: number }>();
  for (const w of wheels)
    if (w.steerLinkId && !steerLinks.has(w.steerLinkId))
      steerLinks.set(w.steerLinkId, {
        link: linkById(model, w.steerLinkId)!,
        sign: w.steerSign,
        dx: w.position[0] - cx,
      });

  let v = 0;
  let vy = 0;
  let wz = 0;
  const steer = new Map<string, number>();
  let last = -Infinity;

  return {
    id: "drive",
    name: "Wheeled drive",
    description: holonomic
      ? `Holonomic base with ${wheels.length} wheels: drive, turn and strafe.`
      : `${wheels.length}-wheel ${steerLinks.size ? "steered" : "differential/skid-steer"} base.`,
    teleop: true,
    velocityJoints: wheels.map((w) => w.linkId),
    tick(ctx): JointCommands {
      if (ctx.time < last - 1e-9) {
        v = vy = wz = 0;
        steer.clear();
      }
      last = ctx.time;
      const dt = clamp(ctx.dt || 0, 0, 0.1);
      const inp = ctx.input;
      v = step(v, clamp(inp.forward, -1, 1) * vmax, LIN_ACCEL * dt);
      vy = step(vy, holonomic ? clamp(inp.strafe, -1, 1) * vmax : 0, LIN_ACCEL * dt);
      wz = step(wz, clamp(inp.turn, -1, 1) * MAX_TURN, ANG_ACCEL * dt);

      const out: JointCommands = {};
      // Steering: Ackermann-ish, each steered wheel points along its instantaneous velocity.
      for (const [id, s] of steerLinks) {
        const sv = v < 0 ? -1 : 1;
        const delta = Math.atan((wz * s.dx) / (sv * Math.max(Math.abs(v), 0.05)));
        const q = clampJoint(s.link, clamp(delta, -MAX_STEER, MAX_STEER) * s.sign);
        const cur = step(steer.get(id) ?? 0, q, STEER_RATE * dt);
        steer.set(id, cur);
        out[id] = cur;
      }

      const rates: number[] = [];
      let scale = 1;
      for (const w of wheels) {
        const px = w.position[0] - cx;
        const py = w.position[1] - cy;
        const vcx = v - wz * py;
        const vcy = vy + wz * px;
        let dx = w.rollDir[0];
        let dy = w.rollDir[1];
        if (w.steerLinkId) {
          const yaw = (steer.get(w.steerLinkId) ?? 0) * w.steerSign;
          const c = Math.cos(yaw);
          const s = Math.sin(yaw);
          [dx, dy] = [c * dx - s * dy, s * dx + c * dy];
        }
        let lin: number;
        if (w.kind === "mecanum") {
          // X-configuration rollers: wheel speed = forward + sigma * lateral component.
          const sgn = dx >= 0 ? 1 : -1;
          const fx = sgn * dx;
          const fy = sgn * dy;
          const sigma = -Math.sign(px) * Math.sign(py);
          lin = sgn * (fx * vcx + fy * vcy + sigma * (-fy * vcx + fx * vcy));
        } else lin = dx * vcx + dy * vcy;
        const rate = lin / w.radius;
        rates.push(rate);
        if (Number.isFinite(w.maxRate)) scale = Math.max(scale, Math.abs(rate) / w.maxRate);
      }
      wheels.forEach((w, i) => (out[w.linkId] = rates[i] / scale));
      return out;
    },
  };
}

export const wheeledDrive: BehaviorFactory = {
  id: "drive",
  name: "Wheeled drive",
  description: "Drive the base with WASD / arrow keys (Q/E strafe on holonomic bases).",
  detect(model) {
    const wheels = findWheels(model);
    if (wheels.length < 2) return null;
    const holonomic =
      wheels.filter((w) => w.kind !== "standard").length >= 3 ||
      // Wheels rolling in clearly different directions (e.g. a three-wheel omni base).
      (wheels.length >= 3 && wheels.some((w) => Math.abs(w.rollDir[0]) < 0.9));
    const left = wheels.some((w) => w.side === "left");
    const right = wheels.some((w) => w.side === "right");
    if (!holonomic && !(left && right)) return null;
    return makeDrive(model, wheels, holonomic);
  },
};
