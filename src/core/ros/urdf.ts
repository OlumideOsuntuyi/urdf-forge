/** URDF generation. One URDF per target; the xacro wraps the same pieces. */
import {
  ARTICULATED,
  hasJoint,
  isFrameLink,
  jointName,
  linkById,
  materialById,
  meshById,
  orderedLinks,
  safeName,
  uniqueName,
  type Collision,
  type Geometry,
  type Link,
  type Pose,
  type RobotModel,
  type Sensor,
  type Visual,
} from "../model";
import { fmt, fmt3, normalize } from "../math";
import { TARGETS, targetLabel, type Target, type TargetId } from "./targets";

export const GENERATOR = "URDF Forge";

export function xmlEscape(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function meshUri(model: RobotModel, file: string): string {
  return `package://${model.packageName}/${model.meshDir}/${file}`;
}

/** Package path of a texture image. */
export function textureUri(
  model: RobotModel,
  key: string,
  scheme: "package" | "model" = "package",
): string {
  return `${scheme}://${model.packageName}/materials/textures/${key}`;
}

/** Mesh file name for a visual: textured materials need UVs, so those meshes export as OBJ. */
export function meshFileFor(model: RobotModel, meshId: string, materialId: string | null): string {
  const file = meshById(model, meshId)?.file ?? "missing.stl";
  const mat = materialById(model, materialId);
  return mat?.textures?.maps.color || mat?.textures?.maps.normal
    ? texturedMeshFile(file, mat.textures.tile)
    : file;
}

export function texturedMeshFile(stlFile: string, tile: number): string {
  return `${stlFile.replace(/\.stl$/i, "")}_uv${Math.round(tile * 1000)}mm.obj`;
}

function geometryXml(
  model: RobotModel,
  g: Geometry,
  ind: string,
  materialId: string | null = null,
): string {
  switch (g.type) {
    case "mesh": {
      const file = meshFileFor(model, g.meshId, materialId);
      return `${ind}<geometry><mesh filename="${xmlEscape(meshUri(model, file))}" scale="${fmt3(g.scale)}"/></geometry>`;
    }
    case "box":
      return `${ind}<geometry><box size="${fmt3(g.size)}"/></geometry>`;
    case "cylinder":
      return `${ind}<geometry><cylinder radius="${fmt(g.radius)}" length="${fmt(g.length)}"/></geometry>`;
    case "sphere":
      return `${ind}<geometry><sphere radius="${fmt(g.radius)}"/></geometry>`;
  }
}

export function originXml(o: Pose, ind: string): string {
  return `${ind}<origin xyz="${fmt3(o.xyz)}" rpy="${fmt3(o.rpy)}"/>`;
}

function componentName(link: Link, c: Visual | Collision, kind: string, i: number): string {
  return safeName(c.name || `${link.name}_${kind}${i ? `_${i + 1}` : ""}`, kind);
}

/**
 * The name each material is written under. URDF material names are global, so two materials
 * that share a name (easy to do in the editor) get `_2`, `_3`... instead of clashing.
 */
export function materialExportNames(model: RobotModel): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of model.materials) out.set(m.id, uniqueName(m.name, out.values(), "material"));
  return out;
}

/**
 * KDL (robot_state_publisher) does not support inertia on the root link, so a root that is
 * only a frame (base_footprint) is written without <inertial>, as hand-written URDFs do.
 */
export function omitInertial(model: RobotModel, L: Link): boolean {
  return !hasJoint(model, L) && isFrameLink(L);
}

export function linkXml(
  model: RobotModel,
  L: Link,
  massExpr?: string,
  matNames = materialExportNames(model),
): string {
  const o = [`  <link name="${xmlEscape(L.name)}">`];
  const ine = L.inertial;
  const I = ine.inertia;
  if (!omitInertial(model, L)) {
    o.push("    <inertial>");
    o.push(originXml({ xyz: ine.com, rpy: [0, 0, 0] }, "      "));
    o.push(`      <mass value="${massExpr ?? fmt(Math.max(ine.mass, 1e-6))}"/>`);
    o.push(
      `      <inertia ixx="${fmt(I.ixx, 10)}" ixy="${fmt(I.ixy, 10)}" ixz="${fmt(I.ixz, 10)}" iyy="${fmt(I.iyy, 10)}" iyz="${fmt(I.iyz, 10)}" izz="${fmt(I.izz, 10)}"/>`,
    );
    o.push("    </inertial>");
  }
  L.visuals.forEach((v, i) => {
    o.push(`    <visual name="${xmlEscape(componentName(L, v, "visual", i))}">`);
    o.push(originXml(v.origin, "      "));
    o.push(geometryXml(model, v.geometry, "      ", v.materialId));
    const mat = materialById(model, v.materialId);
    if (mat) o.push(`      <material name="${xmlEscape(matNames.get(mat.id)!)}"/>`);
    o.push("    </visual>");
  });
  L.collisions.forEach((c, i) => {
    o.push(`    <collision name="${xmlEscape(componentName(L, c, "collision", i))}">`);
    o.push(originXml(c.origin, "      "));
    o.push(geometryXml(model, c.geometry, "      "));
    o.push("    </collision>");
  });
  o.push("  </link>");
  return o.join("\n");
}

