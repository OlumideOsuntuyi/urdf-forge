import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Copy,
  FolderOpen,
  Info,
  Monitor,
  Palette,
  PlugZap,
  Puzzle,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { app } from "@/store/app";
import { THEMES, useSettings } from "@/store/settings";
import { loadPlugins, setPluginEnabled, usePlugins } from "@/plugins/host";
import { mcpStatus, setMcpServer, type McpStatus } from "@/mcp/bridge";
import { listTools } from "@/mcp/tools";
import { isTauri, openExternal, openFolder, pluginsDir } from "@/platform";
import { Dialog } from "./Dialog";
import { CheckRow, Field, NumberField, Segmented, Toggle } from "../controls";

type Tab = "appearance" | "general" | "plugins" | "mcp" | "about";

export function SettingsDialog({ tab: initial }: { tab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initial ?? "appearance");
  const tabs: [Tab, string, typeof Palette][] = [
    ["appearance", "Appearance", Palette],
    ["general", "General", Settings2],
    ["plugins", "Plugins", Puzzle],
    ["mcp", "AI assistants (MCP)", PlugZap],
    ["about", "About", Info],
  ];
  return (
    <Dialog title="Settings" wide bodyless>
      <div className="dialog-nav">
        <nav role="tablist" aria-orientation="vertical">
          {tabs.map(([id, label, I]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              <I size={15} /> {label}
            </button>
          ))}
        </nav>
        <div className="pane">
          {tab === "appearance" && <Appearance />}
          {tab === "general" && <General />}
          {tab === "plugins" && <Plugins />}
          {tab === "mcp" && <Mcp />}
          {tab === "about" && <About />}
        </div>
      </div>
    </Dialog>
  );
}

// Swatches mirror the token values in themes.css.
const SWATCH: Record<string, [string, string, string, string]> = {
  "forge-dark": ["#16191d", "#22272e", "#ff8a3d", "#e8ebf0"],
  "forge-light": ["#f5f6f8", "#dfe4ea", "#d4581c", "#1a1e24"],
  midnight: ["#0f1424", "#18203a", "#7aa2ff", "#e6ebf7"],
  nord: ["#2e3440", "#3b4252", "#88c0d0", "#eceff4"],
  "solarized-light": ["#fdf6e3", "#e4dcc3", "#b5532a", "#073642"],
  "high-contrast": ["#0a0a0a", "#000000", "#ffd400", "#ffffff"],
};

function Appearance() {
  const theme = useSettings((s) => s.theme);
  const density = useSettings((s) => s.density);
  const update = useSettings((s) => s.update);
  return (
    <>
      <div className="row">
        <b className="grow">Theme</b>
        <button
          className="chip-btn"
          aria-pressed={theme === "system"}
          onClick={() => update({ theme: "system" })}
        >
          <Monitor size={12} /> Follow system
        </button>
      </div>
      <div className="theme-grid">
        {THEMES.map((t) => {
          const [panel, vp, accent, text] = SWATCH[t.id];
          return (
            <button
              key={t.id}
              className="theme-card"
              aria-pressed={theme === t.id}
              onClick={() => update({ theme: t.id })}
            >
              <div className="preview">
                <div className="s" style={{ background: panel }}>
                  <i style={{ background: text, width: "80%" }} />
                  <i style={{ background: text, width: "60%" }} />
                  <i style={{ background: accent, width: "70%", opacity: 1 }} />
                  <i style={{ background: text, width: "50%" }} />
                </div>
                <div className="v" style={{ background: vp }}>
                  <b style={{ background: accent }} />
                </div>
              </div>
              <div className="tname">{t.name}</div>
            </button>
          );
        })}
      </div>
      <Field
        label="Density"
        hint="Touch makes every control at least 44 px for tablets and touch screens."
      >
        <Segmented
          value={density}
          onChange={(v) => update({ density: v })}
          options={[
            { value: "compact", label: "Compact" },
            { value: "comfortable", label: "Comfortable" },
            { value: "touch", label: "Touch" },
          ]}
        />
      </Field>
    </>
  );
}

