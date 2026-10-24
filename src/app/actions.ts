/**
 * Model operations shared by commands, the viewport, plugins and MCP tools.
 * Functions named `*In` mutate a draft model and are meant to run inside `app().edit(...)`.
 */
import { Matrix4, Quaternion, Vector3 } from "three";
import {
  childrenOf,
  clone,
  isDescendantOrSelf,
  linkById,
  meshById,
  newLink,
  newMaterial,
  rootLinks,
  safeName,
  uid,
  uniqueName,
  type Collision,
  type Link,
  type MeshAsset,
  type Rgba,
  type RobotModel,
  type Vec3,
} from "@/core/model";
import { matrixToPose, poseToMatrix, rotateInertia } from "@/core/math";
import { linkWorldMatrices } from "@/core/kinematics";
import { computeInertial } from "@/core/inertial";
import { bounds, massProperties } from "@/core/mesh/massprops";
import { convexHull } from "@/core/mesh/hull";
import { decimate, fitPrimitive, transformPositions } from "@/core/mesh/ops";
import { app } from "@/store/app";
import { meshStore } from "@/store/meshStore";

// ------------------------------------------------------------------ frames

export function linkWorld(m: RobotModel, id: string): Matrix4 {
  return linkWorldMatrices(m).get(id)?.clone() ?? new Matrix4();
}

export function parentWorld(m: RobotModel, L: Link): Matrix4 {
  return L.parentId && linkById(m, L.parentId) ? linkWorld(m, L.parentId) : new Matrix4();
}

/** Place a link (and with it its subtree) at a model-frame pose. */
export function setLinkWorldIn(m: RobotModel, linkId: string, world: Matrix4): void {
  const L = linkById(m, linkId);
  if (!L) return;
  L.origin = matrixToPose(parentWorld(m, L).invert().multiply(world));
}

/**
 * Move a link's frame (the joint origin) without moving its geometry or its children:
 * everything attached is re-expressed in the new frame.
 */
export function movePivotIn(m: RobotModel, linkId: string, newWorld: Matrix4): void {
  const L = linkById(m, linkId);
  if (!L) return;
  const delta = newWorld.clone().invert().multiply(linkWorld(m, linkId));
  const q = new Quaternion();
  delta.decompose(new Vector3(), q, new Vector3());
  for (const c of [...L.visuals, ...L.collisions])
    c.origin = matrixToPose(delta.clone().multiply(poseToMatrix(c.origin)));
  for (const k of childrenOf(m, linkId))
    k.origin = matrixToPose(delta.clone().multiply(poseToMatrix(k.origin)));
  const com = new Vector3(...L.inertial.com).applyMatrix4(delta);
  L.inertial.com = [com.x, com.y, com.z];
  L.inertial.inertia = rotateInertia(L.inertial.inertia, q);
  // Rotate the joint axis with the frame so the physical axis is unchanged.
  const ax = new Vector3(...L.joint.axis).applyQuaternion(q);
  L.joint.axis = [ax.x, ax.y, ax.z].map((v) => (Math.abs(v) < 1e-12 ? 0 : v)) as Vec3;
  setLinkWorldIn(m, linkId, newWorld);
}

/** Change a link's parent while keeping it where it is in the world. */
export function reparentIn(m: RobotModel, linkId: string, parentId: string | null): boolean {
  const L = linkById(m, linkId);
  if (!L) return false;
  if (parentId && isDescendantOrSelf(m, parentId, linkId)) return false;
  const w = linkWorld(m, linkId);
  L.parentId = parentId;
  setLinkWorldIn(m, linkId, w);
  return true;
}

// ------------------------------------------------------------------ meshes

export function createMeshAsset(
  m: RobotModel,
  name: string,
  positions: Float32Array,
  source: MeshAsset["source"],
  originFile: string,
  color: Rgba | null = null,
): MeshAsset {
  const b = bounds(positions);
  const mp = massProperties(positions);
  const asset: MeshAsset = {
    id: uid("msh"),
    name: safeName(name, "part"),
    file: `${uniqueName(
      name,
      m.meshes.map((x) => x.file.replace(/\.stl$/, "")),
      "part",
    )}.stl`,
    source,
    origin: originFile,
    triangles: Math.floor(positions.length / 9),
    bbox: b,
    volume: mp?.volume ?? 0,
    com: mp?.com ?? [0, 0, 0],
    watertight: mp?.watertight ?? false,
    color,
  };
  m.meshes.push(asset);
  meshStore.set(asset.id, positions);
  return asset;
}

