/** Built-in solid materials (no textures): metals, plastics, rubbers and coated finishes. */
import type { Material, Rgba } from "./model";

export interface MaterialPreset {
  id: string;
  name: string;
  group: "Metals" | "Plastics" | "Rubber and elastomers" | "Coated and painted" | "Other";
  rgba: Rgba;
  metalness: number;
  roughness: number;
  clearcoat?: number;
}

const srgb = (hex: string, a = 1): Rgba => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
};

export const MATERIAL_PRESETS: MaterialPreset[] = [
  {
    id: "aluminium",
    name: "Aluminium (machined)",
    group: "Metals",
    rgba: srgb("#c9ccd1"),
    metalness: 1,
    roughness: 0.35,
  },
  {
    id: "aluminium_anodised_black",
    name: "Anodised aluminium, black",
    group: "Metals",
    rgba: srgb("#2a2c30"),
    metalness: 0.85,
    roughness: 0.45,
  },
  {
    id: "aluminium_anodised_blue",
    name: "Anodised aluminium, blue",
    group: "Metals",
    rgba: srgb("#2f5fa8"),
    metalness: 0.85,
    roughness: 0.4,
  },
  {
    id: "steel_brushed",
    name: "Brushed steel",
    group: "Metals",
    rgba: srgb("#b4b8bd"),
    metalness: 1,
    roughness: 0.45,
  },
  {
    id: "steel_polished",
    name: "Polished steel (chrome)",
    group: "Metals",
    rgba: srgb("#e8eaee"),
    metalness: 1,
    roughness: 0.08,
  },
  {
    id: "titanium",
    name: "Titanium",
    group: "Metals",
    rgba: srgb("#a8a49c"),
    metalness: 1,
    roughness: 0.4,
  },
  {
    id: "brass",
    name: "Brass",
    group: "Metals",
    rgba: srgb("#d8b468"),
    metalness: 1,
    roughness: 0.3,
  },
  {
    id: "copper",
    name: "Copper",
    group: "Metals",
    rgba: srgb("#d9895f"),
    metalness: 1,
    roughness: 0.3,
  },
  {
    id: "gold",
    name: "Gold",
    group: "Metals",
    rgba: srgb("#f2c94c"),
    metalness: 1,
    roughness: 0.2,
  },
  {
    id: "abs_black",
    name: "ABS, black",
    group: "Plastics",
    rgba: srgb("#1d1f22"),
    metalness: 0,
    roughness: 0.55,
  },
  {
    id: "abs_white",
    name: "ABS, white",
    group: "Plastics",
    rgba: srgb("#e9eaec"),
    metalness: 0,
    roughness: 0.5,
  },
  {
    id: "pla_orange",
    name: "PLA, orange (3D printed)",
    group: "Plastics",
    rgba: srgb("#ff7a2e"),
    metalness: 0,
    roughness: 0.65,
  },
  {
    id: "pla_grey",
    name: "PLA, grey (3D printed)",
    group: "Plastics",
    rgba: srgb("#8a8f96"),
    metalness: 0,
    roughness: 0.7,
  },
  {
    id: "nylon",
    name: "Nylon (PA12, sintered)",
    group: "Plastics",
    rgba: srgb("#d6d2c8"),
    metalness: 0,
    roughness: 0.85,
  },
  {
    id: "acrylic_clear",
    name: "Acrylic, clear",
    group: "Plastics",
    rgba: srgb("#dfeef5", 0.35),
    metalness: 0,
    roughness: 0.05,
    clearcoat: 1,
  },
  {
    id: "acrylic_smoked",
    name: "Acrylic, smoked",
    group: "Plastics",
    rgba: srgb("#3a3f46", 0.6),
    metalness: 0,
    roughness: 0.05,
    clearcoat: 1,
  },
  {
    id: "pcb_green",
    name: "PCB, green solder mask",
    group: "Plastics",
    rgba: srgb("#1f6b3a"),
    metalness: 0.1,
    roughness: 0.35,
    clearcoat: 0.4,
  },
  {
    id: "rubber_black",
    name: "Rubber, black",
    group: "Rubber and elastomers",
    rgba: srgb("#16171a"),
    metalness: 0,
    roughness: 0.92,
  },
  {
    id: "rubber_grey",
    name: "Rubber, grey",
    group: "Rubber and elastomers",
    rgba: srgb("#4a4d52"),
    metalness: 0,
    roughness: 0.9,
  },
  {
    id: "silicone_blue",
    name: "Silicone, blue",
    group: "Rubber and elastomers",
    rgba: srgb("#4d8fd6"),
    metalness: 0,
    roughness: 0.6,
  },
  {
    id: "car_paint_red",
    name: "Car paint, red",
    group: "Coated and painted",
    rgba: srgb("#b3121b"),
    metalness: 0.3,
    roughness: 0.35,
    clearcoat: 1,
  },
  {
    id: "car_paint_white",
    name: "Car paint, white",
    group: "Coated and painted",
    rgba: srgb("#f2f2f0"),
    metalness: 0.2,
    roughness: 0.35,
    clearcoat: 1,
  },
  {
    id: "powder_coat_orange",
    name: "Powder coat, safety orange",
    group: "Coated and painted",
    rgba: srgb("#ff6a13"),
    metalness: 0.05,
    roughness: 0.55,
    clearcoat: 0.3,
  },
  {
    id: "powder_coat_yellow",
    name: "Powder coat, industrial yellow",
    group: "Coated and painted",
    rgba: srgb("#f4b400"),
    metalness: 0.05,
    roughness: 0.55,
    clearcoat: 0.3,
  },
  {
    id: "matte_black",
    name: "Matte black",
    group: "Coated and painted",
    rgba: srgb("#121314"),
    metalness: 0,
    roughness: 1,
  },
  {
    id: "gloss_black",
    name: "Gloss black",
    group: "Coated and painted",
    rgba: srgb("#0d0e10"),
    metalness: 0.1,
    roughness: 0.15,
    clearcoat: 1,
  },
  {
    id: "carbon_fibre",
    name: "Carbon fibre (solid)",
    group: "Other",
    rgba: srgb("#24272b"),
    metalness: 0.3,
    roughness: 0.3,
    clearcoat: 1,
  },
  {
    id: "glass",
    name: "Glass",
    group: "Other",
    rgba: srgb("#e6f2f7", 0.2),
    metalness: 0,
    roughness: 0.02,
    clearcoat: 1,
  },
  {
    id: "wood_light",
    name: "Wood (solid colour)",
    group: "Other",
    rgba: srgb("#c49a6c"),
    metalness: 0,
    roughness: 0.7,
  },
];

export function applyPreset(m: Material, p: MaterialPreset): void {
  m.rgba = [...p.rgba];
  m.metalness = p.metalness;
  m.roughness = p.roughness;
  m.clearcoat = p.clearcoat ?? 0;
  m.textures = null;
}
