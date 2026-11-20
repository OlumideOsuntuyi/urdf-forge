/**
 * NVIDIA Isaac Sim / Isaac Lab export: a folder with a URDF whose mesh paths are relative to the
 * file (Isaac has no ROS package lookup), an Isaac Lab `ArticulationCfg`, scripts that convert
 * the URDF to USD with Isaac Lab's `convert_urdf.py`, and a README. Not a ROS package.
 *
 * Checked against Isaac Lab 3.0.0 (Isaac Sim 6.2): `UrdfFileCfg` / `UrdfConverterCfg`
 * (sim/converters/urdf_converter_cfg.py), `ArticulationCfg` (quaternions are x, y, z, w) and
 * `ImplicitActuatorCfg` (`joint_effort_limit` / `joint_velocity_limit`).
 */
import {
  ARTICULATED,
  childrenOf,
  hasJoint,
  jointName,
  linkById,
  orderedLinks,
  rootLinks,
  safeName,
  type Link,
  type RobotModel,
} from "../model";
import { clampJoint, effectiveJointValues, lowestZ } from "../kinematics";
import { fmt, fmt3, rpyToQuat } from "../math";
import { writeObj } from "../mesh/uv";
import { usedTextureKeys } from "../project";
import {
  GENERATOR,
  commandInterfaceFor,
  jointXml,
  linkXml,
  materialExportNames,
  meshFileFor,
  xmlEscape,
} from "../ros/urdf";

/** Where Isaac Lab is checked out when nothing else is configured. */
export const DEFAULT_ISAACLAB_PATH = "C:\\Dev\\Robotics\\Isaac\\IsaacLab";

/** Isaac Lab's URDF to USD script, relative to the checkout. */
export const CONVERT_SCRIPT = "scripts/tools/convert_urdf.py";

/** Lift above the ground for a floating-base robot's lowest point at spawn, metres. */
export const SPAWN_CLEARANCE = 0.02;

export interface IsaacOptions {
  /** ISO timestamp for headers; omit for reproducible output. */
  stamp?: string;
  /** Mesh geometry by asset id: spawn height, and OBJ copies of textured meshes. */
  meshPositions?: (meshId: string) => Float32Array | undefined;
  /** Texture image bytes by key. */
  textures?: Map<string, Uint8Array>;
  /**
   * The app's guess for an "auto" base when the model does not decide it (no `world` root):
   * true for arms. The editor's physics preview uses the same rule. Without it, robots with
   * wheels float and everything else is fixed.
   */
  fixedBaseHint?: boolean;
  /** Isaac Lab checkout the conversion scripts use by default. */
  isaacLabPath?: string;
}

export type IsaacFiles = Map<string, string | Uint8Array>;

// ------------------------------------------------------------------ names and paths

export function isaacRobotName(model: RobotModel): string {
  return safeName(model.robot, "robot");
}

/** Folder the export is written to, inside the folder the user picks. */
export function isaacFolderName(model: RobotModel): string {
  return `${isaacRobotName(model)}_isaac`;
}

/** Python constant name of the articulation config, e.g. `MY_ROBOT_CFG`. */
export function isaacCfgName(model: RobotModel): string {
  return `${isaacRobotName(model).toUpperCase()}_CFG`;
}

/** Paths inside the export folder. */
export function isaacPaths(model: RobotModel) {
  const robot = isaacRobotName(model);
  return {
    urdf: `urdf/${robot}.urdf`,
    meshDir: `urdf/${model.meshDir}`,
    textureDir: "urdf/materials/textures",
    cfg: `isaaclab/${robot}_cfg.py`,
    check: `isaaclab/check_${robot}.py`,
    ps1: "convert_to_usd.ps1",
    sh: "convert_to_usd.sh",
    readme: "README.md",
    /** What Isaac Lab's URDF importer writes for `usd/` as the output directory. */
    usd: `usd/${robot}/${robot}.usda`,
  };
}

// ------------------------------------------------------------------ base

/**
 * A `world` root that only pins the robot down: no geometry and a single fixed child. Isaac
 * fixes the base with `fix_base` instead, so the URDF leaves it out and the child's pose in the
 * world becomes the spawn pose.
 */
