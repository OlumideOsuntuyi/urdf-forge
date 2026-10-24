# Architecture

URDF Forge is a Tauri 2 application: a thin Rust shell around a TypeScript application that
runs in the platform webview (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux,
Android System WebView on Android). Almost all logic is TypeScript so it is shared by every
platform and testable with Vitest.

```
┌──────────────────────────── webview ────────────────────────────┐
│ React UI (src/ui)        ──▶ command registry (src/commands)     │
│   panels, dialogs,            ▲   ▲            ▲                 │
│   palette, shortcuts          │   │            │                 │
│                               │   plugins      MCP tools         │
│ Zustand store (src/store) ◀───┘   (src/plugins) (src/mcp)        │
│   model (immutable), selection, view, history                    │
│        │                                                         │
│        ├──▶ Viewport (src/viewport, three.js)                    │
│        ├──▶ Simulation (src/sim: kinematics, Rapier physics)     │
│        └──▶ Core (src/core): model, geometry, inertia,           │
│             URDF/xacro/SDF/package export, URDF import,          │
│             validation, project files                            │
│ CAD worker (src/workers) ── OpenCascade WebAssembly              │
└───────────────▲─────────────────────────────▲───────────────────┘
                │ Tauri IPC                    │ events
┌───────────────┴──────── Rust (src-tauri) ────┴───────────────────┐
│ dialog / fs / opener / os plugins     MCP HTTP server (mcp.rs)    │
└───────────────────────────────────────────────────────────────────┘
```

## Principles

- **The model is data.** `RobotModel` (src/core/model.ts) is plain JSON. Every edit clones it,
  mutates the clone and stores the previous version for undo (`app().edit`). Mesh geometry is
  large and immutable, so it lives outside the model in `meshStore`, keyed by asset id.
- **One action, one command.** Menus, toolbar buttons, keyboard shortcuts, the palette,
  plugins and MCP all run the same registered commands, so behaviour never diverges.
- **React never touches three.js.** The `Viewport` class receives plain state through
  `update()` and reports picks and gizmo drags through callbacks. It renders on demand only.
- **Core has no UI.** Everything that can be checked without a window lives in `src/core` and
  has tests.

## Coordinates

REP 103 throughout: metres, kilograms, radians, right-handed, Z up. Orientations are URDF
roll-pitch-yaw (R = Rz·Ry·Rx), which is three.js Euler order `"ZYX"`. A link's `origin` is its
joint origin: the pose of the link frame in the parent link frame at zero joint position.
Visual and collision `origin`s are relative to the link frame.

## Import pipeline

STEP/IGES/BREP bytes go to a Web Worker running occt-import-js, which tessellates the B-rep
(`linearUnit: "meter"`) and returns one mesh per shape with the assembly tree. STL is parsed on
the main thread, split into connected components, and given a unit guess. Either way the user
reviews the bodies in the import dialog before `importPartsIn` creates mesh assets and links.

## Export

`buildPackage` (src/core/ros/package.ts) produces a map of relative paths to file contents.
Target-specific details (plugin names, message namespaces, resource-path variables) come from
`TARGETS` in src/core/ros/targets.ts, so adding a distribution means adding one entry there.

## Simulation

Pose mode applies joint values through forward kinematics (src/core/kinematics.ts). Physics
mode builds a Rapier world: each link is a rigid body created world-aligned at its link
origin, so a joint axis is the same vector for both bodies; colliders and mass properties are
expressed relative to that body frame, and a fixed per-body offset maps body poses back to
link frames for display. Rapier is loaded lazily the first time physics is used.

## MCP

See [mcp.md](mcp.md). The Rust server answers protocol plumbing and forwards tool calls to the
webview, where the tool registry lives, so plugins can add tools.
