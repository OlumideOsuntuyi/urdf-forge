import { beforeAll, describe, expect, it } from "vitest";
import { buildSampleRobot } from "../src/app/sample";
import { initPhysics, PhysicsSim } from "../src/sim/physics";
import { jointName, type RobotModel } from "../src/core/model";
import { Vector3 } from "three";
import { PROCEDURAL_ENVS } from "../src/core/env/procedural";
import { importUrdf } from "../src/core/ros/importUrdf";
import { wheeledDrive } from "../src/sim/behaviors";
import { Window } from "happy-dom";

globalThis.DOMParser ??= new Window().DOMParser as unknown as typeof DOMParser;

/** A TurtleBot3-like base: centre of mass on the axle, light rear casters, massless frames. */
const TB3_LIKE = `<robot name="tb">
  <link name="base_footprint"/>
  <joint name="base_joint" type="fixed"><parent link="base_footprint"/><child link="base_link"/><origin xyz="0 0 0.010"/></joint>
  <link name="base_link">
    <collision><origin xyz="-0.064 0 0.047"/><geometry><box size="0.266 0.266 0.094"/></geometry></collision>
    <inertial><mass value="1.37"/><inertia ixx="0.0087" ixy="0" ixz="0" iyy="0.0087" iyz="0" izz="0.0145"/></inertial>
  </link>
  ${["left", "right"]
    .map(
      (
        s,
        i,
      ) => `<joint name="wheel_${s}_joint" type="continuous"><parent link="base_link"/><child link="wheel_${s}"/>
    <origin xyz="0 ${i ? -0.144 : 0.144} 0.023" rpy="-1.57 0 0"/><axis xyz="0 0 1"/></joint>
  <link name="wheel_${s}">
    <collision><geometry><cylinder length="0.018" radius="0.033"/></geometry></collision>
    <inertial><mass value="0.0285"/><inertia ixx="1.1e-5" ixy="0" ixz="0" iyy="1.1e-5" iyz="0" izz="2.1e-5"/></inertial>
  </link>
  <joint name="caster_${s}_joint" type="fixed"><parent link="base_link"/><child link="caster_${s}"/><origin xyz="-0.177 ${i ? -0.064 : 0.064} -0.004" rpy="-1.57 0 0"/></joint>
  <link name="caster_${s}">
    <collision><origin xyz="0 0.001 0"/><geometry><box size="0.030 0.009 0.020"/></geometry></collision>
    <inertial><mass value="0.005"/><inertia ixx="1e-6" ixy="0" ixz="0" iyy="1e-6" iyz="0" izz="1e-6"/></inertial>
  </link>`,
    )
    .join("")}
  <joint name="camera_joint" type="fixed"><parent link="base_link"/><child link="camera_link"/><origin xyz="0.073 -0.011 0.084"/></joint>
  <link name="camera_link"/>
  <joint name="scan_joint" type="fixed"><parent link="base_link"/><child link="base_scan"/><origin xyz="-0.064 0 0.122"/></joint>
  <link name="base_scan">
    <collision><geometry><cylinder length="0.0315" radius="0.055"/></geometry></collision>
    <inertial><mass value="0.114"/><inertia ixx="1e-4" ixy="0" ixz="0" iyy="1e-4" iyz="0" izz="1e-4"/></inertial>
  </link>
</robot>`;

const opts = { fixedBase: true, gravity: true, stiffness: 1, damping: 1 };

function run(model: RobotModel, seconds: number, o = opts) {
  const sim = new PhysicsSim(model, () => undefined, o);
  for (let t = 0; t < seconds; t += 1 / 60) sim.step(1 / 60);
  const out = { q: sim.jointPositions(), worlds: sim.linkWorlds() };
  sim.dispose();
  return out;
}

beforeAll(async () => {
  await initPhysics();
});

