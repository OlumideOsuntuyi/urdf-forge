/** Assemble a complete ament_cmake description package. */
import { hasJoint, jointName, orderedLinks, safeName, type RobotModel } from "../model";
import { TARGETS, targetLabel, type Target, type TargetId } from "./targets";
import {
  generateUrdf,
  GENERATOR,
  commandInterfaceFor,
  controlledJoints,
  sensorName,
  sensorTopic,
} from "./urdf";
import { generateXacro } from "./xacro";
import { generateSdf } from "./sdf";
import { fmt, fmt3 } from "../math";
import { writeStl } from "../mesh/stl";
import type { Environment } from "../env/types";
import { meshFileFor, xmlEscape } from "./urdf";
import { writeObj } from "../mesh/uv";
import { usedTextureKeys } from "../project";

export type PackageFiles = Map<string, string | Uint8Array>;

/** Mesh bytes keyed by MeshAsset.file. */
export type MeshFiles = Map<string, Uint8Array>;

/** Left and right drive wheels of a differential base, found by the app from the geometry. */
export interface DiffDrive {
  left: string[];
  right: string[];
  /** Distance between the left and right wheel centres, metres. */
  separation: number;
  radius: number;
}

/**
 * The diff-drive setup to export, or null. Needs ros2_control, the diff_drive base controller
 * setting, and at least one controlled wheel joint on each side.
 */
export function activeDiffDrive(
  model: RobotModel,
  dd: DiffDrive | null | undefined,
): DiffDrive | null {
  if (!dd || !model.export.ros2Control || model.export.baseController !== "diff_drive") return null;
  const controlled = new Set(controlledJoints(model).map(jointName));
  const left = dd.left.filter((j) => controlled.has(j));
  const right = dd.right.filter((j) => controlled.has(j));
  return left.length && right.length ? { ...dd, left, right } : null;
}

export interface PackageOptions {
  stamp?: string;
  projectJson?: string;
  /** Test environment to export as the default Gazebo world. */
  environment?: Environment | null;
  /** Texture image bytes by key, for PBR materials. */
  textures?: Map<string, Uint8Array>;
  /** Mesh geometry by asset id, to write UV-mapped OBJ files for textured visuals. */
  meshPositions?: (meshId: string) => Float32Array | undefined;
  /** Drive wheels, used when the model asks for a diff_drive_controller. */
  diffDrive?: DiffDrive | null;
}

