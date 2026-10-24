/**
 * `.forge` project files: a zip with project.json, one binary STL per mesh asset and the
 * texture images materials use. Meshes are stored by asset id so renaming the export file name
 * never breaks a project.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { newModel, type RobotModel } from "./model";
import { parseStl, writeStl } from "./mesh/stl";

export const PROJECT_EXT = "forge";

export interface Project {
  model: RobotModel;
  meshes: Map<string, Float32Array>;
  /** Texture image bytes by key (see MaterialTextures.maps). */
  textures?: Map<string, Uint8Array>;
}

/** Texture keys the model's materials refer to. */
export function usedTextureKeys(model: RobotModel): Set<string> {
  const out = new Set<string>();
  for (const m of model.materials)
    for (const k of Object.values(m.textures?.maps ?? {})) if (k) out.add(k);
  return out;
}

export function saveProject(p: Project): Uint8Array {
  const files: Zippable = {
    "project.json": strToU8(JSON.stringify({ app: "urdf-forge", ...p.model }, null, 1)),
  };
  for (const m of p.model.meshes) {
    const pos = p.meshes.get(m.id);
    if (pos) files[`meshes/${m.id}.stl`] = [writeStl(pos, m.name), { level: 6 }];
  }
  for (const key of usedTextureKeys(p.model)) {
    const bytes = p.textures?.get(key);
    // Images are already compressed.
    if (bytes) files[`textures/${key}`] = [bytes, { level: 0 }];
  }
  return zipSync(files, { level: 6 });
}

export function loadProject(bytes: Uint8Array): Required<Project> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("This is not a URDF Forge project (.forge) file.");
  }
  const json = files["project.json"];
  if (!json) throw new Error("The project file has no project.json.");
  const raw = JSON.parse(strFromU8(json));
  if (raw.formatVersion !== 1) throw new Error(`Unsupported project version ${raw.formatVersion}.`);
  delete raw.app;
  const base = newModel(raw.robot);
  const model: RobotModel = { ...base, ...raw, export: { ...base.export, ...raw.export } };
  const meshes = new Map<string, Float32Array>();
  for (const m of model.meshes) {
    const f = files[`meshes/${m.id}.stl`];
    if (f) meshes.set(m.id, parseStl(f).positions);
  }
  const textures = new Map<string, Uint8Array>();
  for (const key of usedTextureKeys(model)) {
    const f = files[`textures/${key}`];
    if (f) textures.set(key, f);
  }
  return { model, meshes, textures };
}
