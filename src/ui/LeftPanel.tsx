import { memo, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  Box,
  ChevronDown,
  ChevronRight,
  Cuboid,
  Eye,
  EyeOff,
  FileUp,
  Plus,
  Search,
  Shield,
  Sparkles,
} from "lucide-react";
import { useApp, app, type Selection } from "@/store/app";
import {
  childrenOf,
  materialById,
  rootLinks,
  uid,
  type Link,
  type MeshAsset,
  type RobotModel,
} from "@/core/model";
import { linkFromMeshIn, recomputeInertialIn, reparentIn } from "@/app/actions";
import { runCommand } from "@/commands/registry";
import { meshStore } from "@/store/meshStore";
import { viewportRef } from "@/viewport/ref";
import { CommandMenu, Popover } from "./Menu";
import { ComponentsPanel } from "./ComponentsPanel";

const css = (rgba?: number[]) =>
  rgba
    ? `rgb(${Math.round(rgba[0] * 255)} ${Math.round(rgba[1] * 255)} ${Math.round(rgba[2] * 255)})`
    : "var(--text-3)";

export function LeftPanel() {
  const [tab, setTab] = useState<"robot" | "components" | "parts">("robot");
  const parts = useApp((s) => s.model.meshes.length);
  return (
    <aside className="side left" aria-label="Robot">
      <div className="panel-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "robot"} onClick={() => setTab("robot")}>
          Robot
        </button>
        <button
          role="tab"
          aria-selected={tab === "components"}
          onClick={() => setTab("components")}
          title="Library of shapes, actuators, wheels, sensors and assemblies"
        >
          Components
        </button>
        <button
          role="tab"
          aria-selected={tab === "parts"}
          onClick={() => setTab("parts")}
          title="Meshes imported or generated in this project"
        >
          Parts <span className="muted">{parts || ""}</span>
        </button>
        <span className="grow" />
        <button
          className="icon-btn"
          title="Import CAD or mesh (Ctrl+I)"
          onClick={() => runCommand("file.import")}
        >
          <FileUp size={15} />
        </button>
      </div>
      {tab === "robot" ? (
        <Outliner />
      ) : tab === "components" ? (
        <ComponentsPanel />
      ) : (
        <PartsLibrary />
      )}
    </aside>
  );
}

// ------------------------------------------------------------------ outliner

function Outliner() {
  const model = useApp((s) => s.model);
  const selection = useApp((s) => s.selection);
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ el: HTMLElement } | null>(null);
  const matches = useMemo(() => {
    if (!q.trim()) return null;
    const s = q.toLowerCase();
    const hit = new Set<string>();
    for (const L of model.links)
      if (L.name.toLowerCase().includes(s) || L.joint.name.toLowerCase().includes(s)) hit.add(L.id);
    // Keep ancestors of matches visible.
    for (const id of [...hit]) {
      let p = model.links.find((l) => l.id === id)?.parentId;
      while (p && !hit.has(p)) {
        hit.add(p);
        p = model.links.find((l) => l.id === p)?.parentId;
      }
    }
    return hit;
  }, [q, model.links]);

  const onDropRoot = (e: DragEvent) => {
    e.preventDefault();
    const link = e.dataTransfer.getData("forge/link");
    const mesh = e.dataTransfer.getData("forge/mesh");
    if (link) app().edit((m) => reparentIn(m, link, null));
    if (mesh)
      app().edit((m) => {
        const a = m.meshes.find((x) => x.id === mesh);
        if (a) app().select({ kind: "link", linkId: linkFromMeshIn(m, a, { parentId: null }).id });
      });
  };

  if (!model.links.length)
    return (
      <div className="panel-body">
        <div className="empty">
          <b>No links yet</b>
          Import a STEP or STL file and each body becomes a link you can arrange into a tree.
          <div className="col" style={{ alignItems: "center" }}>
            <button className="btn primary" onClick={() => runCommand("file.import")}>
              <FileUp size={15} /> Import CAD…
            </button>
            <button className="btn ghost" onClick={() => runCommand("file.sample")}>
              <Sparkles size={15} /> Load the sample rover
            </button>
          </div>
        </div>
      </div>
    );

  return (
    <>
      <div className="search">
        <Search size={14} />
        <input
          placeholder="Filter links"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filter links"
        />
        <button
          className="icon-btn"
          style={{ width: 22, height: 22 }}
          title="Add link"
          onClick={() => runCommand("link.add")}
        >
          <Plus size={14} />
        </button>
      </div>
      <div
        className="panel-body tree"
        role="tree"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDropRoot}
      >
        {rootLinks(model).map((L) => (
          <TreeNode
            key={L.id}
            link={L}
            model={model}
            depth={0}
            selection={selection}
            closed={closed}
            matches={matches}
            toggle={(id) =>
              setClosed((c) => {
                const n = new Set(c);
                if (n.has(id)) n.delete(id);
                else n.add(id);
                return n;
              })
            }
            onMenu={(el) => setMenu({ el })}
          />
        ))}
      </div>
      {menu && (
        <Popover anchor={menu.el} onClose={() => setMenu(null)}>
          <CommandMenu
            onDone={() => setMenu(null)}
            entries={[
              "view.frameSelection",
              "link.toggleHidden",
              "edit.duplicate",
              "-",
              "link.pivotToCentre",
              "link.pivotToCom",
              "link.pivotToParent",
              "-",
              "link.collision.box",
              "link.collision.cylinder",
              "link.collision.hull",
              "-",
              "edit.delete",
              "edit.deleteKeepChildren",
            ]}
          />
        </Popover>
      )}
    </>
  );
}

