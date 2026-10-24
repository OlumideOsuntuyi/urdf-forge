// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { boxUVs, writeObj } from "../src/core/mesh/uv";
import { boxPositions } from "../src/core/mesh/ops";
import { loadMesh } from "../src/core/mesh/loaders";
import { buildPackage } from "../src/core/ros/package";
import { generateUrdf } from "../src/core/ros/urdf";
import { MATERIAL_PRESETS, applyPreset } from "../src/core/materials";
import { loadProject, saveProject } from "../src/core/project";
import { sampleRobot } from "./helpers";

describe("box-projected UVs", () => {
  it("maps each face of a box in metres", () => {
    const uv = boxUVs(boxPositions(2, 2, 2));
    expect(Math.max(...uv)).toBeCloseTo(1, 6);
    expect(Math.min(...uv)).toBeCloseTo(-1, 6);
  });

  it("writes an OBJ that reads back with the same triangles", () => {
    const box = boxPositions(0.5, 0.25, 0.1);
    const obj = writeObj(box, 0.25, "box");
    expect(obj).toMatch(/^vt /m);
    expect(obj).toMatch(/^vn /m);
    expect(loadMesh("box.obj", new TextEncoder().encode(obj)).positions.length).toBe(box.length);
  });
});

describe("PBR export", () => {
  const textured = () => {
    const { model, meshes } = sampleRobot();
    const mat = model.materials[0];
    mat.textures = {
      source: "ambientCG Metal032 (CC0)",
      tile: 0.25,
      maps: {
        color: "Metal032_1K_color.jpg",
        normal: "Metal032_1K_normal.jpg",
        roughness: "Metal032_1K_roughness.jpg",
      },
    };
    const textures = new Map([
      ["Metal032_1K_color.jpg", new Uint8Array([1])],
      ["Metal032_1K_normal.jpg", new Uint8Array([2])],
      ["Metal032_1K_roughness.jpg", new Uint8Array([3])],
    ]);
    return { model, meshes, textures };
  };

  it("references UV-mapped OBJ meshes and the colour texture in the URDF", () => {
    const { model } = textured();
    const urdf = generateUrdf(model, "jazzy-harmonic");
    expect(urdf).toContain("base_uv250mm.obj");
    expect(urdf).toContain(
      '<texture filename="package://test_bot_description/materials/textures/Metal032_1K_color.jpg"/>',
    );
    expect(urdf).toContain(
      "<albedo_map>model://test_bot_description/materials/textures/Metal032_1K_color.jpg</albedo_map>",
    );
    expect(urdf).toContain("<normal_map>");
    // Collisions keep the STL.
    expect(urdf).toMatch(/<collision[\s\S]*?<\/collision>/);
  });

  it("puts textures, OBJ meshes and the install rule in the package", () => {
    const { model, meshes, textures } = textured();
    const files = buildPackage(model, new Map(), {
      textures,
      meshPositions: (id) => meshes.get(id),
    });
    expect(files.has("materials/textures/Metal032_1K_color.jpg")).toBe(true);
    expect(files.has("meshes/base_uv250mm.obj")).toBe(true);
    expect(files.get("CMakeLists.txt")).toContain(" materials");
  });

  it("keeps textures in project files", () => {
    const { model, meshes, textures } = textured();
    const back = loadProject(saveProject({ model, meshes, textures }));
    expect([...back.textures.keys()].sort()).toEqual([...textures.keys()].sort());
    expect(back.model.materials[0].textures?.tile).toBe(0.25);
  });

  it("presets set a solid finish and clear textures", () => {
    const { model } = textured();
    const chrome = MATERIAL_PRESETS.find((p) => p.id === "steel_polished")!;
    applyPreset(model.materials[0], chrome);
    expect(model.materials[0].textures).toBeNull();
    expect(model.materials[0].metalness).toBe(1);
    expect(generateUrdf(model, "jazzy-harmonic")).not.toContain(".obj");
  });
});
