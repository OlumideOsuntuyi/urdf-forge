/**
 * Native services through Tauri: file dialogs, file system, app folders, URLs.
 * URDF Forge is a desktop/tablet app; these calls need the Tauri runtime.
 */
import { open, save } from "@tauri-apps/plugin-dialog";
import { exists, mkdir, readDir, readFile, readTextFile, writeFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { platform as osPlatform } from "@tauri-apps/plugin-os";

export interface PickedFile {
  name: string;
  path: string;
  bytes: Uint8Array;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function requireTauri() {
  if (!isTauri())
    throw new Error("This needs the URDF Forge app. Start it with `npm run app:dev`.");
}

export function baseName(path: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(path);
    } catch {
      return path;
    }
  })();
  return decoded.split(/[\\/]/).pop() || decoded;
}

export async function readPath(path: string): Promise<PickedFile> {
  requireTauri();
  return { name: baseName(path), path, bytes: await readFile(path) };
}

export async function pickFiles(filters: FileFilter[], multiple = true): Promise<PickedFile[]> {
  requireTauri();
  const sel = await open({ multiple, filters, directory: false });
  if (!sel) return [];
  const paths = Array.isArray(sel) ? sel : [sel];
  return Promise.all(paths.map(readPath));
}

export async function saveBytes(
  defaultName: string,
  data: Uint8Array | string,
  filters: FileFilter[],
  existingPath?: string | null,
): Promise<string | null> {
  requireTauri();
  const path = existingPath ?? (await save({ defaultPath: defaultName, filters }));
  if (!path) return null;
  await writeFile(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
  return path;
}

export async function pickDirectory(): Promise<string | null> {
  requireTauri();
  const sel = await open({ directory: true, multiple: false });
  return typeof sel === "string" ? sel : null;
}

/** Write a set of relative paths under `dir`, creating folders as needed. */
export async function writeTree(
  dir: string,
  files: Map<string, string | Uint8Array>,
): Promise<void> {
  requireTauri();
  for (const [rel, data] of files) {
    const parts = rel.split("/");
    const folder = await join(dir, ...parts.slice(0, -1));
    if (parts.length > 1) await mkdir(folder, { recursive: true });
    await writeFile(
      await join(dir, ...parts),
      typeof data === "string" ? new TextEncoder().encode(data) : data,
    );
  }
}

export async function pluginsDir(): Promise<string> {
  requireTauri();
  const dir = await join(await appDataDir(), "plugins");
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  return dir;
}

export async function listPluginFolders(): Promise<
  { folder: string; manifest: string; main: string }[]
> {
  const dir = await pluginsDir();
  const out: { folder: string; manifest: string; main: string }[] = [];
  for (const e of await readDir(dir)) {
    if (!e.isDirectory) continue;
    const folder = await join(dir, e.name);
    const manifestPath = await join(folder, "manifest.json");
    if (!(await exists(manifestPath))) continue;
    const manifest = await readTextFile(manifestPath);
    let mainFile = "main.js";
    try {
      mainFile = JSON.parse(manifest).main ?? mainFile;
    } catch {
      /* reported by the plugin host */
    }
    const mainPath = await join(folder, mainFile);
    out.push({
      folder,
      manifest,
      main: (await exists(mainPath)) ? await readTextFile(mainPath) : "",
    });
  }
  return out;
}

export async function openFolder(path: string): Promise<void> {
  requireTauri();
  await openPath(path);
}

export async function openExternal(url: string): Promise<void> {
  if (isTauri()) await openUrl(url);
  else window.open(url, "_blank", "noopener");
}

export function currentOs(): string {
  try {
    return isTauri() ? osPlatform() : "unknown";
  } catch {
    return "unknown";
  }
}

export const isMobile = (): boolean => ["android", "ios"].includes(currentOs());
