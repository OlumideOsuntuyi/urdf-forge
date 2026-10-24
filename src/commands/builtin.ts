/** Built-in commands. Menus, toolbar, shortcuts, the palette and MCP all call these by id. */
import { registerCommand, type Command } from "./registry";
import { app } from "@/store/app";
import { useSettings, THEMES } from "@/store/settings";
import { linkById, newLink, uid, uniqueName, type RobotModel } from "@/core/model";
import { poseToMatrix } from "@/core/math";
import {
  addCollisionIn,
  deleteLinkIn,
  duplicateLinkIn,
  linkWorld,
  movePivotIn,
  purgeUnusedMeshesIn,
  recomputeInertialIn,
  selectedLink,
  setLinkWorldIn,
  type CollisionKind,
} from "@/app/actions";
import {
  exportPackage,
  exportSingle,
  importDialog,
  newProject,
  openProjectDialog,
  saveProjectFile,
} from "@/app/io";
import { loadSampleRobot } from "@/app/sample";
import { PROCEDURAL_ENVS } from "@/core/env/procedural";
import { applyBuiltinEnvironment } from "@/samples/open";
import { viewportRef } from "@/viewport/ref";
import { pause, play, reset, setMode } from "@/sim/controller";
import { Box3, Matrix4, Vector3 } from "three";

const hasLink = () => !!selectedLink();
const editMode = () => app().mode === "edit";

