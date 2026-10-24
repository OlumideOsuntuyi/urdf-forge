import { describe, expect, it } from "vitest";
import { newModel, type Geometry } from "../src/core/model";
import { PART_LIBRARY, defaults } from "../src/core/parts";
import { insertPartIn } from "../src/app/parts";
import { validate } from "../src/core/validate";

const size = (g: Geometry) =>
  g.type === "box" ? Math.min(...g.size) : g.type === "mesh" ? 1 : g.radius;

describe("inserting components", () => {
  it.each(PART_LIBRARY.map((t) => [t.id, t] as const))("%s", (_id, t) => {
    const m = newModel();
    insertPartIn(m, t, defaults(t), null);
    expect(m.links.length).toBeGreaterThan(0);
    for (const L of m.links) {
      for (const c of L.collisions)
        expect(size(c.geometry), `${L.name} collision`).toBeGreaterThan(0);
      expect(L.inertial.mass, `${L.name} mass`).toBeGreaterThan(0);
    }
    const errors = validate(m).filter((i) => i.level === "error");
    expect(errors.map((e) => e.message)).toEqual([]);
  });

  it("attaches to an existing link and keeps names unique", () => {
    const m = newModel();
    const wheel = PART_LIBRARY.find((t) => t.id === "wheel_rubber")!;
    const base = PART_LIBRARY.find((t) => t.id === "shape_box")!;
    const root = insertPartIn(m, base, defaults(base), null);
    insertPartIn(m, wheel, defaults(wheel), root);
    insertPartIn(m, wheel, defaults(wheel), root);
    const names = m.links.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
    expect(m.links.filter((l) => l.parentId === root).length).toBeGreaterThanOrEqual(2);
  });
});
