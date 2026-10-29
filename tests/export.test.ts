// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { generateUrdf } from "../src/core/ros/urdf";
import { generateXacro } from "../src/core/ros/xacro";
import { generateSdf } from "../src/core/ros/sdf";
import { buildPackage, controllersYaml } from "../src/core/ros/package";
import { importUrdf } from "../src/core/ros/importUrdf";
import { TARGET_IDS } from "../src/core/ros/targets";
import { validate } from "../src/core/validate";
import { computeInertial } from "../src/core/inertial";
import { sampleRobot } from "./helpers";

const parse = (xml: string) => {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
  return doc;
};

describe("URDF", () => {
  it.each(TARGET_IDS)("produces well-formed XML for %s", (t) => {
    const { model } = sampleRobot();
    model.export.ros2Control = true;
    const doc = parse(generateUrdf(model, t));
    expect(doc.getElementsByTagName("link")).toHaveLength(3);
    expect(doc.getElementsByTagName("joint").length).toBeGreaterThanOrEqual(2);
  });

  it("writes package:// mesh URIs", () => {
    const { model } = sampleRobot();
    expect(generateUrdf(model, "jazzy-harmonic")).toContain(
      'filename="package://test_bot_description/meshes/base.stl"',
    );
  });

  it("uses per-target ros2_control plugins", () => {
    const { model } = sampleRobot();
    model.export.ros2Control = true;
    expect(generateUrdf(model, "jazzy-harmonic")).toContain("gz_ros2_control/GazeboSimSystem");
    expect(generateUrdf(model, "humble-classic")).toContain("gazebo_ros2_control/GazeboSystem");
  });

  it("gives wheels a velocity interface and servos a position interface", () => {
    const { model } = sampleRobot();
    model.export.ros2Control = true;
    const yaml = controllersYaml(model);
    expect(yaml).toContain("velocity_controller:");
    expect(yaml).toContain("position_controller:");
    expect(yaml).toMatch(
      /velocity_controller:\n {2}ros__parameters:\n {4}joints:\n {6}- wheel_joint/,
    );
  });

  it("round-trips through the importer", () => {
    const { model } = sampleRobot();
    const xml = generateUrdf(model, "jazzy-harmonic");
    const asset = model.meshes[0];
    const { model: back, missing } = importUrdf(xml, (uri) =>
      uri.endsWith("/base.stl") ? asset : undefined,
    );
    expect(missing).toEqual([]);
    expect(back.links.map((l) => l.name)).toEqual(["base_link", "arm", "wheel"]);
    const arm = back.links.find((l) => l.name === "arm")!;
    expect(arm.joint.type).toBe("revolute");
    expect(arm.joint.axis).toEqual([0, 1, 0]);
    expect(arm.origin.xyz).toEqual([0, 0, 0.1]);
    expect(arm.parentId).toBe(back.links[0].id);
  });

  it("reports unknown meshes on import", () => {
    const xml = `<robot name="r"><link name="a"><visual><geometry><mesh filename="package://x/m.stl"/></geometry></visual></link></robot>`;
    expect(importUrdf(xml, () => undefined).missing).toEqual(["package://x/m.stl"]);
  });
});

describe("xacro and SDF", () => {
  it("emits one xacro:if block per target", () => {
    const { model } = sampleRobot();
    const xml = generateXacro(model, ["humble-fortress", "jazzy-harmonic"], "jazzy-harmonic");
    parse(xml);
    expect(xml.match(/<xacro:if /g)).toHaveLength(2);
    expect(xml).toContain("${mesh_prefix}/base.stl");
  });

  it("places links in the model frame", () => {
    const { model } = sampleRobot();
    const doc = parse(generateSdf(model));
    const arm = [...doc.getElementsByTagName("link")].find(
      (l) => l.getAttribute("name") === "arm",
    )!;
    expect(arm.getElementsByTagName("pose")[0].textContent).toBe("0 0 0.1 0 0 0");
  });
});

describe("package", () => {
  it("contains everything colcon and the launch files need", () => {
    const { model } = sampleRobot();
    model.export.targets = ["humble-fortress", "jazzy-harmonic", "lyrical-jetty"];
    const files = buildPackage(model, new Map([["base.stl", new Uint8Array([1])]]));
    for (const f of [
      "package.xml",
      "CMakeLists.txt",
      "urdf/test_bot.urdf.xacro",
      "urdf/test_bot.jazzy-harmonic.urdf",
      "launch/gazebo_lyrical-jetty.launch.py",
      "launch/display.launch.py",
      "config/gz_bridge_humble-fortress.yaml",
      "worlds/empty_fortress.sdf",
      "meshes/base.stl",
    ])
      expect(files.has(f), f).toBe(true);
    expect(files.get("config/gz_bridge_humble-fortress.yaml")).toContain("ignition.msgs.Clock");
    expect(files.get("launch/gazebo_humble-fortress.launch.py")).toContain(
      "IGN_GAZEBO_RESOURCE_PATH",
    );
    parse(files.get("package.xml") as string);
  });
});

