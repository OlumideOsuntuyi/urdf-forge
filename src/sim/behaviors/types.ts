/**
 * Simulation behaviours: small controllers that drive a robot's joints in Pose and Physics
 * modes, so sample robots can be driven, walk and move without ROS.
 */
import type { Link, RobotModel } from "@/core/model";

/** Operator input, from the keyboard (WASD / arrows, Q/E strafe, Space stop) or the on-screen pad. */
export interface TeleopInput {
  /** Forward speed command, -1 to 1. */
  forward: number;
  /** Turn rate command, -1 (right) to 1 (left). */
  turn: number;
  /** Sideways command for holonomic bases, -1 (right) to 1 (left). */
  strafe: number;
}

export interface BehaviorContext {
  model: RobotModel;
  /** Seconds since the behaviour started. */
  time: number;
  dt: number;
  input: TeleopInput;
  /** Measured joint positions by link id (physics mode), or the last commanded ones (pose mode). */
  joints: Record<string, number>;
}

/**
 * Commands by link id. For links whose drive is "wheel" (or continuous joints) the value is a
 * velocity in rad/s (m/s for prismatic); for every other joint it is a position target.
 */
export type JointCommands = Record<string, number>;

export interface Behavior {
  id: string;
  name: string;
  description: string;
  /** Whether it uses TeleopInput (the UI then shows the drive pad and key hints). */
  teleop: boolean;
  /** Links whose commands are velocities (wheels); all others are positions. */
  velocityJoints: string[];
  tick(ctx: BehaviorContext): JointCommands;
}

export interface BehaviorFactory {
  id: string;
  name: string;
  description: string;
  /** Returns a behaviour when it applies to this robot (e.g. it has drive wheels), else null. */
  detect(model: RobotModel): Behavior | null;
}

export type { Link };
