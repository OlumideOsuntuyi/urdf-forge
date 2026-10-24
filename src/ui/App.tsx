import { useEffect, useState } from "react";
import { useApp, app } from "@/store/app";
import { resolveTheme, useSettings } from "@/store/settings";
import { configureCommands, installShortcuts } from "@/commands/registry";
import { isNarrow, registerBuiltinCommands } from "@/commands/builtin";
import "@/samples/remote";
import { registerBuiltinTools } from "@/mcp/tools";
import { setMcpServer, startMcpBridge } from "@/mcp/bridge";
import { loadPlugins } from "@/plugins/host";
import { importFiles } from "@/app/io";
import { isTauri, readPath } from "@/platform";
import { viewportRef } from "@/viewport/ref";
import type { PendingImport } from "@/app/io";
import { TitleBar } from "./TitleBar";
import { LeftPanel } from "./LeftPanel";
import { Inspector } from "./Inspector";
import { ViewportView } from "./ViewportView";
import { BottomPanel } from "./BottomPanel";
import { StatusBar } from "./StatusBar";
import { CommandPalette } from "./CommandPalette";
import { Toasts } from "./Toasts";
import { ImportDialog } from "./dialogs/ImportDialog";
import { ExportDialog } from "./dialogs/ExportDialog";
import { SettingsDialog } from "./dialogs/SettingsDialog";
import { ShortcutsDialog } from "./dialogs/ShortcutsDialog";
import { SamplesDialog } from "./dialogs/SamplesDialog";
import { ComponentDialog } from "./dialogs/ComponentDialog";
import { MaterialsDialog } from "./dialogs/MaterialsDialog";

let booted = false;
function boot() {
  if (booted) return;
  booted = true;
  registerBuiltinCommands();
  registerBuiltinTools(() => viewportRef.get()?.screenshot() ?? null);
  configureCommands({
    onError: (e) => app().toast(e instanceof Error ? e.message : String(e), "error"),
    modalOpen: () => !!app().dialog,
  });
}

export function App() {
  boot();
  const theme = useSettings((s) => s.theme);
  const density = useSettings((s) => s.density);
  const panels = useApp((s) => s.panels);
  const dialog = useApp((s) => s.dialog);
  const [dragging, setDragging] = useState(false);
  const [mcpRunning, setMcpRunning] = useState(false);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolveTheme(theme).id;
    document.documentElement.dataset.density = density;
  }, [theme, density, systemDark]);

  // First run on a touch screen: pick the touch density.
  useEffect(() => {
    if (matchMedia("(pointer: coarse)").matches && !localStorage.getItem("urdf-forge.settings"))
      useSettings.getState().update({ density: "touch" });
  }, []);

  useEffect(() => installShortcuts(), []);

  // Narrow screens (phones, portrait tablets): side panels become drawers, closed by default.
  const [narrow, setNarrow] = useState(isNarrow);
  useEffect(() => {
    const mq = matchMedia("(max-width: 1000px)");
    const on = () => {
      setNarrow(mq.matches);
      if (mq.matches) app().set("panels", { ...app().panels, left: false, right: false });
    };
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    // Errors thrown inside edits (for example an invalid reparent) surface as toasts.
    const onErr = (e: PromiseRejectionEvent | ErrorEvent) => {
      const err = "reason" in e ? e.reason : e.error;
      if (err instanceof Error) app().toast(err.message, "error");
    };
    window.addEventListener("unhandledrejection", onErr);
    window.addEventListener("error", onErr);
    return () => {
      window.removeEventListener("unhandledrejection", onErr);
      window.removeEventListener("error", onErr);
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    loadPlugins().catch((e) => app().toast(`Plugins: ${e.message}`, "warning"));
    startMcpBridge().then(async () => {
      const s = useSettings.getState();
      if (s.mcpEnabled) {
        const st = await setMcpServer(true, s.mcpPort);
        setMcpRunning(st.running);
        if (st.error) app().toast(st.error, "warning");
      }
    });
    const unsub = useSettings.subscribe((s, p) => {
      if (s.mcpEnabled !== p.mcpEnabled || s.mcpPort !== p.mcpPort) setMcpRunning(s.mcpEnabled);
    });
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
      getCurrentWebview()
        .onDragDropEvent(async (ev) => {
          const p = ev.payload;
          if (p.type === "enter" || p.type === "over") setDragging(true);
          else if (p.type === "leave") setDragging(false);
          else if (p.type === "drop") {
            setDragging(false);
            try {
              await importFiles(await Promise.all(p.paths.map(readPath)));
            } catch (e) {
              app().toast(e instanceof Error ? e.message : String(e), "error");
            }
          }
        })
        .then((u) => (unlisten = u)),
    );
    return () => {
      unsub();
      unlisten?.();
    };
  }, []);

  // Warn before closing with unsaved work.
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (app().dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);

  const cls = ["workspace", panels.left ? "" : "no-left", panels.right ? "" : "no-right"].join(" ");
  return (
    <div className="app">
      <TitleBar />
      <main className={cls}>
        <LeftPanel />
        <div className="center">
          <ViewportView dragging={dragging} />
          {panels.bottom && <BottomPanel />}
        </div>
        {narrow && (panels.left || panels.right) && (
          <div
            className="drawer-scrim"
            onClick={() => app().set("panels", { ...panels, left: false, right: false })}
          />
        )}
        <Inspector />
      </main>
      <StatusBar mcpRunning={mcpRunning} />
      {dialog?.id === "palette" && <CommandPalette />}
      {dialog?.id === "import" && <ImportDialog pending={dialog.props as PendingImport} />}
      {dialog?.id === "export" && <ExportDialog />}
      {dialog?.id === "settings" && (
        <SettingsDialog
          tab={(dialog.props as { tab?: "plugins" | "mcp" | "about" } | undefined)?.tab}
        />
      )}
      {dialog?.id === "shortcuts" && <ShortcutsDialog />}
      {dialog?.id === "component" && <ComponentDialog id={(dialog.props as { id: string }).id} />}
      {dialog?.id === "materials" && (
        <MaterialsDialog
          {...((dialog.props as { materialId?: string; tab?: "presets" | "pbr" | "hdri" }) ?? {})}
        />
      )}
      {dialog?.id === "samples" && (
        <SamplesDialog tab={(dialog.props as { tab?: "robot" | "environment" } | undefined)?.tab} />
      )}
      <Toasts />
    </div>
  );
}
