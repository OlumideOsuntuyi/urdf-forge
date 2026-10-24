/**
 * Test environments: static scenery the robot is previewed and simulated in, and that can be
 * exported as a Gazebo world. Environments are not part of the robot model or its undo history.
 */
import type { Geometry, Pose, Rgba } from "../model";

export type EnvGeometry =
  | Exclude<Geometry, { type: "mesh" }>
  | { type: "mesh"; mesh: string; scale?: [number, number, number] };

export interface EnvObject {
  name: string;
  geometry: EnvGeometry;
  pose: Pose;
  color: Rgba;
  /** Visual only (no collider), e.g. decals or very heavy decorative meshes. */
  noCollide?: boolean;
}

export interface Environment {
  id: string;
  name: string;
  description: string;
  /** Show the infinite ground plane (z = 0). */
  ground: boolean;
  /** Where the robot's base is placed for simulation (z is added to the automatic lift). */
  spawn: Pose;
  objects: EnvObject[];
  /** Mesh geometry by key (triangle soups in metres). */
  meshes: Record<string, Float32Array>;
  /** Shown in the gallery and in exported worlds. */
  attribution?: string;
}

export function emptyEnvironment(): Environment {
  return {
    id: "flat",
    name: "Flat ground",
    description: "An empty floor.",
    ground: true,
    spawn: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
    objects: [],
    meshes: {},
  };
}
