/** Insert parametric components (src/core/parts) into the robot. */
import {
  clone,
  jointName,
  linkById,
  newLink,
  rootLinks,
  uid,
  uniqueName,
  type Collision,
  type Link,
  type RobotModel,
} from "@/core/model";
import { computeInertial } from "@/core/inertial";
import type { PartLink, PartShape, PartTemplate, Params } from "@/core/parts/types";
import { meshStore } from "@/store/meshStore";
import { addCollisionIn, createMeshAsset, materialFor } from "./actions";

/** Order part links so parents come before children. */
function ordered(links: PartLink[]): PartLink[] {
  const out: PartLink[] = [];
  const keys = new Set(links.map((l) => l.key));
  const placed = new Set<string>();
  let guard = 0;
  while (out.length < links.length && guard++ < links.length + 2)
    for (const l of links)
      if (!placed.has(l.key) && (!l.parent || !keys.has(l.parent) || placed.has(l.parent))) {
        out.push(l);
        placed.add(l.key);
      }
  return out;
}

function shapeTo(m: RobotModel, s: PartShape, partName: string, link: Link) {
  const g = s.geometry;
  if (g.type === "mesh") {
    const asset = createMeshAsset(
      m,
      s.name ?? `${partName}_${link.name}`,
      g.positions,
      "generated",
      partName,
      s.color,
    );
    return {
      geometry: {
        type: "mesh" as const,
        meshId: asset.id,
        scale: [1, 1, 1] as [number, number, number],
      },
      materialId: materialFor(m, s.color),
    };
  }
  return { geometry: clone(g), materialId: materialFor(m, s.color) };
}

/**
 * Add a component. Its root attaches to `attachTo` (a link id) or becomes the robot root when the
 * robot is empty. Returns the id of the component's root link.
 */
export function insertPartIn(
  m: RobotModel,
  t: PartTemplate,
  params: Params,
  attachTo: string | null,
): string {
  const built = ordered(t.build(params));
  const byKey = new Map<string, Link>();
  const parentFallback =
    attachTo && linkById(m, attachTo) ? attachTo : (rootLinks(m)[0]?.id ?? null);
  let rootId = "";
  for (const p of built) {
    const L = newLink(
      uniqueName(
        p.name,
        m.links.map((l) => l.name),
      ),
    );
    L.parentId = p.parent ? (byKey.get(p.parent)?.id ?? parentFallback) : parentFallback;
    L.origin = clone(p.origin);
    if (p.joint && L.parentId) {
      const j = p.joint;
      Object.assign(L.joint, {
        type: j.type,
        ...(j.axis && { axis: [...j.axis] }),
        ...(j.lower !== undefined && { lower: j.lower }),
        ...(j.upper !== undefined && { upper: j.upper }),
        ...(j.effort !== undefined && { effort: j.effort }),
        ...(j.velocity !== undefined && { velocity: j.velocity }),
        ...(j.damping !== undefined && { damping: j.damping }),
        ...(j.friction !== undefined && { friction: j.friction }),
      });
    }
    if (p.drive) L.drive = { ...p.drive };
    m.links.push(L);
    byKey.set(p.key, L);
    if (!rootId) rootId = L.id;

    for (const s of p.visuals) {
      const { geometry, materialId } = shapeTo(m, s, t.name, L);
      L.visuals.push({ id: uid("vis"), name: "", origin: clone(s.origin), geometry, materialId });
    }
    const col = p.collisions ?? "box";
    if (Array.isArray(col)) {
      for (const s of col) {
        const { geometry } = shapeTo(m, s, `${t.name}_collision`, L);
        L.collisions.push({
          id: uid("col"),
          name: "",
          origin: clone(s.origin),
          geometry,
        } as Collision);
      }
    } else if (col === "same") {
      for (const v of L.visuals)
        L.collisions.push({
          id: uid("col"),
          name: "",
          origin: clone(v.origin),
          geometry: clone(v.geometry),
        });
    } else if (L.visuals.length) {
      // Primitive-only links collide as themselves; meshes get the requested fit.
      const allPrimitive = L.visuals.every((v) => v.geometry.type !== "mesh");
      if (allPrimitive && L.visuals.length <= 3)
        for (const v of L.visuals)
          L.collisions.push({
            id: uid("col"),
            name: "",
            origin: clone(v.origin),
            geometry: clone(v.geometry),
          });
      else addCollisionIn(m, L.id, col);
    }
    for (const s of p.sensors ?? [])
      L.sensors.push({
        id: uid("sen"),
        type: s.type,
        name: uniqueName(
          s.name,
          m.links.flatMap((l) => l.sensors.map((x) => x.name)),
          "sensor",
        ),
        rate: s.rate,
        topic: s.topic ?? "",
      });
    L.inertial = {
      ...L.inertial,
      auto: true,
      mode: p.mass !== undefined ? "mass" : "density",
      mass: p.mass ?? L.inertial.mass,
      density: p.density ?? 1200,
    };
    L.inertial = computeInertial(L, meshStore.get);
  }
  // Mimic joints refer to other links of the same part by key.
  for (const p of built) {
    const mim = p.joint?.mimic;
    const L = byKey.get(p.key);
    const leader = mim && byKey.get(mim.link);
    if (L && leader && mim)
      L.joint.mimic = { joint: jointName(leader), multiplier: mim.multiplier, offset: mim.offset };
  }
  return rootId;
}
