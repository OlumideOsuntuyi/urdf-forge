/**
 * The built-in parametric component library.
 *
 * Conventions: REP 103 (Z up, metres, kilograms, radians). Unless a description says otherwise a
 * part sits on its attach frame (its underside at z = 0); pure shapes are centred on it, wheels
 * put their axle (local Y) through it and sensors put their optical / scan frame where the
 * simulator expects it (cameras look along +X).
 */
import type { Pose, Rgba, SimDrive, Vec3 } from "../model";
import type {
  ParamSpec,
  Params,
  PartGeometry,
  PartJoint,
  PartLink,
  PartShape,
  PartTemplate,
} from "./types";
import * as G from "./geometry";

// ------------------------------------------------------------------ small helpers

function hex(h: string, a = 1): Rgba {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
}

const C = {
  black: hex("#1c1c1e"),
  darkGrey: hex("#2f3238"),
  grey: hex("#6b7078"),
  alu: hex("#c8ccd2"),
  steel: hex("#9ea3a9"),
  silver: hex("#b9bec5"),
  brass: hex("#c9a74a"),
  rubber: hex("#232325"),
  pcbGreen: hex("#1f6f3a"),
  pcbTeal: hex("#00878f"),
  pcbRed: hex("#a3221c"),
  pcbBlue: hex("#1d4f9c"),
  pcbBlack: hex("#18191b"),
  servoBlue: hex("#2c63c9"),
  dxlBlue: hex("#1e4b9b"),
  white: hex("#ececec"),
  orange: hex("#e07a1f"),
  yellow: hex("#e8c21a"),
  terminalBlue: hex("#2f6fd6"),
  lipo: hex("#27344f"),
  glass: hex("#101418", 0.9),
  acrylic: hex("#202226"),
};

const pose = (xyz: Vec3 = [0, 0, 0], rpy: Vec3 = [0, 0, 0]): Pose => ({ xyz, rpy });
/** Turns a Z-aligned primitive so it lies along X. */
const ALONG_X: Vec3 = [0, Math.PI / 2, 0];
/** Turns a Z-aligned primitive so it lies along Y. */
const ALONG_Y: Vec3 = [Math.PI / 2, 0, 0];

function shape(
  geometry: PartGeometry,
  color: Rgba,
  xyz: Vec3 = [0, 0, 0],
  rpy: Vec3 = [0, 0, 0],
  name?: string,
): PartShape {
  return { geometry, origin: pose(xyz, rpy), color, ...(name ? { name } : {}) };
}
const boxV = (size: Vec3, color: Rgba, xyz?: Vec3, rpy?: Vec3, name?: string) =>
  shape({ type: "box", size }, color, xyz, rpy, name);
const cylV = (radius: number, length: number, color: Rgba, xyz?: Vec3, rpy?: Vec3, name?: string) =>
  shape({ type: "cylinder", radius, length }, color, xyz, rpy, name);
const sphV = (radius: number, color: Rgba, xyz?: Vec3, name?: string) =>
  shape({ type: "sphere", radius }, color, xyz, undefined, name);
const meshV = (positions: Float32Array, color: Rgba, name: string, xyz?: Vec3, rpy?: Vec3) =>
  shape({ type: "mesh", positions }, color, xyz, rpy, name);

/** Box soup with its underside at zBottom, centred on (x, y). */
const boxAt = (sx: number, sy: number, sz: number, x: number, y: number, zBottom: number) =>
  G.translate(G.box(sx, sy, sz), x, y, zBottom + sz / 2);
/** Z-aligned cylinder soup with its underside at zBottom. */
const cylAt = (r: number, h: number, x: number, y: number, zBottom: number, seg = 20) =>
  G.translate(G.cylinder(r, h, seg), x, y, zBottom + h / 2);

const num = (p: Params, k: string): number => {
  const v = p[k];
  return typeof v === "number" ? v : Number(v);
};
const int = (p: Params, k: string): number => Math.round(num(p, k));
const str = (p: Params, k: string): string => String(p[k]);
const bool = (p: Params, k: string): boolean => p[k] === true || p[k] === "true";
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const len = (
  key: string,
  label: string,
  def: number,
  min: number,
  max: number,
  hint?: string,
): ParamSpec => ({
  key,
  label,
  kind: "length",
  default: def,
  min,
  max,
  ...(hint ? { hint } : {}),
});
const ang = (
  key: string,
  label: string,
  def: number,
  min: number,
  max: number,
  hint?: string,
): ParamSpec => ({
  key,
  label,
  kind: "angle",
  default: def,
  min,
  max,
  ...(hint ? { hint } : {}),
});
const nump = (
  key: string,
  label: string,
  def: number,
  min: number,
  max: number,
  hint?: string,
): ParamSpec => ({
  key,
  label,
  kind: "number",
  default: def,
  min,
  max,
  ...(hint ? { hint } : {}),
});
const intp = (
  key: string,
  label: string,
  def: number,
  min: number,
  max: number,
  hint?: string,
): ParamSpec => ({
  key,
  label,
  kind: "int",
  default: def,
  min,
  max,
  ...(hint ? { hint } : {}),
});
const choice = (
  key: string,
  label: string,
  def: string,
  choices: [string, string][],
): ParamSpec => ({
  key,
  label,
  kind: "choice",
  default: def,
  choices: choices.map(([value, l]) => ({ value, label: l })),
});
const boolp = (key: string, label: string, def: boolean): ParamSpec => ({
  key,
  label,
  kind: "bool",
  default: def,
});

const servoDrive = (): SimDrive => ({ mode: "servo", target: 0, sweep: false });
const wheelDrive = (target: number): SimDrive => ({ mode: "wheel", target, sweep: false });
const passive = (): SimDrive => ({ mode: "none", target: 0, sweep: false });

const rev = (
  axis: Vec3,
  lower: number,
  upper: number,
  effort: number,
  velocity: number,
): PartJoint => ({
  type: "revolute",
  axis,
  lower,
  upper,
  effort,
  velocity,
  damping: 0.05,
  friction: 0,
});
const cont = (axis: Vec3, effort: number, velocity: number, damping = 0.01): PartJoint => ({
  type: "continuous",
  axis,
  effort,
  velocity,
  damping,
  friction: 0,
});
const pris = (
  axis: Vec3,
  lower: number,
  upper: number,
  effort: number,
  velocity: number,
): PartJoint => ({
  type: "prismatic",
  axis,
  lower,
  upper,
  effort,
  velocity,
  damping: 0.5,
  friction: 0,
});

function link(
  key: string,
  parent: string | null,
  origin: Pose,
  visuals: PartShape[],
  extra: Partial<PartLink> = {},
): PartLink {
  return { key, name: key, parent, origin, visuals, ...extra };
}

/** Explicit cylinder collision for a wheel whose axle is local Y. */
const wheelCollision = (radius: number, width: number): PartShape[] => [
  cylV(radius, width, C.rubber, [0, 0, 0], ALONG_Y),
];

// ------------------------------------------------------------------ shared builders

interface ServoSpec {
  body: Vec3;
  tabLength: number;
  tabZ: number;
  tabT: number;
  bossR: number;
  bossH: number;
  shaftOffset: number;
  hornHubR: number;
  hornHubH: number;
  hornLength: number;
  hornWidth: number;
  bodyColor: Rgba;
  hornColor: Rgba;
  bodyMass: number;
  hornMass: number;
  effort: number;
  velocity: number;
  range: number;
}

/** Hobby-servo shaped actuator: body on the attach frame, horn on a revolute Z joint. */
function servoLinks(s: ServoSpec, prefix = ""): PartLink[] {
  const [bx, by, bz] = s.body;
  const body = link(
    `${prefix}servo_body`,
    null,
    pose(),
    [
      boxV([bx, by, bz], s.bodyColor, [0, 0, bz / 2], undefined, "case"),
      boxV([s.tabLength, by, s.tabT], s.bodyColor, [0, 0, s.tabZ + s.tabT / 2], undefined, "tabs"),
      cylV(s.bossR, s.bossH, s.bodyColor, [s.shaftOffset, 0, bz + s.bossH / 2], undefined, "boss"),
    ],
    { mass: s.bodyMass },
  );
  const hornArm = Math.max(s.hornLength, s.hornHubR * 2);
  const horn = link(
    `${prefix}servo_horn`,
    body.key,
    pose([s.shaftOffset, 0, bz + s.bossH]),
    [
      cylV(s.hornHubR, s.hornHubH, s.hornColor, [0, 0, s.hornHubH / 2], undefined, "hub"),
      boxV(
        [hornArm, s.hornWidth, s.hornHubH * 0.4],
        s.hornColor,
        [0, 0, s.hornHubH * 0.8],
        undefined,
        "arm",
      ),
    ],
    {
      joint: rev([0, 0, 1], -s.range, s.range, s.effort, s.velocity),
      drive: servoDrive(),
      mass: s.hornMass,
      collisions: "box",
    },
  );
  return [body, horn];
}

/** Rubber-tyred wheel link on a continuous joint about local Y. */
function wheelLink(
  key: string,
  parent: string | null,
  xyz: Vec3,
  radius: number,
  width: number,
  speed: number,
  effort = 2,
): PartLink {
  const rim = Math.max(radius * 0.66, 0.004);
  return link(
    key,
    parent,
    pose(xyz),
    [
      meshV(G.tyreWheel(radius, width), C.rubber, `${key}_tyre`, [0, 0, 0], ALONG_Y),
      cylV(rim, width * 0.72, C.alu, [0, 0, 0], ALONG_Y, "rim"),
    ],
    {
      joint: cont([0, 1, 0], effort, 30),
      drive: wheelDrive(speed),
      collisions: wheelCollision(radius, width),
      mass: 550 * Math.PI * radius * radius * width + 0.005,
    },
  );
}

