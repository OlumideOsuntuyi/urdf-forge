/** Gallery thumbnails: rendered in the app and cached as PNG files in the app cache folder. */
import { appCacheDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { useSyncExternalStore } from "react";
import { isTauri } from "@/platform";

const memory = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

let dirP: Promise<string> | null = null;
const dir = () => (dirP ??= appCacheDir().then((d) => join(d, "thumbnails")));
const file = async (id: string) => join(await dir(), `${id.replace(/[^A-Za-z0-9_.-]/g, "_")}.png`);

function changed() {
  version++;
  listeners.forEach((l) => l());
}

/** Store a rendered thumbnail (a PNG data URL). */
export async function saveThumbnail(id: string, dataUrl: string): Promise<void> {
  if (!dataUrl) return;
  memory.set(id, dataUrl);
  changed();
  if (!isTauri()) return;
  const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
  await mkdir(await dir(), { recursive: true });
  await writeFile(await file(id), bytes);
}

/** Load cached thumbnails for these ids into memory. */
export async function loadThumbnails(ids: string[]): Promise<void> {
  if (!isTauri()) return;
  let any = false;
  await Promise.all(
    ids.map(async (id) => {
      if (memory.has(id)) return;
      const f = await file(id);
      if (!(await exists(f))) return;
      const bytes = await readFile(f);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000)
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      memory.set(id, `data:image/png;base64,${btoa(bin)}`);
      any = true;
    }),
  );
  if (any) changed();
}

export function useThumbnail(id: string): string | undefined {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  return memory.get(id);
}

export const hasThumbnail = (id: string) => memory.has(id);
