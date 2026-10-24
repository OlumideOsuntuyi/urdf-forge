/**
 * Legged gait: a trot for quadrupeds (diagonal pairs in phase), alternating steps for bipeds and a
 * tripod gait for hexapods. Legs and joint roles are found from geometry, so imported robots
 * (Unitree, ANYmal, Solo, humanoids) work without drive settings.
 */
import { Vector3 } from "three";
import { linkById, rootLinks, type Link, type RobotModel, type Vec3 } from "@/core/model";
import { clampJoint } from "@/core/kinematics";
import type { Behavior, BehaviorFactory, JointCommands } from "./types";
import {
  clamp,
  descendants,
  hasParent,
  isArticulated,
  jointAxisIn,
  lowestPoints,
  originOf,
  robotFrames,
} from "./drive";

export interface LegInfo {
  /** First articulated link under the trunk. */
  rootId: string;
  /** Every link of the leg's subtree (root included). */
  linkIds: string[];
  footLinkId: string;
  /** Lowest point of the foot, in the foot link's frame. */
  footLocal: Vec3;
  /** Revolute joints from the trunk to the foot, in order (link ids). */
  joints: string[];
  abduction: string | null;
  hip: string;
  knee: string;
  ankle: string | null;
  /** Hip pitch joint position in the robot frame at zero pose. */
  hipPos: Vec3;
  /** +1 left, -1 right (relative to the legs' centre). */
  side: number;
}

/** Legs of the robot: chains of revolute joints whose ends are the lowest points at zero pose. */
export function findLegs(model: RobotModel): LegInfo[] {
  const root = rootLinks(model)[0];
  if (!root) return [];
  const frames = robotFrames(model);
  const { minZ, maxZ, perLink } = lowestPoints(model, frames);
  if (!Number.isFinite(minZ)) return [];
  const tol = Math.max(0.03, 0.08 * (maxZ - minZ));

  // The trunk: the root plus everything welded to it.
  const trunk = new Set([root.id]);
  const queue = [root];
  while (queue.length) {
    const t = queue.pop()!;
    for (const c of model.links)
      if (c.parentId === t.id && c.joint.type === "fixed" && !trunk.has(c.id)) {
        trunk.add(c.id);
        queue.push(c);
      }
  }
  const legRoots = model.links.filter(
    (l) => l.parentId && trunk.has(l.parentId) && !trunk.has(l.id) && isArticulated(l),
  );

  const legs: LegInfo[] = [];
  for (const lr of legRoots) {
    const sub = [lr, ...descendants(model, lr.id)];
    let foot: Link | null = null;
    let fz = Infinity;
    for (const l of sub) {
      const p = perLink.get(l.id);
      if (p && p.z < fz) {
        fz = p.z;
        foot = l;
      }
    }
    if (!foot || fz > minZ + tol) continue;
    const path: Link[] = [];
    for (let cur: Link | undefined = foot; cur; cur = linkById(model, cur.parentId)) {
      path.unshift(cur);
      if (cur.id === lr.id) break;
    }
    const joints = path.filter((l) => l.joint.type === "revolute" && !l.joint.mimic);
    if (joints.length < 2 || joints.length > 7) continue;
    const footLocal = perLink.get(foot.id)!.local;
    const footPt = footLocal.clone().applyMatrix4(frames.get(foot.id)!);
    let len = 0;
    for (let i = 0; i < joints.length; i++)
      len += originOf(frames, joints[i].id).distanceTo(
        i + 1 < joints.length ? originOf(frames, joints[i + 1].id) : footPt,
      );
    const top = originOf(frames, joints[0].id);
    if (len < 0.03 || top.z - footPt.z < 0.4 * len) continue;

    let abduction: string | null = null;
    const pitch: Link[] = [];
    for (const j of joints) {
      const a = jointAxisIn(frames, j);
      if (Math.abs(a.y) > 0.7) pitch.push(j);
      else if (Math.abs(a.x) > 0.7 && !abduction && !pitch.length) abduction = j.id;
    }
    if (pitch.length < 2) continue;
    legs.push({
      rootId: lr.id,
      linkIds: sub.map((l) => l.id),
      footLinkId: foot.id,
      footLocal: footLocal.toArray() as Vec3,
      joints: joints.map((j) => j.id),
      abduction,
      hip: pitch[0].id,
      knee: pitch[1].id,
      ankle: pitch[2]?.id ?? null,
      hipPos: originOf(frames, pitch[0].id).toArray() as Vec3,
      side: 0,
    });
  }
  const cy = legs.reduce((s, l) => s + l.hipPos[1], 0) / Math.max(legs.length, 1);
  for (const l of legs) l.side = l.hipPos[1] >= cy ? 1 : -1;
  return legs;
}