/** Swivel caster hanging below its attach frame: mount plate, fork (swivel Z), wheel (Y). */
function casterLinks(
  prefix: string,
  parent: string | null,
  xyz: Vec3,
  wheelR: number,
  wheelW: number,
  trail: number,
): PartLink[] {
  const t = 0.003;
  const plate = Math.max(0.03, wheelR * 1.6);
  const drop = wheelR + 0.008;
  const legY = wheelW / 2 + 0.002;
  const mount = link(
    `${prefix}caster_mount`,
    parent,
    pose(xyz),
    [boxV([plate, plate, t], C.steel, [0, 0, -t / 2], undefined, "plate")],
    { mass: 0.01 + 40 * wheelR * wheelR },
  );
  const forkLen = drop + wheelR * 0.25 - t;
  const swivel = link(
    `${prefix}caster_swivel`,
    mount.key,
    pose([0, 0, -t]),
    [
      boxV(
        [trail + 0.016, wheelW + 0.01, t],
        C.steel,
        [-trail / 2, 0, -t / 2],
        undefined,
        "fork_top",
      ),
      boxV(
        [0.006, 0.002, forkLen],
        C.steel,
        [-trail, legY + 0.001, -t - forkLen / 2],
        undefined,
        "leg_l",
      ),
      boxV(
        [0.006, 0.002, forkLen],
        C.steel,
        [-trail, -legY - 0.001, -t - forkLen / 2],
        undefined,
        "leg_r",
      ),
    ],
    { joint: cont([0, 0, 1], 1, 20, 0.002), drive: passive(), mass: 0.01 + 30 * wheelR * wheelR },
  );
  const wheel = link(
    `${prefix}caster_wheel`,
    swivel.key,
    pose([-trail, 0, -drop]),
    [
      cylV(wheelR, wheelW, C.black, [0, 0, 0], ALONG_Y, "tyre"),
      cylV(wheelR * 0.4, wheelW + 0.002, C.steel, [0, 0, 0], ALONG_Y, "hub"),
    ],
    {
      joint: cont([0, 1, 0], 1, 50, 0.002),
      drive: passive(),
      collisions: wheelCollision(wheelR, wheelW),
      mass: 900 * Math.PI * wheelR * wheelR * wheelW,
    },
  );
  return [mount, swivel, wheel];
}
const casterHeight = (wheelR: number) => 0.003 + wheelR + 0.008 + wheelR;

// ------------------------------------------------------------------ Shapes

const shapes: PartTemplate[] = [
  {
    id: "shape_box",
    name: "Box",
    category: "Shapes",
    description: "Solid box centred on the attach frame.",
    tags: ["primitive", "cuboid"],
    params: [
      len("x", "Size X", 0.1, 0.001, 2),
      len("y", "Size Y", 0.1, 0.001, 2),
      len("z", "Size Z", 0.1, 0.001, 2),
    ],
    build: (p) => [
      link("box", null, pose(), [boxV([num(p, "x"), num(p, "y"), num(p, "z")], C.grey)], {
        collisions: "same",
      }),
    ],
  },
  {
    id: "shape_cylinder",
    name: "Cylinder",
    category: "Shapes",
    description: "Solid cylinder along Z, centred.",
    tags: ["primitive", "rod"],
    params: [len("radius", "Radius", 0.05, 0.001, 1), len("length", "Length", 0.1, 0.001, 2)],
    build: (p) => [
      link("cylinder", null, pose(), [cylV(num(p, "radius"), num(p, "length"), C.grey)], {
        collisions: "same",
      }),
    ],
  },
  {
    id: "shape_sphere",
    name: "Sphere",
    category: "Shapes",
    description: "Solid sphere centred on the attach frame.",
    tags: ["primitive", "ball"],
    params: [len("radius", "Radius", 0.05, 0.001, 1)],
    build: (p) => [
      link("sphere", null, pose(), [sphV(num(p, "radius"), C.grey)], { collisions: "same" }),
    ],
  },
  {
    id: "shape_cone",
    name: "Cone",
    category: "Shapes",
    description: "Cone along Z with its base at -h/2 and apex at +h/2.",
    tags: ["mesh"],
    params: [len("radius", "Base radius", 0.05, 0.002, 1), len("height", "Height", 0.1, 0.002, 2)],
    build: (p) => [
      link(
        "cone",
        null,
        pose(),
        [meshV(G.cone(num(p, "radius"), num(p, "height"), 40), C.grey, "cone")],
        {
          collisions: "hull",
        },
      ),
    ],
  },
  {
    id: "shape_capsule",
    name: "Capsule",
    category: "Shapes",
    description: "Cylinder with hemispherical ends along Z; length is overall.",
    tags: ["mesh", "pill"],
    params: [
      len("radius", "Radius", 0.03, 0.002, 0.5),
      len("length", "Overall length", 0.15, 0.004, 2),
    ],
    build: (p) => {
      const r = num(p, "radius");
      const l = Math.max(num(p, "length"), 2 * r);
      return [
        link("capsule", null, pose(), [meshV(G.capsule(r, l, 32), C.grey, "capsule")], {
          collisions: "hull",
        }),
      ];
    },
  },
  {
    id: "shape_tube",
    name: "Tube",
    category: "Shapes",
    description: "Hollow round tube along Z, centred.",
    tags: ["mesh", "pipe"],
    params: [
      len("outer_radius", "Outer radius", 0.02, 0.002, 0.5),
      len("wall", "Wall thickness", 0.002, 0.0003, 0.1),
      len("length", "Length", 0.2, 0.002, 3),
    ],
    build: (p) => {
      const ro = num(p, "outer_radius");
      const ri = Math.max(ro - num(p, "wall"), 0);
      return [
        link("tube", null, pose(), [meshV(G.tube(ro, ri, num(p, "length"), 40), C.alu, "tube")], {
          collisions: "same",
          density: 2700,
        }),
      ];
    },
  },
  {
    id: "shape_torus",
    name: "Torus",
    category: "Shapes",
    description: "Ring about the Z axis.",
    tags: ["mesh", "ring", "o-ring"],
    params: [
      len("ring_radius", "Ring radius", 0.05, 0.003, 1),
      len("tube_radius", "Tube radius", 0.01, 0.001, 0.3),
    ],
    build: (p) => [
      link(
        "torus",
        null,
        pose(),
        [meshV(G.torus(num(p, "ring_radius"), num(p, "tube_radius"), 16, 40), C.grey, "torus")],
        { collisions: "same" },
      ),
    ],
  },
  {
    id: "shape_wedge",
    name: "Wedge / ramp",
    category: "Shapes",
    description: "Right-triangle prism: length along X, rising to full height at -X.",
    tags: ["mesh", "ramp", "triangle"],
    params: [
      len("length", "Length (X)", 0.2, 0.002, 2),
      len("width", "Width (Y)", 0.1, 0.002, 2),
      len("height", "Height (Z)", 0.05, 0.002, 2),
    ],
    build: (p) => [
      link(
        "wedge",
        null,
        pose(),
        [meshV(G.wedge(num(p, "length"), num(p, "width"), num(p, "height")), C.grey, "wedge")],
        { collisions: "hull" },
      ),
    ],
  },
  {
    id: "shape_rounded_box",
    name: "Rounded box",
    category: "Shapes",
    description: "Box with filleted edges and corners, centred.",
    tags: ["mesh", "fillet", "enclosure"],
    params: [
      len("x", "Size X", 0.12, 0.002, 2),
      len("y", "Size Y", 0.08, 0.002, 2),
      len("z", "Size Z", 0.05, 0.002, 2),
      len("radius", "Edge radius", 0.008, 0, 0.5),
    ],
    build: (p) => [
      link(
        "rounded_box",
        null,
        pose(),
        [
          meshV(
            G.roundedBox(num(p, "x"), num(p, "y"), num(p, "z"), num(p, "radius"), 4),
            C.grey,
            "rounded_box",
          ),
        ],
        { collisions: "hull" },
      ),
    ],
  },
  {
    id: "shape_hex_prism",
    name: "Hexagonal prism",
    category: "Shapes",
    description: "Six-sided prism along Z, centred; size is across flats.",
    tags: ["mesh", "hex", "nut"],
    params: [
      len("across_flats", "Across flats", 0.03, 0.001, 1),
      len("length", "Length", 0.05, 0.001, 2),
    ],
    build: (p) => [
      link(
        "hex_prism",
        null,
        pose(),
        [meshV(G.prism(6, num(p, "across_flats"), num(p, "length")), C.grey, "hex_prism")],
        { collisions: "hull" },
      ),
    ],
  },
  {
    id: "shape_perforated_plate",
    name: "Plate with hole grid",
    category: "Shapes",
    description: "Flat plate with a regular grid of through-holes, centred, thickness along Z.",
    tags: ["mesh", "perforated", "breadboard"],
    params: [
      len("width", "Width (X)", 0.15, 0.01, 1),
      len("depth", "Depth (Y)", 0.1, 0.01, 1),
      len("thickness", "Thickness", 0.003, 0.0005, 0.03),
      len("hole_diameter", "Hole diameter", 0.0032, 0.001, 0.02),
      len("spacing", "Hole spacing", 0.01, 0.003, 0.1),
    ],
    build: (p) => {
      const w = num(p, "width");
      const d = num(p, "depth");
      const holes = G.holeGrid(w, d, num(p, "spacing"), num(p, "hole_diameter"));
      return [
        link(
          "perforated_plate",
          null,
          pose(),
          [
            meshV(
              G.plateWithHoles(w, d, num(p, "thickness"), holes, 12),
              C.alu,
              "perforated_plate",
            ),
          ],
          { collisions: "box", density: 2700 },
        ),
      ];
    },
  },
  {
    id: "shape_l_bracket",
    name: "L-bracket",
    category: "Shapes",
    description: "Angle bracket: one leg along +X, the other up +Z; width along Y.",
    tags: ["mesh", "angle", "bracket"],
    params: [
      len("leg_x", "Leg X", 0.03, 0.004, 0.5),
      len("leg_z", "Leg Z", 0.03, 0.004, 0.5),
      len("thickness", "Thickness", 0.003, 0.0005, 0.02),
      len("width", "Width (Y)", 0.02, 0.003, 0.5),
    ],
    build: (p) => [
      link(
        "l_bracket",
        null,
        pose(),
        [
          meshV(
            G.lBracket(num(p, "leg_x"), num(p, "leg_z"), num(p, "thickness"), num(p, "width")),
            C.alu,
            "l_bracket",
          ),
        ],
        { collisions: "same", density: 2700 },
      ),
    ],
  },
  {
    id: "shape_u_bracket",
    name: "U-bracket",
    category: "Shapes",
    description: "Channel opening upward: base along X, two walls up +Z; width along Y.",
    tags: ["mesh", "channel", "servo bracket"],
    params: [
      len("span", "Span (X)", 0.03, 0.006, 0.5),
      len("height", "Wall height", 0.03, 0.004, 0.5),
      len("thickness", "Thickness", 0.002, 0.0005, 0.02),
      len("width", "Width (Y)", 0.02, 0.003, 0.5),
    ],
    build: (p) => [
      link(
        "u_bracket",
        null,
        pose(),
        [
          meshV(
            G.uBracket(num(p, "span"), num(p, "height"), num(p, "thickness"), num(p, "width")),
            C.alu,
            "u_bracket",
          ),
        ],
        { collisions: "same", density: 2700 },
      ),
    ],
  },
  {
    id: "shape_spur_gear",
    name: "Spur gear",
    category: "Shapes",
    description: "Involute spur gear (20 degree pressure angle) along Z, centred, with a bore.",
    tags: ["mesh", "gear", "transmission"],
    params: [
      len("module", "Module", 0.001, 0.0003, 0.008, "Pitch diameter = module x teeth"),
      intp("teeth", "Teeth", 24, 8, 100),
      len("width", "Face width", 0.006, 0.001, 0.1),
      len("bore", "Bore diameter", 0.005, 0, 0.05),
    ],
    build: (p) => [
      link(
        "spur_gear",
        null,
        pose(),
        [
          meshV(
            G.spurGear(num(p, "module"), int(p, "teeth"), num(p, "width"), num(p, "bore")),
            C.white,
            "spur_gear",
          ),
        ],
        { collisions: "cylinder", density: 1150 },
      ),
    ],
  },
];

