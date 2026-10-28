/**
 * The robot model: everything URDF Forge edits, saves and exports.
 * Conventions follow REP 103: Z-up, metres, kilograms, radians. Orientations are URDF
 * roll/pitch/yaw (fixed-axis X then Y then Z).
 */
import type { TargetId } from "./ros/targets";

export type Vec3 = [number, number, number];
export type Rgba = [number, number, number, number];

export interface Pose {
  xyz: Vec3;
  rpy: Vec3;
}

export const JOINT_TYPES = [
  "fixed",
  "revolute",
  "continuous",
  "prismatic",
  "planar",
  "floating",
] as const;
export type JointType = (typeof JOINT_TYPES)[number];
export const ARTICULATED: readonly JointType[] = ["revolute", "continuous", "prismatic"];

export interface Mimic {
  joint: string;
  multiplier: number;
  offset: number;
}

export interface SafetyController {
  softLower: number;
  softUpper: number;
  kPosition: number;
  kVelocity: number;
}

export interface Joint {
  /** Empty means "<link name>_joint". */
  name: string;
  type: JointType;
  axis: Vec3;
  lower: number;
  upper: number;
  effort: number;
  velocity: number;
  damping: number;
  friction: number;
  mimic: Mimic | null;
  safety: SafetyController | null;
}

export type Geometry =
  | { type: "mesh"; meshId: string; scale: Vec3 }
  | { type: "box"; size: Vec3 }
  | { type: "cylinder"; radius: number; length: number }
  | { type: "sphere"; radius: number };

export interface Visual {
  id: string;
  name: string;
  origin: Pose;
  geometry: Geometry;
  materialId: string | null;
}

export interface Collision {
  id: string;
  name: string;
  origin: Pose;
  geometry: Geometry;
}

export interface Inertia {
  ixx: number;
  iyy: number;
  izz: number;
  ixy: number;
  iyz: number;
  ixz: number;
}

export interface Inertial {
  /** Recompute from the visual geometry whenever it changes. */
  auto: boolean;
  /** "density": mass = volume x density. "mass": fixed mass, inertia scaled to it. */
  mode: "density" | "mass";
  density: number;
  mass: number;
  com: Vec3;
  inertia: Inertia;
  volume: number;
  /** False when a mesh that fed the numbers is not a closed surface. */
  watertight: boolean;
}

export interface GazeboLinkProps {
  mu1: number;
  mu2: number;
  kp: number;
  kd: number;
  minDepth: number;
  maxVel: number;
  selfCollide: boolean;
  gravity: boolean;
}

export const SENSOR_TYPES = [
  "imu",
  "camera",
  "depth_camera",
  "lidar",
  "contact",
  "force_torque",
] as const;
export type SensorType = (typeof SENSOR_TYPES)[number];

export interface Sensor {
  id: string;
  type: SensorType;
  name: string;
  /** Hz */
  rate: number;
  /** Empty means a default derived from the sensor name. */
  topic: string;
  fov?: number;
  width?: number;
  height?: number;
  near?: number;
  far?: number;
  samples?: number;
  minAngle?: number;
  maxAngle?: number;
  rangeMin?: number;
  rangeMax?: number;
}

/** How the simulation preview drives a joint. Not exported. */
export interface SimDrive {
  mode: "none" | "servo" | "wheel";
  /** servo: target position (rad or m). wheel: target velocity (rad/s or m/s). */
  target: number;
  /** servo: sweep between the limits instead of holding the target. */
  sweep: boolean;
}

export interface Link {
  id: string;
  name: string;
  parentId: string | null;
  /** Joint origin: pose of this link's frame in its parent's frame. */
  origin: Pose;
  joint: Joint;
  visuals: Visual[];
  collisions: Collision[];
  sensors: Sensor[];
  inertial: Inertial;
  gazebo: GazeboLinkProps;
  /** Include this joint in ros2_control. */
  controlled: boolean;
  drive: SimDrive;
  hidden: boolean;
  /** Current joint position in the editor (pose preview). Not exported. */
  jointValue: number;
}

export interface Material {
  id: string;
  name: string;
  /** Base colour; multiplies the colour texture when there is one. */
  rgba: Rgba;
  metalness: number;
  roughness: number;
  /** Extra glossy lacquer layer, 0 to 1 (car paint, coated plastic). */
  clearcoat?: number;
  /** PBR texture set; null for a solid material. */
  textures?: MaterialTextures | null;
}

export type TextureMap = "color" | "normal" | "roughness" | "metalness" | "ao";

export interface MaterialTextures {
  /** Where the set came from, for attribution (e.g. "ambientCG Metal032, CC0"). */
  source: string;
  /** Size of one texture tile on the part, in metres. */
  tile: number;
  /** Texture keys (in the project's texture store) for each map present. */
  maps: Partial<Record<TextureMap, string>>;
}

export interface MeshAsset {
  id: string;
  name: string;
  /** File name inside the exported package's mesh directory. */
  file: string;
  source: "stl" | "step" | "generated" | "plugin";
  /** Name of the file it was imported from. */
  origin: string;
  triangles: number;
  bbox: { min: Vec3; max: Vec3 };
  volume: number;
  com: Vec3;
  watertight: boolean;
  /** Colour carried over from STEP, if any. */
  color: Rgba | null;
}

export interface ExportSettings {
  targets: TargetId[];
  defaultTarget: TargetId;
  ros2Control: boolean;
  /** "auto": velocity for wheels and continuous joints, position for everything else. */
  commandInterface: "auto" | "position" | "velocity" | "effort";
  version: string;
  description: string;
  maintainer: string;
  maintainerEmail: string;
  license: string;
}