export function jointXml(model: RobotModel, L: Link): string {
  const j = L.joint;
  const parent = linkById(model, L.parentId)!;
  const o = [`  <joint name="${xmlEscape(jointName(L))}" type="${j.type}">`];
  o.push(`    <parent link="${xmlEscape(parent.name)}"/>`);
  o.push(`    <child link="${xmlEscape(L.name)}"/>`);
  o.push(originXml(L.origin, "    "));
  if (ARTICULATED.includes(j.type) || j.type === "planar")
    o.push(`    <axis xyz="${fmt3(normalize(j.axis))}"/>`);
  if (j.type === "revolute" || j.type === "prismatic")
    o.push(
      `    <limit lower="${fmt(j.lower)}" upper="${fmt(j.upper)}" effort="${fmt(j.effort, 4)}" velocity="${fmt(j.velocity, 4)}"/>`,
    );
  else if (j.type === "continuous")
    o.push(`    <limit effort="${fmt(j.effort, 4)}" velocity="${fmt(j.velocity, 4)}"/>`);
  if (ARTICULATED.includes(j.type) && (j.damping || j.friction))
    o.push(`    <dynamics damping="${fmt(j.damping)}" friction="${fmt(j.friction)}"/>`);
  if (j.safety && (j.type === "revolute" || j.type === "prismatic"))
    o.push(
      `    <safety_controller soft_lower_limit="${fmt(j.safety.softLower)}" soft_upper_limit="${fmt(j.safety.softUpper)}" k_position="${fmt(j.safety.kPosition, 4)}" k_velocity="${fmt(j.safety.kVelocity, 4)}"/>`,
    );
  if (j.mimic?.joint)
    o.push(
      `    <mimic joint="${xmlEscape(j.mimic.joint)}" multiplier="${fmt(j.mimic.multiplier, 6)}" offset="${fmt(j.mimic.offset, 6)}"/>`,
    );
  o.push("  </joint>");
  return o.join("\n");
}

// ------------------------------------------------------------------ sensors

export function sensorTopic(L: Link, s: Sensor): string {
  if (s.topic) return s.topic;
  const nm = sensorName(L, s);
  return (
    { imu: "imu", lidar: "scan", camera: `${nm}/image`, depth_camera: `${nm}/depth_image` }[
      s.type as string
    ] ?? nm
  );
}

export function sensorName(L: Link, s: Sensor): string {
  return safeName(s.name || `${L.name}_${s.type}`, "sensor");
}

function sensorXml(L: Link, T: Target): string[] {
  const out: string[] = [];
  for (const s of L.sensors) {
    const nm = sensorName(L, s);
    const topic = sensorTopic(L, s);
    const classic = T.family === "classic";
    const sdfType =
      s.type === "lidar"
        ? classic
          ? "ray"
          : "gpu_lidar"
        : s.type === "depth_camera"
          ? classic
            ? "depth"
            : "depth_camera"
          : s.type;
    out.push(`    <sensor name="${xmlEscape(nm)}" type="${sdfType}">`);
    out.push(`      <always_on>true</always_on>`);
    out.push(`      <update_rate>${fmt(s.rate, 3)}</update_rate>`);
    out.push(`      <visualize>false</visualize>`);
    if (s.type === "camera" || s.type === "depth_camera") {
      out.push("      <camera>");
      out.push(`        <horizontal_fov>${fmt(s.fov ?? 1.047, 5)}</horizontal_fov>`);
      out.push(
        `        <image><width>${Math.round(s.width ?? 640)}</width><height>${Math.round(s.height ?? 480)}</height><format>${s.type === "depth_camera" ? "R_FLOAT32" : "R8G8B8"}</format></image>`,
      );
      out.push(
        `        <clip><near>${fmt(s.near ?? 0.05, 4)}</near><far>${fmt(s.far ?? 50, 4)}</far></clip>`,
      );
      out.push("      </camera>");
    } else if (s.type === "lidar") {
      const tag = classic ? "ray" : "lidar";
      out.push(`      <${tag}><scan><horizontal>`);
      out.push(
        `        <samples>${Math.round(s.samples ?? 360)}</samples><resolution>1</resolution><min_angle>${fmt(s.minAngle ?? -Math.PI, 5)}</min_angle><max_angle>${fmt(s.maxAngle ?? Math.PI, 5)}</max_angle>`,
      );
      out.push("      </horizontal></scan>");
      out.push(
        `      <range><min>${fmt(s.rangeMin ?? 0.12, 4)}</min><max>${fmt(s.rangeMax ?? 12, 4)}</max><resolution>0.01</resolution></range>`,
      );
      out.push(`      </${tag}>`);
    } else if (s.type === "contact" && L.collisions.length) {
      out.push(
        `      <contact><collision>${xmlEscape(componentName(L, L.collisions[0], "collision", 0))}</collision></contact>`,
      );
    }
    if (classic) {
      const plugin = {
        imu: "libgazebo_ros_imu_sensor.so",
        camera: "libgazebo_ros_camera.so",
        depth_camera: "libgazebo_ros_camera.so",
        lidar: "libgazebo_ros_ray_sensor.so",
        contact: "libgazebo_ros_bumper.so",
        force_torque: "libgazebo_ros_ft_sensor.so",
      }[s.type];
      out.push(`      <plugin name="${xmlEscape(nm)}_plugin" filename="${plugin}">`);
      out.push(`        <ros><remapping>~/out:=${xmlEscape(topic)}</remapping></ros>`);
      out.push(`        <frame_name>${xmlEscape(L.name)}</frame_name>`);
      if (s.type === "lidar") out.push("        <output_type>sensor_msgs/LaserScan</output_type>");
      out.push("      </plugin>");
    } else {
      out.push(`      <topic>${xmlEscape(topic)}</topic>`);
      if (T.frameTag) out.push(`      <${T.frameTag}>${xmlEscape(L.name)}</${T.frameTag}>`);
    }
    out.push("    </sensor>");
  }
  return out;
}