describe("validation and inertia", () => {
  it("accepts the sample robot", () => {
    const { model, meshes } = sampleRobot();
    model.links = model.links.map((l) => ({
      ...l,
      inertial: computeInertial(l, (id) => meshes.get(id)),
    }));
    expect(validate(model).filter((i) => i.level === "error")).toEqual([]);
  });

  it("catches broken trees and limits", () => {
    const { model } = sampleRobot();
    model.links[1].parentId = null;
    model.links[1].joint.lower = 2;
    model.links[1].joint.upper = 1;
    model.links[2].name = "base_link";
    const msgs = validate(model)
      .map((i) => i.message)
      .join("\n");
    expect(msgs).toMatch(/2 root links/);
    expect(msgs).toMatch(/Link name "base_link" is used 2 times/);
  });

  it("computes density-based mass from mesh volume", () => {
    const { model, meshes } = sampleRobot();
    const ine = computeInertial(model.links[0], (id) => meshes.get(id));
    expect(ine.volume).toBeCloseTo(0.004, 6);
    expect(ine.mass).toBeCloseTo(4, 4);
  });
});

describe("ROS URDF conventions", () => {
  // Shaped like xacro output: a footprint frame and the same inline material on two visuals.
  const XACRO_STYLE = `<robot name="r">
    <link name="base_footprint"/>
    <link name="base_link">
      <inertial><mass value="1"/><inertia ixx="0.01" iyy="0.01" izz="0.01" ixy="0" ixz="0" iyz="0"/></inertial>
      <visual><geometry><box size="0.2 0.2 0.1"/></geometry>
        <material name="dark_gray"><color rgba="0.2 0.2 0.2 1"/></material></visual>
      <collision><geometry><box size="0.2 0.2 0.1"/></geometry></collision>
    </link>
    <link name="wheel">
      <inertial><mass value="0.1"/><inertia ixx="0.001" iyy="0.001" izz="0.001" ixy="0" ixz="0" iyz="0"/></inertial>
      <visual><geometry><cylinder radius="0.05" length="0.02"/></geometry>
        <material name="dark_gray"><color rgba="0.2 0.2 0.2 1"/></material></visual>
      <collision><geometry><cylinder radius="0.05" length="0.02"/></geometry></collision>
    </link>
    <link name="camera_optical_frame"/>
    <joint name="base_joint" type="fixed"><parent link="base_footprint"/><child link="base_link"/></joint>
    <joint name="wheel_joint" type="continuous"><parent link="base_link"/><child link="wheel"/><axis xyz="0 1 0"/></joint>
    <joint name="optical_joint" type="fixed"><parent link="base_link"/><child link="camera_optical_frame"/></joint>
  </robot>`;

  const topMaterials = (xml: string) =>
    [...parse(xml).documentElement.children]
      .filter((c) => c.tagName === "material")
      .map((m) => m.getAttribute("name"));

  it("imports a repeated inline material once", () => {
    const { model } = importUrdf(XACRO_STYLE, () => undefined);
    expect(model.materials.map((m) => m.name)).toEqual(["dark_gray"]);
    expect(topMaterials(generateUrdf(model, "jazzy-harmonic"))).toEqual(["dark_gray"]);
  });

  it("never writes two top-level materials with the same name", () => {
    const { model } = sampleRobot();
    // Same name as the default material, different colour.
    model.materials.push({ ...model.materials[0], id: "mat_second", rgba: [1, 0, 0, 1] });
    model.links[1].visuals[0].materialId = "mat_second";
    const xml = generateUrdf(model, "jazzy-harmonic");
    const names = topMaterials(xml);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(2);
  });

  it("writes no inertia on a massless root frame", () => {
    const { model } = importUrdf(XACRO_STYLE, () => undefined);
    const doc = parse(generateUrdf(model, "jazzy-harmonic"));
    const link = (n: string) =>
      [...doc.getElementsByTagName("link")].find((l) => l.getAttribute("name") === n)!;
    expect(link("base_footprint").getElementsByTagName("inertial")).toHaveLength(0);
    expect(link("camera_optical_frame").getElementsByTagName("inertial")).toHaveLength(1);
    expect(link("base_link").getElementsByTagName("inertial")).toHaveLength(1);
  });

  it("does not warn about missing geometry on pure frames", () => {
    const { model } = importUrdf(XACRO_STYLE, () => undefined);
    const msgs = validate(model).map((i) => i.message);
    expect(msgs.filter((m) => /base_footprint|camera_optical_frame/.test(m))).toEqual([]);
  });
});