describe("physics preview", () => {
  it("servos hold their targets against gravity", () => {
    const m = buildSampleRobot();
    for (const l of m.links) if (l.drive.mode === "servo") l.drive = { ...l.drive, sweep: false };
    const { q } = run(m, 3);
    const report = m.links
      .filter((l) => l.drive.mode === "servo")
      .map((l) => ({ joint: jointName(l), target: l.drive.target, actual: q[l.id] }));
    for (const r of report)
      expect(Math.abs(r.actual - r.target), JSON.stringify(r)).toBeLessThan(0.05);
  });

  it("a fixed base stays where it was", () => {
    const m = buildSampleRobot();
    const base = m.links[0];
    const { worlds } = run(m, 2);
    const p = new Vector3().setFromMatrixPosition(worlds.get(base.id)!);
    expect(p.distanceTo(new Vector3(0, 0, base.origin.xyz[2]))).toBeLessThan(0.02);
  });

  it("rests on environment scenery and reports poses in the robot frame", () => {
    const m = buildSampleRobot();
    for (const l of m.links) if (l.drive.mode !== "none") l.drive = { ...l.drive, mode: "none" };
    const table = PROCEDURAL_ENVS.find((e) => e.id === "tabletop")!.build();
    // Spawn the rover on the table top (0.75 m) instead of at its edge.
    table.spawn = { xyz: [0.45, 0, 0.75], rpy: [0, 0, 0] };
    const sim = new PhysicsSim(m, () => undefined, { ...opts, fixedBase: false }, table);
    for (let t = 0; t < 2; t += 1 / 60) sim.step(1 / 60);
    const p = new Vector3().setFromMatrixPosition(sim.linkWorlds().get(m.links[0].id)!);
    sim.dispose();
    // Robot frame: the base settles near its normal height above the spawn point, not 0.75 m below.
    expect(p.z).toBeGreaterThan(0.03);
    expect(p.z).toBeLessThan(0.2);
  });

  it("builds every procedural environment", () => {
    for (const e of PROCEDURAL_ENVS) {
      const env = e.build();
      const sim = new PhysicsSim(buildSampleRobot(), () => undefined, opts, env);
      sim.step(1 / 60);
      sim.dispose();
      for (const k of Object.keys(env.meshes)) expect(env.meshes[k].length % 9).toBe(0);
    }
  });

  it("wheels drive a free base forward", () => {
    const m = buildSampleRobot();
    for (const l of m.links) if (l.drive.mode === "servo") l.drive = { ...l.drive, sweep: false };
    const base = m.links[0];
    const { worlds } = run(m, 3, { ...opts, fixedBase: false });
    const p = new Vector3().setFromMatrixPosition(worlds.get(base.id)!);
    // 4 rad/s on a 0.07 m wheel is ~0.28 m/s.
    expect(Math.hypot(p.x, p.y)).toBeGreaterThan(0.3);
    expect(p.z).toBeGreaterThan(0.03);
    expect(p.z).toBeLessThan(0.2);
  });

  it("keeps a TurtleBot-like base level at rest and drives it with the teleop controller", () => {
    const { model } = importUrdf(TB3_LIKE, () => undefined);
    // Links without <inertial> are massless frames, not 0.1 kg lumps at the camera.
    expect(model.links.find((l) => l.name === "camera_link")!.inertial.mass).toBeLessThan(1e-3);
    // Continuous joints without <limit> have no velocity limit in URDF.
    expect(model.links.find((l) => l.name === "wheel_left")!.joint.velocity).toBeGreaterThan(10);
    const drive = wheeledDrive.detect(model)!;
    expect(drive.velocityJoints).toHaveLength(2);
    for (const id of drive.velocityJoints) {
      const L = model.links.find((l) => l.id === id)!;
      L.drive = { ...L.drive, mode: "wheel", target: 0 };
    }
    const base = model.links.find((l) => l.name === "base_link")!;
    const sim = new PhysicsSim(model, () => undefined, { ...opts, fixedBase: false });
    const tilt = () => new Vector3(0, 0, 1).transformDirection(sim.linkWorlds().get(base.id)!);
    let worst = 0;
    let t = 0;
    const drive_ = (forward: number, seconds: number, measure = false) => {
      for (let i = 0; i < seconds * 60; i++) {
        t += 1 / 60;
        const input = { forward, turn: 0, strafe: 0 };
        sim.step(
          1 / 60,
          drive.tick({ model, time: t, dt: 1 / 60, input, joints: sim.jointPositions() }),
        );
        if (measure) worst = Math.max(worst, Math.hypot(tilt().x, tilt().y));
      }
    };
    drive_(0, 1); // lands from 2 mm up
    drive_(0, 2, true);
    expect(worst, "rocks at rest").toBeLessThan(0.02);
    drive_(1, 3);
    const p = new Vector3().setFromMatrixPosition(sim.linkWorlds().get(base.id)!);
    sim.dispose();
    expect(p.x).toBeGreaterThan(0.8);
  });
});