export function worldAnchor(model: RobotModel): Link | null {
  const roots = rootLinks(model);
  if (roots.length !== 1) return null;
  const w = roots[0];
  if (w.name !== "world" || w.visuals.length || w.collisions.length) return null;
  const kids = childrenOf(model, w.id);
  return kids.length === 1 && kids[0].joint.type === "fixed" ? w : null;
}

const hasWheels = (model: RobotModel) =>
  model.links.some(
    (l) => hasJoint(model, l) && (l.joint.type === "continuous" || l.drive.mode === "wheel"),
  );

/** Whether Isaac should weld the root link to the world. */
export function isaacFixedBase(model: RobotModel, hint?: boolean): boolean {
  const mode = model.export.isaac?.base ?? "auto";
  if (mode !== "auto") return mode === "fixed";
  if (worldAnchor(model)) return true;
  return hint ?? !hasWheels(model);
}

// ------------------------------------------------------------------ URDF

/** Mesh filename as written in the Isaac URDF: relative to the URDF file. */
const relativeMesh = (model: RobotModel, file: string) => `${model.meshDir}/${file}`;

/**
 * URDF for Isaac Sim's importer: the same links, joints, inertials and collisions as the ROS
 * export, with mesh paths relative to the URDF and no Gazebo or ros2_control blocks.
 */
export function generateIsaacUrdf(model: RobotModel, opts: Pick<IsaacOptions, "stamp"> = {}) {
  const anchor = worldAnchor(model);
  const matNames = materialExportNames(model);
  const used = new Set(model.links.flatMap((l) => l.visuals.map((v) => v.materialId)));
  const o = ['<?xml version="1.0"?>'];
  o.push(
    `<!-- ${xmlEscape(model.robot)}: generated by ${GENERATOR}${opts.stamp ? ` ${opts.stamp}` : ""}`,
  );
  o.push("     Target: NVIDIA Isaac Sim / Isaac Lab. Mesh paths are relative to this file.");
  o.push("     REP 103: Z-up, metres, kilograms, radians. -->");
  o.push(`<robot name="${isaacRobotName(model)}">`);
  for (const m of model.materials) {
    if (!used.has(m.id)) continue;
    const tex = m.textures?.maps.color;
    o.push(
      `  <material name="${xmlEscape(matNames.get(m.id)!)}"><color rgba="${fmt3(m.rgba, 4)} ${fmt(m.rgba[3], 3)}"/>${
        tex ? `<texture filename="materials/textures/${xmlEscape(tex)}"/>` : ""
      }</material>`,
    );
  }
  o.push("");
  for (const L of orderedLinks(model)) {
    if (L === anchor) continue;
    o.push(linkXml(model, L, undefined, matNames, { meshRef: relativeMesh, alwaysInertial: true }));
    if (hasJoint(model, L) && linkById(model, L.parentId) !== anchor) o.push(jointXml(model, L));
    o.push("");
  }
  o.push("</robot>");
  return o.join("\n") + "\n";
}

// ------------------------------------------------------------------ actuators

export type IsaacGroup = "position" | "velocity" | "effort" | "passive";

export interface IsaacJoint {
  name: string;
  type: "revolute" | "prismatic" | "continuous";
  group: IsaacGroup;
  stiffness: number;
  damping: number;
  /** N·m or N; null when the URDF limit is not usable. */
  effort: number | null;
  /** rad/s or m/s; null when the URDF limit is not usable. */
  velocity: number | null;
  /** Initial position, rad or m. */
  initial: number;
}

/**
 * Full rated effort at this position error: 0.2 rad (about 11°) for revolute joints, 2 cm for
 * prismatic ones. Damping is stiffness / 20 (a 50 ms time constant). Starting points, not tuned.
 */
export const POSITION_ERROR_AT_FULL_EFFORT = { revolute: 0.2, prismatic: 0.02 } as const;
export const DAMPING_RATIO = 1 / 20;
/** Velocity drives reach full effort when 10% of the velocity limit below target. */
export const VELOCITY_ERROR_AT_FULL_EFFORT = 0.1;

