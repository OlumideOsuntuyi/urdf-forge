/** Forward kinematics over the link tree. */
import { Matrix4, Quaternion, Vector3 } from "three";
import { childrenOf, jointName, linkById, rootLinks, type Link, type RobotModel } from "./model";
import { normalize, poseToMatrix } from "./math";

/** The joint's motion for a given position: rotation about, or translation along, its axis. */
export function jointMotion(link: Link, value: number): Matrix4 {
  const t = link.joint.type;
  if (!value || (t !== "revolute" && t !== "continuous" && t !== "prismatic")) return new Matrix4();
  const axis = new Vector3(...normalize(link.joint.axis));
  if (t === "prismatic")
    return new Matrix4().makeTranslation(axis.x * value, axis.y * value, axis.z * value);
  return new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromAxisAngle(axis, value));
}

/** Resolve mimic joints: value = multiplier * leader + offset. */
export function effectiveJointValues(
  model: RobotModel,
  values: Record<string, number>,
): Record<string, number> {
  const out = { ...values };
  const byJoint = new Map(model.links.filter((l) => l.parentId).map((l) => [jointName(l), l]));
  for (const l of model.links) {
    const m = l.joint.mimic;
    if (!m?.joint) continue;
    const leader = byJoint.get(m.joint);
    if (leader) out[l.id] = (values[leader.id] ?? 0) * m.multiplier + m.offset;
  }
  return out;
}

/**
 * Model-frame matrix of every link.
 * world(child) = world(parent) * origin(child) * motion(child joint value)
 */
export function linkWorldMatrices(
  model: RobotModel,
  values: Record<string, number> = {},
): Map<string, Matrix4> {
  const v = effectiveJointValues(model, values);
  const out = new Map<string, Matrix4>();
  const walk = (L: Link, parent: Matrix4) => {
    if (out.has(L.id)) return;
    const m = parent.clone().multiply(poseToMatrix(L.origin));
    if (linkById(model, L.parentId)) m.multiply(jointMotion(L, v[L.id] ?? 0));
    out.set(L.id, m);
    childrenOf(model, L.id).forEach((c) => walk(c, m));
  };
  rootLinks(model).forEach((r) => walk(r, new Matrix4()));
  return out;
}

export function clampJoint(link: Link, value: number): number {
  const t = link.joint.type;
  if (t === "revolute" || t === "prismatic")
    return Math.min(link.joint.upper, Math.max(link.joint.lower, value));
  return value;
}

/**
 * Lowest z of the robot's visual and collision geometry in its own frame at zero joint positions.
 * Mesh vertices are sampled with `stride`; returns 0 for an empty robot.
 */
export function lowestZ(
  model: RobotModel,
  meshes: (id: string) => ArrayLike<number> | undefined,
  stride = 7,
): number {
  const W = linkWorldMatrices(model);
  let minZ = Infinity;
  const probe = (m: Matrix4, pts: ArrayLike<number>, step: number) => {
    const e = m.elements;
    for (let i = 2; i < pts.length; i += 3 * step) {
      const z = e[2] * pts[i - 2] + e[6] * pts[i - 1] + e[10] * pts[i] + e[14];
      if (z < minZ) minZ = z;
    }
  };
  for (const L of model.links)
    for (const c of [...L.visuals, ...L.collisions]) {
      const g = c.geometry;
      const m = W.get(L.id)!
        .clone()
        .multiply(poseToMatrix(c.origin, g.type === "mesh" ? g.scale : undefined));
      if (g.type === "mesh") {
        const pos = meshes(g.meshId);
        if (pos) probe(m, pos, stride);
      } else {
        const h =
          g.type === "box"
            ? g.size.map((s) => s / 2)
            : g.type === "sphere"
              ? [g.radius, g.radius, g.radius]
              : [g.radius, g.radius, g.length / 2];
        const corners: number[] = [];
        for (const sx of [-1, 1])
          for (const sy of [-1, 1])
            for (const sz of [-1, 1]) corners.push(sx * h[0], sy * h[1], sz * h[2]);
        probe(m, corners, 1);
      }
    }
  return Number.isFinite(minZ) ? minZ : 0;
}
