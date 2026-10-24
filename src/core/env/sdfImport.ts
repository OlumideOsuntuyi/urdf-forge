/**
 * Turn an SDF world or model into a static Environment. Supports nested models, <include>,
 * link and visual poses, box / cylinder / sphere / plane / mesh geometry and material colours.
 * `relative_to` frames other than the defaults are not resolved.
 */
import { Matrix4 } from "three";
import { matrixToPose, poseToMatrix } from "../math";
import type { Rgba, Vec3 } from "../model";
import type { LoadedMesh } from "../mesh/loaders";
import type { EnvObject, Environment } from "./types";

export interface SdfContext {
  /** Load a mesh referenced from an SDF file whose location is `base`. */
  mesh(uri: string, base: string): Promise<LoadedMesh | null>;
  /** Resolve an <include> URI to the model's SDF text and its base location. */
  include(uri: string, base: string): Promise<{ sdf: string; base: string } | null>;
}

const kids = (el: Element, tag: string) => [...el.children].filter((c) => c.tagName === tag);
const kid = (el: Element, tag: string) => kids(el, tag)[0] ?? null;
const nums = (s: string | null | undefined, n: number, d = 0) => {
  const v = (s ?? "").trim().split(/\s+/).map(Number);
  return Array.from({ length: n }, (_, i) => (Number.isFinite(v[i]) ? v[i] : d));
};

function poseOf(el: Element | null): Matrix4 {
  const p = el ? kid(el, "pose") : null;
  if (!p?.textContent?.trim()) return new Matrix4();
  const v = nums(p.textContent, 6);
  return poseToMatrix({ xyz: [v[0], v[1], v[2]], rpy: [v[3], v[4], v[5]] });
}

function colourOf(visual: Element): Rgba {
  const mat = kid(visual, "material");
  const c = (mat && (kid(mat, "diffuse") ?? kid(mat, "ambient")))?.textContent;
  if (c?.trim()) {
    const v = nums(c, 4, 1);
    return [v[0], v[1], v[2], v[3]];
  }
  return [0.7, 0.7, 0.72, 1];
}