// ------------------------------------------------------------------ Structure

function extrusionTemplate(series: 20 | 40): PartTemplate {
  return {
    id: `struct_extrusion_20${series === 20 ? "20" : "40"}`,
    name: `Aluminium extrusion 20${series === 20 ? "20" : "40"}`,
    category: "Structure",
    description: `20x${series} mm T-slot profile (6 mm slot) standing along +Z from the attach frame.`,
    tags: ["v-slot", "t-slot", "aluminium", "frame"],
    params: [len("length", "Length", 0.3, 0.01, 3)],
    build: (p) => {
      const l = num(p, "length");
      return [
        link(
          `extrusion_20${series === 20 ? "20" : "40"}`,
          null,
          pose(),
          [meshV(G.extrusionProfile2020(l, series), C.alu, `extrusion_20${series}`, [0, 0, l / 2])],
          { collisions: "box", mass: (series === 20 ? 0.5 : 0.9) * l },
        ),
      ];
    },
  };
}

const structure: PartTemplate[] = [
  extrusionTemplate(20),
  extrusionTemplate(40),
  {
    id: "struct_flat_plate",
    name: "Flat plate",
    category: "Structure",
    description: "Aluminium plate lying on the attach frame, with optional corner or grid holes.",
    tags: ["sheet", "mounting plate", "aluminium"],
    params: [
      len("width", "Width (X)", 0.2, 0.01, 2),
      len("depth", "Depth (Y)", 0.15, 0.01, 2),
      len("thickness", "Thickness", 0.003, 0.0005, 0.05),
      choice("holes", "Holes", "corners", [
        ["none", "None"],
        ["corners", "Four corners"],
        ["grid", "Grid"],
      ]),
      len("hole_diameter", "Hole diameter", 0.0034, 0.001, 0.02),
      len("spacing", "Grid spacing / corner inset", 0.025, 0.004, 0.2),
    ],
    build: (p) => {
      const w = num(p, "width");
      const d = num(p, "depth");
      const t = num(p, "thickness");
      const dia = num(p, "hole_diameter");
      const r = dia / 2;
      const mode = str(p, "holes");
      let holes: { x: number; y: number; r: number }[] = [];
      if (mode === "grid") holes = G.holeGrid(w, d, num(p, "spacing"), dia);
      else if (mode === "corners") {
        const inset = Math.max(Math.min(num(p, "spacing") / 2, w / 2, d / 2), r + 0.001);
        if (w / 2 - inset >= r + 0.0005 && d / 2 - inset >= r + 0.0005)
          for (const sx of [-1, 1])
            for (const sy of [-1, 1])
              holes.push({ x: sx * (w / 2 - inset), y: sy * (d / 2 - inset), r });
      }
      const visual = holes.length
        ? meshV(G.plateWithHoles(w, d, t, holes, 16), C.alu, "plate", [0, 0, t / 2])
        : boxV([w, d, t], C.alu, [0, 0, t / 2], undefined, "plate");
      return [link("plate", null, pose(), [visual], { collisions: "box", density: 2700 })];
    },
  },
  {
    id: "struct_standoff",
    name: "Hex standoff",
    category: "Structure",
    description: "Brass hex spacer with a threaded bore, standing on the attach frame.",
    tags: ["spacer", "m3", "brass"],
    params: [
      len("length", "Length", 0.02, 0.003, 0.15),
      len("across_flats", "Across flats", 0.0055, 0.003, 0.02),
      len("bore", "Bore diameter", 0.0025, 0.001, 0.012),
    ],
    build: (p) => {
      const l = num(p, "length");
      const af = num(p, "across_flats");
      const rc = af / 2 / Math.cos(Math.PI / 6);
      const hexLoop = G.circleLoop(0, 0, rc, 6);
      const bore = Math.min(num(p, "bore"), af * 0.7);
      const soup = G.extrudeLoops(hexLoop, [G.circleLoop(0, 0, bore / 2, 16)], l);
      return [
        link("standoff", null, pose(), [meshV(soup, C.brass, "standoff")], {
          collisions: "cylinder",
          density: 8500,
        }),
      ];
    },
  },
  {
    id: "struct_corner_bracket",
    name: "Corner bracket",
    category: "Structure",
    description: "Cast triangular corner bracket for 20-series extrusion; legs along +X and +Z.",
    tags: ["gusset", "angle", "extrusion"],
    params: [
      len("leg", "Leg length", 0.02, 0.008, 0.1),
      len("thickness", "Wall thickness", 0.003, 0.001, 0.01),
      len("width", "Width (Y)", 0.02, 0.005, 0.08),
    ],
    build: (p) => [
      link(
        "corner_bracket",
        null,
        pose(),
        [
          meshV(
            G.cornerBracket(num(p, "leg"), num(p, "thickness"), num(p, "width")),
            C.alu,
            "corner_bracket",
          ),
        ],
        { collisions: "hull", density: 2700 },
      ),
    ],
  },
  {
    id: "struct_tube_frame",
    name: "Tube frame",
    category: "Structure",
    description: "Rectangle of four round tubes lying on the attach frame (one welded link).",
    tags: ["frame", "chassis", "tube"],
    params: [
      len("width", "Width (X, centre to centre)", 0.4, 0.05, 3),
      len("depth", "Depth (Y, centre to centre)", 0.3, 0.05, 3),
      len("tube_radius", "Tube outer radius", 0.01, 0.003, 0.05),
      len("wall", "Wall thickness", 0.0015, 0.0005, 0.01),
    ],
    build: (p) => {
      const w = num(p, "width");
      const d = num(p, "depth");
      const r = Math.min(num(p, "tube_radius"), w / 4, d / 4);
      const ri = Math.max(r - num(p, "wall"), 0);
      const long = G.tube(r, ri, w + 2 * r, 24);
      const short = G.tube(r, ri, Math.max(d - r, r), 24);
      const soup = G.merge(
        G.transform(long, { xyz: [0, d / 2, r], rpy: ALONG_X }),
        G.transform(long, { xyz: [0, -d / 2, r], rpy: ALONG_X }),
        G.transform(short, { xyz: [w / 2, 0, r], rpy: ALONG_Y }),
        G.transform(short, { xyz: [-w / 2, 0, r], rpy: ALONG_Y }),
      );
      return [
        link("tube_frame", null, pose(), [meshV(soup, C.steel, "tube_frame")], {
          collisions: "box",
          mass: 7850 * Math.PI * (r * r - ri * ri) * (2 * (w + 2 * r) + 2 * Math.max(d - r, r)),
        }),
      ];
    },
  },
  {
    id: "struct_chassis_plate",
    name: "Two-deck chassis plate",
    category: "Structure",
    description:
      "Two acrylic decks joined by four standoffs, as one link sitting on the attach frame.",
    tags: ["chassis", "deck", "acrylic", "standoff"],
    params: [
      len("length", "Length (X)", 0.25, 0.05, 1),
      len("width", "Width (Y)", 0.18, 0.04, 1),
      len("thickness", "Deck thickness", 0.004, 0.001, 0.02),
      len("gap", "Deck gap", 0.04, 0.005, 0.3),
      len("standoff_radius", "Standoff radius", 0.003, 0.0015, 0.015),
      len("inset", "Standoff inset", 0.012, 0.004, 0.1),
    ],
    build: (p) => {
      const l = num(p, "length");
      const w = num(p, "width");
      const t = num(p, "thickness");
      const g = num(p, "gap");
      const sr = num(p, "standoff_radius");
      const inset = clamp(num(p, "inset"), sr + 0.001, Math.min(l, w) / 2 - sr);
      const visuals: PartShape[] = [
        boxV([l, w, t], C.acrylic, [0, 0, t / 2], undefined, "lower_deck"),
        boxV([l, w, t], C.acrylic, [0, 0, t + g + t / 2], undefined, "upper_deck"),
      ];
      for (const sx of [-1, 1])
        for (const sy of [-1, 1])
          visuals.push(
            cylV(
              sr,
              g,
              C.brass,
              [sx * (l / 2 - inset), sy * (w / 2 - inset), t + g / 2],
              undefined,
              "standoff",
            ),
          );
      return [link("chassis", null, pose(), visuals, { collisions: "box", density: 1190 })];
    },
  },
];

// ------------------------------------------------------------------ Actuators

