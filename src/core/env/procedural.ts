/** Built-in test environments, generated in the app (no download needed). */
import type { Rgba, Vec3 } from "../model";
import type { EnvObject, Environment } from "./types";

const P = (xyz: Vec3, rpy: Vec3 = [0, 0, 0]) => ({ xyz, rpy });
const CONCRETE: Rgba = [0.62, 0.63, 0.65, 1];
const WOOD: Rgba = [0.62, 0.45, 0.28, 1];
const SAFETY: Rgba = [0.95, 0.72, 0.1, 1];
const STEEL: Rgba = [0.45, 0.5, 0.58, 1];
const BLUE: Rgba = [0.2, 0.42, 0.75, 1];

/** Small deterministic PRNG so generated scenes are the same every time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const box = (
  name: string,
  size: Vec3,
  xyz: Vec3,
  color: Rgba,
  rpy: Vec3 = [0, 0, 0],
): EnvObject => ({
  name,
  geometry: { type: "box", size },
  pose: P(xyz, rpy),
  color,
});

function env(
  id: string,
  name: string,
  description: string,
  objects: EnvObject[],
  extra: Partial<Environment> = {},
): Environment {
  return {
    id,
    name,
    description,
    ground: true,
    spawn: P([0, 0, 0]),
    objects,
    meshes: {},
    ...extra,
  };
}

export interface ProceduralEnv {
  id: string;
  name: string;
  description: string;
  complexity: "simple" | "moderate" | "complex";
  build(): Environment;
}

/** A heightfield as a closed triangle soup (top surface, skirt sides and a flat bottom). */
export function heightfield(
  size: number,
  cells: number,
  height: (x: number, y: number) => number,
): Float32Array {
  const out: number[] = [];
  const h = (i: number, j: number) =>
    height(-size / 2 + (i / cells) * size, -size / 2 + (j / cells) * size);
  const X = (i: number) => -size / 2 + (i / cells) * size;
  const tri = (a: Vec3, b: Vec3, c: Vec3) => out.push(...a, ...b, ...c);
  const base = -0.05;
  for (let i = 0; i < cells; i++)
    for (let j = 0; j < cells; j++) {
      const a: Vec3 = [X(i), X(j), h(i, j)];
      const b: Vec3 = [X(i + 1), X(j), h(i + 1, j)];
      const c: Vec3 = [X(i + 1), X(j + 1), h(i + 1, j + 1)];
      const d: Vec3 = [X(i), X(j + 1), h(i, j + 1)];
      tri(a, b, c);
      tri(a, c, d);
    }
  // Skirts on the four sides and the bottom, so the solid is closed.
  for (let k = 0; k < cells; k++) {
    const sides: [Vec3, Vec3][] = [
      [
        [X(k + 1), X(0), h(k + 1, 0)],
        [X(k), X(0), h(k, 0)],
      ],
      [
        [X(cells), X(k + 1), h(cells, k + 1)],
        [X(cells), X(k), h(cells, k)],
      ],
      [
        [X(k), X(cells), h(k, cells)],
        [X(k + 1), X(cells), h(k + 1, cells)],
      ],
      [
        [X(0), X(k), h(0, k)],
        [X(0), X(k + 1), h(0, k + 1)],
      ],
    ];
    for (const [p, q] of sides) {
      const pb: Vec3 = [p[0], p[1], base];
      const qb: Vec3 = [q[0], q[1], base];
      tri(p, q, qb);
      tri(p, qb, pb);
    }
  }
  const s = size / 2;
  tri([-s, -s, base], [-s, s, base], [s, s, base]);
  tri([-s, -s, base], [s, s, base], [s, -s, base]);
  return new Float32Array(out);
}

