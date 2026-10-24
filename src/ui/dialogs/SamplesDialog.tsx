import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, Download, ExternalLink, Globe2, Library, Search, Trash2 } from "lucide-react";
import { app, useApp } from "@/store/app";
import { SAMPLES, type Sample } from "@/samples/catalog";
import { ensureBuiltinThumbnails, generateRobotThumbnail, openSample } from "@/samples/open";
import { hasThumbnail, loadThumbnails, useThumbnail } from "@/samples/thumbnails";
import { clearCache, isCached } from "@/samples/fetch";
import type { Progress } from "@/samples/robot";
import { openExternal } from "@/platform";
import { Dialog } from "./Dialog";
import { Segmented } from "../controls";

type Tab = "robot" | "environment";

export function SamplesDialog({ tab: initial }: { tab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initial ?? "robot");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [busy, setBusy] = useState<{ id: string; p: Progress } | null>(null);
  const [cached, setCached] = useState<Record<string, boolean>>({});
  const abort = useRef<AbortController | null>(null);
  const envId = useApp((s) => s.environment.id);

  const list = SAMPLES.filter((s) => s.kind === tab);
  const cats = ["All", ...new Set(list.map((s) => s.category))];
  const shown = useMemo(
    () =>
      list.filter(
        (s) =>
          (cat === "All" || s.category === cat) &&
          `${s.name} ${s.description} ${s.category} ${s.tags?.join(" ") ?? ""}`
            .toLowerCase()
            .includes(q.toLowerCase()),
      ),
    [list, cat, q],
  );

  useEffect(() => {
    let live = true;
    Promise.all(
      SAMPLES.map(
        async (s) =>
          [
            s.id,
            s.source.kind !== "procedural" && (await isCached(s.id).catch(() => false)),
          ] as const,
      ),
    ).then((r) => live && setCached(Object.fromEntries(r)));
    return () => {
      live = false;
    };
  }, [busy]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    void loadThumbnails(SAMPLES.map((s) => s.id)).then(ensureBuiltinThumbnails);
  }, []);

  const [genProgress, setGenProgress] = useState<string | null>(null);
  const generateMissing = async () => {
    const todo = SAMPLES.filter((s) => s.kind === "robot" && !hasThumbnail(s.id));
    const ctrl = new AbortController();
    abort.current = ctrl;
    for (const [i, s] of todo.entries()) {
      if (ctrl.signal.aborted) break;
      setGenProgress(`Rendering ${s.name} (${i + 1}/${todo.length})`);
      await generateRobotThumbnail(s, ctrl.signal).catch(() => {});
    }
    setGenProgress(null);
  };

  const open = async (s: Sample) => {
    if (
      s.kind === "robot" &&
      app().dirty &&
      !window.confirm("Replace the current robot? Unsaved changes will be lost.")
    )
      return;
    abort.current?.abort();
    abort.current = new AbortController();
    setBusy({ id: s.id, p: { stage: "Starting", done: 0, total: 1 } });
    try {
      await openSample(s, (p) => setBusy({ id: s.id, p }), abort.current.signal);
      app().closeDialog();
    } catch (e) {
      if (!abort.current.signal.aborted)
        app().toast(`${s.name}: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog title="Samples" icon={<Library size={18} />} wide>
      <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
        <Segmented
          value={tab}
          onChange={(t) => {
            setTab(t);
            setCat("All");
          }}
          options={[
            {
              value: "robot",
              label: (
                <>
                  <Bot size={14} /> Robots
                </>
              ),
            },
            {
              value: "environment",
              label: (
                <>
                  <Globe2 size={14} /> Environments
                </>
              ),
            },
          ]}
        />
        <div className="search" style={{ margin: 0, flex: 1, minWidth: 180 }}>
          <Search size={14} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${tab === "robot" ? "robots" : "environments"}`}
          />
        </div>
      </div>
      <div className="chips">
        {cats.map((c) => (
          <button key={c} className="chip-btn" aria-pressed={cat === c} onClick={() => setCat(c)}>
            {c}
          </button>
        ))}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: "var(--fs-sm)" }}>
        {tab === "robot"
          ? "Open-source robot descriptions, downloaded from their original repositories when you open them and cached for next time."
          : "Scenes to preview and simulate your robot in. The chosen environment is also exported as the default Gazebo world."}
        {tab === "robot" && (
          <>
            {" "}
            <button
              className="link-btn"
              disabled={!!genProgress || !!busy}
              onClick={generateMissing}
            >
              {genProgress ?? "Download all and render missing thumbnails"}
            </button>
          </>
        )}
      </p>
      <div className="sample-grid">
        {shown.map((s) => {
          const mine = busy?.id === s.id;
          const active = s.kind === "environment" && envId === s.id.replace(/^env\./, "");
          return (
            <article key={s.id} className={`sample ${active ? "active" : ""}`}>
              <SampleThumb id={s.id} />
              <header>
                <div className="grow">
                  <div className="sname">{s.name}</div>
                  <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                    {s.category}
                    {s.sizeMB ? ` · ~${s.sizeMB} MB` : ""}
                  </div>
                </div>
                <span
                  className={`badge ${s.complexity === "complex" ? "warn" : s.complexity === "simple" ? "ok" : ""}`}
                >
                  {s.complexity}
                </span>
              </header>
              <p className="sdesc">{s.description}</p>
              <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                <span
                  className={`badge ${s.permissive ? "ok" : "warn"}`}
                  title={s.permissive ? "Open licence" : "Check the licence before redistributing"}
                >
                  {s.license}
                </span>
                {s.source.kind !== "procedural" && (
                  <button
                    className="link-btn"
                    onClick={() => openExternal(s.homepage)}
                    title={s.homepage}
                  >
                    {s.attribution} <ExternalLink size={11} />
                  </button>
                )}
              </div>
              {mine && busy ? (
                <div className="progress" aria-live="polite">
                  <div className="bar">
                    <span
                      style={{
                        width: `${Math.round((100 * busy.p.done) / Math.max(busy.p.total, 1))}%`,
                      }}
                    />
                  </div>
                  <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                    {busy.p.stage}
                    {busy.p.total > 1 ? ` ${busy.p.done}/${busy.p.total}` : ""}
                  </div>
                </div>
              ) : (
                <footer className="row">
                  <button className="btn sm primary" disabled={!!busy} onClick={() => open(s)}>
                    {active ? (
                      <Check size={13} />
                    ) : s.source.kind === "procedural" || cached[s.id] ? null : (
                      <Download size={13} />
                    )}
                    {s.kind === "robot" ? "Open" : active ? "In use" : "Use"}
                  </button>
                  {cached[s.id] && (
                    <button
                      className="icon-btn"
                      title="Remove the downloaded files"
                      onClick={async () => {
                        await clearCache(s.id);
                        setCached({ ...cached, [s.id]: false });
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                  {cached[s.id] && (
                    <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                      downloaded
                    </span>
                  )}
                </footer>
              )}
            </article>
          );
        })}
        {!shown.length && <div className="empty">Nothing matches.</div>}
      </div>
    </Dialog>
  );
}

function SampleThumb({ id }: { id: string }) {
  const url = useThumbnail(id);
  return (
    <div className="sample-thumb">
      {url ? <img src={url} alt="" /> : <Bot size={28} className="muted" />}
    </div>
  );
}