const positive = (x: number) => (Number.isFinite(x) && x > 0 ? x : null);

/** Articulated joints as Isaac Lab sees them, with their actuator group, gains and limits. */
export function isaacJoints(model: RobotModel): IsaacJoint[] {
  const out: IsaacJoint[] = [];
  const values: Record<string, number> = {};
  for (const L of model.links) values[L.id] = clampJoint(L, L.jointValue ?? 0);
  const eff = effectiveJointValues(model, values);
  for (const L of orderedLinks(model)) {
    if (!hasJoint(model, L) || !ARTICULATED.includes(L.joint.type)) continue;
    const j = L.joint;
    const type = j.type as IsaacJoint["type"];
    const effort = positive(j.effort);
    const velocity = positive(j.velocity);
    const passive = !L.controlled || !!j.mimic?.joint;
    const group: IsaacGroup = passive ? "passive" : commandInterfaceFor(model, L);
    let stiffness = 0;
    let damping = 0;
    if (group === "position") {
      const err =
        type === "prismatic"
          ? POSITION_ERROR_AT_FULL_EFFORT.prismatic
          : POSITION_ERROR_AT_FULL_EFFORT.revolute;
      stiffness = (effort ?? 10) / err;
      damping = stiffness * DAMPING_RATIO;
    } else if (group === "velocity") {
      damping = (effort ?? 10) / (VELOCITY_ERROR_AT_FULL_EFFORT * (velocity ?? 10));
    } else if (group === "passive") {
      damping = Math.max(0, j.damping || 0);
    }
    out.push({
      name: jointName(L),
      type,
      group,
      stiffness,
      damping,
      effort,
      velocity,
      initial: clampJoint(L, eff[L.id] ?? 0),
    });
  }
  return out;
}

// ------------------------------------------------------------------ Isaac Lab config

/** A Python float literal. */
export function py(v: number, precision = 6): string {
  const s = fmt(v, precision);
  return /[.e]/.test(s) ? s : `${s}.0`;
}

const pyStr = (s: string) => JSON.stringify(s);

function pyDict(entries: [string, number][], ind: string): string {
  if (!entries.length) return "{}";
  return `{\n${entries.map(([k, v]) => `${ind}    ${pyStr(k)}: ${py(v)},`).join("\n")}\n${ind}}`;
}

/**
 * Root pose at spawn, in the world: x, y, z and an x, y, z, w quaternion. A root link's origin
 * places the robot in the editor but has no place in a URDF, so it becomes the spawn pose.
 * Floating robots then start with their lowest point just above the ground (in the exported
 * pose); fixed ones only move up if they would be in it.
 */
export function isaacSpawnPose(
  model: RobotModel,
  fixed: boolean,
  meshes?: (meshId: string) => Float32Array | undefined,
): { pos: [number, number, number]; rot: [number, number, number, number] } {
  const anchor = worldAnchor(model);
  const root = anchor ? childrenOf(model, anchor.id)[0] : orderedLinks(model)[0];
  if (!root) return { pos: [0, 0, 0], rot: [0, 0, 0, 1] };
  const q = rpyToQuat(root.origin.rpy);
  const rot: [number, number, number, number] = [q.x, q.y, q.z, q.w];
  if (anchor) return { pos: [...root.origin.xyz], rot };
  const values: Record<string, number> = {};
  for (const L of model.links) values[L.id] = clampJoint(L, L.jointValue ?? 0);
  // Lowest point with the root at its editor placement.
  const low = lowestZ(model, meshes ?? (() => undefined), 7, values);
  const [x, y, z] = root.origin.xyz;
  return fixed
    ? { pos: [x, y, z + Math.max(0, -low)], rot }
    : { pos: [0, 0, z + SPAWN_CLEARANCE - low], rot };
}

const GROUP_DOC: Record<IsaacGroup, string> = {
  position: "Position control (revolute and prismatic joints).",
  velocity: "Velocity control (wheels and other continuous joints): stiffness 0.",
  effort: "Effort control: the policy commands torque directly.",
  passive: "Not driven (uncontrolled or mimic joints): no stiffness, URDF damping.",
};

