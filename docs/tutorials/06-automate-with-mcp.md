# Tutorial 6: Automate with an AI assistant (MCP)

URDF Forge runs a [Model Context Protocol](https://modelcontextprotocol.io) server, so an AI
assistant can read and edit the robot you have open. You stay in control: every change is an
ordinary undoable edit, and you see it happen in the viewport.

**You will learn to:** connect a client, ask for edits, and combine tools for bigger jobs.

**Time:** about 10 minutes.

## 1. Check the server

The server is on by default. The status bar shows **MCP :8765** with a green dot when it is
running. It listens on `http://127.0.0.1:8765/mcp` and refuses connections from other machines
and from web pages. Change the port or turn it off in **Settings → AI assistants (MCP)**.

## 2. Connect a client

**Clients with Streamable HTTP** (Cursor, VS Code and others), in their MCP JSON configuration:

```json
{
  "mcpServers": {
    "urdf-forge": { "type": "http", "url": "http://127.0.0.1:8765/mcp" }
  }
}
```

**Clients that only speak stdio** can use the `mcp-remote` bridge:

```json
{
  "mcpServers": {
    "urdf-forge": { "command": "npx", "args": ["-y", "mcp-remote", "http://127.0.0.1:8765/mcp"] }
  }
}
```

The settings page has copy buttons for these configurations. Ask the assistant "what tools does
urdf-forge have?" to confirm it is connected.

## 3. First requests

With a robot open, try:

- "Summarise the robot: links, moving joints, total mass and any validation problems."
- "Rename every link to snake_case."
- "Make all wheel joints continuous about Y with effort 5 and velocity 20."
- "Fit cylinder collisions to the wheels and convex hulls to everything else."
- "Why does validation fail? Fix what you safely can."
- "Take a screenshot and tell me if any joint axis looks wrong."

Press <kbd>Mod</kbd>+<kbd>Z</kbd> to undo anything you don't like.

## 4. Build a robot by conversation

The component and sample tools let an assistant assemble and test whole robots:

> Start a new project. Add a differential-drive base with 40 mm wheels, a 2D lidar on top
> centred 5 cm forward, and a 3-DOF arm at the back. Put the robot in the obstacle course and
> show me a screenshot.

Behind the scenes it calls `run_command` (`file.new`), `list_components`, `add_component` with
parameter overrides, `set_link_origin`, `set_environment` and `screenshot`.

> Open the Unitree Go2 sample and list its joints with their limits.

That uses `list_samples`, `open_sample` and `get_robot`.

## 5. Tools reference

| Tool                                          | What it does                                             |
| --------------------------------------------- | -------------------------------------------------------- |
| `get_robot`, `get_link`                       | Read the robot or one link                               |
| `add_link_from_part`                          | Create a link from a part in the library                 |
| `set_joint`, `set_link_origin`                | Joint type, axis, limits, dynamics; joint origin         |
| `reparent_link`, `rename_link`, `delete_link` | Edit the tree                                            |
| `add_collision`, `set_mass`, `set_drive`      | Collisions, mass or density, preview drives              |
| `validate`, `generate_urdf`                   | Problems; URDF text for a target                         |
| `list_components`, `add_component`            | Component library                                        |
| `list_samples`, `open_sample`                 | Sample robots and environments                           |
| `set_environment`                             | Test environment (also the exported world)               |
| `list_commands`, `run_command`                | Any editor command, the same ones as the command palette |
| `screenshot`                                  | PNG of the viewport                                      |

Plugins can add tools; theirs are named `<plugin id>__<tool>`. The full reference is in
[docs/mcp.md](../mcp.md).

## Tips

- Ask for a plan first on big changes ("tell me what you would change, then wait").
- Save before large batches; undo still works, but a saved file is a clean checkpoint.
- The assistant sees the same state you do. If you select a link and say "this link", it can
  find it with `get_robot`.

## Next

Add your own tools: [Tutorial 7, Write a plugin](07-write-a-plugin.md).