export function registerBuiltinCommands(): void {
  const cmds: Command[] = [
    // ---------------------------------------------------------------- file
    {
      id: "file.new",
      title: "New project",
      category: "File",
      shortcut: "Mod+N",
      run: () => confirmDiscard() && newProject(),
    },
    {
      id: "file.open",
      title: "Open project…",
      category: "File",
      shortcut: "Mod+O",
      run: () => confirmDiscard() && openProjectDialog(),
    },
    {
      id: "file.save",
      title: "Save project",
      category: "File",
      shortcut: "Mod+S",
      run: () => saveProjectFile(false),
    },
    {
      id: "file.saveAs",
      title: "Save project as…",
      category: "File",
      shortcut: "Mod+Shift+S",
      run: () => saveProjectFile(true),
    },
    {
      id: "file.import",
      title: "Import CAD, mesh or URDF…",
      category: "File",
      shortcut: "Mod+I",
      keywords: "step stp iges stl urdf open add parts",
      run: () => importDialog(),
    },
    {
      id: "file.export",
      title: "Export ROS 2 package…",
      category: "File",
      shortcut: "Mod+E",
      keywords: "urdf xacro sdf launch",
      run: () => app().openDialog("export"),
    },
    {
      id: "file.exportFolder",
      title: "Export package to folder",
      category: "File",
      run: () => exportPackage("folder"),
    },
    {
      id: "file.exportZip",
      title: "Export package as zip",
      category: "File",
      run: () => exportPackage("zip"),
    },
    {
      id: "file.exportUrdf",
      title: "Export URDF file",
      category: "File",
      run: () => exportSingle("urdf"),
    },
    {
      id: "file.exportSdf",
      title: "Export SDF model",
      category: "File",
      run: () => exportSingle("sdf"),
    },
    {
      id: "file.sample",
      title: "Load sample robot",
      category: "File",
      keywords: "demo example",
      run: () => confirmDiscard() && loadSampleRobot(),
    },
    {
      id: "file.samples",
      title: "Browse sample robots…",
      category: "File",
      shortcut: "Mod+Shift+O",
      keywords: "template example download open source turtlebot panda unitree",
      run: () => app().openDialog("samples", { tab: "robot" }),
    },
    {
      id: "env.browse",
      title: "Choose environment…",
      category: "Simulate",
      keywords: "world scene terrain stairs ramp warehouse gazebo fuel",
      run: () => app().openDialog("samples", { tab: "environment" }),
    },
    ...PROCEDURAL_ENVS.map((e): Command => ({
      id: `env.use.${e.id}`,
      title: `Environment: ${e.name}`,
      category: "Simulate",
      checked: () => app().environment.id === e.id,
      run: () => applyBuiltinEnvironment(e.id),
    })),

    // ---------------------------------------------------------------- edit
    {
      id: "edit.undo",
      title: "Undo",
      category: "Edit",
      shortcut: "Mod+Z",
      enabled: () => app().past.length > 0,
      run: () => app().undo(),
    },
    {
      id: "edit.redo",
      title: "Redo",
      category: "Edit",
      shortcut: "Mod+Y, Mod+Shift+Z",
      enabled: () => app().future.length > 0,
      run: () => app().redo(),
    },
    {
      id: "edit.delete",
      title: "Delete selected",
      category: "Edit",
      shortcut: "Delete",
      enabled: () => !!app().selection && editMode(),
      run: () => deleteSelection(false),
    },
    {
      id: "edit.deleteKeepChildren",
      title: "Delete link, keep children",
      category: "Edit",
      shortcut: "Shift+Delete",
      enabled: () => hasLink() && editMode(),
      run: () => deleteSelection(true),
    },
    {
      id: "edit.duplicate",
      title: "Duplicate link",
      category: "Edit",
      shortcut: "Mod+D",
      enabled: () => hasLink() && editMode(),
      run: () => {
        let id = "";
        app().edit((m) => (id = duplicateLinkIn(m, selectedLink()!.id)?.id ?? ""));
        if (id) app().select({ kind: "link", linkId: id });
      },
    },
    {
      id: "edit.deselect",
      title: "Clear selection",
      category: "Edit",
      shortcut: "Escape",
      run: () => app().select(null),
    },
    {
      id: "edit.selectParent",
      title: "Select parent link",
      category: "Edit",
      shortcut: "ArrowUp",
      palette: false,
      enabled: () => !!selectedLink()?.parentId,
      run: () => app().select({ kind: "link", linkId: selectedLink()!.parentId! }),
    },

    // ---------------------------------------------------------------- tools
    {
      id: "tool.select",
      title: "Select tool",
      category: "Tools",
      shortcut: "Q",
      checked: () => app().tool === "select",
      run: () => app().set("tool", "select"),
    },
    {
      id: "tool.move",
      title: "Move tool",
      category: "Tools",
      shortcut: "W",
      checked: () => app().tool === "translate",
      run: () => app().set("tool", "translate"),
    },
    {
      id: "tool.rotate",
      title: "Rotate tool",
      category: "Tools",
      shortcut: "E",
      checked: () => app().tool === "rotate",
      run: () => app().set("tool", "rotate"),
    },
    {
      id: "tool.mate",
      title: "Mate faces",
      category: "Tools",
      shortcut: "F",
      keywords: "snap align attach face",
      checked: () => app().tool === "mate",
      run: () => {
        app().set("tool", "mate");
        app().toast("Click a face on the part to move, then the face it should sit against.");
      },
    },
    {
      id: "tool.targetLink",
      title: "Gizmo moves the link (with children)",
      category: "Tools",
      checked: () => app().gizmoTarget === "link",
      run: () => app().set("gizmoTarget", "link"),
    },
    {
      id: "tool.targetPivot",
      title: "Gizmo moves the link origin only (pivot)",
      category: "Tools",
      keywords: "origin frame joint location",
      checked: () => app().gizmoTarget === "pivot",
      run: () => app().set("gizmoTarget", "pivot"),
    },
    {
      id: "tool.targetMesh",
      title: "Gizmo moves the mesh inside its link",
      category: "Tools",
      checked: () => app().gizmoTarget === "mesh",
      run: () => app().set("gizmoTarget", "mesh"),
    },
    {
      id: "tool.cycleTarget",
      title: "Cycle gizmo target (link, pivot, mesh)",
      category: "Tools",
      shortcut: "T",
      run: () => {
        const order = ["link", "pivot", "mesh"] as const;
        const next = order[(order.indexOf(app().gizmoTarget) + 1) % 3];
        app().set("gizmoTarget", next);
        app().toast(`Gizmo target: ${next}`);
      },
    },
    {
      id: "tool.space",
      title: "Toggle world / local gizmo space",
      category: "Tools",
      shortcut: "X",
      run: () => app().set("gizmoSpace", app().gizmoSpace === "world" ? "local" : "world"),
    },
    {
      id: "tool.snap",
      title: "Toggle snapping",
      category: "Tools",
      shortcut: "S",
      checked: () => app().snap,
      run: () => app().set("snap", !app().snap),
    },

    // ---------------------------------------------------------------- link
    {
      id: "link.add",
      title: "Add empty link",
      category: "Link",
      shortcut: "Shift+A",
      enabled: editMode,
      run: () => {
        const parent = selectedLink();
        let id = "";
        app().edit((m) => {
          const L = newLink(
            uniqueName(
              "link",
              m.links.map((l) => l.name),
            ),
          );
          L.parentId = parent?.id ?? null;
          L.inertial.auto = false;
          L.inertial.mode = "mass";
          id = L.id;
          m.links.push(L);
        });
        app().select({ kind: "link", linkId: id });
      },
    },
    ...(["box", "cylinder", "sphere"] as const).map((kind): Command => ({
      id: `link.addPrimitive.${kind}`,
      title: `Add ${kind} link`,
      category: "Link",
      enabled: editMode,
      run: () => {
        const parent = selectedLink();
        let id = "";
        app().edit((m) => {
          const L = newLink(
            uniqueName(
              kind,
              m.links.map((l) => l.name),
            ),
          );
          L.parentId = parent?.id ?? null;
          const geometry =
            kind === "box"
              ? { type: "box" as const, size: [0.1, 0.1, 0.1] as [number, number, number] }
              : kind === "cylinder"
                ? { type: "cylinder" as const, radius: 0.05, length: 0.1 }
                : { type: "sphere" as const, radius: 0.05 };
          L.visuals.push({
            id: uid("vis"),
            name: "",
            origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
            geometry,
            materialId: m.materials[0]?.id ?? null,
          });
          L.collisions.push({
            id: uid("col"),
            name: "",
            origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
            geometry: structuredClone(geometry),
          });
          m.links.push(L);
          if (parent) setLinkWorldIn(m, L.id, linkWorld(m, parent.id));
          recomputeInertialIn(m, L.id);
          id = L.id;
        });
        app().select({ kind: "link", linkId: id });
      },
    })),
    ...(["box", "cylinder", "sphere", "hull", "simplified", "mesh"] as CollisionKind[]).map(
      (kind): Command => ({
        id: `link.collision.${kind}`,
        title: `Collision: ${{ box: "fit box", cylinder: "fit cylinder", sphere: "fit sphere", hull: "convex hull", simplified: "simplified mesh", mesh: "same as visual" }[kind]}`,
        category: "Link",
        keywords: "collider physics",
        enabled: () => hasLink() && editMode(),
        run: () => app().edit((m) => addCollisionIn(m, selectedLink()!.id, kind, true)),
      }),
    ),
    {
      id: "link.recomputeInertia",
      title: "Recompute inertia of all links",
      category: "Link",
      keywords: "mass inertial",
      run: () => app().edit((m) => m.links.forEach((l) => recomputeInertialIn(m, l.id))),
    },
    {
      id: "link.pivotToCentre",
      title: "Move link origin to geometry centre",
      category: "Link",
      enabled: () => hasLink() && editMode(),
      run: () => movePivot("centre"),
    },
    {
      id: "link.pivotToCom",
      title: "Move link origin to centre of mass",
      category: "Link",
      enabled: () => hasLink() && editMode(),
      run: () => movePivot("com"),
    },
    {
      id: "link.pivotToParent",
      title: "Align link origin with parent frame",
      category: "Link",
      enabled: () => !!selectedLink()?.parentId && editMode(),
      run: () => movePivot("parent"),
    },
    {
      id: "link.resetRotation",
      title: "Reset link origin rotation",
      category: "Link",
      enabled: () => hasLink() && editMode(),
      run: () => movePivot("unrotate"),
    },
    {
      id: "link.toggleHidden",
      title: "Hide / show link",
      category: "Link",
      shortcut: "H",
      enabled: hasLink,
      run: () =>
        app().edit((m) => {
          const L = linkById(m, selectedLink()!.id)!;
          L.hidden = !L.hidden;
        }),
    },
    {
      id: "link.purgeParts",
      title: "Remove unused parts",
      category: "Link",
      run: () => app().edit((m) => app().toast(`Removed ${purgeUnusedMeshesIn(m)} unused part(s)`)),
    },

    // ---------------------------------------------------------------- view
    {
      id: "view.frameAll",
      title: "Frame all",
      category: "View",
      shortcut: "Home",
      run: () => viewportRef.get()?.frameAll(),
    },
    {
      id: "view.frameSelection",
      title: "Frame selection",
      category: "View",
      shortcut: ".",
      run: () => viewportRef.get()?.frameSelection(),
    },
    ...(
      [
        ["iso", "1"],
        ["top", "7"],
        ["front", "2"],
        ["right", "3"],
        ["back", "4"],
        ["left", "5"],
        ["bottom", "6"],
      ] as const
    ).map(([v, key]): Command => ({
      id: `view.${v}`,
      title: `View: ${v}`,
      category: "View",
      shortcut: key,
      run: () => viewportRef.get()?.setView(v),
    })),
    ...(
      [
        ["shaded", "Shaded"],
        ["shaded-wire", "Shaded with edges"],
        ["wireframe", "Wireframe"],
        ["xray", "X-ray"],
      ] as const
    ).map(([s, label]): Command => ({
      id: `view.shading.${s}`,
      title: `Shading: ${label}`,
      category: "View",
      checked: () => app().view.shading === s,
      run: () => app().setView({ shading: s }),
    })),
    {
      id: "view.cycleShading",
      title: "Cycle shading",
      category: "View",
      shortcut: "Z",
      palette: false,
      run: () => cycleShading(),
    },
    ...(
      [
        ["lit", "Lit (PBR) shading", "U"],
        ["lighting", "Studio lighting", "L"],
        ["shadows", "Shadows", ""],
        ["envBackground", "HDRI background", ""],
        ["environment", "Reflections", ""],
        ["grid", "Grid", "G"],
        ["worldOrigin", "World origin", ""],
        ["linkFrames", "Link frames", "O"],
        ["jointAxes", "Joint axes", "J"],
        ["com", "Centres of mass", ""],
        ["inertia", "Inertia boxes", ""],
        ["collisions", "Collision geometry", "C"],
        ["visuals", "Visual geometry", ""],
        ["labels", "Link labels", ""],
      ] as const
    ).map(([k, label, key]): Command => ({
      id: `view.toggle.${k}`,
      title: `Show ${label.toLowerCase()}`,
      category: "View",
      shortcut: key || undefined,
      checked: () => app().view[k],
      run: () => app().setView({ [k]: !app().view[k] }),
    })),
    {
      id: "view.grid.adaptive",
      title: "Grid: adaptive spacing",
      category: "View",
      checked: () => app().view.gridMode === "adaptive",
      run: () => app().setView({ gridMode: "adaptive", grid: true }),
    },
    ...[0.001, 0.01, 0.05, 0.1, 0.5, 1].map((s): Command => ({
      id: `view.grid.fixed.${s}`,
      title: `Grid: fixed ${s < 0.01 ? `${s * 1000} mm` : s < 1 ? `${s * 100} cm` : `${s} m`}`,
      category: "View",
      checked: () => app().view.gridMode === "fixed" && app().view.gridSize === s,
      run: () => app().setView({ gridMode: "fixed", gridSize: s, grid: true }),
    })),
    ...(
      [
        ["studio", "Studio"],
        ["neutral", "Neutral grey"],
      ] as const
    ).map(([k, label]): Command => ({
      id: `view.env.${k}`,
      title: `Reflections: ${label}`,
      category: "View",
      checked: () => app().view.envMap === k,
      run: () => app().setView({ envMap: k, environment: true }),
    })),
    {
      id: "view.env.browse",
      title: "Reflections: HDRI from ambientCG…",
      category: "View",
      keywords: "environment lighting sky hdr",
      run: () => app().openDialog("materials", { tab: "hdri" }),
    },
    {
      id: "app.materials",
      title: "Material library…",
      category: "Robot",
      shortcut: "M",
      keywords: "pbr texture ambientcg metal plastic finish paint",
      run: () => app().openDialog("materials"),
    },
    {
      id: "view.panelLeft",
      title: "Toggle robot panel",
      category: "View",
      shortcut: "Mod+B",
      run: () => togglePanel("left"),
    },
    {
      id: "view.panelRight",
      title: "Toggle inspector",
      category: "View",
      shortcut: "Mod+Alt+B",
      run: () => togglePanel("right"),
    },
    {
      id: "view.panelBottom",
      title: "Toggle problems / joints panel",
      category: "View",
      shortcut: "Mod+J",
      run: () => togglePanel("bottom"),
    },
    {
      id: "view.cycleTheme",
      title: "Next theme",
      category: "View",
      keywords: "dark light appearance color",
      run: () => {
        const s = useSettings.getState();
        const i = THEMES.findIndex((t) => t.id === s.theme);
        s.update({ theme: THEMES[(i + 1) % THEMES.length].id });
      },
    },
    ...THEMES.map((t): Command => ({
      id: `view.theme.${t.id}`,
      title: `Theme: ${t.name}`,
      category: "View",
      checked: () => useSettings.getState().theme === t.id,
      run: () => useSettings.getState().update({ theme: t.id }),
    })),
    {
      id: "view.theme.system",
      title: "Theme: follow system",
      category: "View",
      run: () => useSettings.getState().update({ theme: "system" }),
    },

    // ---------------------------------------------------------------- simulate
    {
      id: "sim.edit",
      title: "Edit mode",
      category: "Simulate",
      shortcut: "F5",
      checked: () => app().mode === "edit",
      run: () => setMode("edit"),
    },
    {
      id: "sim.pose",
      title: "Pose mode (joint sliders)",
      category: "Simulate",
      shortcut: "F6",
      checked: () => app().mode === "pose",
      run: () => setMode("pose"),
    },
    {
      id: "sim.physics",
      title: "Physics simulation",
      category: "Simulate",
      shortcut: "F7",
      checked: () => app().mode === "physics",
      run: () => setMode("physics"),
    },
    {
      id: "sim.playPause",
      title: "Play / pause",
      category: "Simulate",
      shortcut: "Space",
      run: () => (app().simRunning ? pause() : play()),
    },
    {
      id: "sim.reset",
      title: "Reset simulation",
      category: "Simulate",
      shortcut: "Shift+R",
      run: () => reset(),
    },

    // ---------------------------------------------------------------- app
    {
      id: "app.palette",
      title: "Command palette",
      category: "Help",
      shortcut: "Mod+K, Mod+Shift+P",
      palette: false,
      // The same shortcut opens and closes it.
      run: () =>
        app().dialog?.id === "palette" ? app().closeDialog() : app().openDialog("palette"),
    },
    {
      id: "app.settings",
      title: "Settings…",
      category: "Help",
      shortcut: "Mod+,",
      keywords: "preferences plugins mcp theme",
      run: () => app().openDialog("settings"),
    },
    {
      id: "app.plugins",
      title: "Manage plugins…",
      category: "Help",
      run: () => app().openDialog("settings", { tab: "plugins" }),
    },
    {
      id: "app.mcp",
      title: "AI assistant connection (MCP)…",
      category: "Help",
      keywords: "claude model context protocol agent",
      run: () => app().openDialog("settings", { tab: "mcp" }),
    },
    {
      id: "app.shortcuts",
      title: "Keyboard shortcuts",
      category: "Help",
      shortcut: "?",
      run: () => app().openDialog("shortcuts"),
    },
    {
      id: "app.about",
      title: "About URDF Forge",
      category: "Help",
      run: () => app().openDialog("settings", { tab: "about" }),
    },
  ];
  cmds.forEach(registerCommand);
}

