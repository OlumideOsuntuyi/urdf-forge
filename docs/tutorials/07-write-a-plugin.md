# Tutorial 7: Write a plugin

Plugins are small JavaScript modules that extend URDF Forge with commands, importers,
exporters and MCP tools. In this tutorial you write one that checks every moving joint for
sensible limits, adds a command to fix them, exports a joint table as Markdown, and exposes
the check to AI assistants.

**You will learn to:** lay out a plugin, register a command, an exporter and an MCP tool, edit
the model in one undo step, and install and reload the plugin.

**Time:** about 20 minutes. You need a text editor; no build tools.

## 1. Create the folder

Open **Settings → Plugins** and press **Open folder**. Inside it, create a folder
`joint-check` with two files.

`joint-check/manifest.json`:

```json
{
  "id": "tutorial.joint-check",
  "name": "Joint check",
  "version": "1.0.0",
  "description": "Checks joint limits, fixes them, and exports a joint table.",
  "author": "You",
  "main": "main.js",
  "apiVersion": 1
}
```

`id` must be unique; it prefixes your commands (`tutorial.joint-check.<id>`) and MCP tools
(`tutorial.joint-check__<name>`).

## 2. Write the module

`joint-check/main.js`:

```js
// Joints that move need limits a controller can respect.
function problems(model) {
  const out = [];
  for (const l of model.links) {
    if (!l.parentId) continue;
    const j = l.joint;
    if (j.type === "revolute" || j.type === "prismatic") {
      if (!(j.upper > j.lower)) out.push({ link: l.name, issue: "upper limit is not above lower" });
    }
    if (j.type !== "fixed" && !(j.effort > 0)) out.push({ link: l.name, issue: "no effort limit" });
    if (j.type !== "fixed" && !(j.velocity > 0))
      out.push({ link: l.name, issue: "no velocity limit" });
  }
  return out;
}

function table(model) {
  const rows = [
    "| Link | Joint | Type | Lower | Upper | Effort | Velocity |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const l of model.links) {
    if (!l.parentId || l.joint.type === "fixed") continue;
    const j = l.joint;
    rows.push(
      `| ${l.name} | ${j.name} | ${j.type} | ${j.lower} | ${j.upper} | ${j.effort} | ${j.velocity} |`,
    );
  }
  return rows.join("\n") + "\n";
}

export function activate(api) {
  api.commands.register({
    id: "check",
    title: "Check joint limits",
    keywords: "validate limits effort velocity",
    run() {
      const p = problems(api.model.get());
      api.ui.toast(
        p.length
          ? `${p.length} joint problems: ${p.map((x) => x.link).join(", ")}`
          : "All joints look fine",
        p.length ? "warning" : "success",
      );
    },
  });

  api.commands.register({
    id: "fix",
    title: "Give moving joints default limits",
    run() {
      // One undoable step: mutate the draft in place.
      api.model.edit((m) => {
        for (const l of m.links) {
          if (!l.parentId || l.joint.type === "fixed") continue;
          const j = l.joint;
          if (!(j.effort > 0)) j.effort = 5;
          if (!(j.velocity > 0)) j.velocity = 3;
          if ((j.type === "revolute" || j.type === "prismatic") && !(j.upper > j.lower)) {
            j.lower = j.type === "revolute" ? -Math.PI / 2 : 0;
            j.upper = j.type === "revolute" ? Math.PI / 2 : 0.1;
          }
        }
      });
      api.ui.toast("Joint limits updated", "success");
    },
  });

  api.exporters.register({
    id: "joint-table",
    label: "Joint table (Markdown)",
    extension: "md",
    export: (model) => table(model),
  });

  api.mcp.registerTool({
    name: "joint_problems",
    description: "Lists moving joints with missing or impossible limits, effort or velocity.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => problems(api.model.get()),
  });
}
```

## 3. Install and run it

1. In **Settings → Plugins** press **Reload**. "Joint check" appears in the list.
2. Switch it on. The first time, URDF Forge asks for confirmation, because plugins run with the
   same access as the app.
3. Press <kbd>Mod</kbd>+<kbd>K</kbd> and type `joint`: your two commands are there.
4. **File → Export ROS 2 package**: the Export dialog has a **Joint table (Markdown)** button.
5. Ask a connected AI assistant to "run joint_problems".

## 4. Iterate

Edit `main.js`, then press **Reload** in **Settings → Plugins**. Everything the plugin
registered is removed and registered again, so there is no need to restart the app.

Errors from `activate` show as a notification and in the plugin list. For more detail, run the
app from source (`npm run app:dev`) and open the webview developer tools.

## Going further

- **Importers**: `api.importers.register({ extensions: ["ply"], label: "PLY", import(bytes, name) { … } })`
  returns parts as triangle soups in metres. See `plugins/examples/obj-importer`.
- **Meshes**: `api.meshes.get(id)` reads a part's triangles; `api.meshes.add(name, positions)`
  adds one.
- **Selection**: `api.model.selection()`, `api.model.select(...)` and
  `api.model.onChange(fn)` let a plugin react to what the user is doing.
- **Dependencies**: plugins load as a single ES module. Bundle libraries into `main.js` with
  esbuild or Rollup (`format: "esm"`).

The full API is described in [docs/plugins.md](../plugins.md) and typed in
[`src/plugins/api.ts`](../../src/plugins/api.ts). Two complete examples are in
[`plugins/examples`](../../plugins/examples).
