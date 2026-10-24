import { beforeAll, describe, expect, it } from "vitest";
import { Vector3, type Matrix4 } from "three";
import { buildSampleRobot } from "../src/app/sample";
import { insertPartIn } from "../src/app/parts";
import { PART_LIBRARY, defaults } from "../src/core/parts";
import { linkById, newModel, type RobotModel } from "../src/core/model";
import { initPhysics, PhysicsSim } from "../src/sim/physics";
import {
  armWaypoints,
  detectBehaviors,
  findLegs,
  findWheels,
  inputFromKeys,
  leggedGait,
  suggestBehavior,
  wheeledDrive,
  type Behavior,
  type TeleopInput,
} from "../src/sim/behaviors";

const part = (id: string) => PART_LIBRARY.find((t) => t.id === id)!;
const input = (forward = 0, turn = 0, strafe = 0): TeleopInput => ({ forward, turn, strafe });

/** Ticks a behaviour in pose mode (joints = last commands) and returns every frame's commands. */
function run(b: Behavior, model: RobotModel, seconds: number, inp = input(), dt = 0.01) {
  const frames: Record<string, number>[] = [];
  let joints: Record<string, number> = {};
  for (let i = 0; i <= Math.round(seconds / dt); i++) {
    const cmd = b.tick({ model, time: i * dt, dt, input: inp, joints });
    joints = { ...joints, ...cmd };
    frames.push(cmd);
  }
  return frames;
}

function diffDrive(): RobotModel {
  const m = newModel();
  insertPartIn(m, part("asm_diff_drive"), defaults(part("asm_diff_drive")), null);
  return m;
}

function quadruped(): RobotModel {
  const m = newModel("quad");
  const box = part("shape_box");
  const trunk = insertPartIn(m, box, { ...defaults(box), x: 0.5, y: 0.2, z: 0.1 }, null);
  const leg = part("asm_quadruped_leg");
  for (const [x, y] of [
    [0.2, 0.1],
    [0.2, -0.1],
    [-0.2, 0.1],
    [-0.2, -0.1],
  ]) {
    const id = insertPartIn(
      m,
      leg,
      { ...defaults(leg), side: y > 0 ? "left" : "right", thigh_length: 0.2, calf_length: 0.2 },
      trunk,
    );
    linkById(m, id)!.origin.xyz = [x, y, -0.03];
  }
  return m;
}

function arm6(): RobotModel {
  const m = newModel("arm6");
  insertPartIn(m, part("asm_arm_6dof"), defaults(part("asm_arm_6dof")), null);
  return m;
}

function expectWithinLimits(m: RobotModel, frames: Record<string, number>[]) {
  for (const f of frames)
    for (const [id, v] of Object.entries(f)) {
      const L = linkById(m, id)!;
      expect(Number.isFinite(v), L.name).toBe(true);
      if (L.joint.type === "revolute" || L.joint.type === "prismatic") {
        expect(v, L.name).toBeGreaterThanOrEqual(L.joint.lower - 1e-9);
        expect(v, L.name).toBeLessThanOrEqual(L.joint.upper + 1e-9);
      }
    }
}

const yaw = (m: Matrix4) => Math.atan2(m.elements[1], m.elements[0]);

