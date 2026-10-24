import { describe, expect, it } from "vitest";
import { Matrix4 } from "three";
import {
  PART_CATEGORIES,
  PART_LIBRARY,
  defaults,
  findPart,
  type Params,
  type PartLink,
  type PartShape,
  type PartTemplate,
} from "../src/core/parts";
import * as G from "../src/core/parts/geometry";
import { isWatertight, massProperties } from "../src/core/mesh/massprops";

/** Defaults, then every param at its minimum, then every param at its maximum. */
function variants(t: PartTemplate): [string, Params][] {
  const base = defaults(t);
  const at = (which: "min" | "max"): Params => {
    const p: Params = { ...base };
    for (const s of t.params) {
      const v = s[which];
      if (v !== undefined && s.kind !== "choice" && s.kind !== "bool") p[s.key] = v;
      if (s.kind === "bool") p[s.key] = which === "max";
      if (s.kind === "choice" && s.choices?.length)
        p[s.key] = which === "min" ? s.choices[0].value : s.choices[s.choices.length - 1].value;
    }
    return p;
  };
  return [
    ["defaults", base],
    ["min", at("min")],
    ["max", at("max")],
  ];
}

const finite = (v: ArrayLike<number>) => Array.prototype.every.call(v, Number.isFinite);

function checkShape(s: PartShape, where: string) {
  expect(finite(s.origin.xyz), `${where} origin xyz`).toBe(true);
  expect(finite(s.origin.rpy), `${where} origin rpy`).toBe(true);
  expect(s.color.length, `${where} colour`).toBe(4);
  const g = s.geometry;
  if (g.type === "mesh") {
    expect(g.positions.length, `${where} mesh empty`).toBeGreaterThan(0);
    expect(g.positions.length % 9, `${where} mesh length`).toBe(0);
    expect(finite(g.positions), `${where} mesh finite`).toBe(true);
    expect(g.positions.length / 9, `${where} triangle budget`).toBeLessThan(20000);
    const mp = massProperties(g.positions);
    expect(mp, `${where} mass props`).not.toBeNull();
    expect(mp!.volume, `${where} volume`).toBeGreaterThan(0);
    expect(isWatertight(g.positions), `${where} watertight`).toBe(true);
    expect(G.signedVolume(g.positions), `${where} outward winding`).toBeGreaterThan(0);
  } else if (g.type === "box") {
    expect(
      g.size.every((x) => Number.isFinite(x) && x > 0),
      `${where} box size`,
    ).toBe(true);
  } else if (g.type === "cylinder") {
    expect(g.radius > 0 && g.length > 0, `${where} cylinder`).toBe(true);
  } else {
    expect(g.radius, `${where} sphere`).toBeGreaterThan(0);
  }
}

function checkLinks(links: PartLink[], where: string) {
  expect(links.length, `${where} links`).toBeGreaterThan(0);
  const keys = new Set(links.map((l) => l.key));
  expect(keys.size, `${where} unique keys`).toBe(links.length);
  expect(links.filter((l) => l.parent === null).length, `${where} single root`).toBe(1);
  const byKey = new Map(links.map((l) => [l.key, l]));
  for (const l of links) {
    const w = `${where}/${l.key}`;
    if (l.parent !== null) expect(keys.has(l.parent), `${w} parent exists`).toBe(true);
    // No cycles: walking up the parents must reach the root.
    let cur: PartLink | undefined = l;
    let steps = 0;
    while (cur && cur.parent !== null && steps <= links.length) {
      cur = byKey.get(cur.parent);
      steps++;
    }
    expect(steps, `${w} acyclic`).toBeLessThanOrEqual(links.length);
    expect(finite(l.origin.xyz) && finite(l.origin.rpy), `${w} origin`).toBe(true);
    expect(l.visuals.length, `${w} visuals`).toBeGreaterThan(0);
    l.visuals.forEach((s, i) => checkShape(s, `${w} visual ${i}`));
    if (Array.isArray(l.collisions))
      l.collisions.forEach((s, i) => checkShape(s, `${w} collision ${i}`));
    if (l.mass !== undefined) expect(l.mass, `${w} mass`).toBeGreaterThan(0);
    if (l.density !== undefined) expect(l.density, `${w} density`).toBeGreaterThan(0);
    const j = l.joint;
    if (!j || j.type === "fixed") continue;
    if (j.type === "revolute" || j.type === "continuous" || j.type === "prismatic") {
      expect(j.axis, `${w} axis`).toBeDefined();
      expect(Math.hypot(...j.axis!), `${w} axis length`).toBeGreaterThan(0.5);
      expect(j.effort ?? 0, `${w} effort`).toBeGreaterThan(0);
      expect(j.velocity ?? 0, `${w} velocity`).toBeGreaterThan(0);
    }
    if (j.type === "revolute" || j.type === "prismatic") {
      expect(Number.isFinite(j.lower) && Number.isFinite(j.upper), `${w} limits`).toBe(true);
      expect(j.lower!, `${w} lower < upper`).toBeLessThan(j.upper!);
    }
    if (j.mimic) expect(keys.has(j.mimic.link), `${w} mimic target`).toBe(true);
    for (const s of l.sensors ?? []) {
      expect(s.rate, `${w} sensor rate`).toBeGreaterThan(0);
      expect(s.name.length, `${w} sensor name`).toBeGreaterThan(0);
    }
  }
}

