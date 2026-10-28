/** Finds the drive wheels of a differential base for the diff_drive_controller export. */
import { jointName, linkById, type RobotModel } from "@/core/model";
import type { DiffDrive } from "@/core/ros/package";
import { findWheels } from "@/sim/behaviors/drive";

/**
 * Left and right drive wheels, or null when the robot is not a plain differential or
 * skid-steer base (no wheels on one side, steered wheels, or mecanum/omni wheels).
 * Mimic wheels are left out; they follow the joint they mimic.
 */
export function diffDriveFor(model: RobotModel): DiffDrive | null {
  let wheels;
  try {
    wheels = findWheels(model);
  } catch {
    return null;
  }
  if (!wheels.length || wheels.some((w) => w.steerLinkId || w.kind !== "standard")) return null;
  const left = wheels.filter((w) => w.side === "left");
  const right = wheels.filter((w) => w.side === "right");
  if (!left.length || !right.length) return null;
  const meanY = (ws: typeof wheels) => ws.reduce((s, w) => s + w.position[1], 0) / ws.length;
  const name = (w: (typeof wheels)[number]) => jointName(linkById(model, w.linkId)!);
  return {
    left: left.map(name),
    right: right.map(name),
    separation: meanY(left) - meanY(right),
    radius: wheels.reduce((s, w) => s + w.radius, 0) / wheels.length,
  };
}
