import { Keyboard } from "lucide-react";
import { formatShortcut, useCommands } from "@/commands/registry";
import { Dialog } from "./Dialog";

export function ShortcutsDialog() {
  const commands = useCommands().filter((c) => c.shortcut);
  const groups = new Map<string, typeof commands>();
  for (const c of commands) groups.set(c.category, [...(groups.get(c.category) ?? []), c]);
  return (
    <Dialog title="Keyboard shortcuts" icon={<Keyboard size={18} />} wide>
      <div style={{ columns: "2 300px", columnGap: 24 }}>
        {[...groups].map(([cat, list]) => (
          <div key={cat} style={{ breakInside: "avoid", marginBottom: 14 }}>
            <div className="menu-label" style={{ paddingLeft: 0 }}>
              {cat}
            </div>
            {list.map((c) => (
              <div key={c.id} className="row" style={{ padding: "3px 0" }}>
                <span className="grow dim">{c.title}</span>
                {c.shortcut!.split(",").map((s) => (
                  <kbd key={s}>{formatShortcut(s.trim())}</kbd>
                ))}
              </div>
            ))}
          </div>
        ))}
        <div style={{ breakInside: "avoid" }}>
          <div className="menu-label" style={{ paddingLeft: 0 }}>
            Viewport
          </div>
          {[
            ["Orbit", "Left drag"],
            ["Pan", "Right or middle drag"],
            ["Zoom", "Wheel / pinch"],
            ["Select a visual or collision", "Alt+click"],
            ["Scrub a number", "Drag its axis letter"],
            ["Fine / coarse scrub", "Shift / Ctrl while dragging"],
          ].map(([a, b]) => (
            <div key={a} className="row" style={{ padding: "3px 0" }}>
              <span className="grow dim">{a}</span>
              <kbd>{b}</kbd>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