export function buildPackage(
  model: RobotModel,
  meshes: MeshFiles,
  opts: PackageOptions = {},
): PackageFiles {
  const files: PackageFiles = new Map();
  const ex = model.export;
  const targets = ex.targets.length ? ex.targets : [ex.defaultTarget];
  const def = targets.includes(ex.defaultTarget) ? ex.defaultTarget : targets[0];
  const robot = safeName(model.robot, "robot");
  const env = opts.environment && opts.environment.objects.length ? opts.environment : null;
  const envName = env ? safeName(env.id, "world").toLowerCase() : null;
  const dd = activeDiffDrive(model, opts.diffDrive);

  for (const t of targets) files.set(`urdf/${robot}.${t}.urdf`, generateUrdf(model, t, opts));
  files.set(`urdf/${robot}.urdf`, generateUrdf(model, def, opts));
  files.set(`urdf/${robot}.urdf.xacro`, generateXacro(model, targets, def));
  files.set(`sdf/${robot}/model.sdf`, generateSdf(model));
  files.set(`sdf/${robot}/model.config`, modelConfig(model));
  for (const m of model.meshes) {
    const data = meshes.get(m.file);
    if (data) files.set(`${model.meshDir}/${m.file}`, data);
  }
  // Textured materials: UV-mapped OBJ copies of their meshes, and the texture images.
  for (const L of model.links)
    for (const v of L.visuals) {
      if (v.geometry.type !== "mesh") continue;
      const file = meshFileFor(model, v.geometry.meshId, v.materialId);
      const pos = opts.meshPositions?.(v.geometry.meshId);
      const mat = model.materials.find((x) => x.id === v.materialId);
      if (file.endsWith(".obj") && pos && mat?.textures && !files.has(`${model.meshDir}/${file}`))
        files.set(`${model.meshDir}/${file}`, writeObj(pos, mat.textures.tile, file));
    }
  for (const key of usedTextureKeys(model)) {
    const bytes = opts.textures?.get(key);
    if (bytes) files.set(`materials/textures/${key}`, bytes);
  }
  for (const t of targets)
    files.set(`launch/gazebo_${t}.launch.py`, gazeboLaunch(model, TARGETS[t], env, envName, dd));
  files.set("launch/display.launch.py", displayLaunch(model, def));
  files.set("config/controllers.yaml", controllersYaml(model, dd));
  for (const t of targets)
    if (TARGETS[t].family !== "classic")
      files.set(`config/gz_bridge_${t}.yaml`, bridgeYaml(model, TARGETS[t]));
  files.set("worlds/empty.sdf", worldSdf(TARGETS[def]));
  if (targets.includes("humble-fortress"))
    files.set("worlds/empty_fortress.sdf", worldSdf(TARGETS["humble-fortress"]));
  if (env && envName) {
    const gz = targets.find((t) => TARGETS[t].family === "gz");
    if (gz) files.set(`worlds/${envName}.sdf`, worldSdf(TARGETS[gz], env, model.packageName));
    if (targets.includes("humble-fortress"))
      files.set(
        `worlds/${envName}_fortress.sdf`,
        worldSdf(TARGETS["humble-fortress"], env, model.packageName),
      );
    for (const [key, pos] of Object.entries(env.meshes))
      files.set(`worlds/meshes/${envMeshFile(env, key)}`, writeStl(pos, key));
  }
  files.set("rviz/view.rviz", rvizConfig(model));
  files.set("package.xml", packageXml(model, targets, dd));
  files.set("CMakeLists.txt", cmakeLists(model));
  files.set("README.md", readme(model, targets, def, dd));
  if (opts.projectJson) files.set(`${robot}.forge.json`, opts.projectJson);
  return files;
}

function rootName(model: RobotModel): string {
  return orderedLinks(model)[0]?.name ?? "base_link";
}

function worldFile(T: Target, envName: string | null): string {
  return `${envName ?? "empty"}${T.family === "fortress" ? "_fortress" : ""}.sdf`;
}

export function envMeshFile(env: Environment, key: string): string {
  return `${safeName(env.id, "world").toLowerCase()}_${safeName(key, "mesh")}.stl`;
}