interface LegGait {
  leg: LegInfo;
  /** Rest value of every joint in the leg. */
  base: Record<string, number>;
  hipStance: number;
  kneeStance: number;
  /** Foot forward travel (m) per radian of hip pitch at stance. */
  hipGain: number;
  /** Foot lateral travel (m) per radian of abduction. */
  abdGain: number;
  liftKnee: number;
  liftHip: number;
  /** Sign of each pitch joint's axis along robot +Y (for keeping the foot level). */
  sHip: number;
  sKnee: number;
  sAnkle: number;
  length: number;
  phase: number;
}

function planLeg(model: RobotModel, leg: LegInfo, biped: boolean): LegGait {
  const L = (id: string) => linkById(model, id)!;
  const frames0 = robotFrames(model);
  const base: Record<string, number> = {};
  for (const id of leg.joints) base[id] = clampJoint(L(id), 0);
  const local = new Vector3(...leg.footLocal);
  const foot = (vals: Record<string, number>) =>
    local.clone().applyMatrix4(robotFrames(model, { ...base, ...vals }).get(leg.footLinkId)!);
  const hip = L(leg.hip);
  const knee = L(leg.knee);
  const ankle = leg.ankle ? L(leg.ankle) : null;
  const sign = (l: Link) => (jointAxisIn(frames0, l).y >= 0 ? 1 : -1);

  // Knee bend direction: the side the limits allow, else the one that swings the foot backward.
  const kl = knee.joint.lower;
  const ku = knee.joint.upper;
  let kappa: number;
  if (ku <= 0.2) kappa = -1;
  else if (kl >= -0.2) kappa = 1;
  else kappa = foot({ [knee.id]: 0.6 }).x <= foot({ [knee.id]: -0.6 }).x ? 1 : -1;
  const near = kappa > 0 ? Math.max(0, kl) : Math.max(0, -ku);
  const far = kappa > 0 ? ku : -kl;
  const bend = Math.min(Math.max(0.6, near + 0.4), Math.max(near, far - 0.1));
  const kneeStance = clampJoint(knee, kappa * bend);

  // Hip pitch that puts the foot back under the hip.
  const hipX = leg.hipPos[0];
  const lo = Math.max(hip.joint.lower, -1.5);
  const hi = Math.min(hip.joint.upper, 1.5);
  const search = (a: number, b: number, kv: number, targetX: number) => {
    let best = clampJoint(hip, 0);
    let err = Infinity;
    for (let i = 0; i <= 40; i++) {
      const h = a + ((b - a) * i) / 40;
      const e = Math.abs(foot({ [hip.id]: h, [knee.id]: kv }).x - targetX);
      if (e < err) {
        err = e;
        best = h;
      }
    }
    return best;
  };
  let hipStance = search(lo, hi, kneeStance, hipX);
  hipStance = search(hipStance - 0.05, hipStance + 0.05, kneeStance, hipX);
  hipStance = clampJoint(hip, hipStance);
  const stance = { [hip.id]: hipStance, [knee.id]: kneeStance };
  const f0 = foot(stance);
  const length = Math.max(0.02, leg.hipPos[2] - f0.z);

  const d = 0.05;
  let hipGain =
    (foot({ ...stance, [hip.id]: hipStance + d }).x -
      foot({ ...stance, [hip.id]: hipStance - d }).x) /
    (2 * d);
  if (Math.abs(hipGain) < 1e-3) hipGain = length;
  let abdGain = length;
  if (leg.abduction) {
    const a0 = base[leg.abduction];
    abdGain =
      (foot({ ...stance, [leg.abduction]: a0 + d }).y -
        foot({ ...stance, [leg.abduction]: a0 - d }).y) /
      (2 * d);
    if (Math.abs(abdGain) < 1e-3) abdGain = length;
  }

  // Swing: bend the knee further until the foot clears the ground, then re-centre with the hip.
  const want = (biped ? 0.1 : 0.12) * length;
  let liftKnee = 0;
  for (let delta = 0.05; delta <= 1.0001; delta += 0.05) {
    const k = clampJoint(knee, kneeStance + kappa * delta);
    liftKnee = k - kneeStance;
    if (foot({ ...stance, [knee.id]: k }).z - f0.z >= want) break;
  }
  const kLift = kneeStance + liftKnee;
  const hLift = search(hipStance - 0.8, hipStance + 0.8, kLift, f0.x);
  const liftHip = clampJoint(hip, hLift) - hipStance;

  return {
    leg,
    base,
    hipStance,
    kneeStance,
    hipGain,
    abdGain,
    liftKnee,
    liftHip,
    sHip: sign(hip),
    sKnee: sign(knee),
    sAnkle: ankle ? sign(ankle) : 1,
    length,
    phase: 0,
  };
}

