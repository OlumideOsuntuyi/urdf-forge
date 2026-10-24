/**
 * Downloads for the sample gallery, with an on-disk cache in the app cache folder.
 * Requests go through the Tauri HTTP plugin (no CORS limits; hosts allow-listed in
 * src-tauri/capabilities/default.json).
 */
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { appCacheDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, readFile, remove, writeFile } from "@tauri-apps/plugin-fs";
import { isTauri } from "@/platform";

let cacheRoot: Promise<string> | null = null;
const root = () => (cacheRoot ??= appCacheDir().then((d) => join(d, "samples")));

/** Stable file name for a URL inside a sample's cache folder. */
function cacheName(url: string): string {
  let h = 2166136261;
  for (let i = 0; i < url.length; i++) h = Math.imul(h ^ url.charCodeAt(i), 16777619);
  const tail = url.split(/[?#]/)[0].split("/").pop() || "file";
  return `${(h >>> 0).toString(36)}_${tail.replace(/[^A-Za-z0-9_.-]/g, "_").slice(-60)}`;
}

async function cachePath(sampleId: string, url: string): Promise<string> {
  return join(await root(), sampleId.replace(/[^A-Za-z0-9_-]/g, "_"), cacheName(url));
}

export class DownloadError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function download(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const f = isTauri() ? tauriFetch : fetch;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await f(url, { signal });
      if (!r.ok) throw new DownloadError(`HTTP ${r.status} for ${url}`, url, r.status);
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      lastErr = e;
      if (signal?.aborted || (e instanceof DownloadError && e.status && e.status < 500)) throw e;
      await new Promise((res) => setTimeout(res, 600 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new DownloadError(`Could not download ${url}`, url);
}

/** Fetch a URL for a sample, using the cache when possible. */
export async function fetchCached(
  sampleId: string,
  url: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!isTauri()) return download(url, signal);
  const path = await cachePath(sampleId, url);
  if (await exists(path)) return readFile(path);
  const bytes = await download(url, signal);
  await mkdir(path.replace(/[\\/][^\\/]+$/, ""), { recursive: true });
  await writeFile(path, bytes);
  return bytes;
}

export async function isCached(sampleId: string): Promise<boolean> {
  if (!isTauri()) return false;
  return exists(await join(await root(), sampleId.replace(/[^A-Za-z0-9_-]/g, "_")));
}

export async function clearCache(sampleId?: string): Promise<void> {
  if (!isTauri()) return;
  const dir = sampleId
    ? await join(await root(), sampleId.replace(/[^A-Za-z0-9_-]/g, "_"))
    : await root();
  if (await exists(dir)) await remove(dir, { recursive: true });
}

/** Run async jobs with limited concurrency, reporting progress. */
export async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (t: T, i: number) => Promise<R>,
  onDone?: (done: number) => void,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
        onDone?.(++done);
      }
    }),
  );
  return out;
}