export function generateIsaacLabCfg(model: RobotModel, opts: IsaacOptions = {}): string {
  const robot = isaacRobotName(model);
  const paths = isaacPaths(model);
  const fixed = isaacFixedBase(model, opts.fixedBaseHint);
  const joints = isaacJoints(model);
  const pose = isaacSpawnPose(model, fixed, opts.meshPositions);
  const selfCollision = model.links.some((l) => l.gazebo.selfCollide);
  const tuple = (xs: number[]) => `(${xs.map((x) => py(x)).join(", ")})`;

  const groups = (["position", "velocity", "effort", "passive"] as IsaacGroup[])
    .map((g) => [g, joints.filter((j) => j.group === g)] as const)
    .filter(([, js]) => js.length);
  const actuator = (g: IsaacGroup, js: IsaacJoint[]) => {
    const ind = "            ";
    const lines = [
      `        # ${GROUP_DOC[g]}`,
      `        ${pyStr(g)}: ImplicitActuatorCfg(`,
      `            joint_names_expr=[${js.map((j) => pyStr(j.name)).join(", ")}],`,
    ];
    const withEffort = js.filter((j) => j.effort !== null);
    const withVelocity = js.filter((j) => j.velocity !== null);
    if (withEffort.length)
      lines.push(
        `            joint_effort_limit=${pyDict(
          withEffort.map((j) => [j.name, j.effort!]),
          ind,
        )},`,
      );
    if (withVelocity.length)
      lines.push(
        `            joint_velocity_limit=${pyDict(
          withVelocity.map((j) => [j.name, j.velocity!]),
          ind,
        )},`,
      );
    lines.push(
      `            stiffness=${pyDict(
        js.map((j) => [j.name, j.stiffness]),
        ind,
      )},`,
      `            damping=${pyDict(
        js.map((j) => [j.name, j.damping]),
        ind,
      )},`,
      "        ),",
    );
    return lines.join("\n");
  };

  const baseNote = fixed
    ? "Fixed base: the root link is welded to the world."
    : "Floating base: the robot is free and starts just above the ground.";
  return `"""Isaac Lab configuration for ${model.robot}. Generated by ${GENERATOR}${opts.stamp ? ` ${opts.stamp}` : ""}.

Spawns the robot from the USD that convert_to_usd.ps1 (or .sh) writes to ${paths.usd}
when it exists, otherwise converts ${paths.urdf} on first use and caches the result there.

${baseNote}
The initial joint positions are the pose the robot was in when it was exported.

Gains are starting points derived from each joint's URDF effort and velocity limits:
position joints reach full effort at ${POSITION_ERROR_AT_FULL_EFFORT.revolute} rad (or ${POSITION_ERROR_AT_FULL_EFFORT.prismatic} m) of error, damping is
stiffness / ${Math.round(1 / DAMPING_RATIO)}, and velocity joints reach full effort ${Math.round(VELOCITY_ERROR_AT_FULL_EFFORT * 100)}% below their target speed.
Tune them for your motors before training.

Usage in a task:

    from ${robot}_cfg import ${isaacCfgName(model)}

    robot = ${isaacCfgName(model)}.replace(prim_path="{ENV_REGEX_NS}/Robot")
"""

import os

import isaaclab.sim as sim_utils
from isaaclab.actuators import ImplicitActuatorCfg
from isaaclab.assets import ArticulationCfg${
    selfCollision
      ? `
from isaaclab_newton.sim.schemas import NewtonArticulationCfg
from isaaclab_physx.sim.schemas import PhysxArticulationCfg`
      : ""
  }

ASSET_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
"""The exported folder: urdf/, usd/ and this isaaclab/ folder."""
URDF_PATH = os.path.join(ASSET_DIR, ${paths.urdf.split("/").map(pyStr).join(", ")})
USD_DIR = os.path.join(ASSET_DIR, "usd")
USD_PATH = os.path.join(USD_DIR, ${pyStr(robot)}, ${pyStr(`${robot}.usda`)})
FIX_BASE = ${fixed ? "True" : "False"}

if os.path.isfile(USD_PATH):
    _SPAWN = sim_utils.UsdFileCfg(
        usd_path=USD_PATH,
        activate_contact_sensors=True,
        fix_root_link=FIX_BASE,${
          selfCollision
            ? `
        # The importer puts the articulation root on the root link, below the spawned prim.
        articulation_props={
            "/.*": [
                PhysxArticulationCfg(enabled_self_collisions=True),
                NewtonArticulationCfg(self_collision_enabled=True),
            ],
        },`
            : ""
        }
    )
else:
    _SPAWN = sim_utils.UrdfFileCfg(
        asset_path=URDF_PATH,
        usd_dir=USD_DIR,
        fix_base=FIX_BASE,
        merge_fixed_joints=True,
        self_collision=${selfCollision ? "True" : "False"},
        activate_contact_sensors=True,
        # Gains come from the actuators below, not the importer.
        joint_drive=sim_utils.UrdfConverterCfg.JointDriveCfg(
            gains=sim_utils.UrdfConverterCfg.JointDriveCfg.PDGainsCfg(stiffness=None, damping=None),
        ),
    )

${isaacCfgName(model)} = ArticulationCfg(
    spawn=_SPAWN,
    init_state=ArticulationCfg.InitialStateCfg(
        pos=${tuple(pose.pos)},
        rot=${tuple(pose.rot)},  # x, y, z, w
        joint_pos=${pyDict(
          joints.map((j) => [j.name, j.initial]),
          "        ",
        )},
        joint_vel={".*": 0.0},
    ),
    actuators={${groups.length ? "\n" + groups.map(([g, js]) => actuator(g, js)).join("\n") + "\n    " : ""}},
)
"""Articulation config for ${model.robot}."""
`;
}

