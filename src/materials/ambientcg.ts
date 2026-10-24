/**
 * ambientCG (https://ambientcg.com): CC0 PBR materials and HDRIs, browsed and downloaded on
 * demand. Downloads are cached (see src/samples/fetch.ts).
 */
import { unzipSync } from "fflate";
import { fetchCached } from "@/samples/fetch";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { isTauri } from "@/platform";
import type { TextureMap } from "@/core/model";

const API = "https://ambientcg.com/api/v2/full_json";

export interface AcgAsset {
  id: string;
  name: string;
  category: string;
  thumbnail: string;
  /** Downloads by attribute, e.g. "1K-JPG" or (HDRIs) "1K". */
  downloads: Record<string, { url: string; size: number }>;
  /** Physical size of one tile in metres, when ambientCG knows it. */
  tileMetres: number | null;
}

interface RawAsset {
  assetId: string;
  displayName?: string;
  displayCategory?: string;
  previewImage?: Record<string, string>;
  dimensionX?: number;
  downloadFolders?: {
    default?: {
      downloadFiletypeCategories?: {
        zip?: { downloads?: { attribute: string; fullDownloadPath: string; size: number }[] };
      };
    };
  };
}

const searchCache = new Map<string, { assets: AcgAsset[]; total: number }>();

export async function searchAmbientCG(
  q: string,
  type: "Material" | "HDRI",
  offset = 0,
  limit = 60,
): Promise<{ assets: AcgAsset[]; total: number }> {
  const url = `${API}?type=${type}&limit=${limit}&offset=${offset}&sort=Popular&include=downloadData,previewData,displayData,dimensionsData${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`;
  const hit = searchCache.get(url);
  if (hit) return hit;
  const f = isTauri() ? tauriFetch : fetch;
  const r = await f(url);
  if (!r.ok) throw new Error(`ambientCG returned HTTP ${r.status}`);
  const j = (await r.json()) as { foundAssets: RawAsset[]; numberOfResults: number };
  const assets = j.foundAssets.map((a): AcgAsset => {
    const dl = a.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads ?? [];
    return {
      id: a.assetId,
      name: a.displayName || a.assetId,
      category: a.displayCategory || "",
      thumbnail: a.previewImage?.["256-PNG"] ?? a.previewImage?.["128-PNG"] ?? "",
      downloads: Object.fromEntries(
        dl.map((d) => [d.attribute, { url: d.fullDownloadPath, size: d.size }]),
      ),
      // dimensionX is in centimetres for materials.
      tileMetres: a.dimensionX ? a.dimensionX / 100 : null,
    };
  });
  const out = { assets, total: j.numberOfResults };
  searchCache.set(url, out);
  return out;
}

/** Which file in a material zip feeds each map. ambientCG names: <id>_<res>_<Map>.jpg */
const MAP_FILES: [TextureMap, RegExp][] = [
  ["color", /_Color\.(jpg|png)$/i],
  ["normal", /_NormalGL\.(jpg|png)$/i],
  ["roughness", /_Roughness\.(jpg|png)$/i],
  ["metalness", /_Metalness\.(jpg|png)$/i],
  ["ao", /_AmbientOcclusion\.(jpg|png)$/i],
];

export interface DownloadedTextures {
  /** Map name to [file name, bytes]. */
  maps: Partial<Record<TextureMap, [string, Uint8Array]>>;
}

export async function downloadMaterial(
  asset: AcgAsset,
  resolution: "1K" | "2K" = "1K",
): Promise<DownloadedTextures> {
  const d =
    asset.downloads[`${resolution}-JPG`] ??
    asset.downloads[`${resolution}-PNG`] ??
    Object.values(asset.downloads)[0];
  if (!d) throw new Error(`${asset.name} has no download.`);
  const files = unzipSync(await fetchCached(`acg_${asset.id}`, d.url));
  const maps: DownloadedTextures["maps"] = {};
  for (const [map, re] of MAP_FILES) {
    const name = Object.keys(files).find((k) => re.test(k));
    if (name) maps[map] = [name.split("/").pop()!, files[name]];
  }
  if (!maps.color) throw new Error(`${asset.name}: no colour map in the download.`);
  return { maps };
}

/** An HDRI as raw .hdr or .exr bytes. */
export async function downloadHdri(
  asset: AcgAsset,
  resolution: "1K" | "2K" = "1K",
): Promise<{ name: string; bytes: Uint8Array }> {
  const d =
    asset.downloads[resolution] ??
    asset.downloads[`${resolution}-HDR`] ??
    asset.downloads[`${resolution}-EXR`] ??
    Object.values(asset.downloads)[0];
  if (!d) throw new Error(`${asset.name} has no download.`);
  const files = unzipSync(await fetchCached(`acg_${asset.id}`, d.url));
  const name =
    Object.keys(files).find((k) => /\.hdr$/i.test(k)) ??
    Object.keys(files).find((k) => /\.exr$/i.test(k));
  if (!name) throw new Error(`${asset.name}: no .hdr or .exr file in the download.`);
  return { name: name.split("/").pop()!, bytes: files[name] };
}
