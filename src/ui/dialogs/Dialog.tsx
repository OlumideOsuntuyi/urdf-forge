import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { app } from "@/store/app";

export function Dialog({
  title,
  icon,
  children,
  footer,
  wide,
  onClose = () => app().closeDialog(),
  bodyless,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  onClose?: () => void;
  bodyless?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, select, button.primary, button")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      // Keep keyboard focus inside the dialog.
      if (e.key === "Tab" && ref.current) {
        const f = [
          ...ref.current.querySelectorAll<HTMLElement>(
            "button, input, select, textarea, [tabindex]",
          ),
        ].filter((x) => !x.hasAttribute("disabled"));
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`dialog ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <header>
          {icon}
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        {bodyless ? children : <div className="body">{children}</div>}
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}