const actuators: PartTemplate[] = [
  {
    id: "act_servo_sg90",
    name: "Micro servo (SG90)",
    category: "Actuators",
    description: "9 g micro servo; horn on a revolute Z joint, about 0.18 N·m.",
    tags: ["servo", "hobby", "rc"],
    params: [
      ang("range", "Half range", Math.PI / 2, 0.1, Math.PI),
      len("horn", "Horn length", 0.032, 0.008, 0.06),
    ],
    build: (p) =>
      servoLinks({
        body: [0.0228, 0.0122, 0.0227],
        tabLength: 0.0322,
        tabZ: 0.0157,
        tabT: 0.0025,
        bossR: 0.0061,
        bossH: 0.004,
        shaftOffset: 0.0053,
        hornHubR: 0.0035,
        hornHubH: 0.004,
        hornLength: num(p, "horn"),
        hornWidth: 0.005,
        bodyColor: C.servoBlue,
        hornColor: C.white,
        bodyMass: 0.0085,
        hornMass: 0.0005,
        effort: 0.18,
        velocity: 10,
        range: num(p, "range"),
      }),
  },
  {
    id: "act_servo_mg996r",
    name: "Standard servo (MG996R)",
    category: "Actuators",
    description: "Metal-gear standard servo; horn on a revolute Z joint, about 1.1 N·m.",
    tags: ["servo", "hobby", "metal gear"],
    params: [
      ang("range", "Half range", Math.PI / 2, 0.1, Math.PI),
      len("horn", "Horn length", 0.04, 0.012, 0.08),
    ],
    build: (p) =>
      servoLinks({
        body: [0.0407, 0.0197, 0.037],
        tabLength: 0.054,
        tabZ: 0.0275,
        tabT: 0.0025,
        bossR: 0.0068,
        bossH: 0.004,
        shaftOffset: 0.0103,
        hornHubR: 0.0045,
        hornHubH: 0.005,
        hornLength: num(p, "horn"),
        hornWidth: 0.007,
        bodyColor: C.black,
        hornColor: C.white,
        bodyMass: 0.052,
        hornMass: 0.003,
        effort: 1.1,
        velocity: 6.2,
        range: num(p, "range"),
      }),
  },
  {
    id: "act_dynamixel_xl430",
    name: "Smart servo (Dynamixel XL430 size)",
    category: "Actuators",
    description: "28.5 x 46.5 x 34 mm smart servo; horn on top, revolute Z, 1.4 N·m.",
    tags: ["dynamixel", "smart servo", "robotis"],
    params: [ang("range", "Half range", Math.PI, 0.1, Math.PI)],
    build: (p) => {
      const body = link(
        "xl430_body",
        null,
        pose(),
        [
          boxV([0.0285, 0.0465, 0.034], C.dxlBlue, [0, 0, 0.017], undefined, "case"),
          boxV([0.024, 0.008, 0.002], C.black, [0, -0.016, 0.035], undefined, "label"),
        ],
        { mass: 0.0542 },
      );
      const horn = link(
        "xl430_horn",
        body.key,
        pose([0, 0.0105, 0.034]),
        [cylV(0.0095, 0.003, C.silver, [0, 0, 0.0015], undefined, "horn")],
        {
          joint: rev([0, 0, 1], -num(p, "range"), num(p, "range"), 1.4, 4.8),
          drive: servoDrive(),
          mass: 0.003,
          collisions: "cylinder",
        },
      );
      return [body, horn];
    },
  },
  {
    id: "act_nema17",
    name: "Stepper motor (NEMA 17)",
    category: "Actuators",
    description: "42.3 mm square stepper; 5 mm shaft on a continuous Z joint.",
    tags: ["stepper", "nema", "3d printer"],
    params: [
      len("body_length", "Body length", 0.04, 0.02, 0.06),
      len("shaft_length", "Shaft length", 0.024, 0.005, 0.05),
      nump("speed", "Preview speed (rad/s)", 3, 0.1, 60),
    ],
    build: (p) => {
      const L = num(p, "body_length");
      const s = 0.0423;
      const cap = Math.min(0.008, L / 4);
      const body = link(
        "stepper_body",
        null,
        pose(),
        [
          boxV([s, s, cap], C.alu, [0, 0, cap / 2], undefined, "rear_cap"),
          boxV([s * 0.98, s * 0.98, L - 2 * cap], C.black, [0, 0, L / 2], undefined, "stack"),
          boxV([s, s, cap], C.alu, [0, 0, L - cap / 2], undefined, "front_cap"),
          cylV(0.011, 0.002, C.alu, [0, 0, L + 0.001], undefined, "boss"),
        ],
        { mass: 7 * L },
      );
      const shaftL = num(p, "shaft_length");
      const shaft = link(
        "stepper_shaft",
        body.key,
        pose([0, 0, L + 0.002]),
        [cylV(0.0025, shaftL, C.steel, [0, 0, shaftL / 2], undefined, "shaft")],
        {
          joint: cont([0, 0, 1], 0.45, 30),
          drive: wheelDrive(num(p, "speed")),
          collisions: "cylinder",
          mass: 0.004,
        },
      );
      return [body, shaft];
    },
  },
  {
    id: "act_dc_gearmotor",
    name: "DC gearmotor (37 mm)",
    category: "Actuators",
    description: "37 mm metal gearmotor with an offset 6 mm output shaft on a continuous Z joint.",
    tags: ["dc motor", "gearbox", "drive"],
    params: [
      len("motor_length", "Motor length", 0.033, 0.015, 0.08),
      nump("speed", "No-load speed (rad/s)", 30, 1, 200),
      nump("torque", "Stall torque (N·m)", 1.0, 0.05, 10),
    ],
    build: (p) => {
      const lm = num(p, "motor_length");
      const lg = 0.022;
      const off = 0.007;
      const body = link(
        "gearmotor_body",
        null,
        pose(),
        [
          cylV(0.0175, lm, C.silver, [0, 0, lm / 2], undefined, "motor_can"),
          cylV(0.0185, lg, C.alu, [0, 0, lm + lg / 2], undefined, "gearbox"),
          cylV(0.006, 0.004, C.alu, [off, 0, lm + lg + 0.002], undefined, "bushing"),
          boxV([0.008, 0.004, 0.003], C.brass, [0.006, 0, -0.0015], undefined, "terminals"),
        ],
        { mass: 0.15 + 2 * lm },
      );
      const speed = num(p, "speed");
      const shaft = link(
        "gearmotor_shaft",
        body.key,
        pose([off, 0, lm + lg + 0.004]),
        [cylV(0.003, 0.015, C.steel, [0, 0, 0.0075], undefined, "shaft")],
        {
          joint: cont([0, 0, 1], num(p, "torque"), speed),
          drive: wheelDrive(speed * 0.5),
          collisions: "cylinder",
          mass: 0.006,
        },
      );
      return [body, shaft];
    },
  },
  {
    id: "act_linear_actuator",
    name: "Linear actuator",
    category: "Actuators",
    description: "Electric push rod: body along +Z with a prismatic rod (0 to stroke).",
    tags: ["linear", "push rod", "prismatic"],
    params: [
      len("stroke", "Stroke", 0.1, 0.01, 0.5),
      nump("force", "Force (N)", 200, 10, 2000),
      len("speed", "Speed (m/s)", 0.01, 0.001, 0.1),
    ],
    build: (p) => {
      const stroke = num(p, "stroke");
      const lb = stroke + 0.07;
      const body = link(
        "actuator_body",
        null,
        pose(),
        [
          cylV(0.015, lb, C.alu, [0, 0, lb / 2], undefined, "outer_tube"),
          cylV(0.0125, 0.06, C.black, [0.03, 0, 0.03], undefined, "motor"),
          boxV([0.05, 0.03, 0.025], C.black, [0.015, 0, 0.0125], undefined, "gear_housing"),
          cylV(0.005, 0.03, C.steel, [0, 0, -0.005], ALONG_Y, "rear_clevis"),
        ],
        { mass: 0.35 + 1.5 * stroke },
      );
      const rodLen = stroke + 0.03;
      const rod = link(
        "actuator_rod",
        body.key,
        pose([0, 0, lb]),
        [
          cylV(0.006, rodLen, C.steel, [0, 0, 0.03 - rodLen / 2], undefined, "rod"),
          cylV(0.006, 0.012, C.steel, [0, 0, 0.034], ALONG_Y, "rod_eye"),
        ],
        {
          joint: pris([0, 0, 1], 0, stroke, num(p, "force"), num(p, "speed")),
          drive: servoDrive(),
          collisions: "box",
          mass: 0.03 + 0.25 * stroke,
        },
      );
      return [body, rod];
    },
  },
  {
    id: "act_bldc_outrunner",
    name: "BLDC outrunner motor",
    category: "Actuators",
    description: "Drone-style outrunner (2212 size by default): stator mount plus a spinning bell.",
    tags: ["brushless", "drone", "motor"],
    params: [
      len("diameter", "Bell diameter", 0.028, 0.012, 0.1),
      len("height", "Bell height", 0.02, 0.008, 0.06),
      nump("speed", "Preview speed (rad/s)", 100, 1, 2000),
    ],
    build: (p) => {
      const D = num(p, "diameter");
      const H = num(p, "height");
      const R = D / 2;
      const wall = Math.max(R * 0.08, 0.0008);
      const mount = link(
        "bldc_mount",
        null,
        pose(),
        [
          meshV(
            G.merge(
              G.translate(G.box(D * 1.1, D * 0.22, 0.003), 0, 0, 0.0015),
              G.translate(G.box(D * 0.22, D * 1.1, 0.003), 0, 0, 0.0015),
            ),
            C.darkGrey,
            "cross_mount",
          ),
          cylV(R * 0.45, 0.002, C.darkGrey, [0, 0, 0.004], undefined, "base_boss"),
        ],
        { mass: 0.004 + 0.5 * D * D * 10 },
      );
      const bell = G.revolve(
        [
          [R - wall, 0],
          [R, 0],
          [R, H],
          [0, H],
          [0, H - wall * 1.5],
          [R - wall, H - wall * 1.5],
        ],
        40,
        true,
      );
      const rotor = link(
        "bldc_bell",
        mount.key,
        pose([0, 0, 0.005]),
        [
          meshV(bell, C.pcbRed, "bell"),
          cylV(0.0025, 0.008, C.steel, [0, 0, H + 0.004], undefined, "prop_shaft"),
        ],
        {
          joint: cont([0, 0, 1], 0.15 * (D / 0.028) ** 2, 1200, 0.0001),
          drive: wheelDrive(num(p, "speed")),
          collisions: "cylinder",
          mass: 0.04 * (D / 0.028) ** 2 * (H / 0.02),
        },
      );
      return [mount, rotor];
    },
  },
];