export function gazeboLaunch(
  model: RobotModel,
  T: Target,
  env: Environment | null = null,
  envName: string | null = null,
  dd: DiffDrive | null = null,
): string {
  const spawnXyz = env?.spawn.xyz ?? [0, 0, 0];
  const robot = safeName(model.robot, "robot");
  const control = model.export.ros2Control && controlledJoints(model).length > 0;
  const spawners = control ? controllerNames(model, dd) : [];
  const header = `# Spawn ${model.robot} in ${targetLabel(T)}. Generated by ${GENERATOR}.
import os

from launch import LaunchDescription
from launch.actions import AppendEnvironmentVariable, DeclareLaunchArgument, IncludeLaunchDescription, RegisterEventHandler
from launch.event_handlers import OnProcessExit
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import Command, LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue
from launch_ros.substitutions import FindPackageShare
from ament_index_python.packages import get_package_share_directory

PACKAGE = '${model.packageName}'
ROBOT = '${robot}'
TARGET = '${T.id}'
`;
  const common = `
    share = get_package_share_directory(PACKAGE)
    xacro_file = os.path.join(share, 'urdf', ROBOT + '.urdf.xacro')
    robot_description = ParameterValue(Command(['xacro ', xacro_file, ' sim:=', TARGET]), value_type=str)
    x, y, z = LaunchConfiguration('x'), LaunchConfiguration('y'), LaunchConfiguration('z')

    rsp = Node(package='robot_state_publisher', executable='robot_state_publisher', output='screen',
               parameters=[{'robot_description': robot_description, 'use_sim_time': True}])
`;
  const spawnerBlock = spawners.length
    ? `
    spawners = [Node(package='controller_manager', executable='spawner', arguments=[name], output='screen')
                for name in ${JSON.stringify(spawners).replace(/"/g, "'")}]
    actions.append(RegisterEventHandler(OnProcessExit(target_action=spawn, on_exit=spawners)))
`
    : "";
  if (T.family === "classic") {
    return `${header}

def generate_launch_description():${common}
    gazebo = IncludeLaunchDescription(PythonLaunchDescriptionSource(
        [PathJoinSubstitution([FindPackageShare('gazebo_ros'), 'launch', 'gazebo.launch.py'])]))
    spawn = Node(package='gazebo_ros', executable='spawn_entity.py', output='screen',
                 arguments=['-topic', 'robot_description', '-entity', ROBOT, '-x', x, '-y', y, '-z', z])
    actions = [
        DeclareLaunchArgument('x', default_value='0'),
        DeclareLaunchArgument('y', default_value='0'),
        DeclareLaunchArgument('z', default_value='0.1'),
        AppendEnvironmentVariable('${T.resourceEnv}', os.path.dirname(share)),
        rsp, gazebo, spawn,
    ]${spawnerBlock}
    return LaunchDescription(actions)
`;
  }
  return `${header}

def generate_launch_description():${common}
    world = LaunchConfiguration('world')
    gazebo = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            [PathJoinSubstitution([FindPackageShare('ros_gz_sim'), 'launch', 'gz_sim.launch.py'])]),
        launch_arguments={'gz_args': ['-r ', world]}.items())
    spawn = Node(package='ros_gz_sim', executable='create', output='screen',
                 arguments=['-topic', 'robot_description', '-name', ROBOT, '-x', x, '-y', y, '-z', z])
    bridge = Node(package='ros_gz_bridge', executable='parameter_bridge', output='screen',
                  parameters=[{'config_file': os.path.join(share, 'config', 'gz_bridge_' + TARGET + '.yaml'),
                               'use_sim_time': True}])
    actions = [
        DeclareLaunchArgument('world', default_value=os.path.join(share, 'worlds', '${worldFile(T, envName)}'),
                              description='World SDF file'),
        DeclareLaunchArgument('x', default_value='${fmt(spawnXyz[0], 3)}'),
        DeclareLaunchArgument('y', default_value='${fmt(spawnXyz[1], 3)}'),
        DeclareLaunchArgument('z', default_value='${fmt(spawnXyz[2] + 0.1, 3)}'),
        AppendEnvironmentVariable('${T.resourceEnv}', os.path.dirname(share)),
        rsp, gazebo, spawn, bridge,
    ]${spawnerBlock}
    return LaunchDescription(actions)
`;
}

export function displayLaunch(model: RobotModel, def: TargetId): string {
  const robot = safeName(model.robot, "robot");
  return `# Show ${model.robot} in RViz with joint sliders. Generated by ${GENERATOR}.
import os

from launch import LaunchDescription
from launch.substitutions import Command
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue
from ament_index_python.packages import get_package_share_directory


def generate_launch_description():
    share = get_package_share_directory('${model.packageName}')
    xacro_file = os.path.join(share, 'urdf', '${robot}.urdf.xacro')
    robot_description = ParameterValue(Command(['xacro ', xacro_file, ' sim:=${def}']), value_type=str)
    return LaunchDescription([
        Node(package='robot_state_publisher', executable='robot_state_publisher',
             parameters=[{'robot_description': robot_description}]),
        Node(package='joint_state_publisher_gui', executable='joint_state_publisher_gui'),
        Node(package='rviz2', executable='rviz2', arguments=['-d', os.path.join(share, 'rviz', 'view.rviz')]),
    ])
`;
}

const CONTROLLER_TYPES = {
  position: "position_controllers/JointGroupPositionController",
  velocity: "velocity_controllers/JointGroupVelocityController",
  effort: "effort_controllers/JointGroupEffortController",
} as const;

