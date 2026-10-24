import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { useApp, app } from "@/store/app";

const ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle };

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite" role="status">
      {toasts.map((t) => {
        const I = ICONS[t.tone];
        return (
          <div key={t.id} className={`toast ${t.tone}`} onClick={() => app().dismissToast(t.id)}>
            <I size={15} className="ti" />
            <span>{t.text}</span>
          </div>
        );
      })}
    </div>
  );
}