export const PROCEDURAL_ENVS: ProceduralEnv[] = [
  {
    id: "flat",
    name: "Flat ground",
    description: "An empty floor. The default.",
    complexity: "simple",
    build: () => env("flat", "Flat ground", "An empty floor.", []),
  },
  {
    id: "ramps",
    name: "Ramps",
    description: "Ramps of 5°, 10°, 15° and 20° for climbing and slipping tests.",
    complexity: "simple",
    build: () => {
      const objs: EnvObject[] = [];
      [5, 10, 15, 20].forEach((deg, i) => {
        const a = (deg * Math.PI) / 180;
        const len = 1.6;
        const y = -1.8 + i * 1.2;
        objs.push(
          box(
            `ramp_${deg}deg`,
            [len, 0.9, 0.04],
            [1.2 + (len / 2) * Math.cos(a), y, (len / 2) * Math.sin(a)],
            deg > 12 ? SAFETY : CONCRETE,
            [0, -a, 0],
          ),
        );
        objs.push(
          box(
            `landing_${deg}deg`,
            [0.8, 0.9, 0.04],
            [1.2 + len * Math.cos(a) + 0.4, y, len * Math.sin(a)],
            CONCRETE,
          ),
        );
      });
      return env("ramps", "Ramps", "5°, 10°, 15° and 20° ramps.", objs);
    },
  },
  {
    id: "stairs",
    name: "Stairs",
    description: "A flight of 8 stairs (17 cm rise, 28 cm run) with a landing, for legged robots.",
    complexity: "moderate",
    build: () => {
      const objs: EnvObject[] = [];
      const rise = 0.17;
      const run = 0.28;
      for (let i = 0; i < 8; i++) {
        const h = rise * (i + 1);
        objs.push(
          box(
            `step_${i + 1}`,
            [run, 1.2, h],
            [1 + run * i + run / 2, 0, h / 2],
            i % 2 ? CONCRETE : [0.58, 0.59, 0.61, 1],
          ),
        );
      }
      objs.push(
        box("landing", [1.2, 1.2, rise * 8], [1 + run * 8 + 0.6, 0, (rise * 8) / 2], CONCRETE),
      );
      return env("stairs", "Stairs", "8 steps, 17 cm rise, 28 cm run.", objs);
    },
  },
  {
    id: "obstacles",
    name: "Obstacle course",
    description: "Scattered boxes, bumps, a gap and a narrow passage for navigation tests.",
    complexity: "moderate",
    build: () => {
      const r = rng(7);
      const objs: EnvObject[] = [];
      for (let i = 0; i < 18; i++) {
        const s = 0.15 + r() * 0.35;
        const x = 1 + r() * 6;
        const y = -3 + r() * 6;
        if (Math.hypot(x, y) < 1.2) continue;
        objs.push(
          box(
            `crate_${i}`,
            [s, s, s * (0.6 + r())],
            [x, y, (s * (0.6 + r())) / 2],
            i % 3 ? WOOD : BLUE,
            [0, 0, r() * Math.PI],
          ),
        );
      }
      for (let i = 0; i < 6; i++)
        objs.push({
          name: `bump_${i}`,
          geometry: { type: "cylinder", radius: 0.03, length: 2 },
          pose: P([2 + i * 0.35, -4.5, 0.015], [Math.PI / 2, 0, 0]),
          color: SAFETY,
        });
      objs.push(box("wall_a", [3, 0.1, 0.5], [3, 4, 0.25], STEEL));
      objs.push(box("wall_b", [3, 0.1, 0.5], [3, 4.7, 0.25], STEEL));
      return env("obstacles", "Obstacle course", "Crates, bumps and a narrow passage.", objs);
    },
  },
  {
    id: "rough",
    name: "Rough terrain",
    description: "8 × 8 m of rolling bumps up to 15 cm, for suspension and legged locomotion.",
    complexity: "moderate",
    build: () => {
      const terrain = heightfield(8, 64, (x, y) => {
        const d = Math.hypot(x, y);
        const flat = Math.min(1, Math.max(0, (d - 0.8) / 0.8));
        return (
          flat *
          (0.06 * Math.sin(x * 2.1) * Math.cos(y * 1.7) + 0.04 * Math.sin(x * 5.3 + y * 3.1) + 0.05)
        );
      });
      return env(
        "rough",
        "Rough terrain",
        "Rolling bumps up to 15 cm.",
        [
          {
            name: "terrain",
            geometry: { type: "mesh", mesh: "terrain" },
            pose: P([0, 0, 0]),
            color: [0.42, 0.5, 0.33, 1],
          },
        ],
        {
          meshes: { terrain },
        },
      );
    },
  },
  {
    id: "maze",
    name: "Maze",
    description: "A 6 × 6 m maze with 1 m corridors for mapping and navigation.",
    complexity: "moderate",
    build: () => {
      const r = rng(42);
      const n = 6;
      const objs: EnvObject[] = [];
      const wall = (x: number, y: number, horizontal: boolean, k: number) =>
        objs.push(
          box(
            `wall_${k}`,
            horizontal ? [1.05, 0.06, 0.4] : [0.06, 1.05, 0.4],
            [x, y, 0.2],
            [0.85, 0.85, 0.82, 1],
          ),
        );
      // Recursive backtracker over an n x n grid starting at the robot's cell.
      const seen = new Set<string>();
      const open = new Set<string>();
      const stack: [number, number][] = [[0, 0]];
      seen.add("0,0");
      while (stack.length) {
        const [cx, cy] = stack[stack.length - 1];
        const next = (
          [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const
        )
          .map(([dx, dy]) => [cx + dx, cy + dy] as [number, number])
          .filter(([x, y]) => x >= 0 && y >= 0 && x < n && y < n && !seen.has(`${x},${y}`));
        if (!next.length) {
          stack.pop();
          continue;
        }
        const [nx, ny] = next[Math.floor(r() * next.length)];
        open.add([cx, cy, nx, ny].join(","));
        open.add([nx, ny, cx, cy].join(","));
        seen.add(`${nx},${ny}`);
        stack.push([nx, ny]);
      }
      const ox = -0.5;
      const oy = -0.5;
      let k = 0;
      for (let x = 0; x < n; x++)
        for (let y = 0; y < n; y++) {
          if (!open.has([x, y, x + 1, y].join(","))) wall(ox + x + 1, oy + y + 0.5, false, k++);
          if (!open.has([x, y, x, y + 1].join(","))) wall(ox + x + 0.5, oy + y + 1, true, k++);
          if (x === 0) wall(ox, oy + y + 0.5, false, k++);
          if (y === 0) wall(ox + x + 0.5, oy, true, k++);
        }
      return env("maze", "Maze", "6 × 6 m, 1 m corridors.", objs);
    },
  },
  {
    id: "warehouse",
    name: "Warehouse aisle",
    description: "Pallet racks, pallets, boxes and a loading ramp: a mobile manipulation scene.",
    complexity: "complex",
    build: () => {
      const r = rng(3);
      const objs: EnvObject[] = [];
      for (const side of [-1, 1])
        for (let i = 0; i < 4; i++) {
          const x = 1.5 + i * 2.2;
          const y = side * 2;
          for (const [dx, dy] of [
            [-1, -0.45],
            [1, -0.45],
            [-1, 0.45],
            [1, 0.45],
          ])
            objs.push(
              box(
                `upright_${side}_${i}_${dx}_${dy}`,
                [0.08, 0.08, 2.4],
                [x + dx, y + dy, 1.2],
                [0.15, 0.3, 0.65, 1],
              ),
            );
          for (const z of [0.15, 0.9, 1.65])
            objs.push(box(`shelf_${side}_${i}_${z}`, [2.1, 1, 0.04], [x, y, z], SAFETY));
          for (const z of [0.17, 0.92, 1.67])
            for (let b = 0; b < 3; b++)
              if (r() > 0.3) {
                const s = 0.3 + r() * 0.25;
                objs.push(
                  box(
                    `box_${side}_${i}_${z}_${b}`,
                    [s, s, s],
                    [x - 0.65 + b * 0.65, y, z + s / 2 + 0.02],
                    [0.72, 0.56, 0.36, 1],
                    [0, 0, (r() - 0.5) * 0.4],
                  ),
                );
              }
        }
      for (let i = 0; i < 3; i++)
        objs.push(box(`pallet_${i}`, [1.2, 0.8, 0.14], [2 + i * 2.5, 0, 0.07], WOOD));
      objs.push(box("loading_ramp", [2, 1.5, 0.05], [11, 0, 0.3], CONCRETE, [0, -0.3, 0]));
      objs.push(box("floor_marking_l", [10, 0.08, 0.002], [5.5, -1.2, 0.001], SAFETY));
      objs.push(box("floor_marking_r", [10, 0.08, 0.002], [5.5, 1.2, 0.001], SAFETY));
      return env("warehouse", "Warehouse aisle", "Racks, pallets and boxes.", objs);
    },
  },
  {
    id: "tabletop",
    name: "Table top",
    description:
      "A table with blocks, cylinders and a bin, for arms and grippers. Mount the arm at the table edge.",
    complexity: "simple",
    build: () => {
      const objs: EnvObject[] = [box("table_top", [1.2, 0.8, 0.04], [0.45, 0, 0.73], WOOD)];
      for (const [x, y] of [
        [-0.1, -0.35],
        [-0.1, 0.35],
        [1, -0.35],
        [1, 0.35],
      ])
        objs.push(box(`table_leg_${x}_${y}`, [0.05, 0.05, 0.71], [x, y, 0.355], STEEL));
      const colors: Rgba[] = [
        [0.85, 0.2, 0.2, 1],
        [0.2, 0.7, 0.3, 1],
        [0.2, 0.4, 0.85, 1],
        [0.95, 0.75, 0.1, 1],
      ];
      colors.forEach((c, i) =>
        objs.push(box(`block_${i}`, [0.05, 0.05, 0.05], [0.35 + i * 0.1, -0.15, 0.775], c)),
      );
      objs.push({
        name: "can",
        geometry: { type: "cylinder", radius: 0.033, length: 0.12 },
        pose: P([0.55, 0.15, 0.81]),
        color: [0.75, 0.75, 0.8, 1],
      });
      objs.push({
        name: "ball",
        geometry: { type: "sphere", radius: 0.035 },
        pose: P([0.7, 0.05, 0.785]),
        color: colors[0],
      });
      objs.push(box("bin_floor", [0.25, 0.2, 0.01], [0.8, 0.2, 0.755], BLUE));
      objs.push(box("bin_wall_a", [0.25, 0.01, 0.08], [0.8, 0.1, 0.79], BLUE));
      objs.push(box("bin_wall_b", [0.25, 0.01, 0.08], [0.8, 0.3, 0.79], BLUE));
      objs.push(box("bin_wall_c", [0.01, 0.2, 0.08], [0.675, 0.2, 0.79], BLUE));
      objs.push(box("bin_wall_d", [0.01, 0.2, 0.08], [0.925, 0.2, 0.79], BLUE));
      return env("tabletop", "Table top", "Table with blocks and a bin.", objs, {
        spawn: P([0, 0, 0.75]),
      });
    },
  },
];
