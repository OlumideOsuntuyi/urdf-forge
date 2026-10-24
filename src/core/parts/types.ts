/**
 * Parametric components: shapes, structural parts, actuators, wheels, sensors, electronics and
 * small assemblies that users drop into their robot. A template turns parameter values into one
 * or more links; the app converts those into model links (see src/app/parts.ts).
 */
import type { Geometry, JointType, Pose, Rgba, SensorType, SimDrive } from "../model";

export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

export interface ParamSpec {
  key: string;
  label: string;
  /** length: metres (shown in mm); angle: radians (shown in degrees). */
  kind: "length" | "angle" | "number" | "int" | "choice" | "bool";
  default: ParamValue;
  min?: number;
  max?: number;
  choices?: { value: string; label: string }[];
  hint?: string;
}

/** Geometry for a part: a URDF primitive, or a generated triangle soup in metres. */
export type PartGeometry =
  Exclude<Geometry, { type: "mesh" }> | { type: "mesh"; positions: Float32Array };

export interface PartShape {
  geometry: PartGeometry;
  /** Relative to the owning link's frame. */
  origin: Pose;
  color: Rgba;
  /** Optional name; also used for the generated mesh file. */
  name?: string;
}

export interface PartJoint {
  type: JointType;
  axis?: [number, number, number];
  lower?: number;
  upper?: number;
  effort?: number;
  velocity?: number;
  damping?: number;
  friction?: number;
  /** Key of another link in the same part whose joint this one mimics. */
  mimic?: { link: string; multiplier: number; offset: number };
}

export interface PartLink {
  /** Unique within the part. */
  key: string;
  /** Suggested link name; the app makes it unique in the robot. */
  name: string;
  /** Key of the parent link within the part, or null for the part's root (attached to the target link). */
  parent: string | null;
  /** Joint origin: pose relative to the parent link (or to the attach frame for the root). */
  origin: Pose;
  /** Omitted means fixed. Ignored for a part root attached to nothing. */
  joint?: PartJoint;
  drive?: SimDrive;
  visuals: PartShape[];
  /**
   * Collision geometry. "box" | "cylinder" | "sphere" | "hull" fit the visuals; "same" copies
   * them; omitted means "box". An explicit list is used as is.
   */
  collisions?: "box" | "cylinder" | "sphere" | "hull" | "same" | PartShape[];
  sensors?: { type: SensorType; name: string; rate: number; topic?: string }[];
  /** kg/m^3; defaults to 1200 (plastic). Ignored when mass is given. */
  density?: number;
  /** Known mass in kg (inertia still comes from the geometry). */
  mass?: number;
}

export interface PartTemplate {
  id: string;
  name: string;
  category: PartCategory;
  description: string;
  tags?: string[];
  params: ParamSpec[];
  build(p: Params): PartLink[];
}

export const PART_CATEGORIES = [
  "Shapes",
  "Structure",
  "Actuators",
  "Wheels",
  "Sensors",
  "Electronics",
  "Assemblies",
] as const;
export type PartCategory = (typeof PART_CATEGORIES)[number];

export function defaults(t: PartTemplate): Params {
  return Object.fromEntries(t.params.map((p) => [p.key, p.default]));
}