function confirmDiscard(): boolean {
  return !app().dirty || window.confirm("Discard unsaved changes?");
}

function deleteSelection(keepChildren: boolean) {
  const s = app().selection;
  if (!s) return;
  if (s.kind === "link") app().edit((m) => deleteLinkIn(m, s.linkId, keepChildren));
  else if (s.kind === "visual" || s.kind === "collision")
    app().edit((m) => {
      const L = linkById(m, s.linkId);
      if (!L) return;
      if (s.kind === "visual") L.visuals = L.visuals.filter((c) => c.id !== s.compId);
      else L.collisions = L.collisions.filter((c) => c.id !== s.compId);
      recomputeInertialIn(m, L.id);
    });
  else if (s.kind === "mesh")
    app().edit((m) => {
      const used = m.links.some((l) =>
        [...l.visuals, ...l.collisions].some(
          (c) => c.geometry.type === "mesh" && c.geometry.meshId === s.meshId,
        ),
      );
      if (used) throw new Error("That part is used by a link. Delete the link first.");
      m.meshes = m.meshes.filter((x) => x.id !== s.meshId);
    });
  app().select(null);
}

function movePivot(where: "centre" | "com" | "parent" | "unrotate") {
  const L = selectedLink();
  if (!L) return;
  app().edit((m) => {
    const w = linkWorld(m, L.id);
    const target = w.clone();
    if (where === "parent" && L.parentId) {
      target.copy(linkWorld(m, L.parentId));
    } else if (where === "unrotate") {
      const p = w.elements.slice(12, 15) as [number, number, number];
      target.makeTranslation(...p);
    } else {
      const local = where === "com" ? new Vector3(...L.inertial.com) : geometryCentre(m, L.id);
      target.multiply(new Matrix4().makeTranslation(local.x, local.y, local.z));
    }
    movePivotIn(m, L.id, target);
  });
}

