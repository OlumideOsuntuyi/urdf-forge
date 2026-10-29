import { describe, expect, it } from "vitest";
import { meshPathCandidates, meshUris } from "../src/app/meshPaths";

describe("finding URDF meshes on disk", () => {
  it("lists mesh filenames once each", () => {
    const xml = `<robot><link><visual><geometry><mesh filename="package://p/a.stl" scale="1 1 1"/></geometry></visual>
      <collision><geometry><mesh scale="1 1 1" filename="package://p/a.stl"/></geometry></collision></link>
      <link><visual><geometry><mesh filename="file:///opt/b.dae"/></geometry></visual></link></robot>`;
    expect(meshUris(xml)).toEqual(["package://p/a.stl", "file:///opt/b.dae"]);
  });

  it("uses file:// paths as they are, including Windows drives and escapes", () => {
    expect(meshPathCandidates("file:///home/u/ws/m%20x.stl", "/tmp/r.urdf")).toEqual([
      "/home/u/ws/m x.stl",
    ]);
    expect(meshPathCandidates("file:///C:/ws/m.stl", "C:\\ws\\r.urdf")).toEqual(["C:/ws/m.stl"]);
  });

  it("finds package:// meshes in a source checkout above the URDF", () => {
    expect(
      meshPathCandidates(
        "package://ubot_description/meshes/inspection/base.stl",
        "/home/u/ws/src/ubot/ubot_description/urdf/body/ubot.urdf.xacro",
      ),
    ).toEqual(["/home/u/ws/src/ubot/ubot_description/meshes/inspection/base.stl"]);
    expect(meshPathCandidates("package://pkg/meshes/m.stl", "C:\\ws\\pkg\\urdf\\r.urdf")).toEqual([
      "C:\\ws\\pkg\\meshes\\m.stl",
    ]);
    expect(meshPathCandidates("package://other/m.stl", "/ws/pkg/urdf/r.urdf")).toEqual([]);
  });

  it("resolves relative and absolute paths, and ignores web and model URIs", () => {
    expect(meshPathCandidates("../meshes/m.stl", "/ws/pkg/urdf/r.urdf")).toEqual([
      "/ws/pkg/urdf/../meshes/m.stl",
    ]);
    expect(meshPathCandidates("/abs/m.stl", "/ws/r.urdf")).toEqual(["/abs/m.stl"]);
    expect(meshPathCandidates("https://x.org/m.stl", "/ws/r.urdf")).toEqual([]);
    expect(meshPathCandidates("model://thing/m.dae", "/ws/r.urdf")).toEqual([]);
  });
});