describe("part library", () => {
  it("has at least 40 templates with unique ids, three or more per category", () => {
    expect(PART_LIBRARY.length).toBeGreaterThanOrEqual(40);
    expect(new Set(PART_LIBRARY.map((t) => t.id)).size).toBe(PART_LIBRARY.length);
    for (const c of PART_CATEGORIES)
      expect(PART_LIBRARY.filter((t) => t.category === c).length, c).toBeGreaterThanOrEqual(3);
    expect(findPart("shape_box")?.name).toBe("Box");
    expect(findPart("nope")).toBeUndefined();
  });

  it("declares sane parameter specs", () => {
    for (const t of PART_LIBRARY)
      for (const s of t.params) {
        const w = `${t.id}.${s.key}`;
        if (s.kind === "choice") {
          expect(
            s.choices?.some((c) => c.value === s.default),
            w,
          ).toBe(true);
          continue;
        }
        if (s.kind === "bool") {
          expect(typeof s.default, w).toBe("boolean");
          continue;
        }
        expect(s.min, w).toBeDefined();
        expect(s.max, w).toBeDefined();
        expect(s.min!, w).toBeLessThan(s.max!);
        expect(s.default as number, w).toBeGreaterThanOrEqual(s.min!);
        expect(s.default as number, w).toBeLessThanOrEqual(s.max!);
      }
  });

  for (const t of PART_LIBRARY)
    it(`builds ${t.id} at defaults, minimum and maximum`, () => {
      for (const [label, params] of variants(t)) checkLinks(t.build(params), `${t.id}[${label}]`);
    });

  it("sets drives on actuators and wheels and sim sensors on sensor parts", () => {
    for (const t of PART_LIBRARY) {
      const links = t.build(defaults(t));
      const moving = links.filter((l) => l.joint && l.joint.type !== "fixed");
      if (t.category === "Actuators" || t.category === "Wheels") {
        expect(moving.length, t.id).toBeGreaterThan(0);
        for (const l of moving) expect(l.drive, `${t.id}/${l.key}`).toBeDefined();
      }
      if (t.category === "Sensors" && t.id !== "sensor_ultrasonic")
        expect(
          links.some((l) => (l.sensors ?? []).length > 0),
          t.id,
        ).toBe(true);
    }
  });

  it("puts the gripper's right finger on a mimic of the left", () => {
    const t = findPart("asm_gripper")!;
    const links = t.build(defaults(t));
    expect(links.find((l) => l.key === "right_finger")?.joint?.mimic?.link).toBe("left_finger");
  });

  it("sizes LiPo packs from cells and capacity", () => {
    const t = findPart("elec_lipo")!;
    const small = t.build({ ...defaults(t), cells: 1, capacity: 500 })[0];
    const big = t.build({ ...defaults(t), cells: 6, capacity: 5000 })[0];
    expect(big.mass!).toBeGreaterThan(small.mass!);
    const std = t.build(defaults(t))[0];
    expect(std.mass!).toBeGreaterThan(0.15);
    expect(std.mass!).toBeLessThan(0.22);
  });
});

