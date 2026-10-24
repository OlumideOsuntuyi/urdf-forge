import { useState } from "react";
import { Boxes } from "lucide-react";
import { app, useApp } from "@/store/app";
import { defaults, findPart, type Params } from "@/core/parts";
import { insertPartIn } from "@/app/parts";
import { Dialog } from "./Dialog";
import { CheckRow, Field, NumberField, Select } from "../controls";
import { PartThumbnail } from "../ComponentsPanel";

/** Configure a component's parameters and insert it into the robot. */
export function ComponentDialog({ id }: { id: string }) {
  const t = findPart(id);
  const model = useApp((s) => s.model);
  const sel = useApp((s) => s.selection);
  const [params, setParams] = useState<Params>(() => (t ? defaults(t) : {}));
  const [attach, setAttach] = useState<string>(() =>
    sel && "linkId" in sel ? sel.linkId : (model.links[0]?.id ?? ""),
  );
  if (!t) return null;
  const set = (k: string, v: string | number | boolean) => setParams({ ...params, [k]: v });
  let error = "";
  let linkCount = 0;
  try {
    linkCount = t.build(params).length;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <Dialog
      title={t.name}
      icon={<Boxes size={18} />}
      footer={
        <>
          <span className="muted">
            {linkCount} link{linkCount === 1 ? "" : "s"}
          </span>
          <span className="grow" />
          <button className="btn ghost" onClick={() => app().closeDialog()}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!!error}
            onClick={() => {
              let root = "";
              app().edit((m) => (root = insertPartIn(m, t, params, attach || null)));
              app().closeDialog();
              app().select({ kind: "link", linkId: root });
              app().toast(`Added ${t.name}`, "success");
            }}
          >
            Insert
          </button>
        </>
      }
    >
      <div className="row" style={{ alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div className="part" style={{ cursor: "default", width: 260 }}>
          <div className="thumb" style={{ height: 170 }}>
            <PartThumbnail t={t} params={params} size={[240, 160]} />
          </div>
        </div>
        <p className="dim" style={{ margin: 0, flex: 1, minWidth: 200 }}>
          {t.description}
        </p>
      </div>
      {model.links.length > 0 && (
        <Field
          label="Attach to"
          hint="The component's first link is fixed (or jointed) to this link's frame."
        >
          <Select
            value={attach}
            onChange={setAttach}
            options={model.links.map((l) => ({ value: l.id, label: l.name }))}
          />
        </Field>
      )}
      {t.params.map((p) => (
        <Field key={p.key} label={p.label} hint={p.hint}>
          {p.kind === "choice" ? (
            <Select
              value={String(params[p.key])}
              onChange={(v) => set(p.key, v)}
              options={p.choices ?? []}
            />
          ) : p.kind === "bool" ? (
            <CheckRow checked={!!params[p.key]} onChange={(v) => set(p.key, v)}>
              {p.label}
            </CheckRow>
          ) : (
            <NumberField
              value={Number(params[p.key])}
              unit={p.kind === "length" ? "m" : p.kind === "angle" ? "deg" : "none"}
              precision={p.kind === "int" ? 0 : p.kind === "length" ? 4 : undefined}
              min={p.min}
              max={p.max}
              step={p.kind === "int" ? 1 : undefined}
              onChange={(v) => set(p.key, p.kind === "int" ? Math.round(v) : v)}
            />
          )}
        </Field>
      ))}
      {error && <div className="callout error">{error}</div>}
    </Dialog>
  );
}