/** Controlled joints grouped by command interface: { position: [...], velocity: [...] }. */
export function controllerGroups(
  model: RobotModel,
  dd: DiffDrive | null = null,
): Partial<Record<keyof typeof CONTROLLER_TYPES, string[]>> {
  const out: Partial<Record<keyof typeof CONTROLLER_TYPES, string[]>> = {};
  const wheels = new Set([...(dd?.left ?? []), ...(dd?.right ?? [])]);
  for (const L of controlledJoints(model)) {
    if (wheels.has(jointName(L))) continue;
    const k = commandInterfaceFor(model, L);
    (out[k] ??= []).push(jointName(L));
  }
  return out;
}

/** Controllers the launch file spawns, in order. */
export function controllerNames(model: RobotModel, dd: DiffDrive | null = null): string[] {
  return [
    "joint_state_broadcaster",
    ...Object.keys(controllerGroups(model, dd)).map((g) => `${g}_controller`),
    ...(dd ? ["diff_drive_controller"] : []),
  ];
}

const yamlList = (xs: string[]) => `[${xs.map((x) => JSON.stringify(x)).join(", ")}]`;

export function controllersYaml(model: RobotModel, dd: DiffDrive | null = null): string {
  const groups = controllerGroups(model, dd);
  const lines = [
    `# ros2_control configuration. Generated by ${GENERATOR}.`,
    "controller_manager:",
    "  ros__parameters:",
    "    update_rate: 100",
    "    use_sim_time: true",
    "    joint_state_broadcaster:",
    "      type: joint_state_broadcaster/JointStateBroadcaster",
  ];
  for (const [k, joints] of Object.entries(groups)) {
    if (!joints?.length) continue;
    lines.push(
      `    ${k}_controller:`,
      `      type: ${CONTROLLER_TYPES[k as keyof typeof CONTROLLER_TYPES]}`,
    );
  }
  if (dd)
    lines.push(
      "    diff_drive_controller:",
      "      type: diff_drive_controller/DiffDriveController",
    );
  for (const [k, joints] of Object.entries(groups)) {
    if (!joints?.length) continue;
    lines.push("", `${k}_controller:`, "  ros__parameters:", "    joints:");
    joints.forEach((j) => lines.push(`      - ${j}`));
  }
  if (dd)
    lines.push(
      "",
      "# Wheel separation and radius were measured from the model; check them against the robot.",
      "diff_drive_controller:",
      "  ros__parameters:",
      `    left_wheel_names: ${yamlList(dd.left)}`,
      `    right_wheel_names: ${yamlList(dd.right)}`,
      `    wheel_separation: ${fmt(dd.separation, 5)}`,
      `    wheel_radius: ${fmt(dd.radius, 5)}`,
      `    base_frame_id: ${rootName(model)}`,
      "    odom_frame_id: odom",
      "    publish_rate: 50.0",
      "    enable_odom_tf: true",
      "    linear.x.max_velocity: 1.0",
      "    linear.x.min_velocity: -1.0",
      "    angular.z.max_velocity: 2.0",
      "    angular.z.min_velocity: -2.0",
    );
  return lines.join("\n") + "\n";
}

const BRIDGE_TYPES: Record<string, [string, string]> = {
  imu: ["sensor_msgs/msg/Imu", "IMU"],
  lidar: ["sensor_msgs/msg/LaserScan", "LaserScan"],
  camera: ["sensor_msgs/msg/Image", "Image"],
  depth_camera: ["sensor_msgs/msg/Image", "Image"],
  rgbd_camera: ["sensor_msgs/msg/Image", "Image"],
  contact: ["ros_gz_interfaces/msg/Contacts", "Contacts"],
  force_torque: ["geometry_msgs/msg/Wrench", "Wrench"],
};

