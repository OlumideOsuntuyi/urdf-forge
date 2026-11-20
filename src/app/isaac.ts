/** Isaac Sim / Isaac Lab export: writing the folder and converting it to USD with Isaac Lab. */
import { create } from "zustand";
import { writeStl } from "@/core/mesh/stl";
import {
  buildIsaacExport,
  isaacFolderName,
  isaacPaths,
  type IsaacFiles,
} from "@/core/isaac/export";
import type { RobotModel } from "@/core/model";
import { validate } from "@/core/validate";
import { suggestBehavior } from "@/sim/behaviors";
import { app } from "@/store/app";
import { meshStore } from "@/store/meshStore";
import { textureStore } from "@/store/textureStore";
import { useSettings } from "@/store/settings";
import {
  checkIsaacLab,
  joinPath,
  pickDirectory,
  runIsaacConvert,
  writeTree,
  type ProcessLine,
} from "@/platform";

/** Kept lines of conversion output. */
const MAX_LINES = 2000;

export interface IsaacConversion {
  status: "idle" | "running" | "done" | "failed";
  /** Export folder being converted. */
  folder: string | null;
  /** USD file, once written. */
  usd: string | null;
  lines: ProcessLine[];
  /** Why it failed, in a sentence. */
  error: string | null;
}

export const useIsaacConversion = create<IsaacConversion>(() => ({
  status: "idle",
  folder: null,
  usd: null,
  lines: [],
  error: null,
}));

/**
 * The app's guess for an "auto" base: fixed for arms, floating for wheeled and legged robots,
 * which is what the physics preview does. Undefined when no behaviour applies.
 */
export function isaacBaseHint(model: RobotModel): boolean | undefined {
  const b = suggestBehavior(model);
  return b ? b.id === "arm" : undefined;
}

export function isaacFiles(model: RobotModel, withMeshes = true): IsaacFiles {
  const meshes = new Map<string, Uint8Array>();
  if (withMeshes)
    for (const a of model.meshes) {
      const pos = meshStore.get(a.id);
      if (pos) meshes.set(a.file, writeStl(pos, a.name));
    }
  return buildIsaacExport(model, meshes, {
    stamp: withMeshes ? new Date().toISOString() : undefined,
    meshPositions: meshStore.get,
    textures: textureStore.snapshot(),
    fixedBaseHint: isaacBaseHint(model),
    isaacLabPath: useSettings.getState().isaacLabPath,
  });
}

/** Write the export into `<dir>/<robot>_isaac`, returning that folder. */
export async function writeIsaacExport(model: RobotModel, dir: string): Promise<string> {
  const files = isaacFiles(model);
  const name = isaacFolderName(model);
  await writeTree(dir, new Map([...files].map(([k, v]) => [`${name}/${k}`, v])));
  return joinPath(dir, name);
}

/**
 * Convert an exported folder to USD with the configured Isaac Lab, streaming output into
 * `useIsaacConversion`. Resolves with the final state; never throws.
 */
export async function convertIsaacFolder(
  model: RobotModel,
  folder: string,
): Promise<IsaacConversion> {
  const set = useIsaacConversion.setState;
  if (useIsaacConversion.getState().status === "running")
    return { ...useIsaacConversion.getState(), error: "A conversion is already running." };
  const lab = useSettings.getState().isaacLabPath;
  const usd = joinPath(folder, ...isaacPaths(model).usd.split("/"));
  set({ status: "running", folder, usd: null, lines: [], error: null });
  const fail = (error: string) => {
    set({ status: "failed", error });
    app().toast(error, "error");
    return useIsaacConversion.getState();
  };
  const check = await checkIsaacLab(lab).catch((e) => ({ ok: false, reason: String(e) }));
  if (!check.ok)
    return fail(`The files were written, but they were not converted: ${check.reason}`);
  let code: number;
  try {
    code = await runIsaacConvert(folder, lab, (l) =>
      set((s) => ({ lines: [...s.lines, l].slice(-MAX_LINES) })),
    );
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  if (code !== 0) {
    const last = [...useIsaacConversion.getState().lines]
      .reverse()
      .find((l) => l.stream === "stderr");
    return fail(
      `USD conversion failed (exit code ${code})${last ? `: ${last.text}` : ". See the output."}`,
    );
  }
  set({ status: "done", usd });
  app().toast(`USD written: ${usd}`, "success");
  return useIsaacConversion.getState();
}

/** Export for Isaac to a folder the user picks (or `dir`), then optionally convert to USD. */
export async function exportIsaac(
  opts: { convert?: boolean; dir?: string } = {},
): Promise<string | null> {
  const model = app().model;
  const errors = validate(model).filter((i) => i.level === "error");
  if (errors.length)
    app().toast(
      `Exporting with ${errors.length} validation error(s). See the Problems panel.`,
      "warning",
    );
  const dir = opts.dir ?? (await pickDirectory());
  if (!dir) return null;
  const folder = await writeIsaacExport(model, dir);
  app().toast(`Wrote the Isaac export to ${isaacFolderName(model)}/`, "success");
  if (opts.convert) await convertIsaacFolder(model, folder);
  return folder;
}
