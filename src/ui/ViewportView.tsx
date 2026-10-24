import { useEffect, useRef, useState } from "react";
import {
  Globe2,
  Library,
  Eye,
  FileUp,
  FolderOpen,
  Magnet,
  MousePointer2,
  Move,
  Pause,
  Play,
  RotateCcw,
  Rotate3d,
  Scan,
  SlidersHorizontal,
  Sparkles,
  SquareDashedMousePointer,
  StepForward,
} from "lucide-react";
import { useApp, app } from "@/store/app";
import { resolveTheme, useSettings } from "@/store/settings";
import { meshStore } from "@/store/meshStore";
import { textureStore } from "@/store/textureStore";
import { Viewport } from "@/viewport/Viewport";
import { viewportRef } from "@/viewport/ref";
import {
  attachSimHost,
  pause,
  play,
  reset,
  setMode,
  simOptions,
  restartPhysics,
  setFixedBase,
} from "@/sim/controller";
import { matrixToPose } from "@/core/math";
import { linkById } from "@/core/model";
import { movePivotIn, setLinkWorldIn, linkWorld } from "@/app/actions";
import { runCommand } from "@/commands/registry";
import { IconButton, Segmented, CheckRow, NumberField } from "./controls";
import { BehaviorPicker, TeleopOverlay } from "./SimControls";
import { CommandMenu, Popover } from "./Menu";