interface NodeProps {
  link: Link;
  model: RobotModel;
  depth: number;
  selection: Selection | null;
  closed: Set<string>;
  matches: Set<string> | null;
  toggle: (id: string) => void;
  onMenu: (el: HTMLElement) => void;
}

const TreeNode = memo(function TreeNode({
  link: L,
  model,
  depth,
  selection,
  closed,
  matches,
  toggle,
  onMenu,
}: NodeProps) {
  const [drop, setDrop] = useState(false);
  if (matches && !matches.has(L.id)) return null;
  const kids = childrenOf(model, L.id);
  const open = !closed.has(L.id) || !!matches;
  const sel = selection?.kind === "link" && selection.linkId === L.id;
  const comps = [
    ...L.visuals.map((c) => ({ c, kind: "visual" as const })),
    ...L.collisions.map((c) => ({ c, kind: "collision" as const })),
  ];
  const rgba = materialById(model, L.visuals[0]?.materialId ?? null)?.rgba;
  const jt = L.parentId ? L.joint.type : "root";

  return (
    <div role="treeitem" aria-expanded={open} aria-selected={sel}>
      <div
        className={`node ${sel ? "selected" : ""} ${drop ? "drop-target" : ""} ${L.hidden ? "hidden-link" : ""}`}
        style={{ paddingLeft: 4 + depth * 14 }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("forge/link", L.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDrop(true);
        }}
        onDragLeave={() => setDrop(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDrop(false);
          const link = e.dataTransfer.getData("forge/link");
          const mesh = e.dataTransfer.getData("forge/mesh");
          if (link && link !== L.id)
            app().edit((m) => {
              if (!reparentIn(m, link, L.id))
                throw new Error("A link cannot become a child of its own descendant.");
            });
          if (mesh)
            app().edit((m) => {
              const a = m.meshes.find((x) => x.id === mesh);
              const target = m.links.find((x) => x.id === L.id);
              if (!a || !target) return;
              if (e.altKey) {
                // Alt+drop: add the part as another visual of this link.
                target.visuals.push({
                  id: uid("vis"),
                  name: "",
                  origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
                  geometry: { type: "mesh", meshId: a.id, scale: [1, 1, 1] },
                  materialId: target.visuals[0]?.materialId ?? null,
                });
                recomputeInertialIn(m, target.id);
              } else
                app().select({ kind: "link", linkId: linkFromMeshIn(m, a, { parentId: L.id }).id });
            });
        }}
        onClick={() => app().select({ kind: "link", linkId: L.id })}
        onDoubleClick={() => {
          app().select({ kind: "link", linkId: L.id });
          setTimeout(() => viewportRef.get()?.frameSelection());
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          app().select({ kind: "link", linkId: L.id });
          onMenu(e.currentTarget);
        }}
      >
        <span
          className="twisty"
          onClick={(e) => {
            e.stopPropagation();
            toggle(L.id);
          }}
        >
          {kids.length ? open ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
        </span>
        <span className="swatch" style={{ background: css(rgba) }} />
        <span className="name">{L.name}</span>
        <span className="node-actions">
          <button
            className="icon-btn"
            title={L.hidden ? "Show" : "Hide"}
            onClick={(e) => {
              e.stopPropagation();
              app().edit((m) => {
                const x = m.links.find((l) => l.id === L.id)!;
                x.hidden = !x.hidden;
              });
            }}
          >
            {L.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </span>
        <span
          className={`chip ${jt}`}
          title={L.parentId ? `${L.joint.type} joint to parent` : "Root link"}
        >
          {jt === "continuous" ? "cont" : jt.slice(0, 4)}
        </span>
      </div>
      {open && (
        <div role="group">
          {/* Components are listed for the selected link only, to keep big trees readable. */}
          {(selection && "linkId" in selection && selection.linkId === L.id ? comps : []).map(
            ({ c, kind }) => {
              const csel = selection && "compId" in selection && selection.compId === c.id;
              return (
                <div
                  key={c.id}
                  className={`node ${csel ? "selected" : ""}`}
                  style={{ paddingLeft: 4 + (depth + 1) * 14 + 16 }}
                  onClick={() => app().select({ kind, linkId: L.id, compId: c.id })}
                >
                  {kind === "visual" ? (
                    <Cuboid size={13} className="comp-icon" />
                  ) : (
                    <Shield
                      size={13}
                      className="comp-icon"
                      style={{ color: "var(--vp-collision)" }}
                    />
                  )}
                  <span className="name dim">
                    {c.name ||
                      (c.geometry.type === "mesh"
                        ? (model.meshes.find(
                            (x) => x.id === (c.geometry as { meshId: string }).meshId,
                          )?.name ?? "missing mesh")
                        : c.geometry.type)}
                  </span>
                  <span className="chip">{kind === "visual" ? "vis" : "col"}</span>
                </div>
              );
            },
          )}
          {kids.map((k) => (
            <TreeNode
              key={k.id}
              link={k}
              model={model}
              depth={depth + 1}
              selection={selection}
              closed={closed}
              matches={matches}
              toggle={toggle}
              onMenu={onMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
});

// ------------------------------------------------------------------ parts

function PartsLibrary() {
  const meshes = useApp((s) => s.model.meshes);
  const selection = useApp((s) => s.selection);
  const used = useApp((s) => {
    const set = new Set<string>();
    for (const l of s.model.links)
      for (const c of [...l.visuals, ...l.collisions])
        if (c.geometry.type === "mesh") set.add(c.geometry.meshId);
    return [...set].sort().join(",");
  });
  const [q, setQ] = useState("");
  const list = meshes.filter((m) => m.name.toLowerCase().includes(q.toLowerCase()));
  if (!meshes.length)
    return (
      <div className="panel-body">
        <div className="empty">
          <b>The parts library is empty</b>
          Imported bodies land here. Drag a part onto a link in the Robot tab to attach it as a
          child, or Alt-drag to add it to that link.
          <div>
            <button className="btn primary" onClick={() => runCommand("file.import")}>
              <FileUp size={15} /> Import…
            </button>
          </div>
        </div>
      </div>
    );
  const usedSet = new Set(used.split(","));
  return (
    <>
      <div className="search">
        <Search size={14} />
        <input placeholder="Filter parts" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="panel-body">
        <div className="parts">
          {list.map((m) => (
            <PartCard
              key={m.id}
              asset={m}
              selected={selection?.kind === "mesh" && selection.meshId === m.id}
              used={usedSet.has(m.id)}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function PartCard({
  asset,
  selected,
  used,
}: {
  asset: MeshAsset;
  selected: boolean;
  used: boolean;
}) {
  return (
    <div
      className={`part ${selected ? "selected" : ""}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("forge/mesh", asset.id)}
      onClick={() => app().select({ kind: "mesh", meshId: asset.id })}
      onDoubleClick={() =>
        app().edit((m) => {
          const a = m.meshes.find((x) => x.id === asset.id);
          if (a) app().select({ kind: "link", linkId: linkFromMeshIn(m, a).id });
        })
      }
      title={`${asset.name}\n${asset.triangles.toLocaleString()} triangles\nfrom ${asset.origin}\nDouble-click to add as a link`}
    >
      <div className="thumb">
        <PartThumb id={asset.id} color={asset.color} />
      </div>
      <div className="pname">{asset.name}</div>
      <div className="meta">
        <span>
          {asset.triangles > 999 ? `${(asset.triangles / 1000).toFixed(1)}k` : asset.triangles} tris
        </span>
        {!asset.watertight && (
          <span className="warn" title="Not a closed surface: computed inertia is approximate">
            open
          </span>
        )}
        {!used && <span title="Not used by any link">unused</span>}
      </div>
    </div>
  );
}

/** Flat-shaded isometric silhouette drawn on a 2D canvas: cheap enough for hundreds of parts. */
const PartThumb = memo(function PartThumb({ id, color }: { id: string; color: number[] | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const pos = meshStore.get(id);
    if (!cv || !pos) return;
    const W = (cv.width = 160);
    const H = (cv.height = 96);
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    const n = Math.floor(pos.length / 9);
    const step = Math.max(1, Math.floor(n / 6000));
    const ca = Math.cos(-0.8),
      sa = Math.sin(-0.8),
      ce = Math.cos(0.6),
      se = Math.sin(0.6);
    const proj = (x: number, y: number, z: number): [number, number, number] => {
      const x1 = x * ca - y * sa;
      const y1 = x * sa + y * ca;
      return [x1, z * ce - y1 * se, y1 * ce + z * se];
    };
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    const tris: { p: [number, number, number][]; d: number; l: number }[] = [];
    for (let t = 0; t < n; t += step) {
      const b = t * 9;
      const p = [
        proj(pos[b], pos[b + 1], pos[b + 2]),
        proj(pos[b + 3], pos[b + 4], pos[b + 5]),
        proj(pos[b + 6], pos[b + 7], pos[b + 8]),
      ];
      const ux = p[1][0] - p[0][0],
        uy = p[1][1] - p[0][1],
        uz = p[1][2] - p[0][2];
      const vx = p[2][0] - p[0][0],
        vy = p[2][1] - p[0][1],
        vz = p[2][2] - p[0][2];
      const nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      const l = Math.abs((nx * 0.3 + ny * 0.6 + nz * 0.74) / len);
      for (const q of p) {
        minX = Math.min(minX, q[0]);
        maxX = Math.max(maxX, q[0]);
        minY = Math.min(minY, q[1]);
        maxY = Math.max(maxY, q[1]);
      }
      tris.push({ p, d: (p[0][2] + p[1][2] + p[2][2]) / 3, l });
    }
    tris.sort((a, b) => b.d - a.d);
    const s = Math.min((W - 12) / (maxX - minX || 1), (H - 12) / (maxY - minY || 1));
    const ox = W / 2 - ((minX + maxX) / 2) * s;
    const oy = H / 2 + ((minY + maxY) / 2) * s;
    const base = color ?? [0.62, 0.68, 0.76];
    for (const t of tris) {
      const k = 0.35 + 0.65 * t.l;
      ctx.fillStyle = `rgb(${base[0] * 255 * k},${base[1] * 255 * k},${base[2] * 255 * k})`;
      ctx.beginPath();
      ctx.moveTo(ox + t.p[0][0] * s, oy - t.p[0][1] * s);
      ctx.lineTo(ox + t.p[1][0] * s, oy - t.p[1][1] * s);
      ctx.lineTo(ox + t.p[2][0] * s, oy - t.p[2][1] * s);
      ctx.closePath();
      ctx.fill();
    }
  }, [id, color]);
  return meshStore.has(id) ? <canvas ref={ref} /> : <Box size={22} />;
});
