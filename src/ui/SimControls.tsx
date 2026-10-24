import { useRef, useState } from "react";
import { Bot, Check, Gamepad2 } from "lucide-react";
import { app, useApp } from "@/store/app";
import { useSettings } from "@/store/settings";
import { availableBehaviors, setTeleopPad } from "@/sim/controller";
import { Popover } from "./Menu";

/** Picks the simulation controller (drive, walk, arm motion) for pose and physics modes. */
export function BehaviorPicker() {
  const sim = useApp((s) => s.simBehavior);
  const choice = useApp((s) => s.behaviorChoice);
  const [el, setEl] = useState<HTMLElement | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const options = el ? availableBehaviors() : [];
  const pick = (id: string) => {
    app().set("behaviorChoice", id);
    setEl(null);
  };
  return (
    <>
      <button
        ref={btn}
        className="btn ghost sm"
        title="Simulation controller"
        onClick={() => setEl(el ? null : btn.current)}
      >
        <Bot size={14} /> {sim?.name ?? "No controller"}
      </button>
      {el && (
        <Popover anchor={el} onClose={() => setEl(null)}>
          <div className="menu-label">Controller</div>
          {[
            { id: "auto", name: "Automatic", description: "The best match for this robot." },
            ...options.map((b) => ({ id: b.id, name: b.name, description: b.description })),
            { id: "none", name: "None", description: "Joints follow their own drive settings." },
          ].map((o) => (
            <button
              key={o.id}
              className="menu-item"
              style={{ alignItems: "flex-start", padding: "6px 10px" }}
              onClick={() => pick(o.id)}
            >
              <span className="check">{choice === o.id ? <Check size={14} /> : null}</span>
              <span className="col" style={{ gap: 0 }}>
                <span>{o.name}</span>
                <span
                  className="muted"
                  style={{ fontSize: "var(--fs-xs)", whiteSpace: "normal", maxWidth: 260 }}
                >
                  {o.description}
                </span>
              </span>
            </button>
          ))}
          {!options.length && (
            <div className="muted" style={{ padding: "4px 10px 8px", fontSize: "var(--fs-xs)" }}>
              No wheels, legs or arm chain found on this robot.
            </div>
          )}
        </Popover>
      )}
    </>
  );
}

/** Key hints on desktop; a virtual joystick on touch screens. */
export function TeleopOverlay() {
  const sim = useApp((s) => s.simBehavior);
  const mode = useApp((s) => s.mode);
  const touch = useSettings((s) => s.density === "touch");
  if (!sim?.teleop || mode === "edit") return null;
  return (
    <div className="vp-overlay bl">
      {touch ? (
        <DrivePad />
      ) : (
        <div className="hint-pill" style={{ borderColor: "var(--border)" }}>
          <Gamepad2 size={13} style={{ verticalAlign: -2 }} /> <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> drive · <kbd>Q</kbd>
          <kbd>E</kbd> strafe
        </div>
      )}
    </div>
  );
}

function DrivePad() {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const R = 56;
  const move = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    let x = e.clientX - (r.left + r.width / 2);
    let y = e.clientY - (r.top + r.height / 2);
    const l = Math.hypot(x, y);
    if (l > R) {
      x = (x / l) * R;
      y = (y / l) * R;
    }
    setKnob({ x, y });
    setTeleopPad({ forward: -y / R, turn: -x / R, strafe: 0 });
  };
  const end = () => {
    setKnob({ x: 0, y: 0 });
    setTeleopPad(null);
  };
  return (
    <div
      ref={ref}
      className="drive-pad"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => e.buttons && move(e)}
      onPointerUp={end}
      onPointerCancel={end}
      aria-label="Drive"
    >
      <div className="knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
