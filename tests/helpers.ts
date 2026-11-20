import {
  newLink,
  newModel,
  uid,
  type Link,
  type MeshAsset,
  type RobotModel,
} from "../src/core/model";
import { boxPositions } from "../src/core/mesh/ops";

/** A two-link arm: base box, a revolute upper arm, plus a wheel on a continuous joint. */
export function sampleRobot(): { model: RobotModel; meshes: Map<string, Float32Array> } {
  const model = newModel("test_bot");
  const pos = boxPositions(0.2, 0.2, 0.1);
  const asset: MeshAsset = {
    id: uid("msh"),
    name: "base",
    file: "base.stl",
    source: "stl",
    origin: "base.stl",
    triangles: pos.length / 9,
    bbox: { min: [-0.1, -0.1, -0.05], max: [0.1, 0.1, 0.05] },
    volume: 0.002,
    com: [0, 0, 0],
    watertight: true,
    color: null,
  };
  model.meshes.push(asset);
  const base = newLink("base_link");
  base.visuals.push({
    id: uid("vis"),
    name: "",
    origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
    geometry: { type: "mesh", meshId: asset.id, scale: [1, 1, 1] },
    materialId: model.materials[0].id,
  });
  base.collisions.push({
    id: uid("col"),
    name: "",
    origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
    geometry: { type: "box", size: [0.2, 0.2, 0.1] },
  });
  const arm = newLink("arm");
  arm.parentId = base.id;
  arm.origin = { xyz: [0, 0, 0.1], rpy: [0, 0, 0] };
  arm.joint.type = "revolute";
  arm.joint.axis = [0, 1, 0];
  arm.visuals.push({
    id: uid("vis"),
    name: "",
    origin: { xyz: [0, 0, 0.15], rpy: [0, 0, 0] },
    geometry: { type: "cylinder", radius: 0.02, length: 0.3 },
    materialId: model.materials[0].id,
  });
  arm.collisions.push({
    id: uid("col"),
    name: "",
    origin: { xyz: [0, 0, 0.15], rpy: [0, 0, 0] },
    geometry: { type: "cylinder", radius: 0.02, length: 0.3 },
  });
  const wheel = newLink("wheel");
  wheel.parentId = base.id;
  wheel.origin = { xyz: [0, 0.12, 0], rpy: [-Math.PI / 2, 0, 0] };
  wheel.joint.type = "continuous";
  wheel.drive.mode = "wheel";
  wheel.visuals.push({
    id: uid("vis"),
    name: "",
    origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
    geometry: { type: "cylinder", radius: 0.05, length: 0.02 },
    materialId: model.materials[0].id,
  });
  wheel.collisions.push({
    id: uid("col"),
    name: "",
    origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
    geometry: { type: "sphere", radius: 0.05 },
  });
  model.links.push(base, arm, wheel);
  return { model, meshes: new Map([[asset.id, pos]]) };
}

export function addLink(
  m: RobotModel,
  name: string,
  parent: Link | null,
  type: Link["joint"]["type"],
  xyz: [number, number, number] = [0, 0, 0],
  setup: (l: Link) => void = () => {},
): Link {
  const L = newLink(name);
  L.parentId = parent?.id ?? null;
  L.origin = { xyz, rpy: [0, 0, 0] };
  L.joint.type = type;
  L.collisions.push({
    id: uid("col"),
    name: "",
    origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
    geometry: { type: "box", size: [0.05, 0.05, 0.05] },
  });
  L.inertial.mass = 0.5;
  setup(L);
  m.links.push(L);
  return L;
}

/** A 3-joint arm bolted to the world. */
export function armRobot(): RobotModel {
  const m = newModel("arm_bot");
  const world = newLink("world");
  world.inertial.mass = 0;
  m.links.push(world);
  const base = addLink(m, "base_link", world, "fixed", [0.5, 0, 0.8]);
  const shoulder = addLink(m, "shoulder", base, "revolute", [0, 0, 0.1], (l) => {
    l.joint.effort = 40;
    l.joint.velocity = 3;
    l.joint.lower = -2;
    l.joint.upper = 2;
    l.jointValue = 0.5;
  });
  const elbow = addLink(m, "elbow", shoulder, "revolute", [0, 0, 0.3], (l) => {
    l.joint.effort = 20;
    l.jointValue = 5; // beyond the limit: clamped
  });
  addLink(m, "slider", elbow, "prismatic", [0, 0, 0.2], (l) => {
    l.joint.effort = 100;
    l.joint.lower = 0;
    l.joint.upper = 0.05;
  });
  return m;
}

/** A wheel-legged biped: chassis, two legs with upper and lower limbs, a wheel at each foot. */
export function wheelBiped(): RobotModel {
  const m = newModel("wheel_biped");
  const chassis = addLink(m, "chassis", null, "fixed");
  for (const side of ["left", "right"]) {
    const y = side === "left" ? 0.15 : -0.15;
    const upper = addLink(m, `${side}_upper`, chassis, "revolute", [0, y, -0.05], (l) => {
      l.joint.axis = [0, 1, 0];
      l.joint.effort = 5.5;
      l.joint.velocity = 30;
      l.jointValue = 0.4;
    });
    const motor = addLink(m, `${side}_knee_motor`, upper, "fixed", [0, 0, -0.1]);
    const lower = addLink(m, `${side}_lower`, motor, "revolute", [0, 0, -0.05], (l) => {
      l.joint.axis = [0, 1, 0];
      l.joint.effort = 5.5;
      l.joint.velocity = 30;
      l.jointValue = -0.8;
    });
    addLink(m, `${side}_wheel`, lower, "continuous", [0, 0, -0.15], (l) => {
      l.joint.axis = [0, 1, 0];
      l.joint.effort = 2;
      l.joint.velocity = 40;
      l.drive.mode = "wheel";
    });
  }
  return m;
}
