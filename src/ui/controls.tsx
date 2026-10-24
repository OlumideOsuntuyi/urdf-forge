import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { app } from "@/store/app";

const DEG = 180 / Math.PI;

export type Unit =
  "m" | "deg" | "rad" | "kg" | "kgm2" | "none" | "N" | "Nm" | "mps" | "radps" | "kgm3" | "hz";

const UNIT_LABEL: Partial<Record<Unit, string>> = {
  m: "m",
  deg: "°",
  rad: "rad",
  kg: "kg",
  kgm2: "kg·m²",
  N: "N",
  Nm: "N·m",
  mps: "m/s",
  radps: "rad/s",
  kgm3: "kg/m³",
  hz: "Hz",
};

/**
 * Evaluate what the user typed: plain numbers, simple arithmetic, and length / angle units
 * (25mm, 1.5in, 90deg, pi/2). The result is in the field's base unit.
 */
export function evaluate(text: string, unit: Unit): number | null {
  let s = text.trim().toLowerCase().replace(/,/g, ".").replace(/π/g, "pi");
  if (!s) return null;
  const lengths: Record<string, number> = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };
  let factor = 1;
  if (unit === "m") {
    const m = s.match(/(mm|cm|in|ft|m)$/);
    if (m) {
      factor = lengths[m[1]];
      s = s.slice(0, -m[1].length);
    }
  } else if (unit === "deg") {
    if (s.endsWith("rad")) {
      factor = DEG;
      s = s.slice(0, -3);
    } else s = s.replace(/(deg|°)$/, "");
  }
  const v = parseExpression(s);
  return v !== null && Number.isFinite(v) ? v * factor : null;
}

/** Recursive-descent evaluator for + - * / ( ) numbers and pi. No eval: the CSP forbids it. */
export function parseExpression(src: string): number | null {
  const s = src.replace(/\s+/g, "");
  let i = 0;
  const peek = () => s[i];
  const expr = (): number => {
    let v = term();
    while (peek() === "+" || peek() === "-") v = s[i++] === "+" ? v + term() : v - term();
    return v;
  };
  const term = (): number => {
    let v = factor();
    while (peek() === "*" || peek() === "/") v = s[i++] === "*" ? v * factor() : v / factor();
    return v;
  };
  const factor = (): number => {
    if (peek() === "-") return (i++, -factor());
    if (peek() === "+") return (i++, factor());
    if (peek() === "(") {
      i++;
      const v = expr();
      if (s[i++] !== ")") throw new Error("paren");
      return v;
    }
    if (s.startsWith("pi", i)) return ((i += 2), Math.PI);
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(s.slice(i));
    if (!m) throw new Error("number");
    i += m[0].length;
    return parseFloat(m[0]);
  };
  try {
    const v = expr();
    return i === s.length ? v : null;
  } catch {
    return null;
  }
}