/**
 * A standalone check: spawn the robot on a ground plane, hold the initial pose and report
 * whether it stays up. Headless unless `--viz kit` is passed.
 */
export function checkScript(model: RobotModel): string {
  const robot = isaacRobotName(model);
  return `"""Spawn ${model.robot} on a ground plane and hold its initial pose. Generated by ${GENERATOR}.

Run from the Isaac Lab checkout (add --viz kit to watch it):

    uv run --extra isaacsim python <this folder>/check_${robot}.py --steps 300
"""

import argparse
import os
import sys

from isaaclab.app import add_launcher_args, launch_simulation

parser = argparse.ArgumentParser(description="Spawn ${robot} and hold its initial pose.")
parser.add_argument("--steps", type=int, default=300, help="Physics steps to run.")
add_launcher_args(parser)
args_cli = parser.parse_args()

import torch  # noqa: E402

import isaaclab.sim as sim_utils  # noqa: E402
from isaaclab.assets import Articulation  # noqa: E402
from isaaclab.sim import SimulationContext  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ${robot}_cfg import ${isaacCfgName(model)}  # noqa: E402


def main():
    sim_cfg = sim_utils.SimulationCfg(device=args_cli.device)
    with launch_simulation(sim_cfg, args_cli):
        sim = SimulationContext(sim_cfg)
        sim.set_camera_view([2.0, 2.0, 1.5], [0.0, 0.0, 0.3])
        ground = sim_utils.GroundPlaneCfg()
        ground.func("/World/defaultGroundPlane", ground)
        light = sim_utils.DomeLightCfg(intensity=3000.0, color=(0.75, 0.75, 0.75))
        light.func("/World/Light", light)
        robot = Articulation(${isaacCfgName(model)}.replace(prim_path="/World/Robot"))
        sim.reset()
        print(f"[check] joints: {robot.joint_names}")
        print(f"[check] bodies: {robot.body_names}")
        start = robot.data.root_pos_w.torch.clone()
        target = robot.data.default_joint_pos.torch.clone()
        dt = sim.get_physics_dt()
        for _ in range(args_cli.steps):
            if not sim.is_running():
                break
            robot.actuators.target_command.set_position_index(value=target)
            robot.write_data_to_sim()
            sim.step()
            robot.update(dt)
        end = robot.data.root_pos_w.torch
        err = (robot.data.joint_pos.torch - target).abs().max().item() if robot.num_joints else 0.0
        print(f"[check] root start {start[0].tolist()} end {end[0].tolist()}")
        print(f"[check] largest joint error after {args_cli.steps} steps: {err:.4f}")
        print("[check] done")


if __name__ == "__main__":
    main()
`;
}

