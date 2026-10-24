/** Standalone SDF 1.9 model with link poses relative to the model frame. */
import { Matrix4 } from "three";
import {
  ARTICULATED,
  hasJoint,
  jointName,
  linkById,
  materialById,
  orderedLinks,
  safeName,
  type Geometry,
  type RobotModel,
} from "../model";
import { fmt, fmt3, matrixToPose, normalize } from "../math";
import { linkWorldMatrices } from "../kinematics";
import { meshFileFor, meshUri, xmlEscape } from "./urdf";

function geometry(
  model: RobotModel,
  g: Geometry,
  ind: string,
  materialId: string | null = null,
): string {
  switch (g.type) {
    case "mesh":
      return `${ind}<geometry><mesh><uri>${xmlEscape(meshUri(model, meshFileFor(model, g.meshId, materialId)))}</uri><scale>${fmt3(g.scale)}</scale></mesh></geometry>`;
    case "box":
      return `${ind}<geometry><box><size>${fmt3(g.size)}</size></box></geometry>`;
    case "cylinder":
      return `${ind}<geometry><cylinder><radius>${fmt(g.radius)}</radius><length>${fmt(g.length)}</length></cylinder></geometry>`;
    case "sphere":
      return `${ind}<geometry><sphere><radius>${fmt(g.radius)}</radius></sphere></geometry>`;
  }
}

export function generateSdf(model: RobotModel): string {
  const world = linkWorldMatrices(model);
  const o = [
    '<?xml version="1.0"?>',
    '<sdf version="1.9">',
    `  <model name="${safeName(model.robot, "robot")}">`,
  ];
  for (const L of orderedLinks(model)) {
    const p = matrixToPose(world.get(L.id) ?? new Matrix4());
    const I = L.inertial.inertia;
    o.push(`    <link name="${xmlEscape(L.name)}">`);
    o.push(`      <pose>${fmt3(p.xyz)} ${fmt3(p.rpy)}</pose>`);
    o.push("      <inertial>");
    o.push(`        <pose>${fmt3(L.inertial.com)} 0 0 0</pose>`);
    o.push(`        <mass>${fmt(Math.max(L.inertial.mass, 1e-6))}</mass>`);
    o.push(
      `        <inertia><ixx>${fmt(I.ixx, 10)}</ixx><ixy>${fmt(I.ixy, 10)}</ixy><ixz>${fmt(I.ixz, 10)}</ixz><iyy>${fmt(I.iyy, 10)}</iyy><iyz>${fmt(I.iyz, 10)}</iyz><izz>${fmt(I.izz, 10)}</izz></inertia>`,
    );
    o.push("      </inertial>");
    L.visuals.forEach((v, i) => {
      o.push(`      <visual name="${safeName(v.name || `visual_${i}`)}">`);
      o.push(`        <pose>${fmt3(v.origin.xyz)} ${fmt3(v.origin.rpy)}</pose>`);
      o.push(geometry(model, v.geometry, "        ", v.materialId));
      const mat = materialById(model, v.materialId);
      if (mat) {
        const c = `${fmt3(mat.rgba, 4)} ${fmt(mat.rgba[3], 3)}`;
        o.push(`        <material><ambient>${c}</ambient><diffuse>${c}</diffuse></material>`);
      }
      o.push("      </visual>");
    });
    L.collisions.forEach((c, i) => {
      o.push(`      <collision name="${safeName(c.name || `collision_${i}`)}">`);
      o.push(`        <pose>${fmt3(c.origin.xyz)} ${fmt3(c.origin.rpy)}</pose>`);
      o.push(geometry(model, c.geometry, "        "));
      o.push(
        `        <surface><friction><ode><mu>${fmt(L.gazebo.mu1, 4)}</mu><mu2>${fmt(L.gazebo.mu2, 4)}</mu2></ode></friction></surface>`,
      );
      o.push("      </collision>");
    });
    if (!L.gazebo.gravity) o.push("      <gravity>false</gravity>");
    o.push("    </link>");
  }
  for (const L of orderedLinks(model)) {
    if (!hasJoint(model, L)) continue;
    const j = L.joint;
    const type = j.type === "continuous" ? "revolute" : j.type === "floating" ? "ball" : j.type;
    o.push(`    <joint name="${xmlEscape(jointName(L))}" type="${type}">`);
    o.push(`      <parent>${xmlEscape(linkById(model, L.parentId)!.name)}</parent>`);
    o.push(`      <child>${xmlEscape(L.name)}</child>`);
    if (ARTICULATED.includes(j.type) || j.type === "planar") {
      o.push("      <axis>");
      o.push(`        <xyz>${fmt3(normalize(j.axis))}</xyz>`);
      if (j.type === "continuous")
        o.push(
          `        <limit><lower>-1e16</lower><upper>1e16</upper><effort>${fmt(j.effort, 4)}</effort><velocity>${fmt(j.velocity, 4)}</velocity></limit>`,
        );
      else if (j.type !== "planar")
        o.push(
          `        <limit><lower>${fmt(j.lower)}</lower><upper>${fmt(j.upper)}</upper><effort>${fmt(j.effort, 4)}</effort><velocity>${fmt(j.velocity, 4)}</velocity></limit>`,
        );
      o.push(
        `        <dynamics><damping>${fmt(j.damping)}</damping><friction>${fmt(j.friction)}</friction></dynamics>`,
      );
      o.push("      </axis>");
    }
    o.push("    </joint>");
  }
  o.push("  </model>");
  o.push("</sdf>");
  return o.join("\n") + "\n";
}