export async function sdfToEnvironment(
  sdf: string,
  base: string,
  ctx: SdfContext,
  meta: { id: string; name: string; description: string; attribution?: string },
): Promise<{ env: Environment; skipped: string[] }> {
  const env: Environment = {
    ...meta,
    ground: true,
    spawn: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
    objects: [],
    meshes: {},
  };
  const skipped: string[] = [];
  const meshKeys = new Map<string, string>();
  let depth = 0;

  const addGeometry = async (
    name: string,
    geom: Element,
    world: Matrix4,
    color: Rgba,
    collide: boolean,
    fileBase: string,
  ) => {
    const push = (o: Omit<EnvObject, "pose">, m: Matrix4) =>
      env.objects.push({ ...o, pose: matrixToPose(m), noCollide: !collide || undefined });
    const box = kid(geom, "box");
    if (box)
      return push(
        {
          name,
          geometry: { type: "box", size: nums(kid(box, "size")?.textContent, 3, 1) as Vec3 },
          color,
        },
        world,
      );
    const cyl = kid(geom, "cylinder");
    if (cyl)
      return push(
        {
          name,
          geometry: {
            type: "cylinder",
            radius: +(kid(cyl, "radius")?.textContent ?? 0.5),
            length: +(kid(cyl, "length")?.textContent ?? 1),
          },
          color,
        },
        world,
      );
    const sph = kid(geom, "sphere");
    if (sph)
      return push(
        {
          name,
          geometry: { type: "sphere", radius: +(kid(sph, "radius")?.textContent ?? 0.5) },
          color,
        },
        world,
      );
    const plane = kid(geom, "plane");
    if (plane) {
      // The infinite ground is already there; a finite plane becomes a thin slab.
      const size = nums(kid(plane, "size")?.textContent, 2, 100);
      if (size[0] >= 50 && size[1] >= 50) return;
      return push(
        { name, geometry: { type: "box", size: [size[0], size[1], 0.002] }, color },
        world.clone().multiply(new Matrix4().makeTranslation(0, 0, -0.001)),
      );
    }
    const mesh = kid(geom, "mesh");
    if (mesh) {
      const uri = kid(mesh, "uri")?.textContent?.trim() ?? "";
      const scale = nums(kid(mesh, "scale")?.textContent, 3, 1) as Vec3;
      const key = `${fileBase}|${uri}`;
      let meshKey = meshKeys.get(key);
      if (!meshKey) {
        const loaded = await ctx.mesh(uri, fileBase).catch(() => null);
        if (!loaded || !loaded.positions.length) {
          skipped.push(uri);
          return;
        }
        meshKey = `mesh_${meshKeys.size}`;
        meshKeys.set(key, meshKey);
        env.meshes[meshKey] = loaded.positions;
        if (loaded.color && color.every((c, i) => i === 3 || Math.abs(c - 0.7) < 0.03))
          color = loaded.color;
      }
      return push({ name, geometry: { type: "mesh", mesh: meshKey, scale }, color }, world);
    }
  };

  const walkModel = async (model: Element, parent: Matrix4, fileBase: string) => {
    const mWorld = parent.clone().multiply(poseOf(model));
    const name = model.getAttribute("name") ?? "model";
    for (const link of kids(model, "link")) {
      const lWorld = mWorld.clone().multiply(poseOf(link));
      const visuals = kids(link, "visual");
      const collisions = kids(link, "collision");
      for (const v of visuals) {
        const g = kid(v, "geometry");
        if (g)
          await addGeometry(
            `${name}_${v.getAttribute("name") ?? "visual"}`,
            g,
            lWorld.clone().multiply(poseOf(v)),
            colourOf(v),
            collisions.length === 0,
            fileBase,
          );
      }
      // Collision-only shapes (and collisions that differ from visuals) are invisible colliders.
      for (const c of collisions) {
        const g = kid(c, "geometry");
        if (!g) continue;
        const before = env.objects.length;
        await addGeometry(
          `${name}_${c.getAttribute("name") ?? "collision"}`,
          g,
          lWorld.clone().multiply(poseOf(c)),
          [0.5, 0.5, 0.5, 0],
          true,
          fileBase,
        );
        if (visuals.length && env.objects.length > before)
          env.objects[env.objects.length - 1].color = [0.5, 0.5, 0.5, 0];
      }
    }
    for (const nested of kids(model, "model")) await walkModel(nested, mWorld, fileBase);
    for (const inc of kids(model, "include")) await walkInclude(inc, mWorld, fileBase);
  };

  const walkInclude = async (inc: Element, parent: Matrix4, fileBase: string) => {
    const uri = kid(inc, "uri")?.textContent?.trim();
    if (!uri || depth > 8) return;
    const found = await ctx.include(uri, fileBase).catch(() => null);
    if (!found) {
      skipped.push(uri);
      return;
    }
    depth++;
    const doc = new DOMParser().parseFromString(found.sdf, "application/xml");
    const model = doc.getElementsByTagName("model")[0];
    if (model) {
      // The include's own pose replaces the model's pose.
      const at = kid(inc, "pose")
        ? parent.clone().multiply(poseOf(inc))
        : parent.clone().multiply(poseOf(model));
      const copy = model.cloneNode(true) as Element;
      kid(copy, "pose")?.remove();
      await walkModel(copy, at, found.base);
    }
    depth--;
  };

  const doc = new DOMParser().parseFromString(sdf, "application/xml");
  if (doc.getElementsByTagName("parsererror").length)
    throw new Error("The SDF file is not valid XML.");
  const world = doc.getElementsByTagName("world")[0];
  const roots = world ?? doc.documentElement;
  for (const m of kids(roots, "model")) await walkModel(m, new Matrix4(), base);
  for (const inc of kids(roots, "include")) await walkInclude(inc, new Matrix4(), base);
  return { env, skipped };
}
