import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Palette, Search, Sparkles, Sun } from "lucide-react";
import { app, useApp } from "@/store/app";
import { MATERIAL_PRESETS } from "@/core/materials";
import { searchAmbientCG, type AcgAsset } from "@/materials/ambientcg";
import { applyAmbientCG, applyMaterialPreset, applyAmbientCGHdri } from "@/materials/apply";
import { openExternal } from "@/platform";
import { Dialog } from "./Dialog";
import { Segmented, Select } from "../controls";

type Tab = "presets" | "pbr" | "hdri";

/**
 * The material library. `materialId` is the material being edited; without it, the chosen
 * material is created and given to the selected link.
 */
export function MaterialsDialog({ materialId, tab: initial }: { materialId?: string; tab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initial ?? "presets");
  const target = useApp((s) =>
    materialId ? s.model.materials.find((m) => m.id === materialId)?.name : null,
  );
  const title = target ? `Material: ${target}` : "Materials";
  return (
    <Dialog title={title} icon={<Palette size={18} />} wide>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          {
            value: "presets",
            label: (
              <>
                <Sparkles size={14} /> Solid finishes
              </>
            ),
          },
          {
            value: "pbr",
            label: (
              <>
                <Palette size={14} /> PBR textures (ambientCG)
              </>
            ),
          },
          {
            value: "hdri",
            label: (
              <>
                <Sun size={14} /> Reflections (HDRI)
              </>
            ),
          },
        ]}
      />
      {tab === "presets" && <Presets materialId={materialId ?? null} />}
      {tab === "pbr" && <AmbientBrowser type="Material" materialId={materialId ?? null} />}
      {tab === "hdri" && <AmbientBrowser type="HDRI" materialId={null} />}
    </Dialog>
  );
}

const swatch = (rgba: number[], metal: number, rough: number) => {
  const c = `rgb(${rgba
    .slice(0, 3)
    .map((v) => Math.round(v * 255))
    .join(" ")})`;
  const hi = metal > 0.5 ? 0.85 : 0.55 - rough * 0.4;
  return `radial-gradient(circle at 32% 28%, rgba(255,255,255,${Math.max(0.05, hi)}) 0, transparent ${30 + rough * 40}%), radial-gradient(circle at 50% 50%, ${c} 55%, rgba(0,0,0,0.55) 100%)`;
};

function Presets({ materialId }: { materialId: string | null }) {
  const groups = [...new Set(MATERIAL_PRESETS.map((p) => p.group))];
  return (
    <div className="col" style={{ gap: 14 }}>
      {groups.map((g) => (
        <div key={g}>
          <div className="menu-label" style={{ paddingLeft: 0 }}>
            {g}
          </div>
          <div className="mat-grid">
            {MATERIAL_PRESETS.filter((p) => p.group === g).map((p) => (
              <button
                key={p.id}
                className="mat-card"
                onClick={() => {
                  applyMaterialPreset(materialId, p);
                  app().toast(`${p.name} applied`, "success");
                }}
              >
                <span
                  className="ball"
                  style={{
                    background: swatch(p.rgba, p.metalness, p.roughness),
                    opacity: Math.max(0.4, p.rgba[3]),
                  }}
                />
                <span className="mname">{p.name}</span>
                <span className="muted mmeta">
                  metal {p.metalness} · rough {p.roughness}
                  {p.clearcoat ? " · coat" : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AmbientBrowser({
  type,
  materialId,
}: {
  type: "Material" | "HDRI";
  materialId: string | null;
}) {
  const [q, setQ] = useState(type === "Material" ? "" : "");
  const [debounced, setDebounced] = useState(q);
  const [assets, setAssets] = useState<AcgAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [res, setRes] = useState<"1K" | "2K">("1K");
  const offset = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let live = true;
    offset.current = 0;
    setLoading(true);
    setError("");
    searchAmbientCG(debounced, type, 0)
      .then((r) => {
        if (!live) return;
        setAssets(r.assets);
        setTotal(r.total);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [debounced, type]);

  const more = async () => {
    offset.current += 60;
    setLoading(true);
    try {
      const r = await searchAmbientCG(debounced, type, offset.current);
      setAssets((a) => [...a, ...r.assets]);
    } finally {
      setLoading(false);
    }
  };

  const quick = useMemo(
    () =>
      type === "Material"
        ? [
            "metal",
            "plastic",
            "rubber",
            "carbon",
            "painted",
            "wood",
            "fabric",
            "concrete",
            "tiles",
            "leather",
          ]
        : ["studio", "indoor", "day", "sunset", "night"],
    [type],
  );

  return (
    <>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <div className="search" style={{ margin: 0, flex: 1, minWidth: 200 }}>
          <Search size={14} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={type === "Material" ? "Search 2000+ CC0 materials" : "Search HDRIs"}
          />
        </div>
        {type === "Material" && (
          <div style={{ width: 120 }}>
            <Select
              value={res}
              onChange={setRes}
              options={[
                { value: "1K", label: "1K textures" },
                { value: "2K", label: "2K textures" },
              ]}
            />
          </div>
        )}
      </div>
      <div className="chips">
        {quick.map((k) => (
          <button
            key={k}
            className="chip-btn"
            aria-pressed={q === k}
            onClick={() => setQ(q === k ? "" : k)}
          >
            {k}
          </button>
        ))}
        <span className="grow" />
        <button className="link-btn" onClick={() => openExternal("https://ambientcg.com")}>
          ambientCG · CC0 · {total.toLocaleString()} results
        </button>
      </div>
      {error && <div className="callout error">{error}</div>}
      <div className="mat-grid acg">
        {assets.map((a) => (
          <button
            key={a.id}
            className="mat-card"
            disabled={!!busy}
            title={`${a.name} (${a.category})`}
            onClick={async () => {
              setBusy(a.id);
              try {
                if (type === "HDRI") await applyAmbientCGHdri(a);
                else {
                  await applyAmbientCG(materialId, a, res);
                  app().toast(`${a.name} applied (ambientCG, CC0)`, "success");
                }
              } catch (e) {
                app().toast(`${a.name}: ${e instanceof Error ? e.message : String(e)}`, "error");
              } finally {
                setBusy(null);
              }
            }}
          >
            <img className="thumb-img" src={a.thumbnail} alt="" loading="lazy" />
            <span className="mname">{a.name}</span>
            <span className="muted mmeta">
              {busy === a.id ? (
                "Downloading…"
              ) : (
                <>
                  <Download size={11} /> {a.category}
                </>
              )}
            </span>
          </button>
        ))}
      </div>
      {loading && <div className="muted">Loading…</div>}
      {!loading && assets.length < total && (
        <button className="btn sm" onClick={more}>
          Load more
        </button>
      )}
    </>
  );
}
