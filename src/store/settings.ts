/** User preferences, persisted to the webview's local storage. */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ThemeInfo {
  id: string;
  name: string;
  dark: boolean;
}

export const THEMES: ThemeInfo[] = [
  { id: "forge-dark", name: "Forge Dark", dark: true },
  { id: "forge-light", name: "Forge Light", dark: false },
  { id: "midnight", name: "Midnight", dark: true },
  { id: "nord", name: "Nord", dark: true },
  { id: "solarized-light", name: "Solarized Light", dark: false },
  { id: "high-contrast", name: "High Contrast", dark: true },
];

export interface Settings {
  /** A theme id, or "system" to follow the OS light/dark preference. */
  theme: string;
  density: "compact" | "comfortable" | "touch";
  mcpEnabled: boolean;
  mcpPort: number;
  /** Require `Authorization: Bearer <mcpToken>` on every MCP request. */
  mcpRequireToken: boolean;
  mcpToken: string;
  enabledPlugins: string[];
  trustedPlugins: string[];
  recentProjects: string[];
  recentCommands: string[];
  cadQuality: "draft" | "normal" | "fine";
  showWelcome: boolean;
}

interface Actions {
  update(p: Partial<Settings>): void;
  pushRecentCommand(id: string): void;
  pushRecentProject(path: string): void;
}

export const useSettings = create<Settings & Actions>()(
  persist(
    (set) => ({
      theme: "system",
      density: "compact",
      // On by default: loopback only, rejects non-local origins, every edit is undoable.
      mcpEnabled: true,
      mcpPort: 8765,
      mcpRequireToken: false,
      mcpToken: "",
      enabledPlugins: [],
      trustedPlugins: [],
      recentProjects: [],
      recentCommands: [],
      cadQuality: "normal",
      showWelcome: true,
      update: (p) => set(p),
      pushRecentCommand: (id) =>
        set((s) => ({
          recentCommands: [id, ...s.recentCommands.filter((c) => c !== id)].slice(0, 8),
        })),
      pushRecentProject: (path) =>
        set((s) => ({
          recentProjects: [path, ...s.recentProjects.filter((p) => p !== path)].slice(0, 10),
        })),
    }),
    {
      name: "urdf-forge.settings",
      version: 3,
      // v2: the MCP server became on by default. v3: optional MCP access token.
      migrate: (state, version) => {
        const s = state as Partial<Settings>;
        if (version < 2) s.mcpEnabled = true;
        if (version < 3) {
          s.mcpRequireToken = false;
          s.mcpToken = "";
        }
        return s as Settings & Actions;
      },
    },
  ),
);

export function resolveTheme(theme: string): ThemeInfo {
  if (theme === "system") {
    const dark =
      typeof matchMedia === "undefined" || matchMedia("(prefers-color-scheme: dark)").matches;
    return THEMES.find((t) => t.id === (dark ? "forge-dark" : "forge-light"))!;
  }
  return THEMES.find((t) => t.id === theme) ?? THEMES[0];
}

/** A new random MCP access token (32 hex characters). */
export function newMcpToken(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
