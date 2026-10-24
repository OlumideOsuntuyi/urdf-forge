import { AlertTriangle, Bot, PlugZap, XCircle } from "lucide-react";
import { useApp } from "@/store/app";
import { useSettings } from "@/store/settings";
import { hasJoint } from "@/core/model";
import { runCommand } from "@/commands/registry";
import { TARGETS } from "@/core/ros/targets";
import { useProblems } from "./BottomPanel";

export function StatusBar({ mcpRunning }: { mcpRunning: boolean }) {
  const model = useApp((s) => s.model);
  const sel = useApp((s) => s.selection);
  const mode = useApp((s) => s.mode);
  const target = useApp((s) => s.gizmoTarget);
  const tool = useApp((s) => s.tool);
  const port = useSettings((s) => s.mcpPort);
  const problems = useProblems();
  const errors = problems.filter((p) => p.level === "error").length;
  const warnings = problems.length - errors;
  const joints = model.links.filter((l) => hasJoint(model, l) && l.joint.type !== "fixed").length;
  const selName =
    sel && "linkId" in sel
      ? model.links.find((l) => l.id === sel.linkId)?.name
      : sel?.kind === "mesh"
        ? model.meshes.find((m) => m.id === sel.meshId)?.name
        : null;
  return (
    <footer className="statusbar">
      <button onClick={() => runCommand("view.panelBottom")} title="Problems (Ctrl+J)">
        {errors ? (
          <span className="err row">
            <XCircle size={12} /> {errors}
          </span>
        ) : null}
        {warnings ? (
          <span className="wrn row">
            <AlertTriangle size={12} /> {warnings}
          </span>
        ) : null}
        {!problems.length && <span className="okc">✓ valid</span>}
      </button>
      <span>
        {model.links.length} links · {joints} moving joints · {model.meshes.length} parts
      </span>
      {selName && (
        <span>
          Selected <b style={{ color: "var(--text-2)" }}>{selName}</b>
          {(tool === "translate" || tool === "rotate") && mode === "edit"
            ? ` · gizmo: ${target}`
            : ""}
        </span>
      )}
      <span className="grow" />
      <span title="Default export target">
        <Bot size={12} style={{ verticalAlign: -2 }} />{" "}
        {TARGETS[model.export.defaultTarget].rosLabel} ·{" "}
        {TARGETS[model.export.defaultTarget].simLabel}
      </span>
      <button
        onClick={() => runCommand("app.mcp")}
        title="Model Context Protocol server for AI assistants"
      >
        <PlugZap size={12} />
        <span className="dot" style={{ background: mcpRunning ? "var(--ok)" : "var(--text-3)" }} />
        MCP {mcpRunning ? `:${port}` : "off"}
      </button>
    </footer>
  );
}
