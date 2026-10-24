/**
 * Drives the preview modes:
 * - pose: joint sliders, plus kinematic animation of wheels and servos when playing
 * - physics: Rapier simulation with motors on driven joints
 */
import type { Matrix4 } from "three";
import { clampJoint } from "@/core/kinematics";
import { hasJoint } from "@/core/model";
import { app, useApp } from "@/store/app";
import { meshStore } from "@/store/meshStore";
import type { PhysicsSim, SimOptions } from "./physics";
import {
  detectBehaviors,
  inputFromKeys,
  ZERO_INPUT,
  type Behavior,
  type TeleopInput,
} from "./behaviors";
import { linkById, type RobotModel } from "@/core/model";

// Rapier is several megabytes; load it the first time physics mode is used.
const physicsModule = () => import("./physics");
const initPhysics = async () => (await physicsModule()).initPhysics();
const createSim = async (...args: ConstructorParameters<typeof PhysicsSim>) =>
  new (await physicsModule()).PhysicsSim(...args);

export interface SimHost {
  setOverrideWorlds(w: Map<string, Matrix4> | null): void;
}

let host: SimHost | null = null;
let raf = 0;
let last = 0;
let physics: PhysicsSim | null = null;
let poseTime = 0;

// ------------------------------------------------------------------ behaviours and teleop

let behavior: Behavior | null = null;
let behaviorTime = 0;
const pressed = new Set<string>();
let padInput: TeleopInput | null = null;

/** Input from the on-screen drive pad (touch screens); null when released. */
export function setTeleopPad(i: TeleopInput | null) {
  padInput = i;
}

function teleopInput(): TeleopInput {
  if (padInput) return padInput;
  return pressed.size ? inputFromKeys(pressed) : ZERO_INPUT;
}

/** Pick the controller for the current robot from the user's choice. */
export function chooseBehavior(): Behavior | null {
  const s = app();
  const found = detectBehaviors(s.model);
  behavior =
    s.behaviorChoice === "none"
      ? null
      : s.behaviorChoice === "auto"
        ? (found[0] ?? null)
        : (found.find((b) => b.id === s.behaviorChoice) ?? found[0] ?? null);
  behaviorTime = 0;
  s.set(
    "simBehavior",
    behavior && { id: behavior.id, name: behavior.name, teleop: behavior.teleop },
  );
  return behavior;
}

export function availableBehaviors(): Behavior[] {
  return detectBehaviors(app().model);
}

// Drive keys (WASD, arrows, Q/E) belong to the robot while a teleop controller runs.
const TELEOP_CODES = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyQ",
  "KeyE",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);
if (typeof window !== "undefined") {
  const active = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return false;
    return (
      app().mode !== "edit" &&
      !!behavior?.teleop &&
      TELEOP_CODES.has(e.code) &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    );
  };
  window.addEventListener(
    "keydown",
    (e) => {
      if (!active(e)) return;
      pressed.add(e.code);
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!app().simRunning) void play();
    },
    { capture: true },
  );
  window.addEventListener(
    "keyup",
    (e) => {
      if (pressed.delete(e.code)) e.preventDefault();
    },
    { capture: true },
  );
  window.addEventListener("blur", () => pressed.clear());
}

export const simOptions: SimOptions = {
  fixedBase: true,
  gravity: true,
  stiffness: 1,
  damping: 1,
};

/** Whether physics mode decides the base itself (free when anything is a wheel). */
let autoBase = true;
export function setFixedBase(v: boolean) {
  autoBase = false;
  simOptions.fixedBase = v;
}

export function attachSimHost(h: SimHost | null) {
  host = h;
}

export function isPlaying() {
  return app().simRunning;
}

export async function play() {
  const s = app();
  if (s.mode === "edit") s.set("mode", "pose");
  if (app().mode === "physics" && !physics) await buildPhysics();
  s.set("simRunning", true);
  last = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}

export function pause() {
  app().set("simRunning", false);
  cancelAnimationFrame(raf);
}

export function reset() {
  pause();
  physics?.dispose();
  physics = null;
  poseTime = 0;
  behaviorTime = 0;
  pressed.clear();
  host?.setOverrideWorlds(null);
  app().set("jointValues", {});
}

