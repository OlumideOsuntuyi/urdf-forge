/** Simulation behaviours registry, detection and keyboard mapping. */
import type { RobotModel } from "@/core/model";
import type { Behavior, BehaviorFactory, TeleopInput } from "./types";
import { wheeledDrive } from "./drive";
import { leggedGait } from "./gait";
import { armWaypoints } from "./arm";

export type {
  Behavior,
  BehaviorContext,
  BehaviorFactory,
  JointCommands,
  TeleopInput,
} from "./types";
export { wheeledDrive, findWheels } from "./drive";
export { leggedGait, findLegs } from "./gait";
export { armWaypoints, findArmChain } from "./arm";

/** No behaviour: joints keep their own drive settings. Always applies. */
export const noBehavior: BehaviorFactory = {
  id: "none",
  name: "None",
  description: "No controller; joints follow their own drive settings.",
  detect: () => ({
    id: "none",
    name: "None",
    description: "No controller; joints follow their own drive settings.",
    teleop: false,
    velocityJoints: [],
    tick: () => ({}),
  }),
};

export const BEHAVIORS: BehaviorFactory[] = [leggedGait, wheeledDrive, armWaypoints, noBehavior];

/** Every behaviour that applies to the robot (excluding "none"), legged gait first. */
export function detectBehaviors(model: RobotModel): Behavior[] {
  const out: Behavior[] = [];
  for (const f of BEHAVIORS) {
    if (f === noBehavior) continue;
    const b = f.detect(model);
    if (b) out.push(b);
  }
  return out;
}

/** Best default: legged gait over wheeled drive over arm waypoints; null when none applies. */
export function suggestBehavior(model: RobotModel): Behavior | null {
  return detectBehaviors(model)[0] ?? null;
}

export const ZERO_INPUT: TeleopInput = { forward: 0, turn: 0, strafe: 0 };

/**
 * Teleop input from the keys currently held. Accepts KeyboardEvent.key or .code values
 * ("w", "KeyW", "ArrowUp", " ", "Space"...). WASD / arrows drive and turn, Q/E strafe,
 * Space stops.
 */
export function inputFromKeys(pressed: Set<string>): TeleopInput {
  const keys = new Set([...pressed].map((k) => k.toLowerCase().replace(/^key/, "")));
  if (keys.has(" ") || keys.has("space")) return { ...ZERO_INPUT };
  const any = (...k: string[]) => (k.some((x) => keys.has(x)) ? 1 : 0);
  return {
    forward: any("w", "arrowup") - any("s", "arrowdown"),
    turn: any("a", "arrowleft") - any("d", "arrowright"),
    strafe: any("q") - any("e"),
  };
}
