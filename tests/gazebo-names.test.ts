// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { newLink, newModel, uid, type Link, type RobotModel } from "../src/core/model";
import { gazeboCollisionNames, generateUrdf } from "../src/core/ros/urdf";

/**
 * Links on fixed joints, added in an order that differs from joint-name order, with a nested
 * chain, a collision name that does not start with its link's name ("hull") and a merged link
 * whose name starts with its target's ("base_ext").
 */
function robot(): { model: RobotModel; byName: Map<string, Link> } {
  const model = newModel("synthetic");
  const byName = new Map<string, Link>();
  const add = (
    name: string,
    parent: string | null,
    joint: string,
    type: "fixed" | "revolute",
    n: number,
    cname = "",
  ) => {
    const L = newLink(name);
    L.parentId = parent ? byName.get(parent)!.id : null;
    L.joint.name = joint;
    L.joint.type = type;
    L.joint.axis = [0, 0, 1];
    L.inertial.mass = 0.5;
    for (let i = 0; i < n; i++)
      L.collisions.push({
        id: uid("col"),
        name: cname,
        origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
        geometry: { type: "box", size: [0.05, 0.05, 0.05] },
      });
    model.links.push(L);
    byName.set(name, L);
  };
  add("base", null, "", "fixed", 1, "hull");
  add("alpha", "base", "z_joint", "fixed", 2);
  add("omega", "base", "a_joint", "fixed", 1);
  add("deep", "omega", "m_joint", "fixed", 1);
  add("base_ext", "alpha", "b_joint", "fixed", 1);
  add("arm", "base", "arm_joint", "revolute", 1);
  add("tool", "arm", "tool_joint", "fixed", 2);
  return { model, byName };
}

describe("Gazebo collision names after fixed-joint merging", () => {
  it("matches what gz sdf -p (SDFormat 14.9) produces", () => {
    const { model, byName } = robot();
    const names = gazeboCollisionNames(model);
    const of = (link: string) => byName.get(link)!.collisions.map((c) => names.get(c.id));
    // Copied from `gz sdf -p` on this robot's URDF.
    expect(of("base")).toEqual(["base_fixed_joint_lump__hull_collision"]);
    expect(of("omega")).toEqual(["base_fixed_joint_lump__omega_collision_collision_1"]);
    expect(of("deep")).toEqual(["base_fixed_joint_lump__deep_collision_collision_2"]);
    expect(of("alpha")).toEqual([
      "base_fixed_joint_lump__alpha_collision_collision_3",
      "base_fixed_joint_lump__alpha_collision_2_collision_4",
    ]);
    expect(of("base_ext")).toEqual(["base_ext_collision_collision_5"]);
    expect(of("arm")).toEqual(["arm_collision_collision"]);
    expect(of("tool")).toEqual([
      "arm_fixed_joint_lump__tool_collision_collision_1",
      "arm_fixed_joint_lump__tool_collision_2_collision_2",
    ]);
  });

  it("points contact sensors at every collision of their link, by its Gazebo name", () => {
    const { model, byName } = robot();
    const alpha = byName.get("alpha")!;
    alpha.sensors.push({ id: uid("sen"), type: "contact", name: "bumper", rate: 50, topic: "" });
    const doc = new DOMParser().parseFromString(
      generateUrdf(model, "jazzy-harmonic"),
      "application/xml",
    );
    const sensor = [...doc.getElementsByTagName("sensor")].find(
      (s) => s.getAttribute("name") === "bumper",
    )!;
    const contact = sensor.getElementsByTagName("contact")[0];
    expect([...contact.getElementsByTagName("collision")].map((c) => c.textContent)).toEqual([
      "base_fixed_joint_lump__alpha_collision_collision_3",
      "base_fixed_joint_lump__alpha_collision_2_collision_4",
    ]);
  });
});