describe("wheeled drive", () => {
  it("finds the sample rover's four wheels, two per side", () => {
    const m = buildSampleRobot();
    const wheels = findWheels(m);
    expect(wheels.length).toBe(4);
    expect(wheels.filter((w) => w.side === "left").length).toBe(2);
    expect(wheels.filter((w) => w.side === "right").length).toBe(2);
    for (const w of wheels) expect(w.radius).toBeCloseTo(0.07, 3);
    const b = wheeledDrive.detect(m)!;
    expect(b).not.toBeNull();
    expect(b.teleop).toBe(true);
    expect(new Set(b.velocityJoints)).toEqual(new Set(wheels.map((w) => w.linkId)));
    expect(suggestBehavior(m)?.id).toBe("drive");
  });

  it("forward moves every wheel the same way; turning spins the sides oppositely", () => {
    const m = buildSampleRobot();
    const wheels = findWheels(m);
    const b = wheeledDrive.detect(m)!;
    // Ground speed of each wheel along +X: spin * radius * rolling direction.
    const ground = (cmd: Record<string, number>) =>
      wheels.map((w) => ({ side: w.side, vx: cmd[w.linkId] * w.radius * w.rollDir[0] }));

    const fwd = run(b, m, 2, input(1)).at(-1)!;
    for (const g of ground(fwd)) expect(g.vx).toBeCloseTo(0.6, 2);

    const b2 = wheeledDrive.detect(m)!;
    const turn = run(b2, m, 2, input(0, 1)).at(-1)!;
    for (const g of ground(turn)) {
      if (g.side === "left") expect(g.vx).toBeLessThan(-0.1);
      else expect(g.vx).toBeGreaterThan(0.1);
    }
  });

  it("ramps commands instead of jumping", () => {
    const m = buildSampleRobot();
    const b = wheeledDrive.detect(m)!;
    const frames = run(b, m, 1, input(1));
    const id = b.velocityJoints[0];
    for (let i = 1; i < frames.length; i++)
      expect(Math.abs(frames[i][id] - frames[i - 1][id])).toBeLessThan(0.5);
  });

  it("detects a parts-library diff-drive base and leaves the caster out", () => {
    const m = diffDrive();
    const wheels = findWheels(m);
    expect(wheels.map((w) => w.name).sort()).toEqual(["left_wheel", "right_wheel"]);
    const caster = m.links.find((l) => l.name === "rear_caster_wheel")!;
    const b = wheeledDrive.detect(m)!;
    expect(b.velocityJoints).not.toContain(caster.id);
    const cmd = run(b, m, 2, input(1)).at(-1)!;
    for (const w of wheels) expect(cmd[w.linkId] * w.rollDir[0]).toBeGreaterThan(0);
    expect(leggedGait.detect(m)).toBeNull();
    expect(armWaypoints.detect(m)).toBeNull();
  });

  it("detects a parts-library skid-steer base", () => {
    const m = newModel();
    insertPartIn(m, part("asm_skid_steer"), defaults(part("asm_skid_steer")), null);
    const wheels = findWheels(m);
    expect(wheels.length).toBe(4);
    expect(wheels.filter((w) => w.side === "left").length).toBe(2);
    expect(wheeledDrive.detect(m)).not.toBeNull();
  });

  it("maps keys to teleop input", () => {
    expect(inputFromKeys(new Set(["w", "a"]))).toEqual({ forward: 1, turn: 1, strafe: 0 });
    expect(inputFromKeys(new Set(["ArrowDown", "KeyE"]))).toEqual({
      forward: -1,
      turn: 0,
      strafe: -1,
    });
    expect(inputFromKeys(new Set(["w", " "]))).toEqual({ forward: 0, turn: 0, strafe: 0 });
  });
});

describe("legged gait", () => {
  it("finds four legs on a library quadruped and keeps targets within limits", () => {
    const m = quadruped();
    const legs = findLegs(m);
    expect(legs.length).toBe(4);
    for (const leg of legs) {
      expect(leg.abduction).not.toBeNull();
      expect(linkById(m, leg.hip)!.name).toMatch(/^thigh/);
      expect(linkById(m, leg.knee)!.name).toMatch(/^calf/);
    }
    const b = leggedGait.detect(m)!;
    expect(b).not.toBeNull();
    expect(b.teleop).toBe(true);
    expect(b.velocityJoints).toEqual([]);
    expect(suggestBehavior(m)?.id).toBe("gait");
    expect(wheeledDrive.detect(m)).toBeNull();
    expect(armWaypoints.detect(m)).toBeNull();

    const frames = run(b, m, 3, input(1, 0.3));
    expectWithinLimits(m, frames);
    const knees = legs.map((l) => l.knee);
    // Knees bend (crouched stance) and actually move during the gait.
    const last = frames.slice(150);
    for (const k of knees) {
      const vals = last.map((f) => f[k]);
      expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0.05);
      expect(Math.max(...vals)).toBeLessThan(-0.3);
    }
    // Trot: diagonal legs move together, neighbours in antiphase.
    const byPos = (sx: number, sy: number) =>
      legs.find((l) => Math.sign(l.hipPos[0]) === sx && Math.sign(l.hipPos[1]) === sy)!;
    const fl = byPos(1, 1).knee;
    const rr = byPos(-1, -1).knee;
    const fr = byPos(1, -1).knee;
    for (const f of last) expect(f[fl]).toBeCloseTo(f[rr], 6);
    expect(last.some((f) => Math.abs(f[fl] - f[fr]) > 0.05)).toBe(true);
    // No jumps between 10 ms ticks.
    for (let i = 1; i < frames.length; i++)
      for (const id of Object.keys(frames[i]))
        expect(Math.abs(frames[i][id] - frames[i - 1][id])).toBeLessThan(0.2);
  });
});

