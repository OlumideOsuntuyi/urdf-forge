import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  FolderOutput,
  Info,
  Loader2,
  Settings2,
  Square,
  XCircle,
} from "lucide-react";
import { app, useApp } from "@/store/app";
import { useSettings } from "@/store/settings";
import { isaacFixedBase, isaacFolderName, isaacJoints, type IsaacGroup } from "@/core/isaac/export";
import { validate } from "@/core/validate";
import { exportIsaac, isaacBaseHint, isaacFiles, useIsaacConversion } from "@/app/isaac";
import { cancelIsaacConvert, checkIsaacLab, type IsaacLabCheck } from "@/platform";
import { Dialog } from "./Dialog";
import { Field, Segmented } from "../controls";

const GROUP_LABEL: Record<IsaacGroup, string> = {
  position: "position",
  velocity: "velocity",
  effort: "effort",
  passive: "undriven",
};

/** The Isaac Sim / Isaac Lab side of the export dialog. `kind` is the ROS / Isaac switch. */
export function IsaacExportDialog({ kind }: { kind: React.ReactNode }) {
  const model = useApp((s) => s.model);
  const labPath = useSettings((s) => s.isaacLabPath);
  const conv = useIsaacConversion();
  const [check, setCheck] = useState<IsaacLabCheck | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let live = true;
    setCheck(null);
    checkIsaacLab(labPath)
      .then((c) => live && setCheck(c))
      .catch((e) => live && setCheck({ ok: false, reason: String(e) }));
    return () => {
      live = false;
    };
  }, [labPath]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conv.lines.length]);

  // Preview without serialising meshes.
  const files = useMemo(() => isaacFiles(model, false), [model]);
  const names = [...files.keys()].filter((n) => typeof files.get(n) === "string").sort();
  const total = files.size + model.meshes.length;
  const shown =
    file && files.has(file) ? file : (names.find((n) => n.endsWith("_cfg.py")) ?? names[0]);
  const hint = isaacBaseHint(model);
  const fixed = isaacFixedBase(model, hint);
  const base = model.export.isaac?.base ?? "auto";
  const joints = isaacJoints(model);
  const groups = (["position", "velocity", "effort", "passive"] as IsaacGroup[])
    .map((g) => [g, joints.filter((j) => j.group === g).length] as const)
    .filter(([, n]) => n);
  const errors = validate(model).filter((p) => p.level === "error");
  const running = conv.status === "running";
  const canConvert = !!check?.ok && !running && !busy;
  const convertTitle = !check
    ? "Checking Isaac Lab…"
    : !check.ok
      ? `${check.reason ?? "Isaac Lab is not available."} Export to folder still writes every file.`
      : running
        ? "A conversion is running."
        : `Export, then run convert_to_usd with Isaac Lab at ${labPath}`;

  const run = async (convert: boolean) => {
    setBusy(true);
    try {
      await exportIsaac({ convert });
    } catch (e) {
      app().toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Export for NVIDIA Isaac Sim / Isaac Lab"
      icon={<Cpu size={18} />}
      wide
      footer={
        <>
          <span className="muted">
            {total} files · <span className="mono">{isaacFolderName(model)}/</span>
          </span>
          <span className="grow" />
          <button className="btn" onClick={() => run(false)} disabled={busy || running}>
            <FolderOutput size={15} /> Export to folder
          </button>
          <button
            className="btn primary"
            onClick={() => run(true)}
            disabled={!canConvert}
            title={convertTitle}
          >
            {running ? <Loader2 size={15} className="spin" /> : <Cpu size={15} />} Export and
            convert to USD
          </button>
        </>
      }
    >
      {kind}
      {errors.length > 0 && (
        <div className="callout error">
          <XCircle size={14} />
          <span>
            {errors.length} validation error{errors.length > 1 ? "s" : ""} may stop Isaac Sim from
            importing the robot: {errors[0].message}
          </span>
        </div>
      )}
      <div className="callout info">
        <Info size={14} />
        <span>
          A folder with the URDF (mesh paths relative to it, no ROS or Gazebo tags), an Isaac Lab{" "}
          <span className="mono">ArticulationCfg</span>, and scripts that convert it to USD with
          Isaac Lab. The ROS 2 package export is separate.
        </span>
      </div>
      <Field
        label="Base"
        hint={
          base === "auto"
            ? `Auto: ${fixed ? "fixed (an arm, or a world-anchored robot)" : "floating (the robot moves itself)"}.`
            : undefined
        }
      >
        <Segmented
          value={base}
          onChange={(v) => app().edit((m) => (m.export.isaac = { ...m.export.isaac, base: v }))}
          options={[
            { value: "auto", label: "Auto" },
            { value: "fixed", label: "Fixed", title: "Weld the root link to the world (arms)" },
            { value: "floating", label: "Floating", title: "Free base (wheeled, legged)" },
          ]}
        />
      </Field>
      <Field label="Actuators" hint="The current pose is the initial joint position.">
        <span className="muted">
          {groups.length
            ? groups.map(([g, n]) => `${n} ${GROUP_LABEL[g]}`).join(" · ")
            : "No moving joints."}
        </span>
      </Field>
      <Field label="Isaac Lab">
        <div className="row" style={{ gap: 8, minWidth: 0 }}>
          {!check ? (
            <Loader2 size={14} className="spin" aria-label="Checking" />
          ) : check.ok ? (
            <CheckCircle2 size={14} aria-label="Found" style={{ color: "var(--ok)" }} />
          ) : (
            <AlertTriangle size={14} aria-label="Not available" style={{ color: "var(--warn)" }} />
          )}
          <span className="mono grow" style={{ userSelect: "text", overflowWrap: "anywhere" }}>
            {labPath || "(not set)"}
          </span>
          <button
            className="btn sm"
            onClick={() => app().openDialog("settings", { tab: "general" })}
            title="Change the Isaac Lab folder"
          >
            <Settings2 size={13} /> Change
          </button>
        </div>
      </Field>
      {check && !check.ok && (
        <div className="callout warn">
          <AlertTriangle size={14} />
          <span>
            {check.reason} Export to folder still writes every file; run{" "}
            <span className="mono">convert_to_usd.ps1</span> once Isaac Lab is installed.
          </span>
        </div>
      )}
      {conv.status !== "idle" && (
        <>
          <div className="row">
            <b>USD conversion</b>
            <span className="muted grow" role="status">
              {running
                ? "Running headless…"
                : conv.status === "done"
                  ? `Written: ${conv.usd}`
                  : `Failed: ${conv.error}`}
            </span>
            {running && (
              <button className="btn sm" onClick={() => cancelIsaacConvert()}>
                <Square size={12} /> Cancel
              </button>
            )}
          </div>
          <pre className="code" ref={logRef} style={{ maxHeight: 220 }} aria-live="off">
            {conv.lines.map((l) => l.text).join("\n") || "Starting…"}
          </pre>
        </>
      )}
      <div className="row">
        <b>Preview</b>
        <select
          className="select"
          style={{ width: "auto", minWidth: 260 }}
          value={shown}
          onChange={(e) => setFile(e.target.value)}
          aria-label="File to preview"
        >
          {names.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </div>
      <pre className="code">{String(files.get(shown) ?? "")}</pre>
    </Dialog>
  );
}
