import { Menu, Moon, PanelLeft, PanelRight, Search, Settings, Sun } from "lucide-react";
import { formatShortcut, runCommand } from "@/commands/registry";
import { useApp } from "@/store/app";
import { resolveTheme, useSettings } from "@/store/settings";
import { MenuButton, type MenuEntry } from "./Menu";

const MENUS: Record<string, MenuEntry[]> = {
  File: [
    "file.new",
    "file.open",
    "file.save",
    "file.saveAs",
    "-",
    "file.import",
    "file.samples",
    "file.sample",
    "-",
    "file.export",
    "file.exportFolder",
    "file.exportZip",
    "file.exportUrdf",
    "file.exportSdf",
  ],
  Edit: [
    "edit.undo",
    "edit.redo",
    "-",
    "edit.duplicate",
    "edit.delete",
    "edit.deleteKeepChildren",
    "-",
    "edit.deselect",
    "-",
    "app.settings",
  ],
  View: [
    { label: "Shading" },
    "view.shading.shaded",
    "view.shading.shaded-wire",
    "view.shading.wireframe",
    "view.shading.xray",
    { label: "Show" },
    "view.toggle.lighting",
    "view.toggle.shadows",
    "view.toggle.environment",
    "view.toggle.grid",
    "view.toggle.worldOrigin",
    "view.toggle.linkFrames",
    "view.toggle.jointAxes",
    "view.toggle.com",
    "view.toggle.inertia",
    "view.toggle.collisions",
    "view.toggle.labels",
    { label: "Camera" },
    "view.frameAll",
    "view.frameSelection",
    "view.iso",
    "view.top",
    "view.front",
    "view.right",
    "-",
    "view.panelLeft",
    "view.panelRight",
    "view.panelBottom",
    "view.cycleTheme",
  ],
  Robot: [
    "link.add",
    "link.addPrimitive.box",
    "link.addPrimitive.cylinder",
    "link.addPrimitive.sphere",
    "-",
    { label: "Link origin" },
    "link.pivotToCentre",
    "link.pivotToCom",
    "link.pivotToParent",
    "link.resetRotation",
    { label: "Collision" },
    "link.collision.box",
    "link.collision.cylinder",
    "link.collision.sphere",
    "link.collision.hull",
    "link.collision.simplified",
    "link.collision.mesh",
    "-",
    "link.recomputeInertia",
    "link.purgeParts",
  ],
  Simulate: [
    "sim.edit",
    "sim.pose",
    "sim.physics",
    "-",
    "sim.playPause",
    "sim.reset",
    { label: "Environment" },
    "env.use.flat",
    "env.use.ramps",
    "env.use.stairs",
    "env.use.obstacles",
    "env.use.rough",
    "env.use.maze",
    "env.use.warehouse",
    "env.use.tabletop",
    "env.browse",
  ],
  Help: ["app.shortcuts", "app.plugins", "app.mcp", "-", "app.about"],
};

export function TitleBar() {
  const robot = useApp((s) => s.model.robot);
  const dirty = useApp((s) => s.dirty);
  const path = useApp((s) => s.projectPath);
  const panels = useApp((s) => s.panels);
  const theme = useSettings((s) => s.theme);
  const dark = resolveTheme(theme).dark;
  return (
    <header className="titlebar">
      <div className="narrow-only">
        <MenuButton
          label={<Menu size={18} />}
          entries={Object.entries(MENUS).flatMap(([k, v]) => [{ label: k }, ...v])}
        />
      </div>
      <div className="brand">
        <img src="./logo.svg" alt="" />
        <span>URDF Forge</span>
      </div>
      <nav className="menus" aria-label="Main menu">
        {Object.entries(MENUS).map(([k, v]) => (
          <MenuButton key={k} label={k} entries={v} />
        ))}
      </nav>
      <div className="project-title" title={path ?? undefined}>
        <b>{robot}</b>
        {dirty ? " • edited" : ""}
      </div>
      <span className="spacer-sm" />
      <button
        className="palette-trigger"
        onClick={() => runCommand("app.palette")}
        aria-label="Command palette"
      >
        <Search size={14} />
        <span className="label grow" style={{ textAlign: "left" }}>
          Search commands…
        </span>
        <kbd>{formatShortcut("Mod+K")}</kbd>
      </button>
      <button
        className="icon-btn"
        title="Robot panel"
        aria-pressed={panels.left}
        onClick={() => runCommand("view.panelLeft")}
      >
        <PanelLeft size={16} />
      </button>
      <button
        className="icon-btn"
        title="Inspector"
        aria-pressed={panels.right}
        onClick={() => runCommand("view.panelRight")}
      >
        <PanelRight size={16} />
      </button>
      <button
        className="icon-btn"
        title={dark ? "Switch to light theme" : "Switch to dark theme"}
        onClick={() =>
          useSettings.getState().update({ theme: dark ? "forge-light" : "forge-dark" })
        }
      >
        {dark ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <button className="icon-btn" title="Settings" onClick={() => runCommand("app.settings")}>
        <Settings size={16} />
      </button>
    </header>
  );
}
