/** Connects the Rust MCP server to the tool registry over Tauri events and commands. */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauri } from "@/platform";
import { useSettings } from "@/store/settings";
import { callTool, listTools, onToolsChanged } from "./tools";

interface McpRequest {
  id: number;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

let unlisten: UnlistenFn | null = null;

export interface McpStatus {
  running: boolean;
  port: number;
  url: string;
  error?: string;
}

export async function startMcpBridge(): Promise<void> {
  if (!isTauri() || unlisten) return;
  unlisten = await listen<McpRequest>("mcp://request", async ({ payload }) => {
    let result: unknown;
    if (payload.method === "tools/list") result = { tools: listTools() };
    else if (payload.method === "tools/call")
      result = await callTool(payload.params?.name ?? "", payload.params?.arguments ?? {});
    else result = { error: `Unsupported method ${payload.method}` };
    await invoke("mcp_respond", { id: payload.id, result });
  });
  onToolsChanged(() => {
    invoke("mcp_notify_tools_changed").catch(() => {});
  });
}

export async function setMcpServer(enabled: boolean, port: number): Promise<McpStatus> {
  if (!isTauri())
    return { running: false, port, url: "", error: "Only available in the desktop app." };
  await startMcpBridge();
  if (!enabled) return invoke<McpStatus>("mcp_stop");
  const s = useSettings.getState();
  const token = s.mcpRequireToken && s.mcpToken ? s.mcpToken : null;
  return invoke<McpStatus>("mcp_start", { port, token });
}

export async function mcpStatus(): Promise<McpStatus | null> {
  if (!isTauri()) return null;
  return invoke<McpStatus>("mcp_status");
}