// ------------------------------------------------------------------ conversion scripts

export function convertPs1(model: RobotModel, isaacLab = DEFAULT_ISAACLAB_PATH, hint?: boolean) {
  const robot = isaacRobotName(model);
  const fix = isaacFixedBase(model, hint) ? " --fix_base" : "";
  // ASCII only: Windows PowerShell 5.1 reads BOM-less scripts in the ANSI code page.
  const lab = isaacLab.replace(/'/g, "''");
  return `# Convert urdf/${robot}.urdf to USD with Isaac Lab. Generated by ${GENERATOR}.
# Writes usd/${robot}/${robot}.usda next to this script. Runs headless.
#
#   powershell -ExecutionPolicy Bypass -File .\\convert_to_usd.ps1 [-IsaacLab <Isaac Lab folder>]
#
# The Isaac Lab folder defaults to $env:ISAACLAB_PATH, then '${lab}'.
param(
    [string]$IsaacLab = $(if ($env:ISAACLAB_PATH) { $env:ISAACLAB_PATH } else { '${lab}' })
)

$Urdf = Join-Path $PSScriptRoot 'urdf\\${robot}.urdf'
$UsdDir = Join-Path $PSScriptRoot 'usd'
$Usd = Join-Path $UsdDir '${robot}\\${robot}.usda'
$Tool = Join-Path $IsaacLab '${CONVERT_SCRIPT.replace(/\//g, "\\")}'

if (-not (Test-Path -LiteralPath $Tool)) {
    [Console]::Error.WriteLine("Isaac Lab was not found at '$IsaacLab' (no ${CONVERT_SCRIPT.replace(/\//g, "\\")}). Pass -IsaacLab <folder> or set ISAACLAB_PATH.")
    exit 2
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    [Console]::Error.WriteLine("uv was not found on PATH. Isaac Lab 3 runs through uv: https://docs.astral.sh/uv/")
    exit 3
}

$env:HEADLESS = '1'
$env:PYTHONUNBUFFERED = '1'
Write-Host "Converting $Urdf"
Write-Host "Isaac Lab: $IsaacLab"
Push-Location -LiteralPath $IsaacLab
try {
    & uv run --extra isaacsim python $Tool $Urdf $UsdDir --merge_joints${fix}
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($code -ne 0) {
    [Console]::Error.WriteLine("convert_urdf.py failed with exit code $code.")
    exit $code
}
if (-not (Test-Path -LiteralPath $Usd)) {
    [Console]::Error.WriteLine("The conversion finished but $Usd was not written. Look for another .usda under $UsdDir.")
    exit 1
}
Write-Host "USD written: $Usd"
`;
}

export function convertSh(model: RobotModel, isaacLab = DEFAULT_ISAACLAB_PATH, hint?: boolean) {
  const robot = isaacRobotName(model);
  const fix = isaacFixedBase(model, hint) ? " --fix_base" : "";
  const def = isaacLab.startsWith("/") ? isaacLab.replace(/"/g, '\\"') : "$HOME/IsaacLab";
  return `#!/usr/bin/env bash
# Convert urdf/${robot}.urdf to USD with Isaac Lab. Generated by ${GENERATOR}.
# Writes usd/${robot}/${robot}.usda next to this script. Runs headless.
#
#   ./convert_to_usd.sh [isaac-lab-folder]
#
# The Isaac Lab folder defaults to $ISAACLAB_PATH, then ${def}.
set -euo pipefail

ISAACLAB="\${1:-\${ISAACLAB_PATH:-${def}}}"
HERE="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
URDF="$HERE/urdf/${robot}.urdf"
USD_DIR="$HERE/usd"
USD="$USD_DIR/${robot}/${robot}.usda"
TOOL="$ISAACLAB/${CONVERT_SCRIPT}"

if [ ! -f "$TOOL" ]; then
  echo "Isaac Lab was not found at '$ISAACLAB' (no ${CONVERT_SCRIPT}). Pass the folder or set ISAACLAB_PATH." >&2
  exit 2
fi
if ! command -v uv >/dev/null 2>&1; then
  echo "uv was not found on PATH. Isaac Lab 3 runs through uv: https://docs.astral.sh/uv/" >&2
  exit 3
fi

echo "Converting $URDF"
echo "Isaac Lab: $ISAACLAB"
cd "$ISAACLAB"
HEADLESS=1 PYTHONUNBUFFERED=1 uv run --extra isaacsim python "$TOOL" "$URDF" "$USD_DIR" --merge_joints${fix}
if [ ! -f "$USD" ]; then
  echo "The conversion finished but $USD was not written. Look for another .usda under $USD_DIR." >&2
  exit 1
fi
echo "USD written: $USD"
`;
}

// ------------------------------------------------------------------ README

export function isaacReadme(model: RobotModel, opts: IsaacOptions = {}): string {
  const robot = isaacRobotName(model);
  const p = isaacPaths(model);
  const fixed = isaacFixedBase(model, opts.fixedBaseHint);
  const joints = isaacJoints(model);
  const count = (g: IsaacGroup) => joints.filter((j) => j.group === g).length;
  const lab = opts.isaacLabPath || DEFAULT_ISAACLAB_PATH;
  const groupRows = (["position", "velocity", "effort", "passive"] as IsaacGroup[])
    .filter((g) => count(g))
    .map((g) => `| \`${g}\` | ${count(g)} | ${GROUP_DOC[g]} |`)
    .join("\n");
  return `# ${model.robot} for NVIDIA Isaac Sim and Isaac Lab

Generated by ${GENERATOR} for Isaac Lab 3 (Isaac Sim 6). REP 103 conventions: Z-up, metres,
kilograms, radians. ${fixed ? "Fixed base." : "Floating base."}

## Layout

- \`${p.urdf}\`: the robot. Mesh paths are relative to this file, so the folder can move.
  No \`package://\` URIs, Gazebo blocks or ros2_control tags.
- \`${p.meshDir}/\`: meshes in metres (binary STL; OBJ with UVs for textured parts).
- \`${p.cfg}\`: Isaac Lab \`ArticulationCfg\` (\`${isaacCfgName(model)}\`) with the initial pose and
  actuator groups.
- \`${p.check}\`: spawns the robot on a ground plane and holds its pose, to check the cfg.
- \`convert_to_usd.ps1\` / \`convert_to_usd.sh\`: URDF to USD with Isaac Lab's
  \`${CONVERT_SCRIPT}\`. Output: \`${p.usd}\`.

## Convert to USD

Windows (PowerShell), Isaac Lab installed with uv:

\`\`\`powershell
powershell -ExecutionPolicy Bypass -File .\\convert_to_usd.ps1 -IsaacLab "${lab}"
\`\`\`

Linux:

\`\`\`bash
./convert_to_usd.sh /path/to/IsaacLab
\`\`\`

Both run \`uv run --extra isaacsim python ${CONVERT_SCRIPT} urdf/${robot}.urdf usd --merge_joints${fixed ? " --fix_base" : ""}\`
headless from the Isaac Lab folder. \`ISAACLAB_PATH\` sets the folder too. The importer names
the output after the robot, so the USD is \`${p.usd}\` with its payloads beside it.

## Open it in Isaac Sim

Open \`${p.usd}\` with File > Open, or add it to a scene with File > Add Reference. Press Play
to see it fall under gravity${fixed ? " (the base stays fixed)" : ""}. The URDF importer (File > Import) also reads
\`${p.urdf}\` directly.

## Use it in Isaac Lab

Keep this folder together and put \`isaaclab/\` on the Python path of your task (or copy the cfg
into your task package and set \`ASSET_DIR\` in it to this folder):

\`\`\`python
import sys
sys.path.append(r"<this folder>/isaaclab")

from isaaclab.scene import InteractiveSceneCfg
from isaaclab.utils import configclass
from ${robot}_cfg import ${isaacCfgName(model)}

@configclass
class MySceneCfg(InteractiveSceneCfg):
    robot = ${isaacCfgName(model)}.replace(prim_path="{ENV_REGEX_NS}/Robot")
\`\`\`

The cfg spawns from \`${p.usd}\` when it exists and otherwise converts the URDF on first use,
caching the USD in the same place. Check it before training (add \`--viz kit\` to watch):

\`\`\`powershell
cd "${lab}"
uv run --extra isaacsim python "<this folder>\\isaaclab\\check_${robot}.py" --steps 300
\`\`\`

## Actuators

| Group | Joints | Control |
| --- | --- | --- |
${groupRows || "| (none) | 0 | The robot has no moving joints. |"}

All groups are \`ImplicitActuatorCfg\` (PD in the physics engine), with \`joint_effort_limit\` and
\`joint_velocity_limit\` from the URDF limits. Stiffness and damping are starting points:
position joints reach full effort at ${POSITION_ERROR_AT_FULL_EFFORT.revolute} rad (${POSITION_ERROR_AT_FULL_EFFORT.prismatic} m) of error with damping stiffness / ${Math.round(1 / DAMPING_RATIO)};
velocity joints reach full effort ${Math.round(VELOCITY_ERROR_AT_FULL_EFFORT * 100)}% below their target speed. Tune them for your motors (or switch
to \`DCMotorCfg\` with the motor's torque-speed curve) before training a policy.

## Notes

- Mass and inertia were integrated over the mesh geometry for a uniform-density solid. Check
  links the editor flagged as not watertight, and prefer measured masses for real hardware.
- Links on fixed joints are merged into their parent on conversion (\`--merge_joints\`,
  \`merge_fixed_joints=True\`), so sensor frames such as an IMU link become part of their parent
  body. Turn merging off in both places if a task needs those frames as bodies.
- Mesh collisions become convex hulls on import. Concave parts collide as their hull; split
  them in the editor or use primitive collisions where it matters.
- The ROS 2 / Gazebo package export is separate and unchanged.
`;
}

// ------------------------------------------------------------------ the folder

/**
 * Every file of the Isaac export, keyed by path relative to the export folder. `meshes` holds
 * STL bytes keyed by MeshAsset.file, as for `buildPackage`.
 */
export function buildIsaacExport(
  model: RobotModel,
  meshes: Map<string, Uint8Array>,
  opts: IsaacOptions = {},
): IsaacFiles {
  const files: IsaacFiles = new Map();
  const p = isaacPaths(model);
  files.set(p.urdf, generateIsaacUrdf(model, opts));
  for (const m of model.meshes) {
    const data = meshes.get(m.file);
    if (data) files.set(`${p.meshDir}/${m.file}`, data);
  }
  for (const L of model.links)
    for (const v of L.visuals) {
      if (v.geometry.type !== "mesh") continue;
      const file = meshFileFor(model, v.geometry.meshId, v.materialId);
      const pos = opts.meshPositions?.(v.geometry.meshId);
      const mat = model.materials.find((x) => x.id === v.materialId);
      if (file.endsWith(".obj") && pos && mat?.textures && !files.has(`${p.meshDir}/${file}`))
        files.set(`${p.meshDir}/${file}`, writeObj(pos, mat.textures.tile, file));
    }
  for (const key of usedTextureKeys(model)) {
    const bytes = opts.textures?.get(key);
    if (bytes) files.set(`${p.textureDir}/${key}`, bytes);
  }
  files.set(p.cfg, generateIsaacLabCfg(model, opts));
  files.set(p.check, checkScript(model));
  files.set(p.ps1, convertPs1(model, opts.isaacLabPath, opts.fixedBaseHint));
  files.set(p.sh, convertSh(model, opts.isaacLabPath, opts.fixedBaseHint));
  files.set(p.readme, isaacReadme(model, opts));
  return files;
}
