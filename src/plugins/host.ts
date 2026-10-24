/**
 * Loads plugins from the app data folder (`<appData>/plugins/<id>/manifest.json + main.js`).
 * Plugins run with the same rights as the app, so none runs until the user enables it.
 */
import { useSyncExternalStore } from "react";
import { registerCommand, runCommand } from "@/commands/registry";
import { app, useApp } from "@/store/app";
import { meshStore } from "@/store/meshStore";
import { useSettings } from "@/store/settings";
import { listPluginFolders, isTauri } from "@/platform";
import { createMeshAsset } from "@/app/actions";
import { registerMcpTool } from "@/mcp/tools";
import {
  PLUGIN_API_VERSION,
  type Disposable,
  type ForgePlugin,
  type ForgePluginApi,
  type PluginExporter,
  type PluginImporter,
  type PluginManifest,
} from "./api";

export interface PluginRecord {
  manifest: PluginManifest;
  folder: string;
  state: "disabled" | "active" | "error";
  error?: string;
  disposables: Disposable[];
}

const records = new Map<string, PluginRecord>();
const importers: (PluginImporter & { owner: string })[] = [];
const exporters: (PluginExporter & { owner: string })[] = [];
const listeners = new Set<() => void>();
let version = 0;
const changed = () => {
  version++;
  listeners.forEach((l) => l());
};

export const pluginImporters = () => importers;
export const pluginExporters = () => exporters;

export function usePlugins(): PluginRecord[] {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  return [...records.values()];
}

function makeApi(manifest: PluginManifest, bag: Disposable[]): ForgePluginApi {
  const track = (d: Disposable) => (bag.push(d), d);
  const owner = manifest.id;
  return {
    apiVersion: PLUGIN_API_VERSION,
    manifest,
    commands: {
      register: (c) =>
        track({
          dispose: registerCommand({
            ...c,
            id: `${owner}.${c.id}`,
            category: manifest.name,
            source: owner,
          }),
        }),
      run: (id, args) => runCommand(id, args),
    },
    model: {
      get: () => app().model,
      edit: (fn) => app().edit(fn),
      selection: () => app().selection,
      select: (s) => app().select(s),
      onChange: (fn) =>
        track({ dispose: useApp.subscribe((s, p) => s.model !== p.model && fn(s.model)) }),
    },
    meshes: {
      get: (id) => meshStore.get(id),
      add: (name, positions, color = null) => {
        let asset!: ReturnType<typeof createMeshAsset>;
        app().edit((m) => (asset = createMeshAsset(m, name, positions, "plugin", owner, color)));
        return asset;
      },
    },
    importers: {
      register: (i) => {
        const rec = { ...i, owner };
        importers.push(rec);
        return track({ dispose: () => importers.splice(importers.indexOf(rec), 1) });
      },
    },
    exporters: {
      register: (e) => {
        const rec = { ...e, owner };
        exporters.push(rec);
        return track({ dispose: () => exporters.splice(exporters.indexOf(rec), 1) });
      },
    },
    mcp: {
      registerTool: (t) =>
        track({
          dispose: registerMcpTool({
            ...t,
            name: `${owner.replace(/[^a-z0-9_]/gi, "_")}__${t.name}`,
          }),
        }),
    },
    ui: { toast: (text, tone) => app().toast(text, tone) },
  };
}

function parseManifest(text: string, folder: string): PluginManifest {
  const m = JSON.parse(text) as PluginManifest;
  if (!m.id || !/^[a-z0-9][a-z0-9._-]*$/i.test(m.id))
    throw new Error(`${folder}: manifest needs a valid "id".`);
  if (!m.name) m.name = m.id;
  if (m.apiVersion !== PLUGIN_API_VERSION)
    throw new Error(
      `${m.id} targets plugin API ${m.apiVersion}; this app provides ${PLUGIN_API_VERSION}.`,
    );
  return m;
}

async function activate(rec: PluginRecord, source: string) {
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    const mod = (await import(/* @vite-ignore */ url)) as {
      default?: ForgePlugin;
      activate?: ForgePlugin["activate"];
    };
    const plugin: ForgePlugin | undefined =
      mod.default ?? (mod.activate ? { activate: mod.activate } : undefined);
    if (!plugin?.activate) throw new Error("The module exports no activate(api) function.");
    const out = await plugin.activate(makeApi(rec.manifest, rec.disposables));
    if (out && typeof out.dispose === "function") rec.disposables.push(out);
    rec.state = "active";
    rec.error = undefined;
  } catch (e) {
    rec.disposables.splice(0).forEach((d) => d.dispose());
    rec.state = "error";
    rec.error = e instanceof Error ? e.message : String(e);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function deactivate(rec: PluginRecord) {
  rec.disposables.splice(0).forEach((d) => {
    try {
      d.dispose();
    } catch (e) {
      console.error(e);
    }
  });
  rec.state = "disabled";
}

/** Scan the plugins folder and activate the plugins the user has enabled. */
export async function loadPlugins(): Promise<void> {
  if (!isTauri()) return;
  for (const r of records.values()) deactivate(r);
  records.clear();
  const enabled = new Set(useSettings.getState().enabledPlugins);
  for (const f of await listPluginFolders()) {
    let manifest: PluginManifest;
    try {
      manifest = parseManifest(f.manifest, f.folder);
    } catch (e) {
      const id = f.folder.split(/[\\/]/).pop() ?? f.folder;
      records.set(id, {
        manifest: { id, name: id, version: "?", apiVersion: 0 },
        folder: f.folder,
        state: "error",
        error: e instanceof Error ? e.message : String(e),
        disposables: [],
      });
      continue;
    }
    const rec: PluginRecord = { manifest, folder: f.folder, state: "disabled", disposables: [] };
    records.set(manifest.id, rec);
    if (enabled.has(manifest.id)) await activate(rec, f.main);
  }
  changed();
}

export async function setPluginEnabled(id: string, on: boolean): Promise<void> {
  const s = useSettings.getState();
  s.update({
    enabledPlugins: on
      ? [...new Set([...s.enabledPlugins, id])]
      : s.enabledPlugins.filter((x) => x !== id),
  });
  await loadPlugins();
}
