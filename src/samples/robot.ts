/** Download a URDF robot and everything it references, and turn it into a project. */
import { newModel, safeName, type MeshAsset, type RobotModel } from "@/core/model";
import { importUrdf } from "@/core/ros/importUrdf";
import { loadMesh, meshExtension } from "@/core/mesh/loaders";
import { computeInertial } from "@/core/inertial";
import { createMeshAsset } from "@/app/actions";
import { meshStore } from "@/store/meshStore";
import { fetchCached, pool } from "./fetch";
import type { Sample } from "./catalog";

export interface Progress {
  stage: string;
  done: number;
  total: number;
}

/** Resolve a mesh reference from a URDF to a download URL. */
export function resolveUri(
  uri: string,
  urdfUrl: string,
  packages: Record<string, string>,
): string | null {
  const m = /^package:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (m) {
    const base = packages[m[1]];
    return base ? `${base.replace(/\/$/, "")}/${m[2]}` : null;
  }
  if (/^https?:\/\//.test(uri)) return uri;
  if (uri.startsWith("file://") || uri.startsWith("/")) return null;
  return new URL(uri, urdfUrl).toString();
}

function meshUris(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return [
    ...new Set(
      [...doc.getElementsByTagName("mesh")]
        .map((m) => m.getAttribute("filename") ?? "")
        .filter(Boolean),
    ),
  ];
}

export async function loadUrdfSample(
  sample: Sample,
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
): Promise<{ model: RobotModel; skipped: string[] }> {
  if (sample.source.kind !== "urdf") throw new Error("Not a URDF sample");
  const { urdf, packages } = sample.source;
  onProgress({ stage: "Downloading the URDF", done: 0, total: 1 });
  const xml = new TextDecoder().decode(await fetchCached(sample.id, urdf, signal));
  if (!/<robot[\s>]/.test(xml)) throw new Error("The downloaded file is not a URDF.");

  const uris = meshUris(xml);
  const staged = newModel();
  const byUri = new Map<string, MeshAsset>();
  const skipped: string[] = [];
  onProgress({ stage: "Downloading meshes", done: 0, total: uris.length });
  await pool(
    uris,
    6,
    async (uri) => {
      const url = resolveUri(uri, urdf, packages);
      if (!url || !meshExtension(url)) {
        skipped.push(uri);
        return;
      }
      try {
        const bytes = await fetchCached(sample.id, url, signal);
        const mesh = loadMesh(url, bytes);
        if (!mesh.positions.length) throw new Error("empty mesh");
        const name = safeName(
          url
            .split("/")
            .pop()!
            .replace(/\.[^.]+$/, ""),
          "part",
        );
        byUri.set(uri, createMeshAsset(staged, name, mesh.positions, "stl", url, mesh.color));
      } catch (e) {
        if (signal?.aborted) throw e;
        skipped.push(uri);
      }
    },
    (done) => onProgress({ stage: "Downloading meshes", done, total: uris.length }),
  );

  onProgress({ stage: "Building the robot", done: 0, total: 1 });
  const { model } = importUrdf(xml, (uri) => byUri.get(uri));
  model.export.description = `${sample.name}. ${sample.attribution} (${sample.license}).`;
  model.export.license = sample.license;
  // Mesh-only links without inertial data get geometry-based estimates.
  for (const L of model.links)
    if (L.inertial.mass <= 0.001 && L.visuals.length)
      L.inertial = computeInertial(
        { ...L, inertial: { ...L.inertial, auto: true, mode: "density", density: 1000 } },
        meshStore.get,
      );
  // Colour links from their meshes when the URDF gives no material.
  for (const L of model.links)
    for (const v of L.visuals) {
      if (v.materialId || v.geometry.type !== "mesh") continue;
      const asset = model.meshes.find((a) => a.id === (v.geometry as { meshId: string }).meshId);
      if (!asset?.color) continue;
      const hit = model.materials.find((m) =>
        m.rgba.every((c, i) => Math.abs(c - asset.color![i]) < 0.01),
      );
      if (hit) v.materialId = hit.id;
      else {
        const id = `mat_${model.materials.length}_${Math.random().toString(36).slice(2, 7)}`;
        model.materials.push({
          id,
          name: `color_${model.materials.length}`,
          rgba: asset.color,
          metalness: 0.2,
          roughness: 0.55,
        });
        v.materialId = id;
      }
    }
  return { model, skipped };
}