export interface RobotModel {
  formatVersion: 1;
  robot: string;
  packageName: string;
  meshDir: string;
  materials: Material[];
  links: Link[];
  meshes: MeshAsset[];
  export: ExportSettings;
}

// ------------------------------------------------------------------ factories

let counter = 0;
export function uid(prefix: string): string {
  counter = (counter + 1) % 1679616;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(4, "0")}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export const identityPose = (): Pose => ({ xyz: [0, 0, 0], rpy: [0, 0, 0] });

export function newMaterial(name: string, rgba: Rgba): Material {
  return { id: uid("mat"), name, rgba, metalness: 0.15, roughness: 0.55 };
}

export function newJoint(): Joint {
  return {
    name: "",
    type: "fixed",
    axis: [0, 0, 1],
    lower: -Math.PI / 2,
    upper: Math.PI / 2,
    effort: 10,
    velocity: 2,
    damping: 0,
    friction: 0,
    mimic: null,
    safety: null,
  };
}

export function newLink(name: string): Link {
  return {
    id: uid("lnk"),
    name,
    parentId: null,
    origin: identityPose(),
    joint: newJoint(),
    visuals: [],
    collisions: [],
    sensors: [],
    inertial: {
      auto: true,
      mode: "density",
      density: 1000,
      mass: 0.1,
      com: [0, 0, 0],
      inertia: { ixx: 1e-4, iyy: 1e-4, izz: 1e-4, ixy: 0, iyz: 0, ixz: 0 },
      volume: 0,
      watertight: true,
    },
    gazebo: {
      mu1: 0.8,
      mu2: 0.8,
      kp: 1e6,
      kd: 100,
      minDepth: 0.001,
      maxVel: 0.01,
      selfCollide: false,
      gravity: true,
    },
    controlled: true,
    drive: { mode: "none", target: 0, sweep: false },
    hidden: false,
    jointValue: 0,
  };
}

export function newModel(robot = "my_robot"): RobotModel {
  return {
    formatVersion: 1,
    robot,
    packageName: `${robot}_description`,
    meshDir: "meshes",
    materials: [newMaterial("default", [0.56, 0.65, 0.73, 1])],
    links: [],
    meshes: [],
    export: {
      targets: ["jazzy-harmonic"],
      defaultTarget: "jazzy-harmonic",
      ros2Control: false,
      commandInterface: "auto",
      version: "0.1.0",
      description: "",
      maintainer: "maintainer",
      maintainerEmail: "maintainer@example.com",
      license: "Apache-2.0",
    },
  };
}

// ------------------------------------------------------------------ names

/** A name that is valid in URDF, ROS and as a file name. */
export function safeName(s: string, fallback = "link"): string {
  const t = String(s ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^[^A-Za-z_]+/, "")
    .replace(/_+/g, "_");
  return t || fallback;
}

export function jointName(link: Link): string {
  return safeName(link.joint.name || `${link.name}_joint`, "joint");
}

export function uniqueName(base: string, taken: Iterable<string>, fallback = "link"): string {
  const used = new Set(taken);
  const root = safeName(base, fallback);
  if (!used.has(root)) return root;
  for (let i = 2; ; i++) {
    const n = `${root}_${i}`;
    if (!used.has(n)) return n;
  }
}

// ------------------------------------------------------------------ tree helpers

export function linkById(model: RobotModel, id: string | null | undefined): Link | undefined {
  return id ? model.links.find((l) => l.id === id) : undefined;
}

export function childrenOf(model: RobotModel, id: string): Link[] {
  return model.links.filter((l) => l.parentId === id);
}

export function rootLinks(model: RobotModel): Link[] {
  const ids = new Set(model.links.map((l) => l.id));
  return model.links.filter((l) => !l.parentId || !ids.has(l.parentId));
}

/** Depth-first order, roots first; links unreachable from a root come last. */
export function orderedLinks(model: RobotModel): Link[] {
  const out: Link[] = [];
  const seen = new Set<string>();
  const walk = (l: Link) => {
    if (seen.has(l.id)) return;
    seen.add(l.id);
    out.push(l);
    childrenOf(model, l.id).forEach(walk);
  };
  rootLinks(model).forEach(walk);
  model.links.forEach((l) => !seen.has(l.id) && out.push(l));
  return out;
}

/** True when `id` is `ancestorId` or lies below it. */
export function isDescendantOrSelf(model: RobotModel, id: string, ancestorId: string): boolean {
  let cur = linkById(model, id);
  const guard = new Set<string>();
  while (cur) {
    if (cur.id === ancestorId) return true;
    if (guard.has(cur.id)) return false;
    guard.add(cur.id);
    cur = linkById(model, cur.parentId);
  }
  return false;
}

export function hasJoint(model: RobotModel, link: Link): boolean {
  return !!link.parentId && !!linkById(model, link.parentId);
}

/** Most links weigh far more than this; the URDF importer gives massless frames 1e-6 kg. */
export const FRAME_MASS = 1e-5;

/**
 * A pure coordinate frame (base_footprint, camera_optical_frame, ...): no geometry and no
 * real mass. ROS tools expect these, so they need no geometry warnings and, at the root, no
 * inertia.
 */
export function isFrameLink(link: Link): boolean {
  return !link.visuals.length && !link.collisions.length && link.inertial.mass <= FRAME_MASS;
}

export function materialById(model: RobotModel, id: string | null): Material | undefined {
  return id ? model.materials.find((m) => m.id === id) : undefined;
}

export function meshById(model: RobotModel, id: string): MeshAsset | undefined {
  return model.meshes.find((m) => m.id === id);
}

export function clone<T>(v: T): T {
  return structuredClone(v);
}
