# Writing plugins

A plugin is a folder with a `manifest.json` and an ES module. Plugins can add commands,
importers, exporters and MCP tools, read and edit the robot, and add meshes to the parts
library. Two complete examples live in [`plugins/examples`](../plugins/examples).

## Install a plugin

1. Open **Settings → Plugins** and press **Open folder**. The folder is
   `<app data>/plugins`, for example:
   - Windows: `%APPDATA%\io.github.olumideosuntuyi.urdfforge\plugins`
   - macOS: `~/Library/Application Support/io.github.olumideosuntuyi.urdfforge/plugins`
   - Linux: `~/.local/share/io.github.olumideosuntuyi.urdfforge/plugins`
2. Copy the plugin's folder in, so you have `plugins/<plugin>/manifest.json`.
3. Press **Reload**, then switch the plugin on.

Plugins run with the same access as the app. URDF Forge asks before enabling one for the first
time; only enable code you trust.

## manifest.json

```json
{
  "id": "acme.mjcf-exporter",
  "name": "MJCF exporter",
  "version": "1.0.0",
  "description": "Export MuJoCo MJCF.",
  "author": "ACME Robotics",
  "homepage": "https://example.com",
  "main": "main.js",
  "apiVersion": 1
}
```

`id` must be unique (reverse-DNS style is a good habit) and is used to namespace your commands
and tools. `apiVersion` must match the app's plugin API version, currently **1**.

## The module

Export `activate(api)` (named, or as `default.activate`). Anything you register through `api`
is removed automatically when the plugin is disabled. You can also return an object with a
`dispose()` method for your own clean-up.

```js
export function activate(api) {
  api.commands.register({
    id: "hello",
    title: "Say hello",
    run: () => api.ui.toast(`Hello from ${api.model.get().robot}!`, "success"),
  });
}
```

The full typed API is in [`src/plugins/api.ts`](../src/plugins/api.ts). In short:

| Member                                                                    | Purpose                                                                                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `api.commands.register({ id, title, shortcut?, keywords?, run })`         | Adds a command (id becomes `<plugin id>.<id>`). It appears in the command palette and can be run by MCP clients.           |
| `api.commands.run(id, args?)`                                             | Runs any command, built-in or plugin.                                                                                      |
| `api.model.get()`                                                         | The current robot model (read-only snapshot).                                                                              |
| `api.model.edit(draft => { ... })`                                        | Changes the model as one undoable step. Mutate `draft` in place.                                                           |
| `api.model.selection()` / `select(sel)`                                   | Read or change the selection.                                                                                              |
| `api.model.onChange(fn)`                                                  | Called after every model change.                                                                                           |
| `api.meshes.get(id)`                                                      | Triangle soup (`Float32Array`, 9 floats per triangle, metres) for a part.                                                  |
| `api.meshes.add(name, positions, color?)`                                 | Adds a part to the library and returns its `MeshAsset`.                                                                    |
| `api.importers.register({ extensions, label, import(bytes, fileName) })`  | Handles new file types. Return `[{ name, positions, color }]` in metres; the user reviews them in the import dialog.       |
| `api.exporters.register({ id, label, extension, export(model, meshes) })` | Adds a button to the Export dialog. Return a string or `Uint8Array`.                                                       |
| `api.mcp.registerTool({ name, description, inputSchema, handler })`       | Adds an MCP tool (name becomes `<plugin id>__<name>`). Return a string, a JSON-serialisable object, or an MCP tool result. |
| `api.ui.toast(text, tone?)`                                               | Shows a notification.                                                                                                      |

## The model

Units follow REP 103: metres, kilograms, radians, Z-up. A `RobotModel` has `links`, `materials`
and `meshes` (parts). Each link has a `parentId`, an `origin` (the joint origin relative to the
parent), a `joint`, `visuals`, `collisions`, `sensors` and an `inertial`. Types are in
[`src/core/model.ts`](../src/core/model.ts).

Example: rename every link to snake_case in one undo step.

```js
api.model.edit((m) => {
  for (const l of m.links) l.name = l.name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
});
```

## Tips

- Plugins are loaded from a single file. Bundle dependencies into `main.js` (esbuild or Rollup
  with `format: "esm"`).
- Do heavy work off the UI thread with a `Worker` created from a `Blob` URL.
- Keep MCP tool inputs small and documented with a JSON Schema; assistants read the
  descriptions to decide what to call.
