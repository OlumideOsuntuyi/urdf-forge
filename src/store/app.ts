/** Application state. The robot model is immutable: every edit produces a new model object. */
import { create } from "zustand";
import { clone, newModel, type RobotModel } from "@/core/model";
import { emptyEnvironment, type Environment } from "@/core/env/types";

export type Selection =
  | { kind: "link"; linkId: string }
  | { kind: "visual" | "collision"; linkId: string; compId: string }
  | { kind: "mesh"; meshId: string }
  | { kind: "material"; materialId: string };

export type Tool = "select" | "translate" | "rotate" | "mate";
export type GizmoTarget = "link" | "mesh" | "pivot";
export type Mode = "edit" | "pose" | "physics";
export type Shading = "shaded" | "wireframe" | "shaded-wire" | "xray";

export interface ViewOptions {
  shading: Shading;
  lighting: boolean;
  shadows: boolean;
  environment: boolean;
  grid: boolean;
  worldOrigin: boolean;
  linkFrames: boolean;
  jointAxes: boolean;
  com: boolean;
  inertia: boolean;
  collisions: boolean;
  visuals: boolean;
  labels: boolean;
  frameScale: number;
  /** Lit: physically based lighting. Unlit: flat albedo colours and textures. */
  lit: boolean;
  /** Adaptive: grid spacing follows the zoom level. Fixed: `gridSize` metres. */
  gridMode: "adaptive" | "fixed";
  gridSize: number;
  /** Reflections and image-based light: "studio", "neutral", or "hdri:<texture key>". */
  envMap: string;
  envIntensity: number;
  /** Show the HDRI as the background. */
  envBackground: boolean;
}

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "success" | "warning" | "error";
}

interface State {
  model: RobotModel;
  /** Bumped whenever mesh geometry is added or removed (geometry lives in meshStore). */
  meshVersion: number;
  past: RobotModel[];
  future: RobotModel[];
  dirty: boolean;
  projectPath: string | null;
  selection: Selection | null;
  tool: Tool;
  gizmoTarget: GizmoTarget;
  gizmoSpace: "world" | "local";
  snap: boolean;
  mode: Mode;
  /** Joint positions during pose/physics preview, by link id. */
  jointValues: Record<string, number>;
  simRunning: boolean;
  /** Scenery for preview, physics and the exported Gazebo world. Not part of undo. */
  environment: Environment;
  /** Simulation controller: "auto" (best match), "none", or a behaviour id (drive, gait, arm). */
  behaviorChoice: string;
  /** The controller running in pose / physics mode. */
  simBehavior: { id: string; name: string; teleop: boolean } | null;
  view: ViewOptions;
  toasts: Toast[];
  panels: { left: boolean; right: boolean; bottom: boolean };
  dialog: null | { id: string; props?: unknown };
}

interface Actions {
  /** Apply an edit to a copy of the model and record it for undo. */
  edit(fn: (m: RobotModel) => void, opts?: { coalesce?: string }): void;
  /** Replace the model without recording history (live drags); call `commit` at the end. */
  preview(fn: (m: RobotModel) => void): void;
  beginGesture(): void;
  endGesture(): void;
  setModel(m: RobotModel, opts?: { path?: string | null; dirty?: boolean }): void;
  undo(): void;
  redo(): void;
  select(s: Selection | null): void;
  set<K extends keyof State>(k: K, v: State[K]): void;
  setView(v: Partial<ViewOptions>): void;
  toast(text: string, tone?: Toast["tone"]): void;
  dismissToast(id: number): void;
  openDialog(id: string, props?: unknown): void;
  closeDialog(): void;
  bumpMeshes(): void;
}

const HISTORY = 200;
let gestureBase: RobotModel | null = null;
let lastCoalesce: { key: string; at: number } | null = null;
let toastId = 0;

export const useApp = create<State & Actions>()((set, get) => ({
  model: newModel(),
  meshVersion: 0,
  past: [],
  future: [],
  dirty: false,
  projectPath: null,
  selection: null,
  tool: "select",
  gizmoTarget: "link",
  gizmoSpace: "world",
  snap: false,
  mode: "edit",
  jointValues: {},
  simRunning: false,
  environment: emptyEnvironment(),
  behaviorChoice: "auto",
  simBehavior: null,
  view: {
    shading: "shaded",
    lighting: true,
    shadows: true,
    environment: true,
    grid: true,
    worldOrigin: true,
    linkFrames: false,
    jointAxes: true,
    com: false,
    inertia: false,
    collisions: false,
    visuals: true,
    labels: false,
    frameScale: 1,
    lit: true,
    gridMode: "adaptive",
    gridSize: 0.1,
    envMap: "studio",
    envIntensity: 1,
    envBackground: false,
  },
  toasts: [],
  panels: { left: true, right: true, bottom: false },
  dialog: null,

  edit(fn, opts) {
    const before = get().model;
    const next = clone(before);
    fn(next);
    const now = Date.now();
    const merge =
      opts?.coalesce &&
      lastCoalesce?.key === opts.coalesce &&
      now - lastCoalesce.at < 800 &&
      get().past.length > 0;
    lastCoalesce = opts?.coalesce ? { key: opts.coalesce, at: now } : null;
    set((s) => ({
      model: next,
      past: merge ? s.past : [...s.past.slice(-HISTORY + 1), before],
      future: [],
      dirty: true,
    }));
  },
  preview(fn) {
    const next = clone(get().model);
    fn(next);
    set({ model: next, dirty: true });
  },
  beginGesture() {
    gestureBase = get().model;
  },
  endGesture() {
    if (!gestureBase) return;
    const base = gestureBase;
    gestureBase = null;
    if (base === get().model) return;
    set((s) => ({ past: [...s.past.slice(-HISTORY + 1), base], future: [] }));
  },
  setModel(m, opts) {
    set({
      model: m,
      past: [],
      future: [],
      selection: null,
      jointValues: {},
      dirty: opts?.dirty ?? false,
      projectPath: opts?.path ?? null,
    });
  },
  undo() {
    const { past, model, future } = get();
    if (!past.length) return get().toast("Nothing to undo");
    set({
      model: past[past.length - 1],
      past: past.slice(0, -1),
      future: [model, ...future],
      dirty: true,
    });
  },
  redo() {
    const { past, model, future } = get();
    if (!future.length) return get().toast("Nothing to redo");
    set({ model: future[0], future: future.slice(1), past: [...past, model], dirty: true });
  },
  select(selection) {
    set({ selection });
  },
  set(k, v) {
    set({ [k]: v } as Partial<State>);
  },
  setView(v) {
    set((s) => ({ view: { ...s.view, ...v } }));
  },
  toast(text, tone = "info") {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone }] }));
    setTimeout(() => get().dismissToast(id), tone === "error" ? 7000 : 3500);
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  openDialog(id, props) {
    set({ dialog: { id, props } });
  },
  closeDialog() {
    set({ dialog: null });
  },
  bumpMeshes() {
    set((s) => ({ meshVersion: s.meshVersion + 1 }));
  },
}));

export const app = () => useApp.getState();

export function selectedLinkId(s: Selection | null): string | null {
  return s && "linkId" in s ? s.linkId : null;
}
