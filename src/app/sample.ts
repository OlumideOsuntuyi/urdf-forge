/** A four-wheeled rover with a three-joint arm and a gripper, built from primitives. */
import {
  newLink,
  newMaterial,
  newModel,
  uid,
  type Geometry,
  type JointType,
  type Link,
  type Pose,
  type Rgba,
  type RobotModel,
  type Vec3,
} from "@/core/model";
import { computeInertial } from "@/core/inertial";
import { app } from "@/store/app";
import { meshStore } from "@/store/meshStore";
import { viewportRef } from "@/viewport/ref";

export function buildSampleRobot(): RobotModel {
  const m = newModel("rover_arm");
  m.export.description = "Sample rover with a manipulator arm, made in URDF Forge.";
  m.export.targets = ["jazzy-harmonic", "humble-fortress", "lyrical-jetty"];
  m.export.ros2Control = true;
  const mat = (name: string, rgba: Rgba, metalness = 0.2, roughness = 0.5) => {
    const x = newMaterial(name, rgba);
    x.metalness = metalness;
    x.roughness = roughness;
    m.materials.push(x);
    return x.id;
  };
  m.materials = [];
  const body = mat("graphite", [0.16, 0.18, 0.21, 1], 0.3, 0.45);
  const rubber = mat("rubber", [0.05, 0.05, 0.06, 1], 0, 0.9);
  const orange = mat("forge_orange", [1.0, 0.45, 0.15, 1], 0.1, 0.4);
  const steel = mat("steel", [0.75, 0.77, 0.8, 1], 0.9, 0.3);

  const add = (
    name: string,
    parent: Link | null,
    origin: Pose,
    geometry: Geometry,
    materialId: string,
    joint: {
      type: JointType;
      axis?: Vec3;
      lower?: number;
      upper?: number;
      velocity?: number;
      effort?: number;
    } = { type: "fixed" },
    geoOrigin: Pose = { xyz: [0, 0, 0], rpy: [0, 0, 0] },
    density = 500,
  ) => {
    const L = newLink(name);
    L.parentId = parent?.id ?? null;
    L.origin = origin;
    Object.assign(L.joint, joint);
    L.visuals.push({ id: uid("vis"), name: "", origin: geoOrigin, geometry, materialId });
    L.collisions.push({
      id: uid("col"),
      name: "",
      origin: structuredClone(geoOrigin),
      geometry: structuredClone(geometry),
    });
    L.inertial.density = density;
    m.links.push(L);
    return L;
  };
  const P = (xyz: Vec3, rpy: Vec3 = [0, 0, 0]): Pose => ({ xyz, rpy });

  const base = add(
    "base_link",
    null,
    P([0, 0, 0.09]),
    { type: "box", size: [0.42, 0.28, 0.08] },
    body,
    undefined,
    undefined,
    700,
  );
  base.sensors.push({ id: uid("sen"), type: "imu", name: "imu", rate: 100, topic: "" });
  for (const [sx, sy] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]) {
    const w = add(
      `wheel_${sx > 0 ? "front" : "rear"}_${sy > 0 ? "left" : "right"}`,
      base,
      P([0.14 * sx, 0.17 * sy, -0.02], [-Math.PI / 2, 0, 0]),
      { type: "cylinder", radius: 0.07, length: 0.045 },
      rubber,
      { type: "continuous", axis: [0, 0, 1], velocity: 10, effort: 5 },
      undefined,
      900,
    );
    w.drive = { mode: "wheel", target: 4, sweep: false };
    w.gazebo.mu1 = w.gazebo.mu2 = 1.2;
  }
  const lidar = add(
    "lidar_link",
    base,
    P([0.17, 0, 0.065]),
    { type: "cylinder", radius: 0.035, length: 0.05 },
    steel,
  );
  lidar.sensors.push({
    id: uid("sen"),
    type: "lidar",
    name: "lidar",
    rate: 10,
    topic: "scan",
    samples: 360,
    rangeMin: 0.12,
    rangeMax: 12,
  });

  const turret = add(
    "turret",
    base,
    P([-0.06, 0, 0.04]),
    { type: "cylinder", radius: 0.06, length: 0.05 },
    orange,
    { type: "revolute", axis: [0, 0, 1], lower: -2.6, upper: 2.6, velocity: 1.5, effort: 8 },
    P([0, 0, 0.025]),
  );
  turret.drive = { mode: "servo", target: 0, sweep: true };
  const upper = add(
    "upper_arm",
    turret,
    P([0, 0, 0.05]),
    { type: "box", size: [0.04, 0.05, 0.26] },
    orange,
    { type: "revolute", axis: [0, 1, 0], lower: -1.2, upper: 1.4, velocity: 1.2, effort: 12 },
    P([0, 0, 0.13]),
  );
  upper.drive = { mode: "servo", target: 0.5, sweep: true };
  const fore = add(
    "forearm",
    upper,
    P([0, 0, 0.26]),
    { type: "box", size: [0.035, 0.04, 0.2] },
    steel,
    { type: "revolute", axis: [0, 1, 0], lower: -2.2, upper: 2.2, velocity: 1.5, effort: 6 },
    P([0, 0, 0.1]),
  );
  fore.drive = { mode: "servo", target: 1.0, sweep: false };
  const hand = add(
    "gripper",
    fore,
    P([0, 0, 0.2]),
    { type: "box", size: [0.05, 0.09, 0.025] },
    body,
  );
  const fl = add(
    "finger_left",
    hand,
    P([0, 0.02, 0.0125]),
    { type: "box", size: [0.02, 0.01, 0.05] },
    steel,
    { type: "prismatic", axis: [0, 1, 0], lower: 0, upper: 0.02, velocity: 0.05, effort: 20 },
    P([0, 0, 0.025]),
  );
  fl.drive = { mode: "servo", target: 0.015, sweep: false };
  const fr = add(
    "finger_right",
    hand,
    P([0, -0.02, 0.0125]),
    { type: "box", size: [0.02, 0.01, 0.05] },
    steel,
    { type: "prismatic", axis: [0, -1, 0], lower: 0, upper: 0.02, velocity: 0.05, effort: 20 },
    P([0, 0, 0.025]),
  );
  fr.joint.mimic = { joint: "finger_left_joint", multiplier: 1, offset: 0 };

  m.links = m.links.map((l) => ({ ...l, inertial: computeInertial(l, () => undefined) }));
  return m;
}

export function loadSampleRobot() {
  meshStore.clear();
  app().setModel(buildSampleRobot(), { dirty: true });
  setTimeout(() => viewportRef.get()?.setView("iso"), 50);
  app().toast(
    "Loaded the sample rover. Try Pose and Physics modes at the bottom of the viewport.",
    "success",
  );
}