describe("arm waypoints", () => {
  it("detects the 6-DOF arm and moves it smoothly within limits", () => {
    const m = arm6();
    const b = armWaypoints.detect(m)!;
    expect(b).not.toBeNull();
    expect(b.teleop).toBe(false);
    expect(
      Object.keys(b.tick({ model: m, time: 0, dt: 0.01, input: input(), joints: {} })).length,
    ).toBe(6);
    const b2 = armWaypoints.detect(m)!;
    const frames = run(b2, m, 20);
    expectWithinLimits(m, frames);
    for (let i = 1; i < frames.length; i++)
      for (const id of Object.keys(frames[i]))
        expect(Math.abs(frames[i][id] - frames[i - 1][id])).toBeLessThan(0.2);
    // It really moves: some joint travels well away from home.
    const peak = Math.max(...frames.flatMap((f) => Object.values(f).map(Math.abs)));
    expect(peak).toBeGreaterThan(0.5);
    expect(suggestBehavior(m)?.id).toBe("arm");
    expect(detectBehaviors(m).map((x) => x.id)).toEqual(["arm"]);
  });

  it("drives the sample rover's arm and gripper (with its mimic finger)", () => {
    const m = buildSampleRobot();
    const b = armWaypoints.detect(m)!;
    expect(b).not.toBeNull();
    const left = m.links.find((l) => l.name === "finger_left")!;
    const right = m.links.find((l) => l.name === "finger_right")!;
    const frames = run(b, m, 12);
    expectWithinLimits(m, frames);
    const lv = frames.map((f) => f[left.id]);
    expect(Math.max(...lv) - Math.min(...lv)).toBeGreaterThan(0.015);
    for (const f of frames) expect(f[right.id]).toBeCloseTo(f[left.id], 9);
    expect(detectBehaviors(m).map((x) => x.id)).toEqual(["drive", "arm"]);
  });
});

describe("drive behaviour in physics", () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it("drives the sample rover forward and turns it in place", () => {
    const m = buildSampleRobot();
    for (const l of m.links) if (l.drive.mode === "servo") l.drive = { ...l.drive, sweep: false };
    const b = wheeledDrive.detect(m)!;
    // PhysicsSim treats overrides as velocities only for wheel-mode links.
    for (const id of b.velocityJoints) linkById(m, id)!.drive.mode = "wheel";
    const sim = new PhysicsSim(m, () => undefined, {
      fixedBase: false,
      gravity: true,
      stiffness: 1,
      damping: 1,
    });
    const base = m.links[0].id;
    const dt = 1 / 60;
    let t = 0;
    const drive = (inp: TeleopInput, seconds: number) => {
      for (let i = 0; i < Math.round(seconds / dt); i++) {
        const cmd = b.tick({ model: m, time: t, dt, input: inp, joints: sim.jointPositions() });
        sim.step(dt, cmd);
        t += dt;
      }
      return sim.linkWorlds().get(base)!;
    };
    const p0 = new Vector3().setFromMatrixPosition(drive(input(), 0.5));
    const w1 = drive(input(1), 3);
    const p1 = new Vector3().setFromMatrixPosition(w1);
    expect(p1.x - p0.x).toBeGreaterThan(0.5);
    expect(Math.abs(p1.y - p0.y)).toBeLessThan(0.15);
    const h1 = yaw(drive(input(), 1));
    // 1.5 s at up to 1.5 rad/s stays under half a turn, so the wrapped difference is unambiguous.
    const h2 = yaw(drive(input(0, 1), 1.5));
    sim.dispose();
    let dh = h2 - h1;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    expect(dh).toBeGreaterThan(0.5);
  });
});
