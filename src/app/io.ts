/** Opening, importing, saving and exporting. */
import { zipSync, type Zippable } from "fflate";
import {
  cadFormat,
  CAD_QUALITY,
  type CadFormat,
  type CadPart,
  type CadQuality,
} from "@/core/mesh/cad";
import { parseStl, writeStl } from "@/core/mesh/stl";
import {
  splitComponents,
  guessUnit,
  scalePositions,
  UNIT_SCALE,
  type LengthUnit,
} from "@/core/mesh/ops";
import { bounds } from "@/core/mesh/massprops";
import { loadProject, PROJECT_EXT, saveProject } from "@/core/project";
import { importUrdf } from "@/core/ros/importUrdf";
import { buildPackage } from "@/core/ros/package";
import { newModel, safeName, type RobotModel } from "@/core/model";
import { validate } from "@/core/validate";
import { app } from "@/store/app";
import { meshStore } from "@/store/meshStore";
import { textureStore } from "@/store/textureStore";
import { useSettings } from "@/store/settings";
import {
  baseName,
  expandXacro,
  readIfExists,
  pickDirectory,
  pickFiles,
  saveBytes,
  writeTree,
  type PickedFile,
} from "@/platform";
import { createMeshAsset, importPartsIn, type ImportLayout, type ImportPart } from "./actions";
import { pluginImporters } from "@/plugins/host";
import { diffDriveFor } from "./diffDrive";
import { meshPathCandidates, meshUris } from "./meshPaths";
import { loadMesh } from "@/core/mesh/loaders";

export const IMPORT_FILTERS = [
  {
    name: "All supported",
    extensions: ["step", "stp", "iges", "igs", "brep", "stl", "urdf", "xacro", PROJECT_EXT],
  },
  { name: "STEP", extensions: ["step", "stp"] },
  { name: "IGES", extensions: ["iges", "igs"] },
  { name: "STL", extensions: ["stl"] },
  { name: "URDF and xacro", extensions: ["urdf", "xacro"] },
  { name: "URDF Forge project", extensions: [PROJECT_EXT] },
];

// ------------------------------------------------------------------ CAD worker

let worker: Worker | null = null;
let reqId = 0;
const pending = new Map<number, { resolve: (p: CadPart[]) => void; reject: (e: Error) => void }>();

function cadWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../workers/cad.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<{ id: number; parts?: CadPart[]; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.error) p.reject(new Error(e.data.error));
    else p.resolve(e.data.parts!);
  };
  return worker;
}

export function readCad(
  bytes: Uint8Array,
  format: CadFormat,
  name: string,
  quality: CadQuality,
): Promise<CadPart[]> {
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    cadWorker().postMessage({ id, bytes, format, name, quality });
  });
}

// ------------------------------------------------------------------ import

/** What the import dialog shows and edits before anything is added to the model. */
export interface PendingImport {
  fileName: string;
  kind: "cad" | "stl";
  parts: ImportPart[];
  /** STL only: the unit the file is assumed to be in. CAD files are converted by OpenCascade. */
  unit: LengthUnit;
  layout: ImportLayout;
}

export async function prepareImport(file: PickedFile): Promise<PendingImport | null> {
  const fmt = cadFormat(file.name);
  if (fmt) {
    const q = CAD_QUALITY[useSettings.getState().cadQuality];
    app().toast(`Reading ${file.name} with OpenCascade…`);
    const parts = await readCad(file.bytes, fmt, file.name.replace(/\.[^.]+$/, ""), q);
    if (!parts.length) throw new Error(`${file.name} contains no solid geometry.`);
    return {
      fileName: file.name,
      kind: "cad",
      parts,
      unit: "m",
      layout: parts.length > 1 ? "links" : "links",
    };
  }
  if (/\.stl$/i.test(file.name)) {
    const { positions } = parseStl(file.bytes);
    const b = bounds(positions);
    const unit = guessUnit(Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]));
    const comps = splitComponents(positions);
    const base = safeName(file.name.replace(/\.[^.]+$/, ""), "part");
    const parts: ImportPart[] =
      comps.length > 1
        ? comps.map((p, i) => ({ name: `${base}_${i + 1}`, positions: p, color: null }))
        : [{ name: base, positions, color: null }];
    return { fileName: file.name, kind: "stl", parts, unit, layout: "links" };
  }
  return null;
}