/** Centre of the link's visual geometry bounding box, in the link frame. */
function geometryCentre(m: RobotModel, linkId: string): Vector3 {
  const L = linkById(m, linkId)!;
  const box = new Box3();
  for (const v of L.visuals) {
    const g = v.geometry;
    const tf = poseToMatrix(v.origin, g.type === "mesh" ? g.scale : undefined);
    if (g.type === "mesh") {
      const a = m.meshes.find((x) => x.id === g.meshId);
      if (a)
        box.union(
          new Box3(new Vector3(...a.bbox.min), new Vector3(...a.bbox.max)).applyMatrix4(tf),
        );
    } else box.expandByPoint(new Vector3().applyMatrix4(tf));
  }
  return box.isEmpty() ? new Vector3(...L.inertial.com) : box.getCenter(new Vector3());
}

function cycleShading() {
  const order = ["shaded", "shaded-wire", "wireframe", "xray"] as const;
  const i = order.indexOf(app().view.shading);
  app().setView({ shading: order[(i + 1) % order.length] });
}

/** Below this width the side panels are drawers over the viewport (see app.css). */
export const isNarrow = () =>
  typeof matchMedia !== "undefined" && matchMedia("(max-width: 1000px)").matches;

function togglePanel(which: "left" | "right" | "bottom") {
  const p = app().panels;
  const open = !p[which];
  const next = { ...p, [which]: open };
  // Only one drawer at a time on narrow screens.
  if (open && isNarrow() && which !== "bottom") next[which === "left" ? "right" : "left"] = false;
  app().set("panels", next);
}
