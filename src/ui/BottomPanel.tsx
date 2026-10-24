import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, X, XCircle } from "lucide-react";
import { useApp, app } from "@/store/app";
import { validate } from "@/core/validate";
import { hasJoint, jointName } from "@/core/model";
import { clampJoint } from "@/core/kinematics";
import { runCommand } from "@/commands/registry";

export function useProblems() {
  const model = useApp((s) => s.model);
  return useMemo(() => validate(model), [model]);
}

export function BottomPanel() {
  const mode = useApp((s) => s.mode);
  const [tab, setTab] = useState<"problems" | "joints">(mode === "edit" ? "problems" : "joints");
  const problems = useProblems();
  const errors = problems.filter((p) => p.level === "error").length;
  return (
    <section className="bottom" aria-label="Problems and joints">
      <div className="panel-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "problems"} onClick={() => setTab("problems")}>
          Problems{" "}
          {problems.length ? (
            <span className={errors ? "badge warn" : "badge"}>{problems.length}</span>
          ) : null}
        </button>
        <button role="tab" aria-selected={tab === "joints"} onClick={() => setTab("joints")}>
          Joints
        </button>
        <span className="grow" />
        <button
          className="icon-btn"
          title="Close panel"
          onClick={() => runCommand("view.panelBottom")}
        >
          <X size={15} />
        </button>
      </div>
      <div className="panel-body">{tab === "problems" ? <Problems /> : <Joints />}</div>
    </section>
  );
}

function Problems() {
  const problems = useProblems();
  if (!problems.length)
    return (
      <div className="empty">
        <CheckCircle2 size={20} style={{ color: "var(--ok)" }} />
        <b>No problems found</b>
        The robot passes every check URDF Forge knows about.
      </div>
    );
  return (
    <div role="list">
      {problems.map((p, i) => (
        <div
          key={i}
          role="listitem"
          className="problem"
          onClick={() => p.linkId && app().select({ kind: "link", linkId: p.linkId })}
        >
          {p.level === "error" ? (
            <XCircle size={14} className="ic-error" />
          ) : (
            <AlertTriangle size={14} className="ic-warning" />
          )}
          <span>{p.message}</span>
        </div>
      ))}
    </div>
  );
}

function Joints() {
  const model = useApp((s) => s.model);
  const values = useApp((s) => s.jointValues);
  const mode = useApp((s) => s.mode);
  const joints = model.links.filter(
    (l) =>
      hasJoint(model, l) &&
      l.joint.type !== "fixed" &&
      l.joint.type !== "floating" &&
      l.joint.type !== "planar",
  );
  if (!joints.length)
    return (
      <div className="empty">
        No moving joints yet. Give a link a revolute, continuous or prismatic joint in the
        inspector.
      </div>
    );
  return (
    <div className="joints">
      {joints.map((L) => {
        const j = L.joint;
        const ang = j.type !== "prismatic";
        const lo = j.type === "continuous" ? -Math.PI : j.lower;
        const hi = j.type === "continuous" ? Math.PI : j.upper;
        const v = values[L.id] ?? 0;
        const mimic = !!j.mimic?.joint;
        return (
          <div className="joint-slider" key={L.id}>
            <span className="jn" title={jointName(L)}>
              {jointName(L)} {mimic && <span className="muted">(mimic)</span>}
            </span>
            <span className="jv">
              {ang ? `${((v * 180) / Math.PI).toFixed(1)}°` : `${(v * 1000).toFixed(1)} mm`}
            </span>
            <input
              type="range"
              min={lo}
              max={hi}
              step={(hi - lo) / 400 || 0.001}
              value={Math.max(
                lo,
                Math.min(hi, j.type === "continuous" ? Math.atan2(Math.sin(v), Math.cos(v)) : v),
              )}
              disabled={mimic || mode === "physics"}
              aria-label={jointName(L)}
              onChange={(e) => {
                if (app().mode === "edit") app().set("mode", "pose");
                app().set("jointValues", {
                  ...app().jointValues,
                  [L.id]: clampJoint(L, parseFloat(e.target.value)),
                });
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