function display(v: number, precision: number): string {
  if (!Number.isFinite(v)) return "0";
  const s = v
    .toFixed(precision)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

interface NumberFieldProps {
  value: number;
  /** Called with the value in the base unit (radians for "deg" fields). */
  onChange: (v: number, final: boolean) => void;
  unit?: Unit;
  tag?: string;
  tagClass?: string;
  precision?: number;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  title?: string;
  /** Hide the unit suffix (Vec3 fields show the unit once, in the field label). */
  hideUnit?: boolean;
}

/** Number input with drag-to-scrub on its label, arithmetic, units, and Up/Down stepping. */
export function NumberField({
  value,
  onChange,
  unit = "none",
  tag,
  tagClass,
  precision,
  step,
  min,
  max,
  disabled,
  title,
  hideUnit,
}: NumberFieldProps) {
  const isDeg = unit === "deg";
  const shown = isDeg ? value * DEG : value;
  const prec = precision ?? (isDeg ? 2 : unit === "kgm2" ? 8 : 4);
  const [text, setText] = useState(display(shown, prec));
  const [editing, setEditing] = useState(false);
  const scrub = useRef<{ x: number; start: number; moved: boolean } | null>(null);
  useEffect(() => {
    if (!editing) setText(display(shown, prec));
  }, [shown, prec, editing]);

  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const toBase = (v: number) => (isDeg ? v / DEG : v);
  const stepSize =
    step ?? (isDeg ? 1 : unit === "m" ? 0.001 : Math.max(Math.abs(shown) * 0.01, 0.001));

  const commit = (final: boolean) => {
    const v = evaluate(text, unit);
    if (v === null) {
      setText(display(shown, prec));
      return;
    }
    onChange(clamp(toBase(v)), final);
  };

  return (
    <div className="num" title={title}>
      {tag && (
        <span
          className={`tag ${tagClass ?? ""}`}
          onPointerDown={(e) => {
            if (disabled) return;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            scrub.current = { x: e.clientX, start: shown, moved: false };
            app().beginGesture();
          }}
          onPointerMove={(e) => {
            const s = scrub.current;
            if (!s) return;
            const dx = e.clientX - s.x;
            if (Math.abs(dx) > 2) s.moved = true;
            const k = e.shiftKey ? 0.1 : e.ctrlKey ? 10 : 1;
            onChange(clamp(toBase(s.start + Math.round(dx / 2) * stepSize * k)), false);
          }}
          onPointerUp={() => {
            scrub.current = null;
            app().endGesture();
          }}
        >
          {tag}
        </span>
      )}
      <input
        value={text}
        disabled={disabled}
        inputMode="decimal"
        onFocus={(e) => {
          setEditing(true);
          e.target.select();
        }}
        onBlur={() => {
          setEditing(false);
          commit(true);
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          else if (e.key === "Escape") {
            setText(display(shown, prec));
            setEditing(false);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const k = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (e.key === "ArrowUp" ? 1 : -1);
            const nv = clamp(toBase(shown + stepSize * k));
            onChange(nv, true);
            setText(display(isDeg ? nv * DEG : nv, prec));
          }
        }}
      />
      {UNIT_LABEL[unit] && !hideUnit && <span className="unit">{UNIT_LABEL[unit]}</span>}
    </div>
  );
}

export function Vec3Field({
  value,
  onChange,
  unit = "m",
  labels = ["X", "Y", "Z"],
  disabled,
}: {
  value: [number, number, number];
  onChange: (v: [number, number, number], final: boolean) => void;
  unit?: Unit;
  labels?: [string, string, string];
  disabled?: boolean;
}) {
  return (
    <div className="vec3">
      {[0, 1, 2].map((i) => (
        <NumberField
          key={i}
          tag={labels[i]}
          tagClass={["x", "y", "z"][i]}
          unit={unit}
          hideUnit
          title={`${labels[i]}${UNIT_LABEL[unit] ? ` (${UNIT_LABEL[unit]})` : ""}: type maths or units such as 25mm, 90deg, pi/2`}
          value={value[i]}
          disabled={disabled}
          onChange={(v, f) => {
            const n = [...value] as [number, number, number];
            n[i] = v;
            onChange(n, f);
          }}
        />
      ))}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
  title,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  title?: string;
}) {
  return (
    <div className="field" title={title}>
      <label>{label}</label>
      <div style={{ minWidth: 0 }}>{children}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="toggle"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export function CheckRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="check-row" onClick={() => onChange(!checked)}>
      <Toggle checked={checked} onChange={onChange} />
      <span>{children}</span>
    </label>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <select
      className="select"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function TextField({
  value,
  onCommit,
  placeholder,
  mono,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  const [t, setT] = useState(value);
  useEffect(() => setT(value), [value]);
  return (
    <input
      className={`input ${mono ? "mono" : ""}`}
      value={t}
      placeholder={placeholder}
      onChange={(e) => setT(e.target.value)}
      onBlur={() => t !== value && onCommit(t)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setT(value);
      }}
    />
  );
}

export function Section({
  title,
  icon,
  children,
  extra,
  defaultOpen = true,
  id,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  extra?: ReactNode;
  defaultOpen?: boolean;
  id?: string;
}) {
  const key = `urdf-forge.section.${id ?? title}`;
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? defaultOpen : v === "1";
    } catch {
      return defaultOpen;
    }
  });
  return (
    <section className={`section ${open ? "" : "closed"}`}>
      <header
        onClick={() => {
          setOpen(!open);
          try {
            localStorage.setItem(key, open ? "0" : "1");
          } catch {
            /* storage unavailable */
          }
        }}
        role="button"
        aria-expanded={open}
      >
        <ChevronDown size={14} className="chev" />
        {icon}
        <span>{title}</span>
        {extra && (
          <span className="extra" onClick={(e) => e.stopPropagation()}>
            {extra}
          </span>
        )}
      </header>
      <div className="content">{children}</div>
    </section>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  pressed,
  disabled,
  shortcut,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  accent,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  accent?: boolean;
}) {
  return (
    <div className={`segmented ${accent ? "accent" : ""}`} role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
