import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { formatShortcut, getCommand, runCommand, useCommands } from "@/commands/registry";

export type MenuEntry = string | "-" | { label: string };

/** A popover anchored to an element; closes on outside click and Escape. */
export function Popover({
  anchor,
  onClose,
  children,
  align = "start",
}: {
  anchor: HTMLElement;
  onClose: () => void;
  children: ReactNode;
  align?: "start" | "end";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const el = ref.current!;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = align === "end" ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    let top = r.bottom + 4;
    if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 4);
    setPos({ left, top });
  }, [anchor, align]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} className="popover" style={pos} role="menu">
      {children}
    </div>,
    document.body,
  );
}

/** Menu of command ids. "-" draws a separator; { label } a heading. */
export function CommandMenu({ entries, onDone }: { entries: MenuEntry[]; onDone: () => void }) {
  useCommands();
  return (
    <>
      {entries.map((e, i) => {
        if (e === "-") return <div key={i} className="menu-sep" />;
        if (typeof e === "object")
          return (
            <div key={i} className="menu-label">
              {e.label}
            </div>
          );
        const c = getCommand(e);
        if (!c) return null;
        const enabled = c.enabled ? c.enabled() : true;
        const checked = c.checked?.();
        return (
          <button
            key={e}
            className="menu-item"
            role="menuitem"
            disabled={!enabled}
            onClick={() => {
              onDone();
              runCommand(e).catch(() => {});
            }}
          >
            <span className="check">{checked ? <Check size={14} /> : null}</span>
            <span>{c.title}</span>
            {c.shortcut && (
              <span className="sc">{formatShortcut(c.shortcut.split(",")[0].trim())}</span>
            )}
          </button>
        );
      })}
    </>
  );
}

export function MenuButton({ label, entries }: { label: ReactNode; entries: MenuEntry[] }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={btn}
        className="menu-button"
        aria-haspopup="menu"
        aria-label={typeof label === "string" ? undefined : "Menu"}
        aria-expanded={!!el}
        onClick={() => setEl(el ? null : btn.current)}
      >
        {label}
      </button>
      {el && (
        <Popover anchor={el} onClose={() => setEl(null)}>
          <CommandMenu entries={entries} onDone={() => setEl(null)} />
        </Popover>
      )}
    </>
  );
}