function makeGait(model: RobotModel, legs: LegInfo[]): Behavior {
  const biped = legs.length === 2;
  const plans = legs.map((l) => planLeg(model, l, biped));
  // Phase: alternate along each side, and opposite sides start half a cycle apart.
  for (const side of [1, -1]) {
    const mine = plans
      .filter((p) => p.leg.side === side)
      .sort((a, b) => b.leg.hipPos[0] - a.leg.hipPos[0]);
    mine.forEach((p, i) => (p.phase = ((i + (side > 0 ? 0 : 1)) % 2) * Math.PI));
  }
  const freq = biped ? 1.2 : 2;
  const strideAmp = biped ? 0.15 : 0.18;
  const lateralAmp = 0.06;
  const links = new Map(model.links.map((l) => [l.id, l]));
  const all = plans.flatMap((p) => p.leg.joints);

  let start: Record<string, number> | null = null;
  let t0 = 0;
  let last = -Infinity;
  let fwd = 0;
  let turn = 0;
  let strafe = 0;

  return {
    id: "gait",
    name: biped ? "Walk (biped)" : legs.length === 4 ? "Trot" : "Tripod gait",
    description: `${legs.length}-legged gait: forward/back sets stride, left/right turns, Q/E side-steps.`,
    teleop: true,
    velocityJoints: [],
    tick(ctx): JointCommands {
      if (!start || ctx.time < last - 1e-9) {
        start = {};
        for (const id of all) start[id] = ctx.joints[id] ?? links.get(id)!.jointValue;
        t0 = ctx.time;
        fwd = turn = strafe = 0;
      }
      last = ctx.time;
      const t = ctx.time - t0;
      const dt = clamp(ctx.dt || 0, 0, 0.1);
      const k = 1 - Math.exp(-dt / 0.3);
      fwd += (clamp(ctx.input.forward, -1, 1) - fwd) * k;
      turn += (clamp(ctx.input.turn, -1, 1) - turn) * k;
      strafe += (clamp(ctx.input.strafe, -1, 1) - strafe) * k;
      const b = Math.min(1, t / 1);
      const blend = b * b * (3 - 2 * b);

      const out: JointCommands = {};
      for (const p of plans) {
        const phi = 2 * Math.PI * freq * t + p.phase;
        const u = -Math.cos(phi);
        const swing = Math.max(0, Math.sin(phi));
        const stride = clamp(fwd - p.leg.side * turn, -1, 1);
        const x = stride * strideAmp * p.length * u;
        const vals: Record<string, number> = { ...p.base };
        const hip = p.hipStance + x / p.hipGain + p.liftHip * swing;
        const knee = p.kneeStance + p.liftKnee * swing;
        vals[p.leg.hip] = hip;
        vals[p.leg.knee] = knee;
        if (p.leg.abduction)
          vals[p.leg.abduction] =
            p.base[p.leg.abduction] + (strafe * lateralAmp * p.length * u) / p.abdGain;
        if (p.leg.ankle) {
          // Keep the foot level: ankle pitch cancels hip + knee pitch about robot +Y.
          const pitch = p.sHip * (hip - p.base[p.leg.hip]) + p.sKnee * (knee - p.base[p.leg.knee]);
          vals[p.leg.ankle] = p.base[p.leg.ankle] - p.sAnkle * pitch;
        }
        for (const id of p.leg.joints) {
          const L = links.get(id)!;
          const target = clampJoint(L, vals[id]);
          const s = start[id] ?? 0;
          out[id] = clampJoint(L, s + (target - s) * blend);
        }
      }
      return out;
    },
  };
}

export const leggedGait: BehaviorFactory = {
  id: "gait",
  name: "Legged gait",
  description: "Trot (quadrupeds) or step (bipeds); WASD / arrows steer, Q/E side-step.",
  detect(model) {
    const legs = findLegs(model).filter((l) => hasParent(model, linkById(model, l.rootId)!));
    if (legs.length < 2 || legs.length % 2) return null;
    const left = legs.filter((l) => l.side > 0).length;
    if (left * 2 !== legs.length) return null;
    return makeGait(model, legs);
  },
};