/** Commit a reviewed import to the model as one undoable edit. */
export function commitImport(p: PendingImport, selected: boolean[]): string[] {
  const scale = p.kind === "stl" ? UNIT_SCALE[p.unit] : 1;
  const parts = p.parts
    .filter((_, i) => selected[i] !== false)
    .map((x) => ({ ...x, positions: scalePositions(x.positions, scale) }));
  if (!parts.length) return [];
  let ids: string[] = [];
  app().edit((m) => {
    if (!m.links.length && m.robot === "my_robot") {
      m.robot = safeName(p.fileName.replace(/\.[^.]+$/, ""), "robot").toLowerCase();
      m.packageName = `${m.robot}_description`;
    }
    ids = importPartsIn(m, parts, p.layout, p.fileName);
  });
  if (ids[0]) app().select({ kind: "link", linkId: ids[0] });
  app().toast(
    `Imported ${parts.length} part${parts.length === 1 ? "" : "s"} from ${p.fileName}`,
    "success",
  );
  return ids;
}

/** Route picked or dropped files to the right importer. */
export async function importFiles(files: PickedFile[]): Promise<void> {
  const urdfs = files.filter((f) => /\.(urdf|xacro)$/i.test(f.name));
  const meshes = files.filter((f) => /\.(stl|dae|obj)$/i.test(f.name));
  for (const f of files) {
    try {
      if (f.name.toLowerCase().endsWith(`.${PROJECT_EXT}`)) {
        openProjectBytes(f.bytes, f.path);
        continue;
      }
      if (/\.(urdf|xacro)$/i.test(f.name)) {
        await importUrdfFile(f, meshes);
        continue;
      }
      if (urdfs.length && /\.(stl|dae|obj)$/i.test(f.name)) continue; // consumed by the URDF import
      const plugin = pluginImporters().find((imp) =>
        imp.extensions.some((e) => f.name.toLowerCase().endsWith(`.${e}`)),
      );
      if (plugin) {
        const parts = await plugin.import(f.bytes, f.name);
        app().openDialog("import", {
          fileName: f.name,
          kind: "cad",
          parts,
          unit: "m",
          layout: "links",
        } satisfies PendingImport);
        continue;
      }
      const pend = await prepareImport(f);
      if (!pend) {
        app().toast(`${f.name}: unsupported file type`, "warning");
        continue;
      }
      app().openDialog("import", pend);
    } catch (e) {
      app().toast(`${f.name}: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }
}

async function importUrdfFile(f: PickedFile, siblings: PickedFile[]) {
  let xml = new TextDecoder().decode(f.bytes);
  const macros = /<xacro:/.test(xml) && /\$\{|\$\(/.test(xml);
  if (macros || /\.xacro$/i.test(f.name)) {
    try {
      if (!f.path) throw new Error("The file has no path on disk.");
      xml = await expandXacro(f.path);
    } catch (e) {
      if (macros)
        app().toast(
          `${e instanceof Error ? e.message : String(e)} Opening ${f.name} without expanding it: macros and arguments are ignored.`,
          "warning",
        );
    }
  }
  const byName = new Map(siblings.map((s) => [s.name.toLowerCase(), s]));
  // Meshes the URDF points to on disk: file:// URIs (xacro output), package:// inside a source
  // checkout, and paths relative to the URDF. Files picked alongside the URDF come first.
  const byUri = new Map<string, PickedFile>();
  if (f.path)
    for (const uri of meshUris(xml)) {
      if (byName.has(baseName(uri).toLowerCase())) continue;
      for (const p of meshPathCandidates(uri, f.path)) {
        const file = await readIfExists(p);
        if (file) {
          byUri.set(uri, file);
          break;
        }
      }
    }
  const staged = newModel();
  const created = new Map<string, string>();
  const { model, missing } = importUrdf(xml, (uri) => {
    const file = byName.get(baseName(uri).toLowerCase()) ?? byUri.get(uri);
    if (!file) return undefined;
    const key = file.path || file.name;
    if (!created.has(key)) {
      let pos: Float32Array;
      try {
        pos = loadMesh(file.name, file.bytes).positions;
      } catch {
        return undefined;
      }
      created.set(
        key,
        createMeshAsset(staged, file.name.replace(/\.[^.]+$/, ""), pos, "stl", file.name).id,
      );
    }
    return staged.meshes.find((m) => m.id === created.get(key));
  });
  app().setModel(model, { dirty: true });
  app().toast(
    missing.length
      ? `Imported ${model.links.length} links. ${missing.length} mesh file(s) were not found and are shown as boxes. Select the meshes together with the URDF to include them.`
      : `Imported ${model.links.length} links from ${f.name}`,
    missing.length ? "warning" : "success",
  );
}

export async function importDialog() {
  const extra = pluginImporters().flatMap((p) => p.extensions);
  const filters = extra.length
    ? [
        { ...IMPORT_FILTERS[0], extensions: [...IMPORT_FILTERS[0].extensions, ...extra] },
        ...IMPORT_FILTERS.slice(1),
        ...pluginImporters().map((p) => ({ name: p.label, extensions: p.extensions })),
      ]
    : IMPORT_FILTERS;
  const files = await pickFiles(filters);
  if (files.length) await importFiles(files);
}

// ------------------------------------------------------------------ projects

export function newProject() {
  meshStore.clear();
  app().setModel(newModel());
}

export function openProjectBytes(bytes: Uint8Array, path: string | null) {
  const { model, meshes, textures } = loadProject(bytes);
  meshStore.clear();
  meshStore.setMany(meshes);
  textureStore.clear();
  textureStore.setMany(textures);
  app().setModel(model, { path });
  if (path) useSettings.getState().pushRecentProject(path);
  app().toast(`Opened ${model.robot}`, "success");
}

export async function openProjectDialog() {
  const [f] = await pickFiles([{ name: "URDF Forge project", extensions: [PROJECT_EXT] }], false);
  if (f) openProjectBytes(f.bytes, f.path);
}

export async function saveProjectFile(saveAs = false) {
  const s = app();
  const bytes = saveProject({
    model: s.model,
    meshes: meshStore.snapshot(),
    textures: textureStore.snapshot(),
  });
  const path = await saveBytes(
    `${s.model.robot}.${PROJECT_EXT}`,
    bytes,
    [{ name: "URDF Forge project", extensions: [PROJECT_EXT] }],
    saveAs ? null : s.projectPath,
  );
  if (!path) return;
  app().set("projectPath", path);
  app().set("dirty", false);
  useSettings.getState().pushRecentProject(path);
  s.toast(`Saved ${baseName(path)}`, "success");
}

// ------------------------------------------------------------------ export

export function packageFiles(model: RobotModel) {
  const meshes = new Map<string, Uint8Array>();
  for (const a of model.meshes) {
    const pos = meshStore.get(a.id);
    if (pos) meshes.set(a.file, writeStl(pos, a.name));
  }
  const projectJson = JSON.stringify(model);
  return buildPackage(model, meshes, {
    stamp: new Date().toISOString(),
    projectJson,
    environment: app().environment,
    textures: textureStore.snapshot(),
    meshPositions: meshStore.get,
    diffDrive: diffDriveFor(model),
  });
}

export async function exportPackage(as: "folder" | "zip") {
  const model = app().model;
  const errors = validate(model).filter((i) => i.level === "error");
  if (errors.length)
    app().toast(
      `Exporting with ${errors.length} validation error(s). See the Problems panel.`,
      "warning",
    );
  const files = packageFiles(model);
  if (as === "folder") {
    const dir = await pickDirectory();
    if (!dir) return;
    const prefixed = new Map([...files].map(([k, v]) => [`${model.packageName}/${k}`, v]));
    await writeTree(dir, prefixed);
    app().toast(`Wrote ${files.size} files to ${model.packageName}/`, "success");
  } else {
    const z: Zippable = {};
    for (const [k, v] of files)
      z[`${model.packageName}/${k}`] = typeof v === "string" ? new TextEncoder().encode(v) : v;
    const path = await saveBytes(`${model.packageName}.zip`, zipSync(z, { level: 6 }), [
      { name: "Zip archive", extensions: ["zip"] },
    ]);
    if (path) app().toast(`Saved ${baseName(path)}`, "success");
  }
}

export async function exportSingle(kind: "urdf" | "sdf") {
  const model = app().model;
  const files = packageFiles(model);
  const key =
    kind === "urdf"
      ? `urdf/${safeName(model.robot, "robot")}.urdf`
      : `sdf/${safeName(model.robot, "robot")}/model.sdf`;
  const path = await saveBytes(baseName(key), files.get(key) as string, [
    { name: kind.toUpperCase(), extensions: [kind] },
  ]);
  if (path) app().toast(`Saved ${baseName(path)}`, "success");
}
