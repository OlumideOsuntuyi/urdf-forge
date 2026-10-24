import { newLink, newModel, uid, type MeshAsset, type RobotModel } from "../src/core/model";
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
