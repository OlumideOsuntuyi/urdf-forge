import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import {
  formatShortcut,
  fuzzyScore,
  runCommand,
  useCommands,
  type Command,
} from "@/commands/registry";
import { app } from "@/store/app";
import { useSettings } from "@/store/settings";

/** Ctrl/Cmd+K: fuzzy search over every command, recents first. */
export function CommandPalette() {
  const commands = useCommands();
  const recents = useSettings((s) => s.recentCommands);
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const before = useRef<Element | null>(document.activeElement);

  useEffect(() => {
    input.current?.focus();
    const el = before.current;
    return () => (el as HTMLElement | null)?.focus?.();
  }, []);

  const results = useMemo(() => {
    const visible = commands.filter((c) => c.palette !== false && (!c.enabled || c.enabled()));
    if (!q.trim()) {
      const byId = new Map(visible.map((c) => [c.id, c]));
      const recent = recents.map((id) => byId.get(id)).filter(Boolean) as Command[];
      const rest = visible
        .filter((c) => !recents.includes(c.id))
        .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
      return [...recent, ...rest];
    }
    return visible
      .map((c) => ({
        c,
        s: Math.max(
          fuzzyScore(q, c.title),
          fuzzyScore(q, `${c.category} ${c.title} ${c.keywords ?? ""}`) - 5,
        ),
      }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
  }, [q, commands, recents]);

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    app().closeDialog();
    useSettings.getState().pushRecentCommand(c.id);
    runCommand(c.id).catch(() => {});
  };

  return (
    <div
      className="scrim"
      style={{ background: "transparent" }}
      onPointerDown={(e) => e.target === e.currentTarget && app().closeDialog()}
    >
      <div className="palette" role="dialog" aria-label="Command palette">
        <div className="pin">
          <Search size={16} />
          <input
            ref={input}
            value={q}
            placeholder="Type a command…"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[index] ? `cmd-${results[index].id}` : undefined}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") run(results[index]);
              else if (e.key === "Escape") app().closeDialog();
            }}
          />
        </div>
        <div className="results" id="palette-results" role="listbox" ref={list}>
          {results.map((c, i) => (
            <div
              key={c.id}
              id={`cmd-${c.id}`}
              role="option"
              aria-selected={i === index}
              className="res"
              onPointerMove={() => setIndex(i)}
              onClick={() => run(c)}
            >
              <span className="cat">{!q && recents.includes(c.id) ? "Recent" : c.category}</span>
              <span className="t">{c.title}</span>
              {c.checked?.() && <Check size={14} style={{ color: "var(--accent)" }} />}
              {c.shortcut && <kbd>{formatShortcut(c.shortcut.split(",")[0].trim())}</kbd>}
            </div>
          ))}
          {!results.length && <div className="empty">No command matches “{q}”.</div>}
        </div>
        <div className="foot" aria-live="polite">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>Enter</kbd> run
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
          <span className="grow" />
          <span>{results.length} commands</span>
        </div>
      </div>
    </div>
  );
}