export function gazeboLinkXml(model: RobotModel, L: Link, T: Target): string {
  const g = L.gazebo;
  const o = [`  <gazebo reference="${xmlEscape(L.name)}">`];
  o.push(`    <mu1>${fmt(g.mu1, 4)}</mu1>`);
  o.push(`    <mu2>${fmt(g.mu2, 4)}</mu2>`);
  o.push(`    <kp>${fmt(g.kp, 1)}</kp>`);
  o.push(`    <kd>${fmt(g.kd, 1)}</kd>`);
  o.push(`    <minDepth>${fmt(g.minDepth, 5)}</minDepth>`);
  o.push(`    <maxVel>${fmt(g.maxVel, 5)}</maxVel>`);
  o.push(`    <selfCollide>${g.selfCollide}</selfCollide>`);
  if (!g.gravity) o.push("    <gravity>false</gravity>");
  const mat = L.visuals.map((v) => materialById(model, v.materialId)).find(Boolean);
  const rgba = mat?.rgba ?? [0.7, 0.7, 0.7, 1];
  const col = `${fmt3(rgba, 4)} ${fmt(rgba[3], 3)}`;
  o.push("    <visual>");
  o.push("      <material>");
  o.push(`        <ambient>${col}</ambient>`);
  o.push(`        <diffuse>${col}</diffuse>`);
  o.push("        <specular>0.1 0.1 0.1 1</specular>");
  if (T.family !== "classic" && mat) {
    const maps = mat.textures?.maps ?? {};
    const map = (tag: string, key?: string) =>
      key ? `<${tag}>${xmlEscape(textureUri(model, key, "model"))}</${tag}>` : "";
    o.push(
      `        <pbr><metal><metalness>${fmt(mat.metalness, 3)}</metalness><roughness>${fmt(mat.roughness, 3)}</roughness>${map("albedo_map", maps.color)}${map("normal_map", maps.normal)}${map("roughness_map", maps.roughness)}${map("metalness_map", maps.metalness)}${map("ambient_occlusion_map", maps.ao)}</metal></pbr>`,
    );
  }
  o.push("      </material>");
  o.push("    </visual>");
  o.push(...sensorXml(L, T));
  o.push("  </gazebo>");
  return o.join("\n");
}

// ------------------------------------------------------------------ ros2_control

export type CommandInterface = "position" | "velocity" | "effort";

export function controlledJoints(model: RobotModel): Link[] {
  return orderedLinks(model).filter(
    (l) =>
      hasJoint(model, l) &&
      ARTICULATED.includes(l.joint.type) &&
      l.controlled &&
      !l.joint.mimic?.joint,
  );
}

export function commandInterfaceFor(model: RobotModel, L: Link): CommandInterface {
  const s = model.export.commandInterface;
  if (s !== "auto") return s;
  return L.joint.type === "continuous" || L.drive.mode === "wheel" ? "velocity" : "position";
}

