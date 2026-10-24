/**
 * The plugin API, version 1. A plugin is an ES module whose default export (or named export)
 * has `activate(api)`. See docs/plugins.md.
 */
import type { MeshAsset, RobotModel, Rgba } from "@/core/model";
import type { Selection } from "@/store/app";
import type { ImportPart } from "@/app/actions";

export const PLUGIN_API_VERSION = 1;

export interface Disposable {
  dispose(): void;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  main?: string;
  apiVersion: number;
}

export interface PluginCommand {
  id: string;
  title: string;
  shortcut?: string;
  keywords?: string;
  run(args?: unknown): unknown | Promise<unknown>;
}

export interface PluginImporter {
  /** Lower-case extensions without the dot. */
  extensions: string[];
  label: string;
  /** Return triangle soups in metres. */
  import(bytes: Uint8Array, fileName: string): Promise<ImportPart[]>;
}

export interface PluginExporter {
  id: string;
  label: string;
  extension: string;
  export(
    model: RobotModel,
    meshes: (id: string) => Float32Array | undefined,
  ): Promise<Uint8Array | string>;
}

export interface McpToolResult {
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
  isError?: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  inputSchema: Record<string, unknown>;
  handler(
    args: Record<string, unknown>,
  ): Promise<McpToolResult | string | object> | McpToolResult | string | object;
}

export interface ForgePluginApi {
  apiVersion: number;
  manifest: PluginManifest;
  commands: {
    register(c: PluginCommand): Disposable;
    run(id: string, args?: unknown): Promise<unknown>;
  };
  model: {
    get(): RobotModel;
    /** Apply an undoable edit to a copy of the model. */
    edit(fn: (draft: RobotModel) => void): void;
    selection(): Selection | null;
    select(s: Selection | null): void;
    onChange(fn: (m: RobotModel) => void): Disposable;
  };
  meshes: {
    get(id: string): Float32Array | undefined;
    /** Add geometry (metres) to the parts library. */
    add(name: string, positions: Float32Array, color?: Rgba | null): MeshAsset;
  };
  importers: { register(i: PluginImporter): Disposable };
  exporters: { register(e: PluginExporter): Disposable };
  mcp: { registerTool(t: McpTool): Disposable };
  ui: { toast(text: string, tone?: "info" | "success" | "warning" | "error"): void };
}

export interface ForgePlugin {
  activate(api: ForgePluginApi): void | Disposable | Promise<void | Disposable>;
}
