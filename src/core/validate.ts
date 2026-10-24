import { ARTICULATED, hasJoint, jointName, meshById, rootLinks, type RobotModel } from "./model";

export type IssueLevel = "error" | "warning";

export interface Issue {
  level: IssueLevel;
  message: string;
  /** Link the issue belongs to, for "jump to" in the problems panel. */
  linkId?: string;
}

export function validate(model: RobotModel): Issue[] {
  const out: Issue[] = [];
  const add = (level: IssueLevel, message: string, linkId?: string) =>
    out.push({ level, message, linkId });

  if (!model.links.length) add("error", "The robot has no links.");
  const roots = rootLinks(model);
  if (roots.length > 1)
    add(
      "error",
      `${roots.length} root links (${roots.map((l) => l.name).join(", ")}). URDF needs exactly one tree.`,
    );
  if (!/^[a-z][a-z0-9_]*$/.test(model.packageName))
    add(
      "error",
      `Package name "${model.packageName}" must be lower case letters, digits and underscores (REP 144).`,
    );

  const linkNames = new Map<string, number>();
  const jointNames = new Map<string, number>();
  const articulated = new Set<string>();
  for (const L of model.links) {
    linkNames.set(L.name, (linkNames.get(L.name) ?? 0) + 1);
    if (hasJoint(model, L)) {
      const jn = jointName(L);
      jointNames.set(jn, (jointNames.get(jn) ?? 0) + 1);
      if (ARTICULATED.includes(L.joint.type)) articulated.add(jn);
    }
  }
  for (const [n, c] of linkNames) if (c > 1) add("error", `Link name "${n}" is used ${c} times.`);
  for (const [n, c] of jointNames) if (c > 1) add("error", `Joint name "${n}" is used ${c} times.`);

  for (const L of model.links) {
    const ine = L.inertial;
    if (!(ine.mass > 0)) add("error", `${L.name}: mass must be greater than zero.`, L.id);
    const I = ine.inertia;
    if (Math.min(I.ixx, I.iyy, I.izz) <= 0)
      add("error", `${L.name}: inertia diagonal must be positive.`, L.id);
    else if (
      I.ixx + I.iyy < I.izz * (1 - 1e-6) ||
      I.iyy + I.izz < I.ixx * (1 - 1e-6) ||
      I.ixx + I.izz < I.iyy * (1 - 1e-6)
    )
      add(
        "warning",
        `${L.name}: inertia breaks the triangle inequality, which is physically impossible.`,
        L.id,
      );
    if (!ine.watertight)
      add(
        "warning",
        `${L.name}: a mesh is not watertight, so its computed inertia is approximate.`,
        L.id,
      );
    if (!L.visuals.length) add("warning", `${L.name}: no visual geometry.`, L.id);
    if (!L.collisions.length)
      add(
        "warning",
        `${L.name}: no collision geometry; it will pass through everything in simulation.`,
        L.id,
      );
    for (const c of [...L.visuals, ...L.collisions])
      if (c.geometry.type === "mesh" && !meshById(model, c.geometry.meshId))
        add("error", `${L.name}: references a mesh that is not in the parts library.`, L.id);

    if (!hasJoint(model, L)) continue;
    const j = L.joint;
    const jn = jointName(L);
    if ((j.type === "revolute" || j.type === "prismatic") && j.lower >= j.upper)
      add("error", `${jn}: lower limit must be below the upper limit.`, L.id);
    if ((ARTICULATED.includes(j.type) || j.type === "planar") && Math.hypot(...j.axis) < 1e-9)
      add("error", `${jn}: the axis is zero.`, L.id);
    if (ARTICULATED.includes(j.type) && (j.effort <= 0 || j.velocity <= 0))
      add("warning", `${jn}: effort and velocity limits should be positive.`, L.id);
    if (j.mimic?.joint) {
      if (!jointNames.has(j.mimic.joint))
        add("error", `${jn}: mimics unknown joint "${j.mimic.joint}".`, L.id);
      else if (!articulated.has(j.mimic.joint))
        add("error", `${jn}: mimics a joint that does not move.`, L.id);
    }
    if (j.type === "floating" || j.type === "planar")
      add(
        "warning",
        `${jn}: ${j.type} joints are not supported by ros2_control or most simulators.`,
        L.id,
      );
  }
  return out;
}
