/**
 * Supported ROS 2 distribution + simulator pairings.
 * Sources: REP 2000, gazebosim.org/docs/latest/ros_installation, control.ros.org gz_ros2_control.
 * Gazebo Classic 11 reached end of life in January 2025; it is offered for Humble only, as legacy.
 */

export type SimFamily = "classic" | "fortress" | "gz";

export interface Target {
  id: TargetId;
  ros: string;
  rosLabel: string;
  sim: string;
  simLabel: string;
  family: SimFamily;
  /** Year-month the distribution leaves support. */
  eol: string;
  legacy?: boolean;
  /** ros2_control hardware plugin and Gazebo system plugin. */
  hardwarePlugin: string;
  controlFile: string;
  controlName: string;
  /** Prefix for built-in Gazebo system plugins (sensors, joint state publisher). */
  systemFile: (name: string) => string;
  systemName: (cls: string) => string;
  /** SDF tag that sets a sensor's frame. */
  frameTag: string | null;
  /** gz.msgs (or ignition.msgs) namespace for the clock bridge. */
  msgs: string;
  resourceEnv: string;
}

export type TargetId =
  | "humble-fortress"
  | "humble-classic"
  | "jazzy-harmonic"
  | "kilted-ionic"
  | "lyrical-jetty"
  | "rolling-jetty";

const gzModern = {
  family: "gz" as const,
  hardwarePlugin: "gz_ros2_control/GazeboSimSystem",
  controlFile: "gz_ros2_control-system",
  controlName: "gz_ros2_control::GazeboSimROS2ControlPlugin",
  systemFile: (n: string) => `gz-sim-${n}-system`,
  systemName: (c: string) => `gz::sim::systems::${c}`,
  frameTag: "gz_frame_id",
  msgs: "gz.msgs",
  resourceEnv: "GZ_SIM_RESOURCE_PATH",
};

export const TARGETS: Record<TargetId, Target> = {
  "humble-fortress": {
    id: "humble-fortress",
    ros: "humble",
    rosLabel: "ROS 2 Humble",
    sim: "fortress",
    simLabel: "Gazebo Fortress",
    eol: "2027-05",
    family: "fortress",
    hardwarePlugin: "gz_ros2_control/GazeboSimSystem",
    controlFile: "gz_ros2_control-system",
    controlName: "gz_ros2_control::GazeboSimROS2ControlPlugin",
    systemFile: (n) => `ignition-gazebo-${n}-system`,
    systemName: (c) => `ignition::gazebo::systems::${c}`,
    frameTag: "ignition_frame_id",
    msgs: "ignition.msgs",
    resourceEnv: "IGN_GAZEBO_RESOURCE_PATH",
  },
  "humble-classic": {
    id: "humble-classic",
    ros: "humble",
    rosLabel: "ROS 2 Humble",
    sim: "classic",
    simLabel: "Gazebo Classic 11 (end of life)",
    eol: "2025-01",
    legacy: true,
    family: "classic",
    hardwarePlugin: "gazebo_ros2_control/GazeboSystem",
    controlFile: "libgazebo_ros2_control.so",
    controlName: "gazebo_ros2_control",
    systemFile: (n) => `libgazebo_ros_${n}.so`,
    systemName: (c) => c,
    frameTag: null,
    msgs: "",
    resourceEnv: "GAZEBO_MODEL_PATH",
  },
  "jazzy-harmonic": {
    id: "jazzy-harmonic",
    ros: "jazzy",
    rosLabel: "ROS 2 Jazzy",
    sim: "harmonic",
    simLabel: "Gazebo Harmonic",
    eol: "2029-05",
    ...gzModern,
  },
  "kilted-ionic": {
    id: "kilted-ionic",
    ros: "kilted",
    rosLabel: "ROS 2 Kilted",
    sim: "ionic",
    simLabel: "Gazebo Ionic",
    eol: "2026-12",
    ...gzModern,
  },
  "lyrical-jetty": {
    id: "lyrical-jetty",
    ros: "lyrical",
    rosLabel: "ROS 2 Lyrical",
    sim: "jetty",
    simLabel: "Gazebo Jetty",
    eol: "2031-05",
    ...gzModern,
  },
  "rolling-jetty": {
    id: "rolling-jetty",
    ros: "rolling",
    rosLabel: "ROS 2 Rolling",
    sim: "jetty",
    simLabel: "Gazebo Jetty",
    eol: "rolling",
    ...gzModern,
  },
};

export const TARGET_IDS = Object.keys(TARGETS) as TargetId[];

export function targetLabel(t: Target): string {
  return `${t.rosLabel} · ${t.simLabel}`;
}

export function isTargetId(s: string): s is TargetId {
  return s in TARGETS;
}
