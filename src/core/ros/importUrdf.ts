/** Read an existing URDF into the editor's model. */
import {
  JOINT_TYPES,
  newLink,
  newMaterial,
  newModel,
  safeName,
  uid,
  type Geometry,
  type JointType,
  type MeshAsset,
  type Pose,
  type Rgba,
  type RobotModel,
  type Vec3,
} from "../model";

const nums = (s: string | null, n: number, dflt: number[]): number[] => {
  const v = (s ?? "").trim().split(/\s+/).map(Number);
  return dflt.map((d, i) => (Number.isFinite(v[i]) && (s ?? "").trim() ? v[i] : d)).slice(0, n);
};
const vec3 = (s: string | null, d: Vec3 = [0, 0, 0]) => nums(s, 3, d) as Vec3;
const num = (s: string | null, d: number) => {
  const v = parseFloat(s ?? "");
  return Number.isFinite(v) ? v : d;
};
const kids = (el: Element, tag: string) => [...el.children].filter((c) => c.tagName === tag);
const kid = (el: Element, tag: string) => kids(el, tag)[0] ?? null;

function pose(el: Element | null): Pose {
  const o = el ? kid(el, "origin") : null;
  return { xyz: vec3(o?.getAttribute("xyz") ?? null), rpy: vec3(o?.getAttribute("rpy") ?? null) };
}

export interface UrdfImport {
  model: RobotModel;
  /** Mesh file names (as written in the URDF) that `resolveMesh` could not supply. */
  missing: string[];
}

/**
 * @param resolveMesh maps a mesh filename attribute (e.g. package://pkg/meshes/base.stl) to an
 *   asset already in the library, or undefined. Unresolved meshes become placeholder boxes.
 */
