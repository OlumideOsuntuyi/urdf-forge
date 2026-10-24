/**
 * The sample gallery: open-source robots and environments downloaded on demand from their
 * original repositories (pinned to a commit), plus environments generated in the app.
 * Nothing here is bundled; each entry records its source, licence and attribution.
 */

export type SampleSource =
  /** A plain URDF. `packages` maps ROS package names to the base URL of each package folder. */
  | { kind: "urdf"; urdf: string; packages: Record<string, string> }
  /** A Gazebo Fuel model or world, e.g. https://fuel.gazebosim.org/1.0/OpenRobotics/models/Foo */
  | { kind: "fuel"; url: string; type: "model" | "world" }
  /**
   * An SDF world in a git repository. model://<name> resolves through `models` (name to base URL)
   * or else to `<modelsBase>/<name>`.
   */
  | { kind: "sdf"; sdf: string; models?: Record<string, string>; modelsBase?: string }
  /** Generated in the app (src/core/env/procedural.ts). */
  | { kind: "procedural"; envId: string };

export interface Sample {
  id: string;
  kind: "robot" | "environment";
  name: string;
  category: string;
  description: string;
  complexity: "simple" | "moderate" | "complex";
  source: SampleSource;
  /** SPDX identifier or short description. */
  license: string;
  /** True when the licence clearly allows reuse and redistribution. */
  permissive: boolean;
  attribution: string;
  homepage: string;
  /** Approximate download size. */
  sizeMB?: number;
  tags?: string[];
}

const gh = (repo: string, sha: string, path = "") =>
  `https://raw.githubusercontent.com/${repo}/${sha}/${path}`.replace(/\/$/, "");

export const SAMPLES: Sample[] = [
  // ---------------------------------------------------------------- built-in environments
  ...(
    [
      ["flat", "Flat ground", "An empty floor.", "simple"],
      ["ramps", "Ramps", "5°, 10°, 15° and 20° ramps for climbing and slipping tests.", "simple"],
      [
        "tabletop",
        "Table top",
        "A table with blocks, a can, a ball and a bin for grippers.",
        "simple",
      ],
      ["stairs", "Stairs", "8 steps, 17 cm rise, 28 cm run, for legged robots.", "moderate"],
      ["obstacles", "Obstacle course", "Crates, speed bumps and a narrow passage.", "moderate"],
      ["rough", "Rough terrain", "8 × 8 m of rolling bumps up to 15 cm.", "moderate"],
      ["maze", "Maze", "6 × 6 m maze with 1 m corridors for mapping.", "moderate"],
      [
        "warehouse",
        "Warehouse aisle",
        "Pallet racks, pallets, boxes and a loading ramp.",
        "complex",
      ],
    ] as const
  ).map(([envId, name, description, complexity]): Sample => ({
    id: `env.${envId}`,
    kind: "environment",
    name,
    category: "Built in",
    description,
    complexity,
    source: { kind: "procedural", envId },
    license: "Apache-2.0",
    permissive: true,
    attribution: "URDF Forge",
    homepage: "https://github.com/OlumideOsuntuyi/urdf-forge",
  })),
];

/** Add catalogue entries (used for the researched remote samples and by plugins). */
export function registerSamples(list: Sample[]): void {
  for (const s of list) if (!SAMPLES.some((x) => x.id === s.id)) SAMPLES.push(s);
}

export { gh };