export function materialFor(m: RobotModel, color: Rgba | null): string {
  if (!color)
    return (
      m.materials[0]?.id ??
      (m.materials.push(newMaterial("default", [0.56, 0.65, 0.73, 1])), m.materials[0].id)
    );
  const hit = m.materials.find((x) => x.rgba.every((v, i) => Math.abs(v - color[i]) < 1e-3));
  if (hit) return hit.id;
  const mat = newMaterial(
    uniqueName(
      `color_${m.materials.length}`,
      m.materials.map((x) => x.name),
      "material",
    ),
    color,
  );
  m.materials.push(mat);
  return mat.id;
}

/**
 * Create a link holding a mesh. The link frame is placed at the centre of the mesh's bounding
 * box (in model coordinates) with axes aligned to the model, and the mesh is offset inside it.
 */
export function linkFromMeshIn(
  m: RobotModel,
  asset: MeshAsset,
  opts: { parentId?: string | null; name?: string } = {},
): Link {
  const L = newLink(
    uniqueName(
      opts.name ?? asset.name,
      m.links.map((l) => l.name),
    ),
  );
  const centre: Vec3 = [0, 1, 2].map((i) => (asset.bbox.min[i] + asset.bbox.max[i]) / 2) as Vec3;
  L.visuals.push({
    id: uid("vis"),
    name: "",
    origin: { xyz: [-centre[0], -centre[1], -centre[2]], rpy: [0, 0, 0] },
    geometry: { type: "mesh", meshId: asset.id, scale: [1, 1, 1] },
    materialId: materialFor(m, asset.color),
  });
  const parentId = opts.parentId === undefined ? (rootLinks(m)[0]?.id ?? null) : opts.parentId;
  m.links.push(L);
  L.parentId = parentId && linkById(m, parentId) ? parentId : null;
  setLinkWorldIn(m, L.id, new Matrix4().makeTranslation(...centre));
  addCollisionIn(m, L.id, "box");
  recomputeInertialIn(m, L.id);
  return L;
}

