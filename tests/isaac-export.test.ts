// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { newLink, newModel, type RobotModel } from "../src/core/model";
import {
  buildIsaacExport,
  convertPs1,
  convertSh,
  generateIsaacLabCfg,
  generateIsaacUrdf,
  isaacFixedBase,
  isaacJoints,
  isaacPaths,
  isaacSpawnPose,
  SPAWN_CLEARANCE,
} from "../src/core/isaac/export";
import { buildPackage } from "../src/core/ros/package";
import { generateUrdf } from "../src/core/ros/urdf";
import { importUrdf } from "../src/core/ros/importUrdf";
import { addLink, armRobot as arm, sampleRobot, wheelBiped as biped } from "./helpers";

const parse = (xml: string) => {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
  return doc;
};

describe("Isaac URDF", () => {
  it("writes mesh paths relative to the URDF and no ROS-only tags", () => {
    const { model } = sampleRobot();
    model.export.ros2Control = true;
    const xml = generateIsaacUrdf(model);
    parse(xml);
    expect(xml).toContain('filename="meshes/base.stl"');
    expect(xml).not.toContain("package://");
    expect(xml).not.toContain("model://");
    for (const tag of ["<gazebo", "<ros2_control", "<plugin", "<sensor", "$(find"])
      expect(xml).not.toContain(tag);
  });

  it("keeps the kinematics, inertials and collisions of the ROS export", () => {
    const { model } = sampleRobot();
    const isaac = parse(generateIsaacUrdf(model));
    const ros = parse(generateUrdf(model, "jazzy-harmonic"));
    for (const sel of [
      "robot > link",
      "robot > joint",
      "link > inertial",
      "link > collision",
      "link > visual",
      "joint > limit",
      "joint > axis",
    ])
      expect(isaac.querySelectorAll(sel).length, sel).toBe(ros.querySelectorAll(sel).length);
    const joints = (d: Document) =>
      [...d.getElementsByTagName("joint")].map((j) => j.outerHTML).join("\n");
    expect(joints(isaac)).toBe(joints(ros));
  });

  it("round-trips through the URDF importer", () => {
    const { model } = sampleRobot();
    const asset = model.meshes[0];
    const { model: back, missing } = importUrdf(generateIsaacUrdf(model), (uri) =>
      uri === "meshes/base.stl" ? asset : undefined,
    );
    expect(missing).toEqual([]);
    expect(back.links.map((l) => l.name)).toEqual(["base_link", "arm", "wheel"]);
  });

  it("drops a bare world anchor and writes inertia for a massless root frame", () => {
    const xml = generateIsaacUrdf(arm());
    const doc = parse(xml);
    const links = [...doc.getElementsByTagName("link")].map((l) => l.getAttribute("name"));
    expect(links).toEqual(["base_link", "shoulder", "elbow", "slider"]);
    expect(xml).not.toContain('link="world"');

    const m = newModel("footprint");
    const fp = newLink("base_footprint");
    fp.inertial.mass = 0;
    m.links.push(fp);
    addLink(m, "base_link", fp, "fixed");
    const fpXml = parse(generateIsaacUrdf(m)).getElementsByTagName("link")[0];
    expect(fpXml.getElementsByTagName("inertial")).toHaveLength(1);
  });

  it("does not change the ROS package", () => {
    const { model } = sampleRobot();
    const before = buildPackage(model, new Map());
    buildIsaacExport(model, new Map());
    const after = buildPackage(model, new Map());
    expect([...after.keys()]).toEqual([...before.keys()]);
    expect([...before.keys()].some((k) => k.includes("isaac"))).toBe(false);
  });
});

