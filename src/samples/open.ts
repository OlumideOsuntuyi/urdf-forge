/** Open gallery samples into the editor. */
import { app } from "@/store/app";
import { meshStore } from "@/store/meshStore";
import { viewportRef } from "@/viewport/ref";
import { SAMPLES, type Sample } from "./catalog";
import { loadUrdfSample, type Progress } from "./robot";
import { loadEnvironmentSample } from "./environment";
import { PROCEDURAL_ENVS } from "@/core/env/procedural";
import { environmentThumbnail, robotThumbnail } from "@/viewport/thumbnail";
import { hasThumbnail, saveThumbnail } from "./thumbnails";

/** Download a robot only to render its gallery thumbnail; the open project is untouched. */
export async function generateRobotThumbnail(sample: Sample, signal?: AbortSignal): Promise<void> {
  const { model } = await loadUrdfSample(sample, () => {}, signal);
  await saveThumbnail(sample.id, robotThumbnail(model, meshStore.get));
  // Drop the geometry again unless the open project uses it.
  const used = new Set(app().model.meshes.map((m) => m.id));
  for (const m of model.meshes) if (!used.has(m.id)) meshStore.delete(m.id);
}

/** Built-in environments are generated in the app, so their thumbnails are instant. */
export function ensureBuiltinThumbnails(): void {
  for (const p of PROCEDURAL_ENVS) {
    const id = `env.${p.id}`;
    if (!hasThumbnail(id)) void saveThumbnail(id, environmentThumbnail(p.build()));
  }
}

export async function openSample(
  sample: Sample,
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
): Promise<string[]> {
  if (sample.kind === "robot") {
    const { model } = await loadUrdfSample(sample, onProgress, signal).then((r) => {
      if (r.skipped.length)
        app().toast(
          `${r.skipped.length} mesh file(s) could not be loaded and were replaced by boxes.`,
          "warning",
        );
      return r;
    });
    // Keep only the meshes the new model uses.
    const keep = new Set(model.meshes.map((m) => m.id));
    for (const [id] of [...meshStore.entries()]) if (!keep.has(id)) meshStore.delete(id);
    app().setModel(model, { dirty: true });
    setTimeout(() => viewportRef.get()?.setView("iso"), 60);
    if (!hasThumbnail(sample.id))
      void saveThumbnail(sample.id, robotThumbnail(model, meshStore.get));
    app().toast(`Opened ${sample.name} (${sample.license}). ${sample.attribution}.`, "success");
    return [];
  }
  const { env, skipped } = await loadEnvironmentSample(sample, onProgress, signal);
  app().set("environment", env);
  if (!hasThumbnail(sample.id)) void saveThumbnail(sample.id, environmentThumbnail(env));
  if (skipped.length)
    app().toast(`${skipped.length} part(s) of the scene could not be loaded.`, "warning");
  else app().toast(`Environment: ${sample.name}`, "success");
  setTimeout(() => {
    const vp = viewportRef.get();
    if (vp && env.objects.length) vp.frameEnvironment();
  }, 60);
  return skipped;
}

/** Switch to a built-in environment immediately (no download). */
export function applyBuiltinEnvironment(id: string) {
  const p = PROCEDURAL_ENVS.find((e) => e.id === id);
  if (!p) return;
  app().set("environment", p.build());
  if (id !== "flat") setTimeout(() => viewportRef.get()?.frameEnvironment(), 60);
}

export const sampleById = (id: string) => SAMPLES.find((s) => s.id === id);