export function controlXml(model: RobotModel, T: Target): string {
  const joints = controlledJoints(model);
  if (!model.export.ros2Control || !joints.length) return "";
  const o = [`  <ros2_control name="${safeName(model.robot, "robot")}_system" type="system">`];
  o.push(`    <hardware><plugin>${T.hardwarePlugin}</plugin></hardware>`);
  for (const L of joints) {
    const j = L.joint;
    const iface = commandInterfaceFor(model, L);
    o.push(`    <joint name="${xmlEscape(jointName(L))}">`);
    o.push(`      <command_interface name="${iface}">`);
    if (iface === "position" && (j.type === "revolute" || j.type === "prismatic")) {
      o.push(`        <param name="min">${fmt(j.lower)}</param>`);
      o.push(`        <param name="max">${fmt(j.upper)}</param>`);
    } else if (iface === "velocity") {
      o.push(`        <param name="min">${fmt(-j.velocity)}</param>`);
      o.push(`        <param name="max">${fmt(j.velocity)}</param>`);
    } else if (iface === "effort") {
      o.push(`        <param name="min">${fmt(-j.effort)}</param>`);
      o.push(`        <param name="max">${fmt(j.effort)}</param>`);
    }
    o.push("      </command_interface>");
    o.push('      <state_interface name="position"/>');
    o.push('      <state_interface name="velocity"/>');
    o.push('      <state_interface name="effort"/>');
    o.push("    </joint>");
  }
  o.push("  </ros2_control>");
  o.push("  <gazebo>");
  o.push(`    <plugin filename="${T.controlFile}" name="${T.controlName}">`);
  o.push(`      <parameters>$(find ${model.packageName})/config/controllers.yaml</parameters>`);
  o.push("    </plugin>");
  o.push("  </gazebo>");
  return o.join("\n");
}

/** Without ros2_control, Gazebo still has to publish joint states for robot_state_publisher. */
export function jointStateXml(model: RobotModel, T: Target): string {
  if (model.export.ros2Control && controlledJoints(model).length) return "";
  if (!model.links.some((l) => hasJoint(model, l) && l.joint.type !== "fixed")) return "";
  if (T.family === "classic")
    return [
      "  <gazebo>",
      '    <plugin name="joint_state_publisher" filename="libgazebo_ros_joint_state_publisher.so">',
      "      <update_rate>50</update_rate>",
      ...orderedLinks(model)
        .filter((l) => hasJoint(model, l) && l.joint.type !== "fixed")
        .map((l) => `      <joint_name>${xmlEscape(jointName(l))}</joint_name>`),
      "    </plugin>",
      "  </gazebo>",
    ].join("\n");
  return [
    "  <gazebo>",
    `    <plugin filename="${T.systemFile("joint-state-publisher")}" name="${T.systemName("JointStatePublisher")}">`,
    "      <topic>joint_states</topic>",
    "    </plugin>",
    "  </gazebo>",
  ].join("\n");
}

export function materialsXml(model: RobotModel): string[] {
  const used = new Set(model.links.flatMap((l) => l.visuals.map((v) => v.materialId)));
  const names = materialExportNames(model);
  return model.materials
    .filter((m) => used.has(m.id))
    .map(
      (m) =>
        `  <material name="${xmlEscape(names.get(m.id)!)}"><color rgba="${fmt3(m.rgba, 4)} ${fmt(m.rgba[3], 3)}"/>${
          m.textures?.maps.color
            ? `<texture filename="${xmlEscape(textureUri(model, m.textures.maps.color))}"/>`
            : ""
        }</material>`,
    );
}

export interface GenerateOptions {
  /** ISO timestamp for the header; omit for reproducible output. */
  stamp?: string;
}

export function generateUrdf(
  model: RobotModel,
  targetId: TargetId,
  opts: GenerateOptions = {},
): string {
  const T = TARGETS[targetId];
  const o = ['<?xml version="1.0"?>'];
  o.push(
    `<!-- ${xmlEscape(model.robot)}: generated by ${GENERATOR}${opts.stamp ? ` ${opts.stamp}` : ""}`,
  );
  o.push(`     Target: ${targetLabel(T)}`);
  o.push("     REP 103: Z-up, metres, kilograms, radians. -->");
  o.push(`<robot name="${safeName(model.robot, "robot")}">`);
  o.push(...materialsXml(model));
  o.push("");
  for (const L of orderedLinks(model)) {
    o.push(linkXml(model, L));
    if (hasJoint(model, L)) o.push(jointXml(model, L));
    o.push("");
  }
  o.push(`  <!-- Simulator: ${T.simLabel} -->`);
  for (const L of orderedLinks(model)) o.push(gazeboLinkXml(model, L, T));
  for (const block of [controlXml(model, T), jointStateXml(model, T)]) if (block) o.push(block);
  o.push("</robot>");
  return o.join("\n") + "\n";
}