export async function setMode(mode: "edit" | "pose" | "physics") {
  reset();
  app().set("mode", mode);
  if (mode === "edit") {
    behavior = null;
    app().set("simBehavior", null);
  } else chooseBehavior();
  if (mode === "physics") {
    await buildPhysics();
    await play();
  }
}

/** The model the physics world is built from: wheel joints a controller drives take velocities. */
function simModel(): RobotModel {
  const m = structuredClone(app().model);
  for (const id of behavior?.velocityJoints ?? []) {
    const L = linkById(m, id);
    if (L) L.drive = { ...L.drive, mode: "wheel", target: 0 };
  }
  return m;
}

async function buildPhysics() {
  await initPhysics();
  const s = app();
  // Free base for robots that move themselves (wheels, legs); fixed for arms and the rest.
  if (autoBase)
    simOptions.fixedBase = behavior
      ? behavior.id === "arm"
      : !s.model.links.some((l) => l.drive.mode === "wheel");
  physics?.dispose();
  physics = await createSim(simModel(), meshStore.get, simOptions, s.environment);
  host?.setOverrideWorlds(physics.linkWorlds());
}

/** Rebuild the physics world (after changing options) without leaving physics mode. */
export async function restartPhysics() {
  const running = app().simRunning;
  pause();
  physics?.dispose();
  physics = null;
  if (app().mode === "physics") {
    await initPhysics();
    chooseBehavior();
    physics = await createSim(simModel(), meshStore.get, simOptions, app().environment);
    host?.setOverrideWorlds(physics.linkWorlds());
    if (running) await play();
  }
}

function tick(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const s = app();
  if (!s.simRunning) return;
  if (s.mode === "physics" && physics) {
    behaviorTime += dt;
    const joints = physics.jointPositions();
    const commands = behavior?.tick({
      model: s.model,
      time: behaviorTime,
      dt,
      input: teleopInput(),
      joints,
    });
    physics.step(dt, commands);
    host?.setOverrideWorlds(physics.linkWorlds());
    s.set("jointValues", physics.jointPositions());
  } else if (s.mode === "pose" && behavior) {
    // Kinematic preview of the controller: wheel velocities integrate, the rest are positions.
    behaviorTime += dt;
    const next = { ...s.jointValues };
    const commands = behavior.tick({
      model: s.model,
      time: behaviorTime,
      dt,
      input: teleopInput(),
      joints: next,
    });
    const velocity = new Set(behavior.velocityJoints);
    for (const [id, v] of Object.entries(commands))
      next[id] = velocity.has(id) ? (next[id] ?? 0) + v * dt : v;
    s.set("jointValues", next);
  } else if (s.mode === "pose") {
    poseTime += dt;
    const next = { ...s.jointValues };
    for (const L of s.model.links) {
      if (!hasJoint(s.model, L) || L.joint.type === "fixed") continue;
      const d = L.drive;
      const cur = next[L.id] ?? 0;
      if (d.mode === "wheel") next[L.id] = clampJoint(L, cur + d.target * dt);
      else if (d.mode === "servo") {
        let target = d.target;
        if (d.sweep) {
          const mid = (L.joint.lower + L.joint.upper) / 2;
          const amp = (L.joint.upper - L.joint.lower) / 2;
          target =
            mid + amp * Math.sin(poseTime * Math.max(0.2, L.joint.velocity / Math.max(amp, 1e-3)));
        }
        const step = Math.max(L.joint.velocity, 1e-3) * dt;
        next[L.id] = clampJoint(L, cur + Math.max(-step, Math.min(step, target - cur)));
      }
    }
    s.set("jointValues", next);
  }
  raf = requestAnimationFrame(tick);
}

// Leaving the model behind (new project, undo) invalidates a running physics world.
useApp.subscribe((st, prev) => {
  if (st.behaviorChoice !== prev.behaviorChoice && st.mode !== "edit") {
    chooseBehavior();
    if (st.mode === "physics") void restartPhysics();
    return;
  }
  if (
    (st.model !== prev.model || st.environment !== prev.environment) &&
    physics &&
    st.mode === "physics"
  )
    restartPhysics();
});