export function bridgeYaml(model: RobotModel, T: Target): string {
  const entry = (ros: string, gz: string, rosType: string, gzType: string) =>
    [
      `- ros_topic_name: "${ros}"`,
      `  gz_topic_name: "${gz}"`,
      `  ros_type_name: "${rosType}"`,
      `  gz_type_name: "${T.msgs}.${gzType}"`,
      "  direction: GZ_TO_ROS",
    ].join("\n");
  const out = [`# ros_gz_bridge topics for ${targetLabel(T)}. Generated by ${GENERATOR}.`];
  out.push(entry("clock", "clock", "rosgraph_msgs/msg/Clock", "Clock"));
  const control = model.export.ros2Control && controlledJoints(model).length > 0;
  if (!control && model.links.some((l) => hasJoint(model, l) && l.joint.type !== "fixed"))
    out.push(entry("joint_states", "joint_states", "sensor_msgs/msg/JointState", "Model"));
  for (const L of model.links)
    for (const s of L.sensors) {
      const [rosType, gzType] = BRIDGE_TYPES[s.type];
      const topic = sensorTopic(L, s);
      if (s.type === "rgbd_camera") {
        out.push(entry(`${topic}/image`, `${topic}/image`, rosType, gzType));
        out.push(entry(`${topic}/depth_image`, `${topic}/depth_image`, rosType, gzType));
        out.push(
          entry(
            `${topic}/points`,
            `${topic}/points`,
            "sensor_msgs/msg/PointCloud2",
            "PointCloudPacked",
          ),
        );
        out.push(
          entry(
            `${topic}/camera_info`,
            `${topic}/camera_info`,
            "sensor_msgs/msg/CameraInfo",
            "CameraInfo",
          ),
        );
        continue;
      }
      out.push(entry(topic, topic, rosType, gzType));
      if (s.type === "camera" || s.type === "depth_camera") {
        const info = `${sensorName(L, s)}/camera_info`;
        out.push(
          entry(
            info,
            topic.replace(/[^/]+$/, "camera_info"),
            "sensor_msgs/msg/CameraInfo",
            "CameraInfo",
          ),
        );
      }
    }
  return out.join("\n") + "\n";
}

/** Static SDF models for an environment's objects. */
function envModels(env: Environment, packageName: string): string {
  const geom = (o: Environment["objects"][number]) => {
    const g = o.geometry;
    switch (g.type) {
      case "box":
        return `<box><size>${fmt3(g.size)}</size></box>`;
      case "cylinder":
        return `<cylinder><radius>${fmt(g.radius)}</radius><length>${fmt(g.length)}</length></cylinder>`;
      case "sphere":
        return `<sphere><radius>${fmt(g.radius)}</radius></sphere>`;
      case "mesh":
        return `<mesh><uri>model://${packageName}/worlds/meshes/${envMeshFile(env, g.mesh)}</uri><scale>${fmt3(g.scale ?? [1, 1, 1])}</scale></mesh>`;
    }
  };
  const used = new Set<string>();
  return env.objects
    .map((o) => {
      let name = safeName(o.name, "object");
      for (let i = 2; used.has(name); i++) name = `${safeName(o.name, "object")}_${i}`;
      used.add(name);
      const c = `${fmt3(o.color, 3)} ${fmt(o.color[3], 3)}`;
      return `    <model name="${name}">
      <static>true</static>
      <pose>${fmt3(o.pose.xyz)} ${fmt3(o.pose.rpy)}</pose>
      <link name="link">
        <visual name="visual"><geometry>${geom(o)}</geometry><material><ambient>${c}</ambient><diffuse>${c}</diffuse></material></visual>${
          o.noCollide
            ? ""
            : `\n        <collision name="collision"><geometry>${geom(o)}</geometry></collision>`
        }
      </link>
    </model>`;
    })
    .join("\n");
}

