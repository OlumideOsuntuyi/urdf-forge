# Connecting AI assistants (MCP)

URDF Forge includes a [Model Context Protocol](https://modelcontextprotocol.io) server, so an
AI assistant can inspect the robot you have open and make edits for you: "make every wheel a
continuous joint about Y", "fit convex-hull collisions to all links", "why does validation
fail?". Every change it makes is an ordinary undoable edit.

## Turn it on or off

The server is on by default and listens on `http://127.0.0.1:8765/mcp`. Turn it off or change
the port in **Settings → AI assistants (MCP)**. The status bar shows whether it is running. The
server only accepts connections from this computer, and rejects requests sent by websites in
your browser (any non-local `Origin`).

## Connect a client

Clients configured with JSON (Cursor, VS Code, and others that support Streamable HTTP):

```json
{
  "mcpServers": {
    "urdf-forge": { "type": "http", "url": "http://127.0.0.1:8765/mcp" }
  }
}
```

Clients that only support stdio can use the `mcp-remote` bridge:

```json
{
  "mcpServers": {
    "urdf-forge": { "command": "npx", "args": ["-y", "mcp-remote", "http://127.0.0.1:8765/mcp"] }
  }
}
```

The settings page has copy buttons for these configurations.

## Tools

| Tool                            | What it does                                                                |
| ------------------------------- | --------------------------------------------------------------------------- |
| `get_robot`                     | Robot summary: links, joints, parts, export targets and validation problems |
| `get_link`                      | Details of one link                                                         |
| `add_link_from_part`            | Create a link from a part in the library                                    |
| `set_joint`                     | Joint type, name, axis, limits, effort, velocity, damping, friction         |
| `set_link_origin`               | Joint origin (xyz, rpy) relative to the parent                              |
| `reparent_link`                 | Move a link under another parent, keeping its world pose                    |
| `rename_link` / `delete_link`   | Rename or delete                                                            |
| `add_collision`                 | Fit box, cylinder, sphere, convex hull, simplified mesh, or copy the visual |
| `set_mass`                      | Mass or density; inertia is recomputed                                      |
| `set_drive`                     | How the preview drives a joint (servo, wheel)                               |
| `validate`                      | Errors and warnings                                                         |
| `generate_urdf`                 | URDF text for a target                                                      |
| `list_commands` / `run_command` | Run any editor command                                                      |
| `list_components`               | The component library and each component's parameters                       |
| `add_component`                 | Insert a component (with parameter overrides) attached to a link            |
| `list_samples`                  | The sample robots and environments that can be downloaded                   |
| `open_sample`                   | Download (or load from cache) and open a sample robot or environment        |
| `set_environment`               | Pick the built-in test environment for physics and the exported world       |
| `screenshot`                    | PNG of the viewport                                                         |

A step-by-step walkthrough is in [Tutorial 6](tutorials/06-automate-with-mcp.md).

Plugins can add more tools; they are named `<plugin id>__<tool>`.

## How it works

The Rust side (`src-tauri/src/mcp.rs`) implements the Streamable HTTP transport with JSON
responses. It answers `initialize` and `ping` itself and forwards `tools/list` and
`tools/call` to the webview over a Tauri event; the tools (`src/mcp/tools.ts`) run against the
same state as the UI and reply through the `mcp_respond` command.

Security notes are in [SECURITY.md](../SECURITY.md).
