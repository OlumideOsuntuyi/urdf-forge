import { useMemo, useState } from "react";
import { AlertTriangle, Archive, FolderOutput, Package, XCircle } from "lucide-react";
import { app, useApp } from "@/store/app";
import { TARGETS, TARGET_IDS, targetLabel, type TargetId } from "@/core/ros/targets";
import { validate } from "@/core/validate";
import { exportPackage } from "@/app/io";
import { diffDriveFor } from "@/app/diffDrive";
import { buildPackage } from "@/core/ros/package";
import { pluginExporters } from "@/plugins/host";
import { meshStore } from "@/store/meshStore";
import { saveBytes } from "@/platform";
import { Dialog } from "./Dialog";
import { Field, TextField, Toggle } from "../controls";

export function ExportDialog() {
  const model = useApp((s) => s.model);
  const ex = model.export;
  const [file, setFile] = useState<string | null>(null);
  // Preview without serialising meshes; the real export adds one STL per part.
  const files = useMemo(
    () => buildPackage(model, new Map(), { diffDrive: diffDriveFor(model) }),
    [model],
  );
  const names = [...files.keys()].sort();
  const total = files.size + model.meshes.length;
  const shown =
    file && files.has(file) ? file : (names.find((n) => n.endsWith(".urdf.xacro")) ?? names[0]);
  const problems = validate(model);
  const errors = problems.filter((p) => p.level === "error");
  const setTargets = (t: TargetId[]) =>
    app().edit((m) => {
      m.export.targets = t;
      if (!t.includes(m.export.defaultTarget) && t[0]) m.export.defaultTarget = t[0];
    });

  return (
    <Dialog
      title="Export ROS 2 package"
      icon={<Package size={18} />}
      wide
      footer={
        <>
          <span className="muted">
            {total} files · <span className="mono">{model.packageName}/</span>
          </span>
          <span className="grow" />
          {pluginExporters().map((pe) => (
            <button
              key={pe.id}
              className="btn"
              onClick={async () => {
                const data = await pe.export(model, meshStore.get);
                await saveBytes(`${model.robot}.${pe.extension}`, data, [
                  { name: pe.label, extensions: [pe.extension] },
                ]);
              }}
            >
              {pe.label}
            </button>
          ))}
          <button
            className="btn"
            onClick={() => exportPackage("zip")}
            disabled={!ex.targets.length}
          >
            <Archive size={15} /> Save as zip
          </button>
          <button
            className="btn primary"
            onClick={() => exportPackage("folder")}
            disabled={!ex.targets.length}
          >
            <FolderOutput size={15} /> Export to folder
          </button>
        </>
      }
    >
      {errors.length > 0 && (
        <div className="callout error">
          <XCircle size={14} />
          <span>
            {errors.length} error{errors.length > 1 ? "s" : ""} will produce a package ROS tools may
            reject: {errors[0].message}
            {errors.length > 1 ? " See the Problems panel for the rest." : ""}
          </span>
        </div>
      )}
      <div className="row">
        <b>Targets</b>
        <span className="muted">
          One URDF and launch file per target; the xacro switches between them.
        </span>
      </div>
      <div className="target-list" role="group" aria-label="Export targets">
        {TARGET_IDS.map((id) => {
          const t = TARGETS[id];
          const on = ex.targets.includes(id);
          return (
            <div
              key={id}
              className="target"
              role="checkbox"
              aria-checked={on}
              tabIndex={0}
              onClick={() =>
                setTargets(on ? ex.targets.filter((x) => x !== id) : [...ex.targets, id])
              }
              onKeyDown={(e) =>
                e.key === " " &&
                setTargets(on ? ex.targets.filter((x) => x !== id) : [...ex.targets, id])
              }
            >
              <input type="checkbox" checked={on} readOnly tabIndex={-1} />
              <div>
                <div className="t1">{t.rosLabel}</div>
                <div className="t2">{t.simLabel}</div>
              </div>
              <span className={`badge ${t.legacy ? "warn" : t.eol === "rolling" ? "" : "ok"}`}>
                {t.legacy ? "legacy" : t.eol === "rolling" ? "rolling" : `to ${t.eol}`}
              </span>
            </div>
          );
        })}
      </div>
      {ex.targets.some((t) => TARGETS[t].legacy) && (
        <div className="callout warn">
          <AlertTriangle size={14} />
          <span>
            Gazebo Classic reached end of life in January 2025. Prefer Fortress (Humble) or Harmonic
            (Jazzy) for new work.
          </span>
        </div>
      )}
      <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
        <label className="row">
          <Toggle
            checked={ex.ros2Control}
            onChange={(v) => app().edit((m) => (m.export.ros2Control = v))}
          />
          ros2_control with controllers
        </label>
        <span className="muted">Default target for display.launch.py:</span>
        <select
          className="select"
          style={{ width: "auto" }}
          value={ex.defaultTarget}
          onChange={(e) => app().edit((m) => (m.export.defaultTarget = e.target.value as TargetId))}
        >
          {ex.targets.map((t) => (
            <option key={t} value={t}>
              {targetLabel(TARGETS[t])}
            </option>
          ))}
        </select>
      </div>
      <details>
        <summary className="dim" style={{ cursor: "pointer" }}>
          package.xml details
        </summary>
        <div className="col" style={{ marginTop: 8 }}>
          <Field label="Version">
            <TextField
              value={ex.version}
              onCommit={(v) => app().edit((m) => (m.export.version = v.trim() || "0.1.0"))}
              mono
            />
          </Field>
          <Field label="Maintainer">
            <TextField
              value={ex.maintainer}
              onCommit={(v) => app().edit((m) => (m.export.maintainer = v.trim()))}
            />
          </Field>
          <Field label="Email">
            <TextField
              value={ex.maintainerEmail}
              onCommit={(v) => app().edit((m) => (m.export.maintainerEmail = v.trim()))}
            />
          </Field>
          <Field label="License">
            <TextField
              value={ex.license}
              onCommit={(v) => app().edit((m) => (m.export.license = v.trim()))}
              mono
            />
          </Field>
          <Field label="Description">
            <TextField
              value={ex.description}
              placeholder="Robot description for …"
              onCommit={(v) => app().edit((m) => (m.export.description = v))}
            />
          </Field>
        </div>
      </details>
      <div className="row">
        <b>Preview</b>
        <select
          className="select"
          style={{ width: "auto", minWidth: 260 }}
          value={shown}
          onChange={(e) => setFile(e.target.value)}
        >
          {names.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </div>
      <pre className="code">{String(files.get(shown) ?? "")}</pre>
      {problems.length > errors.length && (
        <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          {problems.length - errors.length} warning(s) in the Problems panel.
        </div>
      )}
    </Dialog>
  );
}
