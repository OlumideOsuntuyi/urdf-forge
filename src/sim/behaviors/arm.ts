/**
 * Arm waypoints: cycles a serial chain of revolute joints through home and a few seeded poses with
 * minimum-jerk moves, opening and closing a prismatic gripper at each waypoint.
 */
import { jointName, rootLinks, type Link, type RobotModel } from "@/core/model";
import { clampJoint } from "@/core/kinematics";
import type { Behavior, BehaviorFactory, JointCommands } from "./types";
import { descendants, findWheels, hashString, mulberry32 } from "./drive";
import { findLegs } from "./gait";

const MOVE = 2.5;
const HOLD = 0.5;
const POSES = 4;

/** Longest root-to-leaf run of revolute joints that is not part of a leg or a wheel. */
export function findArmChain(model: RobotModel): Link[] {
  const exclude = new Set<string>();
  for (const leg of findLegs(model)) leg.linkIds.forEach((id) => exclude.add(id));
  for (const w of findWheels(model)) {
    exclude.add(w.linkId);
    if (w.steerLinkId) exclude.add(w.steerLinkId);
  }
  let best: Link[] = [];
  const seen = new Set<string>();
  const walk = (l: Link, chain: Link[]) => {
    if (seen.has(l.id)) return;
    seen.add(l.id);
    for (const c of model.links) {
      if (c.parentId !== l.id || exclude.has(c.id)) continue;
      const counts =
        c.joint.type === "revolute" && !c.joint.mimic && c.joint.upper - c.joint.lower > 1e-3;
      const next = counts ? [...chain, c] : chain;
      if (next.length > best.length) best = next;
      walk(c, next);
    }
  };
  rootLinks(model).forEach((r) => walk(r, []));
  return best;
}

const minJerk = (s: number) => s * s * s * (10 - 15 * s + 6 * s * s);
const cosine = (s: number) => (1 - Math.cos(Math.PI * s)) / 2;

function makeArm(model: RobotModel, chain: Link[]): Behavior {
  // Gripper: prismatic joints below the end of the chain, plus their mimic followers.
  const end = chain[chain.length - 1];
  const fingers = descendants(model, end.id).filter(
    (l) => l.joint.type === "prismatic" && !l.joint.mimic,
  );
  const leaders = new Map<string, Link>(
    [...chain, ...fingers].map((l) => [jointName(l), l] as const),
  );
  const followers = model.links.filter((l) => l.joint.mimic && leaders.has(l.joint.mimic.joint));

  const rand = mulberry32(hashString(chain.map(jointName).join("|")));
  const home = chain.map((l) => clampJoint(l, 0));
  const waypoints: number[][] = [home];
  for (let i = 0; i < POSES; i++)
    waypoints.push(
      chain.map((l, j) => {
        const half = Math.min(l.joint.upper - l.joint.lower, 2 * Math.PI) / 2;
        const amp = (0.4 + 0.2 * rand()) * half;
        let s = rand() < 0.5 ? -1 : 1;
        if (home[j] + s * amp > l.joint.upper || home[j] + s * amp < l.joint.lower) s = -s;
        return clampJoint(l, home[j] + s * amp);
      }),
    );
  const open = fingers.map((f) =>
    Math.abs(f.joint.upper) >= Math.abs(f.joint.lower) ? f.joint.upper : f.joint.lower,
  );
  const closed = fingers.map((f, i) => (open[i] === f.joint.upper ? f.joint.lower : f.joint.upper));

  // Segment state: moving from `from` to waypoint `index`, then holding.
  let from: number[] = [];
  let gripFrom: number[] = [];
  let index = 0;
  let segStart = 0;
  let duration = MOVE;
  let last = -Infinity;
  let started = false;

  const moveTime = (a: number[], b: number[]) => {
    let t = MOVE;
    chain.forEach((l, i) => {
      const v = l.joint.velocity > 0 ? l.joint.velocity : Infinity;
      t = Math.max(t, (1.875 * Math.abs(b[i] - a[i])) / v);
    });
    return t;
  };
  const gripTarget = (k: number) => (k % 2 ? open : closed);

  return {
    id: "arm",
    name: "Arm waypoints",
    description: `Cycles the ${chain.length}-joint arm through home and ${POSES} poses${fingers.length ? ", opening and closing the gripper" : ""}.`,
    teleop: false,
    velocityJoints: [],
    tick(ctx): JointCommands {
      if (!started || ctx.time < last - 1e-9) {
        from = chain.map((l) => clampJoint(l, ctx.joints[l.id] ?? l.jointValue));
        gripFrom = fingers.map((f) => clampJoint(f, ctx.joints[f.id] ?? f.jointValue));
        index = 0;
        segStart = ctx.time;
        duration = moveTime(from, waypoints[0]);
        started = true;
      }
      last = ctx.time;
      while (ctx.time >= segStart + duration + HOLD) {
        from = waypoints[index];
        gripFrom = gripTarget(index);
        segStart += duration + HOLD;
        index = (index + 1) % waypoints.length;
        duration = moveTime(from, waypoints[index]);
      }
      const t = ctx.time - segStart;
      const s = minJerk(Math.min(1, Math.max(0, t / duration)));
      const g = cosine(Math.min(1, Math.max(0, (t - duration) / HOLD)));
      const to = waypoints[index];
      const gTo = gripTarget(index);

      const out: JointCommands = {};
      chain.forEach((l, i) => (out[l.id] = clampJoint(l, from[i] + (to[i] - from[i]) * s)));
      fingers.forEach(
        (f, i) => (out[f.id] = clampJoint(f, gripFrom[i] + (gTo[i] - gripFrom[i]) * g)),
      );
      for (const f of followers) {
        const m = f.joint.mimic!;
        const leader = leaders.get(m.joint)!;
        out[f.id] = clampJoint(f, (out[leader.id] ?? 0) * m.multiplier + m.offset);
      }
      return out;
    },
  };
}

export const armWaypoints: BehaviorFactory = {
  id: "arm",
  name: "Arm waypoints",
  description:
    "Moves the arm smoothly through home and a few poses, opening and closing the gripper.",
  detect(model) {
    const chain = findArmChain(model);
    return chain.length >= 3 ? makeArm(model, chain) : null;
  },
};
