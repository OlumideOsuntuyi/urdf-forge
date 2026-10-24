import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { CAD_QUALITY, occtParams, partsFromOcct, type OcctResult } from "../src/core/mesh/cad";
import { bounds } from "../src/core/mesh/massprops";
import { loadProject, saveProject } from "../src/core/project";
import { sampleRobot } from "./helpers";

const require = createRequire(import.meta.url);
const testfiles = "node_modules/occt-import-js/test/testfiles";

describe("STEP import", () => {
  // The three files hold the same 1 m cube written in millimetres, metres and inches.
  it.each(["cube-mm", "cube-m", "cube-in"])(
    "converts %s to metres",
    async (name) => {
      const occt = await require("occt-import-js")();
      const bytes = readFileSync(`${testfiles}/cube-units/${name}.step`);
      const result: OcctResult = occt.ReadStepFile(bytes, occtParams(CAD_QUALITY.normal));
      const parts = partsFromOcct(result, "cube");
      expect(parts.length).toBeGreaterThan(0);
      const b = bounds(parts[0].positions);
      expect(b.max[0] - b.min[0]).toBeCloseTo(1, 4);
    },
    60_000,
  );

  it("breaks an assembly into named parts", async () => {
    const occt = await require("occt-import-js")();
    const bytes = readFileSync(`${testfiles}/cax-if/as1-oc-214.stp`);
    const parts = partsFromOcct(occt.ReadStepFile(bytes, occtParams(CAD_QUALITY.draft)), "as1");
    expect(parts.length).toBeGreaterThan(5);
    expect(new Set(parts.map((p) => p.name)).size).toBe(parts.length);
  }, 60_000);
});

describe("project files", () => {
  it("round-trips model and meshes", () => {
    const { model, meshes } = sampleRobot();
    const back = loadProject(saveProject({ model, meshes }));
    expect(back.model.links.map((l) => l.name)).toEqual(model.links.map((l) => l.name));
    expect(Array.from(back.meshes.get(model.meshes[0].id)!)).toEqual(
      Array.from(meshes.get(model.meshes[0].id)!),
    );
  });

  it("rejects non-project files", () => {
    expect(() => loadProject(new Uint8Array([1, 2, 3]))).toThrow(/not a URDF Forge project/);
  });
});