describe("Isaac Lab cfg", () => {
  it("groups an arm's joints for position control with limits from the URDF", () => {
    const m = arm();
    const joints = isaacJoints(m);
    expect(joints.map((j) => [j.name, j.group])).toEqual([
      ["shoulder_joint", "position"],
      ["elbow_joint", "position"],
      ["slider_joint", "position"],
    ]);
    const shoulder = joints[0];
    expect(shoulder.effort).toBe(40);
    expect(shoulder.velocity).toBe(3);
    expect(shoulder.stiffness).toBeCloseTo(200); // 40 N·m at 0.2 rad
    expect(shoulder.damping).toBeCloseTo(10);
    expect(joints[2].stiffness).toBeCloseTo(5000); // 100 N at 2 cm
    expect(joints[0].initial).toBe(0.5);
    expect(joints[1].initial).toBeCloseTo(Math.PI / 2); // clamped to the upper limit

    const cfg = generateIsaacLabCfg(m);
    expect(cfg).toContain("FIX_BASE = True");
    expect(cfg).toContain("ARM_BOT_CFG = ArticulationCfg(");
    expect(cfg).toContain('"position": ImplicitActuatorCfg(');
    expect(cfg).toContain('joint_names_expr=["shoulder_joint", "elbow_joint", "slider_joint"]');
    expect(cfg).toMatch(/joint_effort_limit=\{\n\s+"shoulder_joint": 40\.0,/);
    expect(cfg).toMatch(/joint_velocity_limit=\{\n\s+"shoulder_joint": 3\.0,/);
    expect(cfg).not.toContain('"velocity": ImplicitActuatorCfg(');
  });

  it("spawns a world-anchored arm where the anchor put it", () => {
    const m = arm();
    expect(isaacFixedBase(m)).toBe(true);
    const pose = isaacSpawnPose(m, true);
    expect(pose.pos).toEqual([0.5, 0, 0.8]);
    expect(pose.rot).toEqual([0, 0, 0, 1]);
    expect(generateIsaacLabCfg(m)).toContain("pos=(0.5, 0.0, 0.8),");
  });

  it("turns a root link's editor placement into the spawn pose", () => {
    // Root frame 0.09 m up, wheels of radius 0.05 at -0.02 below it: 0.07 m from root to floor.
    const m = newModel("rover");
    const base = addLink(m, "base_link", null, "fixed");
    base.origin = { xyz: [0.3, 0, 0.09], rpy: [0, 0, Math.PI / 2] };
    addLink(m, "wheel", base, "continuous", [0, 0.1, -0.02], (l) => {
      l.collisions[0].geometry = { type: "sphere", radius: 0.05 };
    });
    const floating = isaacSpawnPose(m, false);
    expect(floating.pos[0]).toBe(0);
    expect(floating.pos[2]).toBeCloseTo(0.07 + SPAWN_CLEARANCE);
    expect(floating.rot[2]).toBeCloseTo(Math.SQRT1_2); // yaw 90° about z
    expect(floating.rot[3]).toBeCloseTo(Math.SQRT1_2);
    const fixed = isaacSpawnPose(m, true);
    expect(fixed.pos[0]).toBeCloseTo(0.3);
    expect(fixed.pos[2]).toBeCloseTo(0.09); // already above the ground
  });

  it("drives a wheeled base's wheels by velocity on a floating base", () => {
    const { model } = sampleRobot();
    expect(isaacFixedBase(model)).toBe(false);
    const joints = isaacJoints(model);
    const wheel = joints.find((j) => j.name === "wheel_joint")!;
    expect(wheel.group).toBe("velocity");
    expect(wheel.stiffness).toBe(0);
    // effort 10 N·m, velocity 2 rad/s: full effort 0.2 rad/s below target
    expect(wheel.damping).toBeCloseTo(50);
    const cfg = generateIsaacLabCfg(model);
    expect(cfg).toContain("FIX_BASE = False");
    expect(cfg).toMatch(
      /"velocity": ImplicitActuatorCfg\(\n\s+joint_names_expr=\["wheel_joint"\],[\s\S]*?stiffness=\{\n\s+"wheel_joint": 0\.0,/,
    );
  });

  it("handles a wheel-legged biped: revolute legs by position, wheels by velocity", () => {
    const m = biped();
    expect(isaacFixedBase(m)).toBe(false);
    const joints = isaacJoints(m);
    const by = (g: string) => joints.filter((j) => j.group === g).map((j) => j.name);
    expect(by("position")).toEqual([
      "left_upper_joint",
      "left_lower_joint",
      "right_upper_joint",
      "right_lower_joint",
    ]);
    expect(by("velocity")).toEqual(["left_wheel_joint", "right_wheel_joint"]);
    // Fixed motor mounts are not joints Isaac Lab sees.
    expect(joints.some((j) => j.name.includes("motor"))).toBe(false);

    const cfg = generateIsaacLabCfg(m);
    expect(cfg).toMatch(/"left_upper_joint": 0\.4,/);
    expect(cfg).toMatch(/"left_lower_joint": -0\.8,/);
    expect(cfg).toMatch(/"left_wheel_joint": 0\.0,/);
    expect(cfg).toContain("rot=(0.0, 0.0, 0.0, 1.0),  # x, y, z, w");
    // Floating: the lowest point of the posed robot starts just above the ground.
    const pose = isaacSpawnPose(m, false);
    expect(pose.pos[2]).toBeGreaterThan(SPAWN_CLEARANCE);
  });

  it("puts uncontrolled and mimic joints in an undriven group", () => {
    const m = biped();
    m.links.find((l) => l.name === "left_wheel")!.controlled = false;
    const lower = m.links.find((l) => l.name === "right_lower")!;
    lower.joint.mimic = { joint: "left_lower_joint", multiplier: 1, offset: 0 };
    lower.joint.damping = 0.3;
    const joints = isaacJoints(m);
    const passive = joints.filter((j) => j.group === "passive");
    expect(passive.map((j) => j.name)).toEqual(["left_wheel_joint", "right_lower_joint"]);
    expect(passive[1].stiffness).toBe(0);
    expect(passive[1].damping).toBe(0.3);
    expect(generateIsaacLabCfg(m)).toContain('"passive": ImplicitActuatorCfg(');
  });

  it("lets the export setting and the app's hint decide the base", () => {
    const m = biped();
    expect(isaacFixedBase(m, true)).toBe(true); // hint: an arm
    m.export.isaac.base = "floating";
    expect(isaacFixedBase(m, true)).toBe(false);
    m.export.isaac.base = "fixed";
    expect(isaacFixedBase(m)).toBe(true);
    expect(generateIsaacLabCfg(m)).toContain("FIX_BASE = True");
    expect(convertPs1(m)).toContain("--merge_joints --fix_base");
    // A model saved before the setting existed.
    const old = arm();
    delete (old.export as Partial<RobotModel["export"]>).isaac;
    expect(isaacFixedBase(old)).toBe(true);
  });

  it("uses Isaac Lab 3 names and spawns from USD when it is converted", () => {
    const cfg = generateIsaacLabCfg(biped());
    for (const s of [
      "from isaaclab.actuators import ImplicitActuatorCfg",
      "from isaaclab.assets import ArticulationCfg",
      "sim_utils.UsdFileCfg(",
      "sim_utils.UrdfFileCfg(",
      "fix_base=FIX_BASE,",
      "fix_root_link=FIX_BASE,",
      "merge_fixed_joints=True,",
      "init_state=ArticulationCfg.InitialStateCfg(",
      'USD_PATH = os.path.join(USD_DIR, "wheel_biped", "wheel_biped.usda")',
      'URDF_PATH = os.path.join(ASSET_DIR, "urdf", "wheel_biped.urdf")',
    ])
      expect(cfg).toContain(s);
    // Deprecated in Isaac Lab 3 and removed in 3.1.
    expect(cfg).not.toMatch(
      /effort_limit_sim|velocity_limit_sim|[^_]effort_limit=|[^_]velocity_limit=/,
    );
    expect(cfg).not.toContain("package://");
  });

  it("turns on self-collision when a link asks for it", () => {
    const m = biped();
    expect(generateIsaacLabCfg(m)).not.toContain("PhysxArticulationCfg");
    m.links[1].gazebo.selfCollide = true;
    const cfg = generateIsaacLabCfg(m);
    expect(cfg).toContain("self_collision=True,");
    expect(cfg).toContain("PhysxArticulationCfg(enabled_self_collisions=True)");
    expect(cfg).toContain("from isaaclab_physx.sim.schemas import PhysxArticulationCfg");
  });

  it("writes an empty actuator map for a robot without moving joints", () => {
    const m = newModel("brick");
    addLink(m, "base_link", null, "fixed");
    expect(generateIsaacLabCfg(m)).toContain("actuators={},");
  });
});

describe("Isaac export folder", () => {
  it("contains the URDF, meshes, cfg, scripts and README", () => {
    const { model } = sampleRobot();
    const stl = new Uint8Array([1, 2, 3]);
    const files = buildIsaacExport(model, new Map([["base.stl", stl]]));
    const p = isaacPaths(model);
    expect([...files.keys()].sort()).toEqual(
      [
        "README.md",
        "convert_to_usd.ps1",
        "convert_to_usd.sh",
        "isaaclab/check_test_bot.py",
        "isaaclab/test_bot_cfg.py",
        "urdf/meshes/base.stl",
        "urdf/test_bot.urdf",
      ].sort(),
    );
    expect(files.get(`${p.meshDir}/base.stl`)).toBe(stl);
    expect(p.usd).toBe("usd/test_bot/test_bot.usda");
  });

  it("runs Isaac Lab's convert_urdf.py through uv from a configurable checkout", () => {
    const { model } = sampleRobot();
    const ps1 = convertPs1(model, "D:\\Isaac\\IsaacLab");
    expect(ps1).toContain("[string]$IsaacLab = $(if ($env:ISAACLAB_PATH)");
    expect(ps1).toContain("'D:\\Isaac\\IsaacLab'");
    expect(ps1).toContain("scripts\\tools\\convert_urdf.py");
    expect(ps1).toContain("& uv run --extra isaacsim python $Tool $Urdf $UsdDir --merge_joints\n");
    expect(ps1).not.toContain("--fix_base");
    // PowerShell 5.1 reads BOM-less scripts as ANSI: ASCII only.
    expect([...ps1].every((c) => c === "\n" || (c >= " " && c <= "~"))).toBe(true);
    const sh = convertSh(model, "/opt/IsaacLab");
    expect(sh).toMatch(/^#!\/usr\/bin\/env bash/);
    expect(sh).toContain('ISAACLAB="${1:-${ISAACLAB_PATH:-/opt/IsaacLab}}"');
    expect(sh).toContain(
      'uv run --extra isaacsim python "$TOOL" "$URDF" "$USD_DIR" --merge_joints',
    );
    expect(convertSh(model, "C:\\Dev\\IsaacLab")).toContain("ISAACLAB_PATH:-$HOME/IsaacLab");
  });
});