// ------------------------------------------------------------------ Wheels

const wheels: PartTemplate[] = [
  {
    id: "wheel_rubber",
    name: "Rubber wheel",
    category: "Wheels",
    description:
      "Rubber tyre on a rim; continuous joint about local Y (the axle) at the attach frame.",
    tags: ["wheel", "tyre", "drive"],
    params: [
      len("radius", "Radius", 0.035, 0.01, 0.4),
      len("width", "Width", 0.025, 0.005, 0.2),
      nump("speed", "Preview speed (rad/s)", 5, -50, 50),
      boolp("rim", "Show aluminium rim", true),
    ],
    build: (p) => {
      const w = wheelLink(
        "wheel",
        null,
        [0, 0, 0],
        num(p, "radius"),
        num(p, "width"),
        num(p, "speed"),
      );
      if (!bool(p, "rim")) w.visuals = w.visuals.filter((v) => v.name !== "rim");
      return [w];
    },
  },
  {
    id: "wheel_caster",
    name: "Swivel caster",
    category: "Wheels",
    description:
      "Hangs below the attach frame: mount, swivel fork (continuous Z) and wheel (continuous Y).",
    tags: ["caster", "castor", "passive"],
    params: [
      len("wheel_radius", "Wheel radius", 0.02, 0.008, 0.1),
      len("wheel_width", "Wheel width", 0.015, 0.005, 0.05),
      len("trail", "Trail (swivel offset)", 0.012, 0, 0.05),
    ],
    build: (p) =>
      casterLinks(
        "",
        null,
        [0, 0, 0],
        num(p, "wheel_radius"),
        num(p, "wheel_width"),
        num(p, "trail"),
      ),
  },
  {
    id: "wheel_omni",
    name: "Omni wheel",
    category: "Wheels",
    description:
      "Hub with two staggered rows of passive rollers (one visual mesh); continuous joint about Y.",
    tags: ["omni", "holonomic", "roller"],
    params: [
      len("radius", "Radius", 0.03, 0.015, 0.2),
      len("width", "Width", 0.025, 0.008, 0.1),
      intp("rollers", "Rollers per row", 8, 4, 16),
      nump("speed", "Preview speed (rad/s)", 5, -50, 50),
    ],
    build: (p) => {
      const r = num(p, "radius");
      const w = num(p, "width");
      return [
        link(
          "omni_wheel",
          null,
          pose(),
          [
            meshV(
              G.omniWheel(r, w, int(p, "rollers")),
              C.darkGrey,
              "omni_wheel",
              [0, 0, 0],
              ALONG_Y,
            ),
          ],
          {
            joint: cont([0, 1, 0], 2, 30),
            drive: wheelDrive(num(p, "speed")),
            collisions: wheelCollision(r, w),
            mass: 700 * Math.PI * r * r * w,
          },
        ),
      ];
    },
  },
  {
    id: "wheel_mecanum",
    name: "Mecanum wheel",
    category: "Wheels",
    description:
      "Side plates and rollers at 45 degrees (one visual mesh); continuous joint about Y.",
    tags: ["mecanum", "holonomic", "roller"],
    params: [
      len("radius", "Radius", 0.04, 0.02, 0.2),
      len("width", "Width", 0.035, 0.01, 0.12),
      intp("rollers", "Rollers", 10, 6, 16),
      choice("hand", "Handedness", "left", [
        ["left", "Left (A)"],
        ["right", "Right (B)"],
      ]),
      nump("speed", "Preview speed (rad/s)", 5, -50, 50),
    ],
    build: (p) => {
      const r = num(p, "radius");
      const w = num(p, "width");
      const hand = str(p, "hand") === "right" ? "right" : "left";
      return [
        link(
          "mecanum_wheel",
          null,
          pose(),
          [
            meshV(
              G.mecanumWheel(r, w, int(p, "rollers"), hand),
              C.darkGrey,
              "mecanum_wheel",
              [0, 0, 0],
              ALONG_Y,
            ),
          ],
          {
            joint: cont([0, 1, 0], 3, 30),
            drive: wheelDrive(num(p, "speed")),
            collisions: wheelCollision(r, w),
            mass: 800 * Math.PI * r * r * w,
          },
        ),
      ];
    },
  },
  {
    id: "wheel_track_sprocket",
    name: "Track sprocket",
    category: "Wheels",
    description: "Toothed drive sprocket for tracks; continuous joint about local Y.",
    tags: ["track", "tank", "sprocket"],
    params: [
      len("radius", "Pitch radius", 0.03, 0.01, 0.2),
      intp("teeth", "Teeth", 12, 6, 40),
      len("width", "Width", 0.008, 0.002, 0.06),
      nump("speed", "Preview speed (rad/s)", 4, -50, 50),
    ],
    build: (p) => {
      const r = num(p, "radius");
      const w = num(p, "width");
      return [
        link(
          "sprocket",
          null,
          pose(),
          [meshV(G.sprocket(r, int(p, "teeth"), w), C.darkGrey, "sprocket", [0, 0, 0], ALONG_Y)],
          {
            joint: cont([0, 1, 0], 5, 20),
            drive: wheelDrive(num(p, "speed")),
            collisions: wheelCollision(r, w * 1.8),
            density: 1400,
          },
        ),
      ];
    },
  },
];

// ------------------------------------------------------------------ Sensors

const sensors: PartTemplate[] = [
  {
    id: "sensor_lidar_2d",
    name: "2D lidar (RPLidar A1 style)",
    category: "Sensors",
    description: "Base on the attach frame with a spinning head; scan frame at the head centre.",
    tags: ["lidar", "laser scanner", "slam"],
    params: [nump("rate", "Scan rate (Hz)", 10, 1, 40)],
    build: (p) => {
      const headX = -0.0968 / 2 + 0.035;
      const base = link(
        "lidar_base",
        null,
        pose(),
        [boxV([0.0968, 0.0703, 0.03], C.black, [0, 0, 0.015], undefined, "base")],
        { mass: 0.12 },
      );
      const scan = link(
        "laser",
        base.key,
        pose([headX, 0, 0.0425]),
        [cylV(0.035, 0.025, C.darkGrey, [0, 0, 0], undefined, "head")],
        {
          mass: 0.05,
          collisions: "cylinder",
          sensors: [{ type: "lidar", name: "lidar", rate: num(p, "rate"), topic: "scan" }],
        },
      );
      return [base, scan];
    },
  },
  {
    id: "sensor_lidar_3d",
    name: "3D lidar puck (VLP-16 style)",
    category: "Sensors",
    description: "103 mm puck sitting on the attach frame; scan frame at the optical centre.",
    tags: ["lidar", "velodyne", "3d", "point cloud"],
    params: [nump("rate", "Rotation rate (Hz)", 10, 5, 20)],
    build: (p) => {
      const r = 0.05165;
      const base = link(
        "lidar3d_base",
        null,
        pose(),
        [
          cylV(r, 0.02, C.alu, [0, 0, 0.01], undefined, "lower_housing"),
          cylV(r, 0.014, C.alu, [0, 0, 0.0717 - 0.007], undefined, "top_cap"),
        ],
        { mass: 0.5, collisions: "cylinder" },
      );
      const windowH = 0.0717 - 0.034;
      const scan = link(
        "lidar3d",
        base.key,
        pose([0, 0, 0.02 + windowH / 2]),
        [cylV(r * 0.985, windowH, C.glass, [0, 0, 0], undefined, "window")],
        {
          mass: 0.33,
          collisions: "cylinder",
          sensors: [{ type: "lidar", name: "lidar3d", rate: num(p, "rate"), topic: "points" }],
        },
      );
      return [base, scan];
    },
  },
  {
    id: "sensor_depth_camera",
    name: "Depth camera (RealSense D435 style)",
    category: "Sensors",
    description:
      "90 x 25 x 25 mm stereo depth camera centred on the attach frame, looking along +X.",
    tags: ["realsense", "rgbd", "stereo", "depth"],
    params: [nump("rate", "Frame rate (Hz)", 30, 1, 90)],
    build: (p) => {
      const lens = (y: number, r: number) =>
        cylV(r, 0.002, C.glass, [0.0125, y, 0], ALONG_X, "lens");
      return [
        link(
          "depth_camera",
          null,
          pose(),
          [
            meshV(G.roundedBox(0.025, 0.09, 0.025, 0.006, 3), C.darkGrey, "depth_camera_body"),
            lens(0.025, 0.004),
            lens(-0.025, 0.004),
            lens(0.0105, 0.0032),
            lens(-0.0045, 0.0028),
          ],
          {
            mass: 0.072,
            collisions: "box",
            sensors: [{ type: "depth_camera", name: "depth_camera", rate: num(p, "rate") }],
          },
        ),
      ];
    },
  },
  {
    id: "sensor_rgb_camera",
    name: "RGB camera module",
    category: "Sensors",
    description: "25 x 24 mm camera board (Pi Camera style); lens looks along +X.",
    tags: ["camera", "picam", "vision"],
    params: [nump("rate", "Frame rate (Hz)", 30, 1, 120)],
    build: (p) => [
      link(
        "camera",
        null,
        pose(),
        [
          boxV([0.001, 0.025, 0.024], C.pcbGreen, [-0.0005, 0, 0], undefined, "pcb"),
          boxV([0.0045, 0.0085, 0.0085], C.black, [0.00225, 0, 0.0025], undefined, "sensor_block"),
          cylV(0.0032, 0.0015, C.glass, [0.00525, 0, 0.0025], ALONG_X, "lens"),
        ],
        {
          mass: 0.003,
          collisions: "box",
          sensors: [{ type: "camera", name: "camera", rate: num(p, "rate") }],
        },
      ),
    ],
  },
  {
    id: "sensor_imu",
    name: "IMU board (MPU-6050 style)",
    category: "Sensors",
    description: "21 x 16 mm breakout board lying on the attach frame; sensor frame at the board.",
    tags: ["imu", "accelerometer", "gyro"],
    params: [nump("rate", "Update rate (Hz)", 100, 1, 1000)],
    build: (p) => [
      link(
        "imu",
        null,
        pose(),
        [
          boxV([0.021, 0.016, 0.0016], C.pcbBlack, [0, 0, 0.0008], undefined, "pcb"),
          boxV([0.004, 0.004, 0.0009], C.black, [0, 0, 0.0016 + 0.00045], undefined, "chip"),
          boxV(
            [0.0025, 0.0127, 0.0025],
            C.black,
            [-0.0085, 0, 0.0016 + 0.00125],
            undefined,
            "header",
          ),
        ],
        {
          mass: 0.002,
          collisions: "box",
          sensors: [{ type: "imu", name: "imu", rate: num(p, "rate"), topic: "imu" }],
        },
      ),
    ],
  },
  {
    id: "sensor_ultrasonic",
    name: "Ultrasonic rangefinder (HC-SR04)",
    category: "Sensors",
    description: "45 x 20 mm board with two transducers facing +X; geometry only (no sim sensor).",
    tags: ["sonar", "distance", "hc-sr04"],
    params: [],
    build: () => [
      link(
        "ultrasonic",
        null,
        pose(),
        [
          boxV([0.0016, 0.045, 0.02], C.pcbBlue, [0, 0, 0.01], undefined, "pcb"),
          cylV(0.008, 0.012, C.silver, [0.0068, 0.013, 0.01], ALONG_X, "transmitter"),
          cylV(0.008, 0.012, C.silver, [0.0068, -0.013, 0.01], ALONG_X, "receiver"),
        ],
        { mass: 0.0085, collisions: "box" },
      ),
    ],
  },
  {
    id: "sensor_bumper",
    name: "Bump sensor",
    category: "Sensors",
    description: "Front bumper bar on two micro switches, facing +X; reports contacts.",
    tags: ["bumper", "contact", "switch"],
    params: [
      len("width", "Bumper width", 0.15, 0.03, 0.6),
      nump("rate", "Update rate (Hz)", 50, 1, 1000),
    ],
    build: (p) => {
      const w = num(p, "width");
      return [
        link(
          "bumper",
          null,
          pose(),
          [
            boxV([0.01, 0.008, 0.01], C.black, [0.005, w / 4, 0.01], undefined, "switch_l"),
            boxV([0.01, 0.008, 0.01], C.black, [0.005, -w / 4, 0.01], undefined, "switch_r"),
            boxV([0.008, w, 0.02], C.darkGrey, [0.014, 0, 0.01], undefined, "bar"),
          ],
          {
            mass: 0.02 + 0.2 * w,
            collisions: "same",
            sensors: [{ type: "contact", name: "bumper", rate: num(p, "rate") }],
          },
        ),
      ];
    },
  },
  {
    id: "sensor_force_torque",
    name: "Force-torque sensor",
    category: "Sensors",
    description: "45 mm six-axis load cell; measures through the fixed joint to its tool flange.",
    tags: ["ft sensor", "load cell", "wrench"],
    params: [
      len("diameter", "Diameter", 0.045, 0.02, 0.15),
      len("height", "Height", 0.0157, 0.008, 0.06),
      nump("rate", "Update rate (Hz)", 100, 1, 1000),
    ],
    build: (p) => {
      const r = num(p, "diameter") / 2;
      const h = num(p, "height");
      const base = link(
        "ft_base",
        null,
        pose(),
        [cylV(r, h / 2, C.alu, [0, 0, h / 4], undefined, "mounting_side")],
        { mass: 0.046 * (r / 0.0225) ** 2, collisions: "cylinder" },
      );
      const tool = link(
        "ft_tool",
        base.key,
        pose([0, 0, h / 2]),
        [
          cylV(r, h / 2, C.steel, [0, 0, h / 4], undefined, "tool_side"),
          boxV([r * 0.5, 0.008, 0.006], C.black, [r * 0.9, 0, h / 4], undefined, "connector"),
        ],
        {
          mass: 0.046 * (r / 0.0225) ** 2,
          collisions: "cylinder",
          sensors: [{ type: "force_torque", name: "ft_sensor", rate: num(p, "rate") }],
        },
      );
      return [base, tool];
    },
  },
];

