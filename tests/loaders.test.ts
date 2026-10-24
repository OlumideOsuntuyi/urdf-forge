// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { loadMesh } from "../src/core/mesh/loaders";
import { bounds } from "../src/core/mesh/massprops";
import { sdfToEnvironment } from "../src/core/env/sdfImport";
import { resolveUri } from "../src/samples/robot";
import { fuelZipUrl } from "../src/samples/environment";

const enc = (s: string) => new TextEncoder().encode(s);

/** A Collada file with one triangle spanning 0..1 along the file's up axis, in centimetres. */
const dae = (up: "Z_UP" | "Y_UP") => `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><unit name="centimeter" meter="0.01"/><up_axis>${up}</up_axis></asset>
  <library_effects><effect id="fx"><profile_COMMON><technique sid="t"><phong><diffuse><color>1 0 0 1</color></diffuse></phong></technique></profile_COMMON></effect></library_effects>
  <library_materials><material id="red"><instance_effect url="#fx"/></material></library_materials>
  <library_geometries><geometry id="g"><mesh>
    <source id="p"><float_array id="pa" count="9">${up === "Z_UP" ? "0 0 0 100 0 0 0 0 100" : "0 0 0 100 0 0 0 100 0"}</float_array>
      <technique_common><accessor source="#pa" count="3" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
    <vertices id="v"><input semantic="POSITION" source="#p"/></vertices>
    <triangles count="1" material="m"><input semantic="VERTEX" source="#v" offset="0"/><p>0 1 2</p></triangles>
  </mesh></geometry></library_geometries>
  <library_visual_scenes><visual_scene id="s"><node id="n"><instance_geometry url="#g"><bind_material><technique_common><instance_material symbol="m" target="#red"/></technique_common></bind_material></instance_geometry></node></visual_scene></library_visual_scenes>
  <scene><instance_visual_scene url="#s"/></scene>
</COLLADA>`;

describe("mesh loaders", () => {
  it("keeps Z-up Collada files Z-up and applies the unit", () => {
    const m = loadMesh("part.dae", enc(dae("Z_UP")));
    const b = bounds(m.positions);
    expect(b.max[2]).toBeCloseTo(1, 4);
    expect(b.max[0]).toBeCloseTo(1, 4);
    expect(m.color?.slice(0, 3)).toEqual([1, 0, 0]);
  });

  it("stands Y-up Collada files up on Z", () => {
    const b = bounds(loadMesh("part.DAE", enc(dae("Y_UP"))).positions);
    expect(b.max[2]).toBeCloseTo(1, 4);
    expect(Math.abs(b.max[1]) + Math.abs(b.min[1])).toBeLessThan(1e-6);
  });

  it("reads OBJ with polygons", () => {
    const obj = "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n";
    expect(loadMesh("quad.obj", enc(obj)).positions.length).toBe(18);
  });
});

describe("URDF mesh resolution", () => {
  const urdf = "https://raw.githubusercontent.com/o/r/abc/robot_description/urdf/robot.urdf";
  it("maps package:// and relative paths", () => {
    expect(
      resolveUri("package://robot_description/meshes/a.stl", urdf, {
        robot_description: "https://raw.githubusercontent.com/o/r/abc/robot_description",
      }),
    ).toBe("https://raw.githubusercontent.com/o/r/abc/robot_description/meshes/a.stl");
    expect(resolveUri("../meshes/b.dae", urdf, {})).toBe(
      "https://raw.githubusercontent.com/o/r/abc/robot_description/meshes/b.dae",
    );
    expect(resolveUri("package://unknown/x.stl", urdf, {})).toBeNull();
    expect(resolveUri("file:///home/me/x.stl", urdf, {})).toBeNull();
  });

  it("turns Fuel URLs into zip downloads", () => {
    expect(fuelZipUrl("https://fuel.gazebosim.org/1.0/OpenRobotics/models/Table")).toBe(
      "https://fuel.gazebosim.org/1.0/OpenRobotics/models/Table.zip",
    );
    expect(fuelZipUrl("https://fuel.gazebosim.org/1.0/OpenRobotics/worlds/Depot/3")).toBe(
      "https://fuel.gazebosim.org/1.0/OpenRobotics/worlds/Depot/3/Depot.zip",
    );
    expect(fuelZipUrl("https://fuel.ignitionrobotics.org/1.0/OpenRobotics/models/House 1")).toBe(
      "https://fuel.gazebosim.org/1.0/OpenRobotics/models/House%201.zip",
    );
  });
});

describe("SDF environments", () => {
  it("composes model, link and visual poses and follows includes", async () => {
    const world = `<sdf version="1.9"><world name="w">
      <model name="ground_plane"><static>true</static><link name="l"><collision name="c"><geometry><plane><normal>0 0 1</normal><size>100 100</size></plane></geometry></collision></link></model>
      <model name="crate"><pose>1 0 0 0 0 0</pose><link name="l"><pose>0 0 0.5 0 0 0</pose>
        <visual name="v"><geometry><box><size>1 1 1</size></box></geometry><material><diffuse>0 0 1 1</diffuse></material></visual></link></model>
      <include><uri>model://table</uri><pose>0 2 0 0 0 1.5708</pose></include>
    </world></sdf>`;
    const table = `<sdf version="1.9"><model name="table"><pose>5 5 5 0 0 0</pose><link name="top"><visual name="top"><pose>0 0 0.7 0 0 0</pose><geometry><mesh><uri>meshes/top.obj</uri></mesh></geometry></visual></link></model></sdf>`;
    const { env, skipped } = await sdfToEnvironment(
      world,
      "base",
      {
        include: async (uri) =>
          uri === "model://table" ? { sdf: table, base: "base/table" } : null,
        mesh: async (uri, base) =>
          base === "base/table" && uri === "meshes/top.obj"
            ? loadMesh("top.obj", enc("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"))
            : null,
      },
      { id: "t", name: "T", description: "" },
    );
    expect(skipped).toEqual([]);
    const crate = env.objects.find((o) => o.name.startsWith("crate"))!;
    expect(crate.pose.xyz).toEqual([1, 0, 0.5]);
    expect(crate.color).toEqual([0, 0, 1, 1]);
    const top = env.objects.find((o) => o.name.startsWith("table"))!;
    // The include pose replaces the model's own pose.
    expect(top.pose.xyz[0]).toBeCloseTo(0, 6);
    expect(top.pose.xyz[1]).toBeCloseTo(2, 6);
    expect(top.pose.xyz[2]).toBeCloseTo(0.7, 6);
    expect(top.geometry.type).toBe("mesh");
    // The infinite ground plane is not duplicated.
    expect(env.objects.some((o) => o.name.startsWith("ground_plane"))).toBe(false);
  });
});