describe("procedural geometry", () => {
  const closed: [string, Float32Array][] = [
    ["box", G.box(0.1, 0.2, 0.3)],
    ["roundedBox", G.roundedBox(0.1, 0.08, 0.05, 0.01)],
    ["cylinder", G.cylinder(0.05, 0.2)],
    ["prism", G.prism(6, 0.01, 0.02)],
    ["tube", G.tube(0.05, 0.04, 0.2)],
    ["cone", G.cone(0.05, 0.1)],
    ["sphere", G.sphere(0.05)],
    ["capsule", G.capsule(0.02, 0.1)],
    ["torus", G.torus(0.1, 0.02)],
    ["wedge", G.wedge(0.2, 0.1, 0.05)],
    ["plateWithHoles", G.plateWithHoles(0.1, 0.08, 0.003, G.holeGrid(0.1, 0.08, 0.01, 0.003))],
    ["extrusion 2020", G.extrusionProfile2020(0.3, 20)],
    ["extrusion 2040", G.extrusionProfile2020(0.3, 40)],
    ["spurGear", G.spurGear(0.001, 24, 0.006, 0.005)],
    ["spurGear small", G.spurGear(0.0005, 8, 0.004)],
    ["tyreWheel", G.tyreWheel(0.05, 0.03)],
    ["lBracket", G.lBracket(0.03, 0.04, 0.003, 0.02)],
    ["uBracket", G.uBracket(0.03, 0.03, 0.002, 0.02)],
    ["cornerBracket", G.cornerBracket(0.02, 0.003, 0.02)],
    ["omniWheel", G.omniWheel(0.03, 0.025)],
    ["mecanumWheel", G.mecanumWheel(0.04, 0.035)],
    ["sprocket", G.sprocket(0.03, 12, 0.008)],
  ];
  for (const [name, soup] of closed)
    it(`${name} is a closed, outward-wound solid`, () => {
      expect(soup.length % 9).toBe(0);
      expect(isWatertight(soup)).toBe(true);
      expect(G.signedVolume(soup)).toBeGreaterThan(0);
    });

  it("matches analytic volumes", () => {
    const rel = (a: number, b: number) => Math.abs(a - b) / b;
    const vol = (s: Float32Array) => massProperties(s)!.volume;
    expect(rel(vol(G.box(0.1, 0.2, 0.3)), 0.006)).toBeLessThan(1e-5);
    expect(rel(vol(G.cylinder(0.05, 0.2, 64)), Math.PI * 0.05 ** 2 * 0.2)).toBeLessThan(0.01);
    expect(
      rel(vol(G.tube(0.05, 0.04, 0.2, 64)), Math.PI * (0.05 ** 2 - 0.04 ** 2) * 0.2),
    ).toBeLessThan(0.01);
    expect(rel(vol(G.sphere(0.05, 48)), (4 / 3) * Math.PI * 0.05 ** 3)).toBeLessThan(0.01);
    expect(rel(vol(G.wedge(0.2, 0.1, 0.05)), 0.5 * 0.2 * 0.1 * 0.05)).toBeLessThan(1e-5);
    // A gear's cross-section lies between its root and tip circles.
    const area = vol(G.spurGear(0.001, 30, 0.01)) / 0.01;
    expect(area).toBeGreaterThan(Math.PI * 0.01375 ** 2);
    expect(area).toBeLessThan(Math.PI * 0.016 ** 2);
  });

  it("keeps winding outward under rigid and mirroring transforms", () => {
    const s = G.cylinder(0.02, 0.1);
    const moved = G.transform(s, { xyz: [1, 2, 3], rpy: [0.3, -0.2, 1.1] });
    expect(G.signedVolume(moved)).toBeCloseTo(G.signedVolume(s), 9);
    const mirrored = G.transform(s, new Matrix4().makeScale(-1, 1, 1));
    expect(G.signedVolume(mirrored)).toBeGreaterThan(0);
  });

  it("merges soups by concatenation", () => {
    const a = G.box(1, 1, 1);
    const b = G.translate(G.box(1, 1, 1), 3, 0, 0);
    const m = G.merge(a, b);
    expect(m.length).toBe(a.length + b.length);
    expect(isWatertight(m)).toBe(true);
  });
});