function General() {
  const s = useSettings();
  return (
    <>
      <Field
        label="STEP quality"
        hint="Finer tessellation looks smoother but makes heavier meshes and slower exports."
      >
        <Segmented
          value={s.cadQuality}
          onChange={(v) => s.update({ cadQuality: v })}
          options={[
            { value: "draft", label: "Draft" },
            { value: "normal", label: "Normal" },
            { value: "fine", label: "Fine" },
          ]}
        />
      </Field>
      <CheckRow checked={s.showWelcome} onChange={(v) => s.update({ showWelcome: v })}>
        Show the welcome card when the robot is empty
      </CheckRow>
      <div className="callout info">
        <Info size={14} />
        <span>
          Projects are saved as .forge files: a zip with the robot model and every mesh, so they
          open anywhere.
        </span>
      </div>
    </>
  );
}

function Plugins() {
  const plugins = usePlugins();
  const trusted = useSettings((s) => s.trustedPlugins);
  const [dir, setDir] = useState("");
  useEffect(() => {
    if (isTauri())
      pluginsDir()
        .then(setDir)
        .catch(() => {});
  }, []);
  return (
    <>
      <div className="callout warn">
        <AlertTriangle size={14} />
        <span>
          Plugins run with the same access as URDF Forge, including your files. Only enable plugins
          you trust.
        </span>
      </div>
      <div className="row">
        <span className="muted grow mono" style={{ fontSize: "var(--fs-xs)", userSelect: "text" }}>
          {dir || "Plugins are available in the desktop and Android apps."}
        </span>
        <button className="btn sm" disabled={!dir} onClick={() => openFolder(dir)}>
          <FolderOpen size={13} /> Open folder
        </button>
        <button className="btn sm" disabled={!dir} onClick={() => loadPlugins()}>
          <RefreshCw size={13} /> Reload
        </button>
      </div>
      {!plugins.length ? (
        <div className="empty">
          <b>No plugins installed</b>
          Put a folder with <span className="mono">manifest.json</span> and{" "}
          <span className="mono">main.js</span> in the plugins folder, then press Reload. See
          docs/plugins.md for the API and an example.
        </div>
      ) : (
        <table className="table">
          <tbody>
            {plugins.map((p) => (
              <tr key={p.manifest.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>
                    {p.manifest.name} <span className="muted">{p.manifest.version}</span>
                  </div>
                  <div className="muted">{p.manifest.description}</div>
                  {p.error && <div style={{ color: "var(--danger)" }}>{p.error}</div>}
                </td>
                <td style={{ width: 90 }}>
                  <span
                    className={`badge ${p.state === "active" ? "ok" : p.state === "error" ? "warn" : ""}`}
                  >
                    {p.state}
                  </span>
                </td>
                <td style={{ width: 50 }}>
                  <Toggle
                    checked={p.state === "active"}
                    disabled={p.manifest.apiVersion === 0}
                    label={`Enable ${p.manifest.name}`}
                    onChange={(on) => {
                      if (on && !trusted.includes(p.manifest.id)) {
                        if (
                          !window.confirm(
                            `Enable ${p.manifest.name}? It will be able to read and change your projects and files.`,
                          )
                        )
                          return;
                        useSettings
                          .getState()
                          .update({ trustedPlugins: [...trusted, p.manifest.id] });
                      }
                      setPluginEnabled(p.manifest.id, on);
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Mcp() {
  const enabled = useSettings((s) => s.mcpEnabled);
  const port = useSettings((s) => s.mcpPort);
  const update = useSettings((s) => s.update);
  const [status, setStatus] = useState<McpStatus | null>(null);
  useEffect(() => {
    mcpStatus()
      .then(setStatus)
      .catch(() => {});
  }, [enabled, port]);
  const url = `http://127.0.0.1:${port}/mcp`;
  const snippets: [string, string][] = [
    ["Claude Code", `claude mcp add --transport http urdf-forge ${url}`],
    [
      "JSON config (Cursor, VS Code, others)",
      JSON.stringify({ mcpServers: { "urdf-forge": { type: "http", url } } }, null, 2),
    ],
    [
      "Clients that only speak stdio",
      JSON.stringify(
        { mcpServers: { "urdf-forge": { command: "npx", args: ["-y", "mcp-remote", url] } } },
        null,
        2,
      ),
    ],
  ];
  const toggle = async (on: boolean) => {
    update({ mcpEnabled: on });
    const s = await setMcpServer(on, port);
    setStatus(s);
    if (s.error) app().toast(s.error, "error");
  };
  return (
    <>
      <p className="dim" style={{ margin: 0 }}>
        Let an AI assistant inspect and edit the open robot through the Model Context Protocol. The
        server listens on this computer only (127.0.0.1) and every change it makes can be undone.
      </p>
      <Field label="Server">
        <div className="row">
          <Toggle
            checked={enabled}
            onChange={toggle}
            disabled={!isTauri()}
            label="Enable MCP server"
          />
          <span
            className="dot"
            style={{ background: status?.running ? "var(--ok)" : "var(--text-3)" }}
          />
          <span className="dim">
            {!isTauri()
              ? "Desktop app only"
              : status?.running
                ? `Listening at ${status.url}`
                : "Off"}
          </span>
        </div>
      </Field>
      <Field label="Port">
        <div style={{ width: 120 }}>
          <NumberField
            precision={0}
            value={port}
            min={1024}
            max={65535}
            step={1}
            onChange={(v, final) => {
              if (!final) return;
              update({ mcpPort: Math.round(v) });
              if (enabled) setMcpServer(true, Math.round(v)).then(setStatus);
            }}
          />
        </div>
      </Field>
      <b>Connect a client</b>
      {snippets.map(([label, text]) => (
        <div key={label} className="col">
          <div className="row">
            <span className="dim grow">{label}</span>
            <button
              className="btn sm ghost"
              onClick={() =>
                navigator.clipboard.writeText(text).then(() => app().toast("Copied", "success"))
              }
            >
              <Copy size={13} /> Copy
            </button>
          </div>
          <pre className="code" style={{ maxHeight: 140 }}>
            {text}
          </pre>
        </div>
      ))}
      <details>
        <summary className="dim" style={{ cursor: "pointer" }}>
          {listTools().length} tools available
        </summary>
        <table className="table">
          <tbody>
            {listTools().map((t) => (
              <tr key={t.name}>
                <td className="mono" style={{ whiteSpace: "nowrap" }}>
                  {t.name}
                </td>
                <td className="dim">{t.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

function About() {
  return (
    <div className="col" style={{ alignItems: "flex-start", gap: 10 }}>
      <div className="row">
        <img src="./logo.svg" alt="" width={48} height={48} />
        <div>
          <div style={{ fontSize: 18, fontWeight: 650 }}>URDF Forge</div>
          <div className="muted">Version {__APP_VERSION__}</div>
        </div>
      </div>
      <p className="dim" style={{ margin: 0 }}>
        An open-source editor that turns STEP and STL CAD models into ROS 2 robot description
        packages. Released under the Apache License 2.0.
      </p>
      <div className="row">
        <button
          className="btn sm"
          onClick={() => openExternal("https://github.com/OlumideOsuntuyi/urdf-forge")}
        >
          Source code
        </button>
        <button
          className="btn sm ghost"
          onClick={() => openExternal("https://github.com/OlumideOsuntuyi/urdf-forge/issues")}
        >
          Report an issue
        </button>
      </div>
      <b>Built with</b>
      <div className="dim" style={{ fontSize: "var(--fs-sm)", lineHeight: 1.7 }}>
        Tauri (MIT/Apache-2.0) · three.js (MIT) · React (MIT) · Rapier physics (Apache-2.0) ·
        OpenCascade via occt-import-js (LGPL-2.1, loaded as a separate WebAssembly module) · Zustand
        (MIT) · fflate (MIT) · Lucide icons (ISC) · Inter and JetBrains Mono fonts (OFL-1.1). See
        NOTICE for details.
      </div>
    </div>
  );
}