// ------------------------------------------------------------------ Electronics

const electronics: PartTemplate[] = [
  {
    id: "elec_raspberry_pi",
    name: "Raspberry Pi 4 size board",
    category: "Electronics",
    description: "85 x 56 mm single-board computer lying on the attach frame.",
    tags: ["sbc", "computer", "raspberry pi"],
    params: [],
    build: () => {
      const t = 0.0014;
      const metal = G.merge(
        boxAt(0.0175, 0.0131, 0.016, 0.0363, -0.001, t),
        boxAt(0.0175, 0.0131, 0.016, 0.0363, -0.019, t),
        boxAt(0.0213, 0.0159, 0.0135, 0.0344, 0.0178, t),
        boxAt(0.015, 0.015, 0.0024, -0.011, -0.003, t),
        boxAt(0.009, 0.0075, 0.0032, -0.0313, -0.0255, t),
        boxAt(0.0075, 0.006, 0.003, -0.0165, -0.0255, t),
        boxAt(0.0075, 0.006, 0.003, -0.003, -0.0255, t),
      );
      const black = G.merge(
        boxAt(0.051, 0.005, 0.0085, -0.0095, 0.0245, t),
        boxAt(0.01, 0.014, 0.001, 0.007, -0.003, t),
        cylAt(0.003, 0.006, 0.0115, -0.0245, t, 16),
      );
      return [
        link(
          "raspberry_pi",
          null,
          pose(),
          [
            boxV([0.085, 0.056, t], C.pcbGreen, [0, 0, t / 2], undefined, "pcb"),
            meshV(metal, C.silver, "pi_metal_parts"),
            meshV(black, C.black, "pi_black_parts"),
          ],
          { mass: 0.046, collisions: "box" },
        ),
      ];
    },
  },
  {
    id: "elec_arduino_uno",
    name: "Arduino Uno size board",
    category: "Electronics",
    description: "68.6 x 53.4 mm microcontroller board lying on the attach frame.",
    tags: ["arduino", "microcontroller", "mcu"],
    params: [],
    build: () => {
      const t = 0.0016;
      const metal = G.merge(
        boxAt(0.016, 0.012, 0.0109, -0.0297, 0.011, t),
        boxAt(0.0115, 0.005, 0.004, 0.0, -0.006, t),
      );
      const black = G.merge(
        boxAt(0.0135, 0.009, 0.011, -0.0287, -0.019, t),
        boxAt(0.035, 0.0075, 0.004, 0.012, -0.012, t),
        boxAt(0.0254, 0.0025, 0.0085, -0.002, 0.0245, t),
        boxAt(0.0203, 0.0025, 0.0085, 0.022, 0.0245, t),
        boxAt(0.0203, 0.0025, 0.0085, -0.004, -0.0245, t),
        boxAt(0.0152, 0.0025, 0.0085, 0.019, -0.0245, t),
      );
      return [
        link(
          "arduino_uno",
          null,
          pose(),
          [
            boxV([0.0686, 0.0534, t], C.pcbTeal, [0, 0, t / 2], undefined, "pcb"),
            meshV(metal, C.silver, "uno_metal_parts"),
            meshV(black, C.black, "uno_black_parts"),
          ],
          { mass: 0.025, collisions: "box" },
        ),
      ];
    },
  },
  {
    id: "elec_jetson",
    name: "Jetson-style compute module",
    category: "Electronics",
    description:
      "100 x 80 mm carrier board with a module and finned heatsink, on the attach frame.",
    tags: ["jetson", "gpu", "computer", "ai"],
    params: [],
    build: () => {
      const t = 0.0016;
      const mz = t + 0.006;
      const fins: Float32Array[] = [];
      const finCount = 11;
      for (let i = 0; i < finCount; i++)
        fins.push(
          boxAt(
            0.0012,
            0.038,
            0.02,
            -0.028 + (0.056 * i) / (finCount - 1),
            0.005,
            mz + 0.0012 + 0.004,
          ),
        );
      const heatsink = G.merge(boxAt(0.06, 0.04, 0.004, 0, 0.005, mz + 0.0012), ...fins);
      const ports = G.merge(
        boxAt(0.0175, 0.0145, 0.016, 0.041, -0.022, t),
        boxAt(0.0175, 0.0145, 0.016, 0.041, -0.004, t),
        boxAt(0.0213, 0.016, 0.0135, 0.039, 0.016, t),
        boxAt(0.015, 0.012, 0.0065, 0.016, -0.034, t),
      );
      const dark = G.merge(
        boxAt(0.0696, 0.045, 0.0012, 0, 0.005, mz),
        boxAt(0.06, 0.006, 0.006, 0, -0.016, t),
        boxAt(0.009, 0.014, 0.011, -0.04, -0.03, t),
      );
      return [
        link(
          "jetson",
          null,
          pose(),
          [
            boxV([0.1, 0.08, t], C.pcbGreen, [0, 0, t / 2], undefined, "carrier"),
            meshV(dark, C.pcbBlack, "jetson_module"),
            meshV(heatsink, C.darkGrey, "jetson_heatsink"),
            meshV(ports, C.silver, "jetson_ports"),
          ],
          { mass: 0.24, collisions: "box" },
        ),
      ];
    },
  },
  {
    id: "elec_lipo",
    name: "LiPo battery",
    category: "Electronics",
    description: "Pouch pack sized from cell count and capacity (about 150 Wh/kg, 300 Wh/l).",
    tags: ["battery", "lipo", "power"],
    params: [
      intp("cells", "Cells (S)", 3, 1, 6),
      nump("capacity", "Capacity (mAh)", 2200, 300, 10000),
    ],
    build: (p) => {
      const cells = clamp(int(p, "cells"), 1, 6);
      const ah = num(p, "capacity") / 1000;
      const wh = cells * 3.7 * ah;
      const volume = wh / 300 / 1000; // m^3
      const h = 0.0075 * cells + 0.0015;
      const area = volume / h;
      const w = Math.sqrt(area / 3);
      const l = 3 * w;
      return [
        link(
          "battery",
          null,
          pose(),
          [
            boxV([l, w, h], C.lipo, [0, 0, h / 2], undefined, "pack"),
            boxV([0.0158, 0.008, 0.0082], C.yellow, [l / 2 + 0.03, 0, 0.0041], undefined, "xt60"),
            boxV(
              [0.03 - 0.0079, 0.004, 0.003],
              C.black,
              [l / 2 + 0.011, 0, 0.0041],
              undefined,
              "lead",
            ),
          ],
          { mass: wh / 150 + 0.008, collisions: "box" },
        ),
      ];
    },
  },
  {
    id: "elec_motor_driver",
    name: "Motor driver board (L298N style)",
    category: "Electronics",
    description: "43 x 43 mm dual H-bridge with heatsink and screw terminals, on the attach frame.",
    tags: ["h-bridge", "driver", "l298n"],
    params: [],
    build: () => {
      const t = 0.0016;
      const fins: Float32Array[] = [];
      for (let i = 0; i < 6; i++)
        fins.push(boxAt(0.023, 0.0012, 0.022, 0, 0.002 + i * 0.0026, t + 0.003));
      const heatsink = G.merge(boxAt(0.023, 0.016, 0.003, 0, 0.0085, t), ...fins);
      const terminals = G.merge(
        boxAt(0.008, 0.01, 0.01, -0.0175, -0.004, t),
        boxAt(0.008, 0.01, 0.01, 0.0175, -0.004, t),
        boxAt(0.015, 0.008, 0.01, -0.006, -0.0175, t),
      );
      const caps = G.merge(
        cylAt(0.004, 0.011, 0.012, -0.015, t, 16),
        cylAt(0.004, 0.011, -0.013, 0.006, t, 16),
      );
      return [
        link(
          "motor_driver",
          null,
          pose(),
          [
            boxV([0.043, 0.043, t], C.pcbRed, [0, 0, t / 2], undefined, "pcb"),
            meshV(heatsink, C.black, "driver_heatsink"),
            meshV(terminals, C.terminalBlue, "driver_terminals"),
            meshV(caps, C.darkGrey, "driver_capacitors"),
          ],
          { mass: 0.03, collisions: "box" },
        ),
      ];
    },
  },
  {
    id: "elec_pdb",
    name: "Power distribution board",
    category: "Electronics",
    description: "36 x 50 mm PDB with XT60 input, solder pads and capacitors, on the attach frame.",
    tags: ["pdb", "power", "distribution"],
    params: [],
    build: () => {
      const t = 0.0016;
      const pads: Float32Array[] = [];
      for (const sx of [-1, 1])
        for (const sy of [-1, 1]) {
          pads.push(boxAt(0.005, 0.004, 0.0003, sx * 0.0135, sy * 0.019, t));
          pads.push(boxAt(0.005, 0.004, 0.0003, sx * 0.0135, sy * 0.012, t));
        }
      return [
        link(
          "pdb",
          null,
          pose(),
          [
            boxV([0.036, 0.05, t], C.pcbBlack, [0, 0, t / 2], undefined, "pcb"),
            meshV(G.merge(...pads), C.brass, "pdb_pads"),
            meshV(boxAt(0.0158, 0.008, 0.0082, 0, -0.019, t), C.yellow, "pdb_xt60"),
            meshV(
              G.merge(
                cylAt(0.004, 0.009, -0.004, 0.006, t, 16),
                cylAt(0.004, 0.009, 0.006, 0.006, t, 16),
              ),
              C.darkGrey,
              "pdb_capacitors",
            ),
          ],
          { mass: 0.02, collisions: "box" },
        ),
      ];
    },
  },
];

