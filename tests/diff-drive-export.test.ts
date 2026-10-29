import { describe, expect, it } from "vitest";
import { insertPartIn } from "../src/app/parts";
import { diffDriveFor } from "../src/app/diffDrive";
import { PART_LIBRARY, defaults } from "../src/core/parts";
import { newModel, type RobotModel } from "../src/core/model";
import { activeDiffDrive, buildPackage, controllersYaml } from "../src/core/ros/package";

const part = (id: string) => PART_LIBRARY.find((t) => t.id === id)!;

function base(id: "asm_diff_drive" | "asm_skid_steer"): RobotModel {
  const m = newModel("rover");
  insertPartIn(m, part(id), defaults(part(id)), null);
  m.export.ros2Control = true;
  m.export.baseController = "diff_drive";
  return m;
}

describe("diff_drive_controller export", () => {
  it("finds one wheel per side on a differential base, leaving the caster out", () => {
    const dd = diffDriveFor(base("asm_diff_drive"))!;
    expect(dd.left).toEqual(["left_wheel_joint"]);
    expect(dd.right).toEqual(["right_wheel_joint"]);
    expect(dd.separation).toBeGreaterThan(0.05);
    expect(dd.radius).toBeGreaterThan(0.005);
  });

  it("puts every skid-steer wheel on its side", () => {
    const dd = diffDriveFor(base("asm_skid_steer"))!;
    expect(dd.left).toHaveLength(2);
    expect(dd.right).toHaveLength(2);
  });

  it("moves the wheels from the velocity group into a diff_drive_controller", () => {
    const m = base("asm_diff_drive");
    const dd = activeDiffDrive(m, diffDriveFor(m))!;
    const yaml = controllersYaml(m, dd);
    expect(yaml).toContain("type: diff_drive_controller/DiffDriveController");
    expect(yaml).toContain('left_wheel_names: ["left_wheel_joint"]');
    expect(yaml).toContain('right_wheel_names: ["right_wheel_joint"]');
    expect(yaml).toMatch(/wheel_separation: 0\.\d+/);
    expect(yaml).toContain("base_frame_id: base");
    // The wheels leave the velocity group; the passive caster joints stay in it.
    const group = yaml.split("\nvelocity_controller:")[1].split("\n\n")[0];
    expect(group).toContain("rear_caster_wheel_joint");
    expect(group).not.toContain("left_wheel_joint");
    expect(group).not.toContain("right_wheel_joint");
  });

  it("spawns the controller and depends on it", () => {
    const m = base("asm_skid_steer");
    const files = buildPackage(m, new Map(), { diffDrive: diffDriveFor(m) });
    // Skid-steer: every wheel goes to the diff drive, so it is the only other controller.
    expect(files.get("launch/gazebo_jazzy-harmonic.launch.py")).toContain(
      "['joint_state_broadcaster','diff_drive_controller']",
    );
    expect(files.get("package.xml")).toContain("<exec_depend>diff_drive_controller</exec_depend>");
    expect(files.get("README.md")).toContain("/diff_drive_controller/cmd_vel");
  });

  it("stays off unless asked for, and needs ros2_control", () => {
    const m = base("asm_diff_drive");
    const dd = diffDriveFor(m);
    m.export.baseController = "none";
    expect(activeDiffDrive(m, dd)).toBeNull();
    m.export.baseController = "diff_drive";
    m.export.ros2Control = false;
    expect(activeDiffDrive(m, dd)).toBeNull();
    expect(controllersYaml(base("asm_diff_drive"))).not.toContain("diff_drive_controller");
  });
});
