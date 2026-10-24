/** Applying library materials to the robot. */
import {
  linkById,
  materialById,
  newMaterial,
  uniqueName,
  type Material,
  type TextureMap,
} from "@/core/model";
import { applyPreset, type MaterialPreset } from "@/core/materials";
import { app, selectedLinkId } from "@/store/app";
import { textureStore } from "@/store/textureStore";
import { downloadHdri, downloadMaterial, type AcgAsset } from "./ambientcg";

/**
 * Edit material `materialId`, or (null) create a new one and give it to the selected link's
 * visuals. Returns the material id.
 */
function withTarget(materialId: string | null, name: string, fn: (m: Material) => void): string {
  let id = materialId ?? "";
  app().edit((model) => {
    let mat = materialId ? materialById(model, materialId) : undefined;
    if (!mat) {
      mat = newMaterial(
        uniqueName(
          name,
          model.materials.map((m) => m.name),
          "material",
        ),
        [0.8, 0.8, 0.8, 1],
      );
      model.materials.push(mat);
      const link = linkById(model, selectedLinkId(app().selection));
      if (link) for (const v of link.visuals) v.materialId = mat.id;
    }
    fn(mat);
    id = mat.id;
  });
  return id;
}

export function applyMaterialPreset(materialId: string | null, p: MaterialPreset): string {
  return withTarget(materialId, p.id, (m) => applyPreset(m, p));
}

export async function applyAmbientCG(
  materialId: string | null,
  asset: AcgAsset,
  resolution: "1K" | "2K" = "1K",
): Promise<string> {
  const { maps } = await downloadMaterial(asset, resolution);
  const keys: Partial<Record<TextureMap, string>> = {};
  for (const [map, entry] of Object.entries(maps) as [TextureMap, [string, Uint8Array]][]) {
    // Texture keys double as exported file names, so keep them unique and readable.
    const key = `${asset.id}_${resolution}_${map}.${entry[0].split(".").pop()}`.replace(
      /[^A-Za-z0-9_.-]/g,
      "_",
    );
    textureStore.set(key, entry[1]);
    keys[map] = key;
  }
  return withTarget(materialId, asset.id.toLowerCase(), (m) => {
    m.textures = {
      source: `ambientCG ${asset.id} (CC0)`,
      tile: asset.tileMetres ?? 0.5,
      maps: keys,
    };
    // Textures carry colour, roughness and metalness; neutral base values let them through.
    m.rgba = [1, 1, 1, m.rgba[3]];
    m.metalness = keys.metalness ? 1 : 0;
    m.roughness = 1;
  });
}

export async function applyAmbientCGHdri(asset: AcgAsset): Promise<void> {
  const { name, bytes } = await downloadHdri(asset);
  const key = `${asset.id}_${name}`.replace(/[^A-Za-z0-9_.-]/g, "_");
  textureStore.set(key, bytes);
  app().setView({ envMap: `hdri:${key}`, environment: true });
  app().toast(`Reflections and lighting from ${asset.name} (ambientCG, CC0)`, "success");
}
