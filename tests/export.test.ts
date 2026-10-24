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