export function ViewportView({ dragging }: { dragging: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const vp = useRef<Viewport | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const theme = useSettings((s) => s.theme);

  useEffect(() => {
    const v = new Viewport(host.current!, {
      onPick(hit, mods) {
        if (!hit) return app().select(null);
        if (mods.alt || mods.shift)
          app().select({ kind: hit.kind, linkId: hit.linkId, compId: hit.compId });
        else app().select({ kind: "link", linkId: hit.linkId });
      },
      onGizmoStart: () => app().beginGesture(),
      onGizmoEnd: () => app().endGesture(),
      onGizmoMove(world, target) {
        const sel = app().selection;
        if (!sel || !("linkId" in sel)) return;
        app().preview((m) => {
          if (target === "link") setLinkWorldIn(m, sel.linkId, world);
          else if (target === "pivot") movePivotIn(m, sel.linkId, world);
          else {
            const L = linkById(m, sel.linkId);
            if (!L) return;
            const comps =
              sel.kind === "visual" || sel.kind === "collision"
                ? [...L.visuals, ...L.collisions].filter((c) => c.id === sel.compId)
                : L.visuals.slice(0, 1);
            const local = matrixToPose(linkWorld(m, L.id).invert().multiply(world));
            for (const c of comps) c.origin = local;
          }
        });
      },
      onMate(linkId, newWorld) {
        app().edit((m) => setLinkWorldIn(m, linkId, newWorld));
        app().set("tool", "translate");
        setHint("Mated. Fine-tune with the move gizmo, or pick the joint type in the inspector.");
        setTimeout(() => setHint(null), 4000);
      },
      onHint(text) {
        setHint(text);
      },
    });
    vp.current = v;
    viewportRef.set(v);
    attachSimHost(v);
    return () => {
      attachSimHost(null);
      viewportRef.set(null);
      v.dispose();
    };
  }, []);

  // Push state into the viewport whenever anything it draws changes.
  useEffect(() => {
    const push = () => {
      const s = app();
      vp.current?.update({
        model: s.model,
        meshVersion: s.meshVersion,
        selection: s.selection,
        view: s.view,
        jointValues: s.jointValues,
        mode: s.mode,
        tool: s.tool,
        gizmoTarget: s.gizmoTarget,
        gizmoSpace: s.gizmoSpace,
        snap: s.snap,
        themeKey: theme + resolveTheme(theme).id,
        meshes: meshStore.get,
        textures: textureStore.get,
        environment: s.environment,
      });
    };
    push();
    return useApp.subscribe(push);
  }, [theme]);

  const tool = useApp((s) => s.tool);
  useEffect(() => {
    if (tool !== "mate") setHint(null);
    else setHint("Click a face on the part to move.");
  }, [tool]);

  const empty = useApp((s) => s.model.links.length === 0);
  return (
    <div className="viewport" ref={host}>
      <ToolStrip />
      <ViewControls />
      <ModeBar />
      <TeleopOverlay />
      {hint && (
        <div className="vp-overlay" style={{ top: 12, left: "50%", transform: "translateX(-50%)" }}>
          <div className="hint-pill" onClick={() => setHint(null)}>
            {hint}
          </div>
        </div>
      )}
      {empty && !dragging && <Welcome />}
      {dragging && (
        <div className="drop-zone">Drop STEP, IGES, STL, URDF or .forge files to import</div>
      )}
    </div>
  );
}

function ToolStrip() {
  const tool = useApp((s) => s.tool);
  const target = useApp((s) => s.gizmoTarget);
  const space = useApp((s) => s.gizmoSpace);
  const snap = useApp((s) => s.snap);
  const mode = useApp((s) => s.mode);
  if (mode !== "edit") return null;
  return (
    <div className="vp-overlay tl">
      <div className="floating vertical" role="toolbar" aria-label="Tools">
        <IconButton
          icon={<MousePointer2 size={16} />}
          label="Select"
          shortcut="Q"
          pressed={tool === "select"}
          onClick={() => runCommand("tool.select")}
        />
        <IconButton
          icon={<Move size={16} />}
          label="Move"
          shortcut="W"
          pressed={tool === "translate"}
          onClick={() => runCommand("tool.move")}
        />
        <IconButton
          icon={<Rotate3d size={16} />}
          label="Rotate"
          shortcut="E"
          pressed={tool === "rotate"}
          onClick={() => runCommand("tool.rotate")}
        />
        <IconButton
          icon={<SquareDashedMousePointer size={16} />}
          label="Mate faces"
          shortcut="F"
          pressed={tool === "mate"}
          onClick={() => runCommand("tool.mate")}
        />
        <span className="sep" />
        <IconButton
          icon={<Magnet size={16} />}
          label="Snap (5 mm, 15°)"
          shortcut="S"
          pressed={snap}
          onClick={() => runCommand("tool.snap")}
        />
      </div>
      {(tool === "translate" || tool === "rotate") && (
        <div className="floating" style={{ marginTop: 2 }}>
          <Segmented
            value={target}
            onChange={(v) => app().set("gizmoTarget", v)}
            options={[
              {
                value: "link",
                label: "Link",
                title: "Move the link and everything attached (T cycles)",
              },
              {
                value: "pivot",
                label: "Origin",
                title: "Move only the link frame / joint origin; geometry stays put",
              },
              { value: "mesh", label: "Mesh", title: "Move the mesh inside its link" },
            ]}
          />
          <Segmented
            value={space}
            onChange={(v) => app().set("gizmoSpace", v)}
            options={[
              { value: "world", label: "World", title: "Gizmo aligned to the world (X)" },
              { value: "local", label: "Local", title: "Gizmo aligned to the object (X)" },
            ]}
          />
        </div>
      )}
    </div>
  );
}

function ViewControls() {
  const shading = useApp((s) => s.view.shading);
  const lit = useApp((s) => s.view.lit);
  const envIntensity = useApp((s) => s.view.envIntensity);
  const gridMode = useApp((s) => s.view.gridMode);
  const gridSize = useApp((s) => s.view.gridSize);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <div className="vp-overlay tr">
      <div className="floating">
        <Segmented
          value={lit ? "lit" : "unlit"}
          onChange={(v) => app().setView({ lit: v === "lit" })}
          options={[
            {
              value: "lit",
              label: "Lit",
              title: "Physically based lighting, shadows and reflections (U)",
            },
            { value: "unlit", label: "Unlit", title: "Flat albedo colours and textures (U)" },
          ]}
        />
        <span className="sep" />
        <Segmented
          value={shading}
          onChange={(v) => app().setView({ shading: v })}
          options={[
            { value: "shaded", label: "Shaded", title: "Shaded (Z cycles)" },
            { value: "shaded-wire", label: "Edges", title: "Shaded with feature edges" },
            { value: "wireframe", label: "Wire", title: "Wireframe" },
            { value: "xray", label: "X-ray", title: "See-through" },
          ]}
        />
        <span className="sep" />
        <button
          ref={btn}
          className="icon-btn"
          title="Overlays and lighting"
          aria-pressed={!!menu}
          onClick={() => setMenu(menu ? null : btn.current)}
        >
          <Eye size={16} />
        </button>
        <IconButton
          icon={<Scan size={16} />}
          label="Frame all"
          shortcut="Home"
          onClick={() => runCommand("view.frameAll")}
        />
      </div>
      {menu && (
        <Popover anchor={menu} onClose={() => setMenu(null)} align="end">
          <CommandMenu
            onDone={() => {}}
            entries={[
              { label: "Lighting" },
              "view.toggle.lit",
              "view.toggle.lighting",
              "view.toggle.shadows",
              "view.toggle.environment",
              { label: "Reflections" },
              "view.env.studio",
              "view.env.neutral",
              "view.env.browse",
              "view.toggle.envBackground",
            ]}
          />
          <div style={{ padding: "2px 10px 6px" }} className="col">
            <label className="muted" style={{ fontSize: "var(--fs-xs)" }}>
              Reflection strength
            </label>
            <input
              type="range"
              min={0}
              max={3}
              step={0.05}
              value={envIntensity}
              aria-label="Reflection strength"
              onChange={(e) => app().setView({ envIntensity: +e.target.value })}
            />
          </div>
          <div className="menu-sep" />
          <div className="menu-label">Grid</div>
          <div className="row" style={{ padding: "2px 10px 6px" }}>
            <Segmented
              value={gridMode}
              onChange={(v) => app().setView({ gridMode: v, grid: true })}
              options={[
                { value: "adaptive", label: "Adaptive", title: "Spacing follows the zoom level" },
                { value: "fixed", label: "Fixed", title: "Fixed cell size" },
              ]}
            />
            {gridMode === "fixed" && (
              <div style={{ width: 96 }}>
                <NumberField
                  value={gridSize}
                  unit="m"
                  min={0.0005}
                  title="Grid cell size; major lines every 10 cells"
                  onChange={(v) => app().setView({ gridSize: v })}
                />
              </div>
            )}
          </div>
          <CommandMenu
            onDone={() => {}}
            entries={[
              { label: "Scene" },
              "view.toggle.grid",
              "view.toggle.worldOrigin",
              "view.toggle.visuals",
              "view.toggle.collisions",
              { label: "Robot overlays" },
              "view.toggle.linkFrames",
              "view.toggle.jointAxes",
              "view.toggle.com",
              "view.toggle.inertia",
              "view.toggle.labels",
            ]}
          />
          <div className="menu-sep" />
          <div className="menu-label">Camera</div>
          <div className="viewcube" style={{ padding: "4px 10px 8px" }}>
            {["top", "front", "right", "iso", "back", "left", "bottom"].map((v) => (
              <button key={v} onClick={() => viewportRef.get()?.setView(v)}>
                {v.toUpperCase()}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

function ModeBar() {
  const mode = useApp((s) => s.mode);
  const running = useApp((s) => s.simRunning);
  const hasLinks = useApp((s) => s.model.links.length > 0);
  const [opts, setOpts] = useState<HTMLElement | null>(null);
  const optBtn = useRef<HTMLButtonElement>(null);
  const [, force] = useState(0);
  const envName = useApp((s) => s.environment.name);
  const [envMenu, setEnvMenu] = useState<HTMLElement | null>(null);
  const envBtn = useRef<HTMLButtonElement>(null);
  if (!hasLinks) return null;
  return (
    <div className="vp-overlay bc">
      <div className="floating">
        <button
          ref={envBtn}
          className="btn ghost sm"
          title="Test environment"
          onClick={() => setEnvMenu(envMenu ? null : envBtn.current)}
        >
          <Globe2 size={14} /> {envName}
        </button>
        <span className="sep" />
        <Segmented
          accent
          value={mode}
          onChange={(v) => setMode(v)}
          options={[
            { value: "edit", label: "Edit", title: "Edit the robot (F5)" },
            {
              value: "pose",
              label: "Pose",
              title: "Move joints with sliders; animate wheels and servos (F6)",
            },
            {
              value: "physics",
              label: "Physics",
              title: "Simulate with gravity, contacts and motors (F7)",
            },
          ]}
        />
        {mode !== "edit" && (
          <>
            <span className="sep" />
            <BehaviorPicker />
            <IconButton
              icon={running ? <Pause size={16} /> : <Play size={16} />}
              label={running ? "Pause" : "Play"}
              shortcut="Space"
              onClick={() => (running ? pause() : play())}
            />
            <IconButton
              icon={<RotateCcw size={16} />}
              label="Reset"
              shortcut="Shift+R"
              onClick={() => (mode === "physics" ? setMode("physics") : reset())}
            />
            <IconButton
              icon={<SlidersHorizontal size={16} />}
              label="Joint panel"
              onClick={() => runCommand("view.panelBottom")}
            />
            {mode === "physics" && (
              <button
                ref={optBtn}
                className="icon-btn"
                title="Physics options"
                onClick={() => setOpts(opts ? null : optBtn.current)}
              >
                <StepForward size={16} />
              </button>
            )}
          </>
        )}
      </div>
      {envMenu && (
        <Popover anchor={envMenu} onClose={() => setEnvMenu(null)}>
          <CommandMenu
            onDone={() => setEnvMenu(null)}
            entries={[
              { label: "Built-in environments" },
              "env.use.flat",
              "env.use.ramps",
              "env.use.tabletop",
              "env.use.stairs",
              "env.use.obstacles",
              "env.use.rough",
              "env.use.maze",
              "env.use.warehouse",
              "-",
              "env.browse",
            ]}
          />
        </Popover>
      )}
      {opts && (
        <Popover anchor={opts} onClose={() => setOpts(null)}>
          <div className="col" style={{ padding: 8, minWidth: 240 }}>
            <CheckRow
              checked={simOptions.fixedBase}
              onChange={(v) => {
                setFixedBase(v);
                force((n) => n + 1);
                restartPhysics();
              }}
            >
              Fix the base in place
            </CheckRow>
            <CheckRow
              checked={simOptions.gravity}
              onChange={(v) => {
                simOptions.gravity = v;
                force((n) => n + 1);
                restartPhysics();
              }}
            >
              Gravity
            </CheckRow>
            <div className="muted" style={{ fontSize: "var(--fs-xs)", maxWidth: 260 }}>
              Wheels spin at their drive velocity; servos hold their target. Set drives per joint in
              the inspector.
            </div>
          </div>
        </Popover>
      )}
    </div>
  );
}

function Welcome() {
  return (
    <div className="welcome">
      <div className="welcome-card">
        <img src="./logo.svg" alt="" />
        <h1>Build a robot description</h1>
        <p>
          Import a STEP or STL assembly, split it into links, set joints, preview the motion, and
          export a ROS 2 package.
        </p>
        <div className="welcome-actions">
          <button className="btn primary" onClick={() => runCommand("file.import")}>
            <FileUp size={16} /> Import CAD…
          </button>
          <button className="btn" onClick={() => runCommand("file.open")}>
            <FolderOpen size={16} /> Open project…
          </button>
          <button className="btn" onClick={() => runCommand("file.sample")}>
            <Sparkles size={16} /> Explore the sample rover
          </button>
          <button className="btn" onClick={() => runCommand("file.samples")}>
            <Library size={16} /> Browse robots…
          </button>
        </div>
        <div className="welcome-foot">
          Drop files anywhere · <kbd>Ctrl K</kbd> for every command
        </div>
      </div>
    </div>
  );
}