export function importUrdf(
  xml: string,
  resolveMesh: (uri: string) => MeshAsset | undefined,
): UrdfImport {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) throw new Error(`Not valid XML: ${err.textContent?.trim().split("\n")[0] ?? ""}`);
  const robot = doc.documentElement;
  if (robot.tagName !== "robot") throw new Error("Not a URDF: the root element is not <robot>.");

  const name = safeName(robot.getAttribute("name") ?? "robot", "robot");
  const model = newModel(name);
  model.materials = [];
  const matByName = new Map<string, string>();
  const missing = new Set<string>();
  const meshes = new Map<string, MeshAsset>();

  const material = (el: Element | null): string | null => {
    if (!el) return null;
    const mname = el.getAttribute("name") ?? "";
    const color = kid(el, "color");
    // URDF material names are global: xacro output often repeats the full definition on every
    // visual that uses it, so reuse the first one rather than creating duplicates.
    if (mname && matByName.has(mname)) return matByName.get(mname)!;
    const rgba = nums(color?.getAttribute("rgba") ?? null, 4, [0.7, 0.7, 0.7, 1]) as Rgba;
    const m = newMaterial(mname || `material_${model.materials.length + 1}`, rgba);
    model.materials.push(m);
    if (mname) matByName.set(mname, m.id);
    return m.id;
  };
  kids(robot, "material").forEach(material);

  const geometry = (el: Element): Geometry => {
    const g = kid(el, "geometry");
    const mesh = g && kid(g, "mesh");
    if (mesh) {
      const uri = mesh.getAttribute("filename") ?? "";
      const asset = resolveMesh(uri);
      if (asset) {
        meshes.set(asset.id, asset);
        return {
          type: "mesh",
          meshId: asset.id,
          scale: vec3(mesh.getAttribute("scale"), [1, 1, 1]),
        };
      }
      missing.add(uri);
      return { type: "box", size: [0.05, 0.05, 0.05] };
    }
    const box = g && kid(g, "box");
    if (box) return { type: "box", size: vec3(box.getAttribute("size"), [0.1, 0.1, 0.1]) };
    const cyl = g && kid(g, "cylinder");
    if (cyl)
      return {
        type: "cylinder",
        radius: num(cyl.getAttribute("radius"), 0.05),
        length: num(cyl.getAttribute("length"), 0.1),
      };
    const sph = g && kid(g, "sphere");
    if (sph) return { type: "sphere", radius: num(sph.getAttribute("radius"), 0.05) };
    return { type: "box", size: [0.05, 0.05, 0.05] };
  };

  const byName = new Map<string, ReturnType<typeof newLink>>();
  for (const el of kids(robot, "link")) {
    const L = newLink(el.getAttribute("name") ?? `link_${byName.size + 1}`);
    L.name = el.getAttribute("name") ?? L.name;
    L.inertial.auto = false;
    L.inertial.mode = "mass";
    const ine = kid(el, "inertial");
    if (ine) {
      L.inertial.mass = num(kid(ine, "mass")?.getAttribute("value") ?? null, 0.001);
      L.inertial.com = pose(ine).xyz;
      const it = kid(ine, "inertia");
      if (it)
        L.inertial.inertia = {
          ixx: num(it.getAttribute("ixx"), 1e-4),
          iyy: num(it.getAttribute("iyy"), 1e-4),
          izz: num(it.getAttribute("izz"), 1e-4),
          ixy: num(it.getAttribute("ixy"), 0),
          iyz: num(it.getAttribute("iyz"), 0),
          ixz: num(it.getAttribute("ixz"), 0),
        };
    } else {
      // No <inertial>: a massless frame (sensor mounts, footprints). URDF tools lump these into
      // their parent, so a default mass here would shift the robot's centre of mass.
      L.inertial.mass = 1e-6;
      L.inertial.com = [0, 0, 0];
      L.inertial.inertia = { ixx: 1e-12, iyy: 1e-12, izz: 1e-12, ixy: 0, iyz: 0, ixz: 0 };
    }
    kids(el, "visual").forEach((v) =>
      L.visuals.push({
        id: uid("vis"),
        name: v.getAttribute("name") ?? "",
        origin: pose(v),
        geometry: geometry(v),
        materialId: material(kid(v, "material")),
      }),
    );
    kids(el, "collision").forEach((c) =>
      L.collisions.push({
        id: uid("col"),
        name: c.getAttribute("name") ?? "",
        origin: pose(c),
        geometry: geometry(c),
      }),
    );
    byName.set(L.name, L);
    model.links.push(L);
  }

  for (const el of kids(robot, "joint")) {
    const child = byName.get(kid(el, "child")?.getAttribute("link") ?? "");
    const parent = byName.get(kid(el, "parent")?.getAttribute("link") ?? "");
    if (!child || !parent) continue;
    const t = (el.getAttribute("type") ?? "fixed") as JointType;
    child.parentId = parent.id;
    child.origin = pose(el);
    const j = child.joint;
    j.name = el.getAttribute("name") ?? "";
    j.type = JOINT_TYPES.includes(t) ? t : "fixed";
    const axis = kid(el, "axis");
    if (axis) j.axis = vec3(axis.getAttribute("xyz"), [1, 0, 0]);
    else if (j.type !== "fixed") j.axis = [1, 0, 0]; // URDF default
    const lim = kid(el, "limit");
    if (lim) {
      j.lower = num(lim.getAttribute("lower"), 0);
      j.upper = num(lim.getAttribute("upper"), 0);
      j.effort = num(lim.getAttribute("effort"), j.effort);
      j.velocity = num(lim.getAttribute("velocity"), j.velocity);
    } else if (j.type === "continuous") {
      // URDF continuous joints may omit <limit>, meaning no velocity limit (TurtleBot wheels).
      j.velocity = 100;
    }
    const dyn = kid(el, "dynamics");
    if (dyn) {
      j.damping = num(dyn.getAttribute("damping"), 0);
      j.friction = num(dyn.getAttribute("friction"), 0);
    }
    const mim = kid(el, "mimic");
    if (mim)
      j.mimic = {
        joint: mim.getAttribute("joint") ?? "",
        multiplier: num(mim.getAttribute("multiplier"), 1),
        offset: num(mim.getAttribute("offset"), 0),
      };
    const sc = kid(el, "safety_controller");
    if (sc)
      j.safety = {
        softLower: num(sc.getAttribute("soft_lower_limit"), 0),
        softUpper: num(sc.getAttribute("soft_upper_limit"), 0),
        kPosition: num(sc.getAttribute("k_position"), 0),
        kVelocity: num(sc.getAttribute("k_velocity"), 0),
      };
  }

  for (const gz of kids(robot, "gazebo")) {
    const L = byName.get(gz.getAttribute("reference") ?? "");
    if (!L) continue;
    const text = (tag: string) => kid(gz, tag)?.textContent?.trim() ?? null;
    L.gazebo.mu1 = num(text("mu1"), L.gazebo.mu1);
    L.gazebo.mu2 = num(text("mu2"), L.gazebo.mu2);
    L.gazebo.kp = num(text("kp"), L.gazebo.kp);
    L.gazebo.kd = num(text("kd"), L.gazebo.kd);
    L.gazebo.minDepth = num(text("minDepth"), L.gazebo.minDepth);
    L.gazebo.maxVel = num(text("maxVel"), L.gazebo.maxVel);
    if (text("selfCollide")) L.gazebo.selfCollide = text("selfCollide") === "true";
    if (text("gravity")) L.gazebo.gravity = text("gravity") !== "false";
  }

  if (!model.materials.length) model.materials.push(newMaterial("default", [0.56, 0.65, 0.73, 1]));
  model.meshes = [...meshes.values()];
  model.export.ros2Control = robot.getElementsByTagName("ros2_control").length > 0;
  return { model, missing: [...missing] };
}
