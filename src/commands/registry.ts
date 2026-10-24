/**
 * Every user action is a command. Menus, the toolbar, keyboard shortcuts, the command palette,
 * plugins and MCP clients all run the same commands by id.
 */
import { useSyncExternalStore } from "react";

export interface Command {
  id: string;
  title: string;
  category: string;
  /** e.g. "Mod+S", "Shift+D", "W". Mod is Ctrl on Windows/Linux and Cmd on macOS. */
  shortcut?: string;
  /** Extra words the palette matches on. */
  keywords?: string;
  /** Hidden from the palette when false. */
  palette?: boolean;
  enabled?: () => boolean;
  checked?: () => boolean;
  run: (args?: unknown) => unknown | Promise<unknown>;
  /** Owner, for commands contributed by plugins. */
  source?: string;
}

const commands = new Map<string, Command>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version++;
  listeners.forEach((l) => l());
}

export function registerCommand(c: Command): () => void {
  commands.set(c.id, c);
  changed();
  return () => {
    if (commands.get(c.id) === c) {
      commands.delete(c.id);
      changed();
    }
  };
}

export function getCommand(id: string): Command | undefined {
  return commands.get(id);
}

export function allCommands(): Command[] {
  return [...commands.values()];
}

export function useCommands(): Command[] {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  return allCommands();
}

export type CommandRunner = (id: string, args?: unknown) => Promise<unknown>;

let errorHandler: (e: unknown, c: Command) => void = (e) => console.error(e);
let afterRun: (c: Command) => void = () => {};
let modalOpen: () => boolean = () => false;

export function configureCommands(opts: {
  onError?: typeof errorHandler;
  afterRun?: typeof afterRun;
  modalOpen?: () => boolean;
}) {
  if (opts.onError) errorHandler = opts.onError;
  if (opts.afterRun) afterRun = opts.afterRun;
  if (opts.modalOpen) modalOpen = opts.modalOpen;
}

/** Shortcuts that still work while a dialog is open. */
const MODAL_SAFE = new Set(["app.palette"]);

export async function runCommand(id: string, args?: unknown): Promise<unknown> {
  const c = commands.get(id);
  if (!c) throw new Error(`Unknown command "${id}"`);
  if (c.enabled && !c.enabled()) return undefined;
  try {
    const r = await c.run(args);
    afterRun(c);
    return r;
  } catch (e) {
    errorHandler(e, c);
    throw e;
  }
}

// ------------------------------------------------------------------ shortcuts

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function formatShortcut(s: string): string {
  return s
    .split("+")
    .map((k) =>
      k === "Mod"
        ? isMac
          ? "⌘"
          : "Ctrl"
        : k === "Shift" && isMac
          ? "⇧"
          : k === "Alt" && isMac
            ? "⌥"
            : k,
    )
    .join(isMac ? "" : "+");
}

function eventToShortcut(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push("Mod");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  let key = e.key;
  if (key === " ") key = "Space";
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts.join("+");
}

/** Install the global keyboard handler. Returns an uninstaller. */
export function installShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const sc = eventToShortcut(e);
    // In text fields only shortcuts with a modifier fire (Mod+S, Mod+K ...), never bare letters.
    if (typing && !/Mod\+|^Escape$/.test(sc)) return;
    const modal = modalOpen();
    for (const c of commands.values()) {
      if (c.shortcut && c.shortcut.split(/\s*,\s*/).includes(sc)) {
        if (modal && !MODAL_SAFE.has(c.id)) return;
        if (c.enabled && !c.enabled()) continue;
        e.preventDefault();
        runCommand(c.id).catch(() => {});
        return;
      }
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

/** Fuzzy score: every query character must appear in order. Higher is better; -1 is no match. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase();
  if (!q) return 0;
  if (t.includes(q)) return 1000 - t.indexOf(q) * 2 - t.length * 0.1;
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    streak = found === ti ? streak + 1 : 0;
    score += 10 + streak * 5 - (found - ti);
    if (found === 0 || /[\s:/_-]/.test(t[found - 1])) score += 15;
    ti = found + 1;
  }
  return score;
}
