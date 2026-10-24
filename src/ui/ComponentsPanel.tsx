import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { PART_CATEGORIES, PART_LIBRARY, defaults, type PartTemplate } from "@/core/parts";
import { app } from "@/store/app";
import { drawSoups, partSoups } from "./partPreview";

/** The component library: parametric parts and assemblies to build a robot from. */
export function ComponentsPanel() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("All");
  const list = useMemo(
    () =>
      PART_LIBRARY.filter(
        (t) =>
          (cat === "All" || t.category === cat) &&
          `${t.name} ${t.description} ${t.category} ${t.tags?.join(" ") ?? ""}`
            .toLowerCase()
            .includes(q.toLowerCase()),
      ),
    [q, cat],
  );
  return (
    <>
      <div className="search">
        <Search size={14} />
        <input placeholder="Search components" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="chips" style={{ padding: "0 10px 8px" }}>
        {["All", ...PART_CATEGORIES].map((c) => (
          <button key={c} className="chip-btn" aria-pressed={cat === c} onClick={() => setCat(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="panel-body">
        <div className="parts">
          {list.map((t) => (
            <ComponentCard key={t.id} t={t} />
          ))}
        </div>
        {!list.length && <div className="empty">No component matches “{q}”.</div>}
      </div>
    </>
  );
}

function ComponentCard({ t }: { t: PartTemplate }) {
  return (
    <button
      className="part component"
      title={`${t.description}\nClick to configure and insert.`}
      onClick={() => app().openDialog("component", { id: t.id })}
    >
      <div className="thumb">
        <PartThumbnail t={t} />
      </div>
      <div className="pname">{t.name}</div>
      <div className="meta">
        <span>{t.category}</span>
        <span className="grow" />
        <Plus size={12} />
      </div>
    </button>
  );
}

const thumbCache = new Map<string, string>();

/** Thumbnails are drawn once per template and cached as data URLs. */
export const PartThumbnail = memo(function PartThumbnail({
  t,
  params,
  size = [160, 96],
}: {
  t: PartTemplate;
  params?: Record<string, string | number | boolean>;
  size?: [number, number];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState(() => (params ? undefined : thumbCache.get(t.id)));
  useEffect(() => {
    if (url && !params) return;
    const cv = ref.current ?? document.createElement("canvas");
    try {
      drawSoups(cv, partSoups(t.build(params ?? defaults(t))), size[0], size[1]);
      if (!params) {
        const u = cv.toDataURL();
        thumbCache.set(t.id, u);
        setUrl(u);
      }
    } catch {
      /* a template that fails to build shows an empty thumbnail */
    }
  }, [t, params, url, size]);
  if (url && !params) return <img src={url} alt="" />;
  return <canvas ref={ref} style={{ width: size[0], height: size[1] }} />;
});