export function worldSdf(T: Target, env?: Environment | null, packageName = ""): string {
  const sys = (file: string, cls: string, body = "") =>
    `    <plugin filename="${T.systemFile(file)}" name="${T.systemName(cls)}">${body}</plugin>`;
  const name = env ? safeName(env.id, "world").toLowerCase() : "empty";
  const extra = env ? `\n${envModels(env, packageName)}` : "";
  return `<?xml version="1.0"?>
<!-- ${env ? `${xmlEscape(env.name)}: ${xmlEscape(env.description)}${env.attribution ? ` (${xmlEscape(env.attribution)})` : ""}` : "Minimal world with the systems sensors need."} Generated by ${GENERATOR}. -->
<sdf version="1.9">
  <world name="${name}">
    <physics name="1ms" type="ignored"><max_step_size>0.001</max_step_size><real_time_factor>1.0</real_time_factor></physics>
${sys("physics", "Physics")}
${sys("user-commands", "UserCommands")}
${sys("scene-broadcaster", "SceneBroadcaster")}
${sys("sensors", "Sensors", "<render_engine>ogre2</render_engine>")}
${sys("imu", "Imu")}
${sys("contact", "Contact")}
${sys("forcetorque", "ForceTorque")}
    <gravity>0 0 -9.8</gravity>
    <scene><ambient>0.6 0.6 0.6 1</ambient><background>0.75 0.8 0.85 1</background><grid>true</grid></scene>
    <light type="directional" name="sun">
      <cast_shadows>true</cast_shadows>
      <pose>0 0 10 0 0 0</pose>
      <diffuse>0.9 0.9 0.9 1</diffuse>
      <specular>0.2 0.2 0.2 1</specular>
      <direction>-0.5 0.1 -0.9</direction>
    </light>
    <model name="ground_plane">
      <static>true</static>
      <link name="link">
        <collision name="collision"><geometry><plane><normal>0 0 1</normal><size>100 100</size></plane></geometry></collision>
        <visual name="visual"><geometry><plane><normal>0 0 1</normal><size>100 100</size></plane></geometry>
          <material><ambient>0.8 0.8 0.8 1</ambient><diffuse>0.8 0.8 0.8 1</diffuse></material></visual>
      </link>
    </model>${extra}
  </world>
</sdf>
`;
}

export function rvizConfig(model: RobotModel): string {
  return `Panels:
  - Class: rviz_common/Displays
    Name: Displays
Visualization Manager:
  Class: ""
  Displays:
    - Class: rviz_default_plugins/Grid
      Name: Grid
      Enabled: true
      Reference Frame: <Fixed Frame>
    - Class: rviz_default_plugins/RobotModel
      Name: RobotModel
      Enabled: true
      Description Source: Topic
      Description Topic:
        Value: /robot_description
    - Class: rviz_default_plugins/TF
      Name: TF
      Enabled: true
      Show Names: false
      Marker Scale: 0.3
  Global Options:
    Fixed Frame: ${rootName(model)}
  Views:
    Current:
      Class: rviz_default_plugins/Orbit
      Distance: 2
      Name: Current View
`;
}