// ------------------------------------------------------------------ Assemblies

/** Arm segment visuals: a Y-axis joint housing at the link origin plus a beam up +Z. */
function armSegment(radius: number, length: number, housing = true): PartShape[] {
  const v: PartShape[] = [];
  if (housing)
    v.push(cylV(radius * 1.2, radius * 2.4, C.darkGrey, [0, 0, 0], ALONG_Y, "joint_housing"));
  v.push(cylV(radius, length, C.alu, [0, 0, length / 2], undefined, "beam"));
  return v;
}

const assemblies: PartTemplate[] = [
  {
    id: "asm_diff_drive",
    name: "Differential-drive base",
    category: "Assemblies",
    description: "Chassis with two driven wheels and a rear caster; frame at the chassis centre.",
    tags: ["mobile base", "diff drive", "turtlebot"],
    params: [
      len("length", "Chassis length", 0.25, 0.08, 1),
      len("width", "Chassis width", 0.2, 0.06, 1),
      len("height", "Chassis height", 0.06, 0.01, 0.3),
      len("wheel_radius", "Wheel radius", 0.05, 0.02, 0.2),
      len("wheel_width", "Wheel width", 0.025, 0.008, 0.1),
      nump("speed", "Preview speed (rad/s)", 4, -30, 30),
    ],
    build: (p) => {
      const L = num(p, "length");
      const W = num(p, "width");
      const H = num(p, "height");
      const R = num(p, "wheel_radius");
      const w = num(p, "wheel_width");
      const speed = num(p, "speed");
      const rc = clamp(0.35 * R, 0.008, 0.05);
      const za = R - H / 2 - casterHeight(rc);
      const y = W / 2 + w / 2 + 0.005;
      const chassis = link(
        "base",
        null,
        pose(),
        [meshV(G.roundedBox(L, W, H, Math.min(0.01, H / 3), 3), C.darkGrey, "base_body")],
        { collisions: "box", mass: 2 + 20 * L * W },
      );
      return [
        chassis,
        wheelLink("left_wheel", chassis.key, [0, y, za], R, w, speed, 3),
        wheelLink("right_wheel", chassis.key, [0, -y, za], R, w, speed, 3),
        ...casterLinks(
          "rear_",
          chassis.key,
          [-L / 2 + Math.max(2 * rc, 0.02), 0, -H / 2],
          rc,
          rc * 0.8,
          rc * 0.5,
        ),
      ];
    },
  },
  {
    id: "asm_skid_steer",
    name: "4-wheel skid-steer base",
    category: "Assemblies",
    description:
      "Chassis with four driven wheels (0.4 x radius ground clearance); frame at the chassis centre.",
    tags: ["mobile base", "skid steer", "4wd"],
    params: [
      len("length", "Chassis length", 0.35, 0.1, 1.5),
      len("width", "Chassis width", 0.25, 0.08, 1),
      len("height", "Chassis height", 0.08, 0.02, 0.4),
      len("wheelbase", "Wheelbase", 0.25, 0.05, 1.5),
      len("wheel_radius", "Wheel radius", 0.06, 0.02, 0.3),
      len("wheel_width", "Wheel width", 0.04, 0.01, 0.15),
      nump("speed", "Preview speed (rad/s)", 4, -30, 30),
    ],
    build: (p) => {
      const L = num(p, "length");
      const W = num(p, "width");
      const H = num(p, "height");
      const R = num(p, "wheel_radius");
      const w = num(p, "wheel_width");
      const wb = num(p, "wheelbase");
      const speed = num(p, "speed");
      const za = 0.6 * R - H / 2;
      const y = W / 2 + w / 2 + 0.005;
      const chassis = link(
        "base",
        null,
        pose(),
        [boxV([L, W, H], C.darkGrey, [0, 0, 0], undefined, "chassis")],
        { collisions: "box", mass: 3 + 25 * L * W },
      );
      const wheelsOut: PartLink[] = [];
      for (const [kx, x] of [
        ["front", wb / 2],
        ["rear", -wb / 2],
      ] as const)
        for (const [ky, sy] of [
          ["left", 1],
          ["right", -1],
        ] as const)
          wheelsOut.push(
            wheelLink(`${kx}_${ky}_wheel`, chassis.key, [x, sy * y, za], R, w, speed, 5),
          );
      return [chassis, ...wheelsOut];
    },
  },
  {
    id: "asm_pan_tilt",
    name: "Pan-tilt unit",
    category: "Assemblies",
    description: "Micro-servo pan (Z) and tilt (Y) stage in a U-bracket; top plate for a camera.",
    tags: ["pan tilt", "gimbal", "camera mount"],
    params: [
      ang("pan_range", "Pan half range", Math.PI / 2, 0.1, Math.PI),
      ang("tilt_min", "Tilt lower", -Math.PI / 4, -Math.PI / 2, -0.05),
      ang("tilt_max", "Tilt upper", Math.PI / 2, 0.05, Math.PI / 2),
    ],
    build: (p) => {
      const span = 0.036;
      const bh = 0.035;
      const t = 0.002;
      const base = link(
        "pan_base",
        null,
        pose(),
        [
          boxV([0.05, 0.05, 0.004], C.black, [0, 0, 0.002], undefined, "base_plate"),
          boxV(
            [0.0228, 0.0122, 0.0227],
            C.servoBlue,
            [0, 0, 0.004 + 0.01135],
            undefined,
            "pan_servo",
          ),
          cylV(0.0061, 0.004, C.servoBlue, [0, 0, 0.0267 + 0.002], undefined, "pan_boss"),
        ],
        { mass: 0.03 },
      );
      const pan = link(
        "pan",
        base.key,
        pose([0, 0, 0.0307]),
        [
          cylV(0.012, 0.003, C.white, [0, 0, 0.0015], undefined, "horn_disc"),
          meshV(
            G.uBracket(span, bh, t, 0.022),
            C.alu,
            "pan_bracket",
            [0, 0, 0.003],
            [0, 0, Math.PI / 2],
          ),
        ],
        {
          joint: rev([0, 0, 1], -num(p, "pan_range"), num(p, "pan_range"), 0.18, 10),
          drive: servoDrive(),
          mass: 0.012,
          collisions: "box",
        },
      );
      const lo = num(p, "tilt_min");
      const hi = Math.max(num(p, "tilt_max"), lo + 0.05);
      const tilt = link(
        "tilt",
        pan.key,
        pose([0, 0, 0.003 + bh - 0.008]),
        [
          boxV(
            [0.0227, span - 2 * t - 0.004, 0.012],
            C.servoBlue,
            [0, 0, 0],
            undefined,
            "tilt_servo",
          ),
          boxV([0.04, 0.028, 0.002], C.black, [0, 0, 0.01], undefined, "camera_plate"),
        ],
        {
          joint: rev([0, 1, 0], lo, hi, 0.18, 10),
          drive: servoDrive(),
          mass: 0.015,
          collisions: "box",
        },
      );
      return [base, pan, tilt];
    },
  },
  {
    id: "asm_gripper",
    name: "Parallel two-finger gripper",
    category: "Assemblies",
    description:
      "Palm on the attach frame, two prismatic fingers along Y; the right finger mimics the left.",
    tags: ["gripper", "end effector", "parallel jaw"],
    params: [
      len("stroke", "Total stroke", 0.06, 0.01, 0.2),
      len("finger_length", "Finger length", 0.05, 0.015, 0.2),
      nump("force", "Grip force (N)", 20, 1, 200),
    ],
    build: (p) => {
      const stroke = num(p, "stroke");
      const fl = num(p, "finger_length");
      const ft = 0.008;
      const palmY = Math.max(0.08, stroke + 2 * ft + 0.02);
      const palmZ = 0.03;
      const palm = link(
        "palm",
        null,
        pose(),
        [
          boxV([0.05, palmY, palmZ], C.darkGrey, [0, 0, palmZ / 2], undefined, "palm"),
          boxV([0.012, palmY * 0.95, 0.004], C.steel, [0, 0, palmZ + 0.002], undefined, "rail"),
        ],
        { mass: 0.25 + palmY },
      );
      const finger = (key: string, side: 1 | -1, mimic: boolean): PartLink =>
        link(
          key,
          palm.key,
          pose([0, side * (ft / 2), palmZ]),
          [
            boxV([0.02, ft, fl], C.alu, [0, 0, fl / 2], undefined, "finger"),
            boxV(
              [0.02, 0.002, fl * 0.6],
              C.black,
              [0, -side * (ft / 2 - 0.001), fl * 0.65],
              undefined,
              "pad",
            ),
          ],
          {
            joint: {
              ...pris([0, side, 0], 0, stroke / 2, num(p, "force"), 0.05),
              ...(mimic ? { mimic: { link: "left_finger", multiplier: 1, offset: 0 } } : {}),
            },
            drive: mimic ? passive() : servoDrive(),
            mass: 0.02 + 0.5 * fl,
            collisions: "box",
          },
        );
      return [palm, finger("left_finger", 1, false), finger("right_finger", -1, true)];
    },
  },
  {
    id: "asm_arm_3dof",
    name: "3-DOF arm",
    category: "Assemblies",
    description:
      "Base, shoulder yaw (Z), shoulder pitch (Y) and elbow (Y); links stack up +Z at zero.",
    tags: ["arm", "manipulator", "3dof"],
    params: [
      len("upper_length", "Upper arm length", 0.15, 0.04, 0.6),
      len("fore_length", "Forearm length", 0.12, 0.04, 0.6),
      len("radius", "Link radius", 0.02, 0.008, 0.06),
    ],
    build: (p) => {
      const r = num(p, "radius");
      const l1 = num(p, "upper_length");
      const l2 = num(p, "fore_length");
      const bh = 0.04;
      const th = 0.03;
      const base = link(
        "arm_base",
        null,
        pose(),
        [cylV(r * 2.2, bh, C.darkGrey, [0, 0, bh / 2], undefined, "base")],
        { density: 2000, collisions: "cylinder" },
      );
      const turret = link(
        "shoulder",
        base.key,
        pose([0, 0, bh]),
        [cylV(r * 1.8, th, C.alu, [0, 0, th / 2], undefined, "turret")],
        {
          joint: rev([0, 0, 1], -Math.PI, Math.PI, 10, 2),
          drive: servoDrive(),
          density: 1500,
          collisions: "cylinder",
        },
      );
      const upper = link("upper_arm", turret.key, pose([0, 0, th + r * 1.25]), armSegment(r, l1), {
        joint: rev([0, 1, 0], -Math.PI / 2, Math.PI / 2, 8, 2),
        drive: servoDrive(),
        density: 900,
      });
      const fore = link("forearm", upper.key, pose([0, 0, l1]), armSegment(r * 0.85, l2), {
        joint: rev([0, 1, 0], -2.6, 2.6, 4, 3),
        drive: servoDrive(),
        density: 900,
      });
      const tool = link(
        "tool0",
        fore.key,
        pose([0, 0, l2]),
        [cylV(r * 0.8, 0.006, C.darkGrey, [0, 0, 0.003], undefined, "flange")],
        { mass: 0.02, collisions: "cylinder" },
      );
      return [base, turret, upper, fore, tool];
    },
  },
  {
    id: "asm_arm_6dof",
    name: "6-DOF arm",
    category: "Assemblies",
    description:
      "Yaw, shoulder, elbow, forearm roll, wrist pitch, flange roll; stacked up +Z at zero.",
    tags: ["arm", "manipulator", "6dof", "cobot"],
    params: [
      len("upper_length", "Upper arm length", 0.25, 0.06, 1),
      len("fore_length", "Forearm length", 0.22, 0.06, 1),
      len("wrist_length", "Wrist length", 0.08, 0.02, 0.3),
      len("radius", "Link radius", 0.03, 0.01, 0.08),
    ],
    build: (p) => {
      const r = num(p, "radius");
      const l1 = num(p, "upper_length");
      const l2 = num(p, "fore_length");
      const lw = num(p, "wrist_length");
      const bh = 0.06;
      const th = 0.05;
      const base = link(
        "arm_base",
        null,
        pose(),
        [cylV(r * 2.2, bh, C.darkGrey, [0, 0, bh / 2], undefined, "base")],
        { density: 2000, collisions: "cylinder" },
      );
      const shoulder = link(
        "shoulder",
        base.key,
        pose([0, 0, bh]),
        [cylV(r * 1.6, th, C.white, [0, 0, th / 2], undefined, "turret")],
        {
          joint: rev([0, 0, 1], -Math.PI, Math.PI, 40, 2),
          drive: servoDrive(),
          density: 1500,
          collisions: "cylinder",
        },
      );
      const upper = link(
        "upper_arm",
        shoulder.key,
        pose([0, 0, th + r * 1.25]),
        armSegment(r, l1),
        {
          joint: rev([0, 1, 0], -Math.PI / 2, Math.PI / 2, 40, 2),
          drive: servoDrive(),
          density: 900,
        },
      );
      const fore = link("forearm", upper.key, pose([0, 0, l1]), armSegment(r * 0.85, l2 / 2), {
        joint: rev([0, 1, 0], -2.8, 2.8, 20, 3),
        drive: servoDrive(),
        density: 900,
      });
      const roll = link(
        "wrist_roll",
        fore.key,
        pose([0, 0, l2 / 2]),
        armSegment(r * 0.7, l2 / 2, false),
        {
          joint: rev([0, 0, 1], -Math.PI, Math.PI, 8, 4),
          drive: servoDrive(),
          density: 900,
        },
      );
      const pitch = link(
        "wrist_pitch",
        roll.key,
        pose([0, 0, l2 / 2 + r * 0.7]),
        armSegment(r * 0.6, lw),
        {
          joint: rev([0, 1, 0], -2, 2, 8, 4),
          drive: servoDrive(),
          density: 900,
        },
      );
      const flange = link(
        "flange",
        pitch.key,
        pose([0, 0, lw]),
        [cylV(r * 0.6, 0.01, C.darkGrey, [0, 0, 0.005], undefined, "flange")],
        {
          joint: rev([0, 0, 1], -Math.PI, Math.PI, 4, 5),
          drive: servoDrive(),
          mass: 0.05,
          collisions: "cylinder",
        },
      );
      return [base, shoulder, upper, fore, roll, pitch, flange];
    },
  },
  {
    id: "asm_quadruped_leg",
    name: "Quadruped leg",
    category: "Assemblies",
    description:
      "Hip abduction (X), thigh pitch (Y) and knee (Y); leg hangs straight down at zero.",
    tags: ["legged", "quadruped", "dog"],
    params: [
      len("hip_offset", "Hip lateral offset", 0.06, 0.02, 0.2),
      len("thigh_length", "Thigh length", 0.2, 0.05, 0.6),
      len("calf_length", "Calf length", 0.2, 0.05, 0.6),
      choice("side", "Side", "left", [
        ["left", "Left (+Y)"],
        ["right", "Right (-Y)"],
      ]),
    ],
    build: (p) => {
      const off = num(p, "hip_offset");
      const lt = num(p, "thigh_length");
      const lc = num(p, "calf_length");
      const s = str(p, "side") === "right" ? -1 : 1;
      const mount = link(
        "hip_mount",
        null,
        pose(),
        [cylV(0.03, 0.05, C.darkGrey, [-0.025, 0, 0], ALONG_X, "hip_motor")],
        { mass: 0.5, collisions: "cylinder" },
      );
      const hip = link(
        "hip",
        mount.key,
        pose(),
        [
          cylV(0.025, 0.03, C.alu, [0.015, 0, 0], ALONG_X, "hip_flange"),
          boxV([0.03, off, 0.03], C.alu, [0.015, (s * off) / 2, 0], undefined, "hip_bracket"),
        ],
        { joint: rev([1, 0, 0], -0.8, 0.8, 20, 20), drive: servoDrive(), mass: 0.3 },
      );
      const thigh = link(
        "thigh",
        hip.key,
        pose([0.015, s * off, 0]),
        [
          cylV(0.03, 0.03, C.darkGrey, [0, s * 0.015, 0], ALONG_Y, "thigh_motor"),
          boxV([0.025, 0.02, lt], C.alu, [0, s * 0.02, -lt / 2], undefined, "thigh_beam"),
        ],
        {
          joint: rev([0, 1, 0], -Math.PI / 2, Math.PI / 2, 20, 20),
          drive: servoDrive(),
          mass: 0.6 + lt,
        },
      );
      const calf = link(
        "calf",
        thigh.key,
        pose([0, s * 0.02, -lt]),
        [
          cylV(0.015, 0.02, C.darkGrey, [0, 0, 0], ALONG_Y, "knee"),
          boxV([0.015, 0.015, lc], C.alu, [0, 0, -lc / 2], undefined, "calf_beam"),
          sphV(0.018, C.rubber, [0, 0, -lc], "foot"),
        ],
        { joint: rev([0, 1, 0], -2.7, 0, 30, 20), drive: servoDrive(), mass: 0.15 + 0.5 * lc },
      );
      return [mount, hip, thigh, calf];
    },
  },
];

export const PART_LIBRARY: PartTemplate[] = [
  ...shapes,
  ...structure,
  ...actuators,
  ...wheels,
  ...sensors,
  ...electronics,
  ...assemblies,
];