/** Visual geometry of a link expressed in the link frame, as one triangle soup. */
export function linkVisualSoup(L: Link): Float32Array {
  const chunks: Float32Array[] = [];
  for (const v of L.visuals) {
    if (v.geometry.type !== "mesh") continue;
    const pos = meshStore.get(v.geometry.meshId);
    if (pos) chunks.push(transformPositions(pos, poseToMatrix(v.origin, v.geometry.scale)));
  }
  const out = new Float32Array(chunks.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export type CollisionKind = "box" | "cylinder" | "sphere" | "hull" | "mesh" | "simplified";

export function addCollisionIn(
  m: RobotModel,
  linkId: string,
  kind: CollisionKind,
  replace = false,
): Collision | null {
  const L = linkById(m, linkId);
  if (!L) return null;
  let col: Collision;
  const v0 = L.visuals[0];
  if (kind === "mesh") {
    if (!v0) return null;
    col = { id: uid("col"), name: "", origin: clone(v0.origin), geometry: clone(v0.geometry) };
  } else {
    const soup = linkVisualSoup(L);
    if (!soup.length) {
      // Primitive visuals: copy them.
      if (!v0) return null;
      col = { id: uid("col"), name: "", origin: clone(v0.origin), geometry: clone(v0.geometry) };
    } else if (kind === "hull" || kind === "simplified") {
      const pos = kind === "hull" ? convexHull(soup) : decimate(soup, 0.15);
      const asset = createMeshAsset(
        m,
        `${L.name}_${kind === "hull" ? "hull" : "collision"}`,
        pos,
        "generated",
        L.name,
      );
      col = {
        id: uid("col"),
        name: "",
        origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
        geometry: { type: "mesh", meshId: asset.id, scale: [1, 1, 1] },
      };
    } else {
      const fit = fitPrimitive(soup, kind);
      col = {
        id: uid("col"),
        name: "",
        origin: { xyz: fit.centre, rpy: [0, 0, 0] },
        geometry: fit.geometry,
      };
    }
  }
  if (replace) L.collisions = [];
  L.collisions.push(col);
  return col;
}

export function recomputeInertialIn(m: RobotModel, linkId: string): void {
  const L = linkById(m, linkId);
  if (L) L.inertial = computeInertial(L, meshStore.get);
}

export function deleteLinkIn(m: RobotModel, linkId: string, keepChildren: boolean): void {
  const L = linkById(m, linkId);
  if (!L) return;
  for (const k of childrenOf(m, linkId)) {
    if (keepChildren) reparentIn(m, k.id, L.parentId);
    else deleteLinkIn(m, k.id, false);
  }
  m.links = m.links.filter((l) => l.id !== linkId);
}

export function duplicateLinkIn(m: RobotModel, linkId: string): Link | null {
  const L = linkById(m, linkId);
  if (!L) return null;
  const c = clone(L);
  c.id = uid("lnk");
  c.name = uniqueName(
    `${L.name}_copy`,
    m.links.map((l) => l.name),
  );
  c.joint.name = "";
  c.visuals.forEach((v) => (v.id = uid("vis")));
  c.collisions.forEach((v) => (v.id = uid("col")));
  c.sensors.forEach((v) => (v.id = uid("sen")));
  m.links.push(c);
  return c;
}

/** Remove mesh assets no component references. */
export function purgeUnusedMeshesIn(m: RobotModel): number {
  const used = new Set(
    m.links
      .flatMap((l) => [...l.visuals, ...l.collisions])
      .flatMap((c) => (c.geometry.type === "mesh" ? [c.geometry.meshId] : [])),
  );
  const before = m.meshes.length;
  m.meshes = m.meshes.filter((x) => used.has(x.id));
  return before - m.meshes.length;
}

// ------------------------------------------------------------------ imports

export interface ImportPart {
  name: string;
  positions: Float32Array;
  color: Rgba | null;
  path?: string[];
}

export type ImportLayout = "links" | "single-link" | "library";

/** Add imported parts to the library and, depending on layout, to the robot. */
export function importPartsIn(
  m: RobotModel,
  parts: ImportPart[],
  layout: ImportLayout,
  originFile: string,
): string[] {
  const assets = parts.map((p) =>
    createMeshAsset(
      m,
      p.name,
      p.positions,
      originFile.match(/\.(step|stp|iges|igs|brep)$/i) ? "step" : "stl",
      originFile,
      p.color,
    ),
  );
  if (layout === "library") return [];
  if (layout === "single-link") {
    const first = linkFromMeshIn(m, assets[0], {
      name: safeName(originFile.replace(/\.[^.]+$/, ""), "part"),
    });
    const lw = linkWorld(m, first.id).invert();
    for (const a of assets.slice(1)) {
      first.visuals.push({
        id: uid("vis"),
        name: "",
        origin: matrixToPose(lw.clone()),
        geometry: { type: "mesh", meshId: a.id, scale: [1, 1, 1] },
        materialId: materialFor(m, a.color),
      });
    }
    first.collisions = [];
    addCollisionIn(m, first.id, "box");
    recomputeInertialIn(m, first.id);
    return [first.id];
  }
  // One link per part. The largest part becomes the root when the robot is empty.
  const order = assets
    .map((a, i) => ({ a, i }))
    .sort((x, y) => y.a.volume - x.a.volume || x.i - y.i);
  const ids: string[] = [];
  let parent = rootLinks(m)[0]?.id ?? null;
  for (const { a } of order) {
    const L = linkFromMeshIn(m, a, { parentId: parent });
    if (!parent) parent = L.id;
    ids.push(L.id);
  }
  return ids;
}

export function selectedLink(): Link | undefined {
  const s = app().selection;
  return s && "linkId" in s ? linkById(app().model, s.linkId) : undefined;
}

export function meshAsset(id: string): MeshAsset | undefined {
  return meshById(app().model, id);
}