export function packageXml(
  model: RobotModel,
  targets: TargetId[],
  dd: DiffDrive | null = null,
): string {
  const ex = model.export;
  const fams = new Set(targets.map((t) => TARGETS[t].family));
  const deps = ["robot_state_publisher", "joint_state_publisher_gui", "xacro", "rviz2"];
  if (fams.has("classic")) deps.push("gazebo_ros");
  if (fams.has("gz") || fams.has("fortress")) deps.push("ros_gz_sim", "ros_gz_bridge");
  if (ex.ros2Control) {
    deps.push("controller_manager", "joint_state_broadcaster");
    const groups = controllerGroups(model, dd);
    if (groups.position) deps.push("position_controllers");
    if (groups.velocity) deps.push("velocity_controllers");
    if (groups.effort) deps.push("effort_controllers");
    if (dd) deps.push("diff_drive_controller");
    if (fams.has("classic")) deps.push("gazebo_ros2_control");
    if (fams.has("gz") || fams.has("fortress")) deps.push("gz_ros2_control");
  }
  return `<?xml version="1.0"?>
<?xml-model href="http://download.ros.org/schema/package_format3.xsd" schematypens="http://www.w3.org/2001/XMLSchema"?>
<package format="3">
  <name>${model.packageName}</name>
  <version>${ex.version}</version>
  <description>${escapeText(ex.description || `Robot description for ${model.robot}, generated by ${GENERATOR}.`)}</description>
  <maintainer email="${escapeText(ex.maintainerEmail)}">${escapeText(ex.maintainer)}</maintainer>
  <license>${escapeText(ex.license)}</license>

  <buildtool_depend>ament_cmake</buildtool_depend>

${deps.map((d) => `  <exec_depend>${d}</exec_depend>`).join("\n")}

  <export>
    <build_type>ament_cmake</build_type>
  </export>
</package>
`;
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function cmakeLists(model: RobotModel): string {
  return `cmake_minimum_required(VERSION 3.8)
project(${model.packageName})

find_package(ament_cmake REQUIRED)

install(DIRECTORY config launch ${model.meshDir} rviz sdf urdf worlds${usedTextureKeys(model).size ? " materials" : ""}
  DESTINATION share/\${PROJECT_NAME})

ament_package()
`;
}

function modelConfig(model: RobotModel): string {
  return `<?xml version="1.0"?>
<model>
  <name>${escapeText(model.robot)}</name>
  <version>${model.export.version}</version>
  <sdf version="1.9">model.sdf</sdf>
  <description>Generated by ${GENERATOR}.</description>
</model>
`;
}

export function readme(
  model: RobotModel,
  targets: TargetId[],
  def: TargetId,
  dd: DiffDrive | null = null,
): string {
  const drive = dd
    ? `
## Drive

A \`diff_drive_controller\` drives ${[...dd.left, ...dd.right].join(", ")}. It publishes odometry on
\`/diff_drive_controller/odom\` and the \`odom\` -> \`${rootName(model)}\` transform.
Send velocity commands to \`/diff_drive_controller/cmd_vel\` (\`geometry_msgs/TwistStamped\` from
Jazzy on; \`Twist\` on Humble), for example with
\`ros2 run teleop_twist_keyboard teleop_twist_keyboard --ros-args -r cmd_vel:=/diff_drive_controller/cmd_vel -p stamped:=true\`.
`
    : "";
  const robot = safeName(model.robot, "robot");
  const rows = targets
    .map(
      (t) =>
        `| \`${t}\` | ${targetLabel(TARGETS[t])} | \`ros2 launch ${model.packageName} gazebo_${t}.launch.py\` |`,
    )
    .join("\n");
  return `# ${model.packageName}

Robot description for **${model.robot}**, generated by ${GENERATOR}.
REP 103 conventions: Z-up, metres, kilograms, radians.

## Build

\`\`\`bash
cd ~/ros2_ws/src && cp -r /path/to/${model.packageName} .
cd ~/ros2_ws && rosdep install --from-paths src -y --ignore-src
colcon build --packages-select ${model.packageName} && source install/setup.bash
\`\`\`

## Run

\`ros2 launch ${model.packageName} display.launch.py\` shows the model in RViz with joint sliders.

| Target | Distribution | Simulator launch |
| --- | --- | --- |
${rows}
${drive}
## Layout

- \`urdf/${robot}.urdf.xacro\`: the source of truth. \`xacro ${robot}.urdf.xacro sim:=<target>\` (default \`${def}\`).
- \`urdf/${robot}.<target>.urdf\`: pre-expanded URDF per target, for tools that cannot run xacro.
- \`sdf/${robot}/\`: standalone SDF model.
- \`${model.meshDir}/\`: binary STL meshes.
- \`config/controllers.yaml\`: ros2_control controllers. \`config/gz_bridge_<target>.yaml\`: ROS <-> Gazebo topics.
- \`worlds/\`: an empty world with the physics, sensors, IMU, contact and force-torque systems loaded.

## Notes

- Mesh URIs use \`package://${model.packageName}/...\`. The launch files add the install share
  directory to the simulator's resource path so Gazebo can resolve them.
- Inertias were integrated over the mesh geometry for a solid of uniform density. Check any link
  the editor flagged as not watertight.
`;
}
