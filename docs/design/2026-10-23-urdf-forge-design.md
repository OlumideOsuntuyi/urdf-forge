# URDF Forge — Design

Status: accepted · 2026-10-23

## Intent

URDF Forge is an open-source desktop and tablet application that turns CAD output (STEP and
STL) into ROS 2 robot description packages. A user imports a model, breaks it into links, sets
the hierarchy, origins and joints, checks it in a live viewport and a physics preview, and
exports a package that builds with `colcon` and spawns in the Gazebo release that matches their
ROS 2 distribution.

It replaces the earlier Python + browser prototype (`urdf-forge/` in the repository root),
which proved the model, the mass-property maths and the URDF generator but needed a Python
server and a browser, could not read STEP, and could not run on Android.

## Goals

- One codebase that ships native installers for Windows, macOS, Linux and an APK for Android.
- Import STEP/STP (OpenCascade, compiled to WebAssembly) and STL (binary and ASCII).
- Break imports down: one part per STEP body, and split STL files into connected components.
  Each part can become a link in one click, or all parts at once.
- Edit the kinematic tree: drag-and-drop hierarchy, joint type/axis/limits/dynamics/mimic,
  link origin (pivot) independent of the mesh, mesh offset inside the link, face-to-face mating.
- Viewport: shaded, wireframe, shaded + wireframe and x-ray modes; optional lighting rig and
  shadows; toggles for link frames, joint axes, centre of mass, inertia boxes, collision
  geometry, grid and world origin; standard views and frame-selection.
- Simulation preview: a kinematic pose mode (joint sliders, animated wheels/servos) and a
  physics mode (Rapier) with position-controlled servos and velocity-controlled wheels.
- Export for current ROS 2 distributions and their paired Gazebo releases: URDF per target,
  one switchable xacro, SDF, launch files, ros2_control config, RViz config, `package.xml`,
  `CMakeLists.txt`. Import existing URDF.
- Plugins: JavaScript modules that add commands, importers, exporters and MCP tools.
- MCP: the desktop app can run a local Model Context Protocol server (Streamable HTTP on
  127.0.0.1) so an AI assistant can inspect and edit the open robot.
- A polished interface with dark, light and additional themes, a command palette and
  keyboard-first editing, usable with touch on Android tablets.
- Every open-source necessity: licence, contribution guide, code of conduct, security policy,
  issue/PR templates, CI on all platforms, release automation, changelog, docs.

## Non-goals (for 1.0)

- Being a CAD tool: no sketching, booleans or B-rep editing. Geometry is tessellated on import.
- ROS 1 output. Noetic is end-of-life; the prototype's ROS 1 path is dropped.
- Running ROS or Gazebo inside the app. The physics preview is a sanity check, not a
  replacement for Gazebo.
- Convex decomposition (V-HACD/CoACD). One convex hull per part, or primitives.

## Anti-goals

- An export that looks right but fails to spawn: every generated file must be valid for the
  distribution it names. Validation errors block nothing but are always visible.
- Silent unit mistakes: imports state the unit they assumed, and the user can change it.
- Plugins or MCP that can be reached from the network: the MCP server binds to loopback only,
  rejects non-local `Origin` headers, and is off until the user turns it on.

## Architecture

- **Shell:** Tauri 2 (Rust). Owns native file dialogs, file system access, the plugin folder,
  and the MCP HTTP server. Kept thin so almost everything runs — and is tested — as TypeScript.
- **Core (`src/core`)**: framework-free TypeScript. Robot model types, mesh maths (STL, mass
  properties, convex hull, decimation, connected components), STEP import, URDF/xacro/SDF
  generation, URDF import, validation, package assembly, project files. Unit-tested with Vitest.
- **Viewport (`src/viewport`)**: a three.js scene manager. React never touches three.js objects.
- **Simulation (`src/sim`)**: kinematic posing and a Rapier physics world built from the model.
- **UI (`src/ui`)**: React 19 + Zustand store. Commands are registered once in a command
  registry and reused by menus, the toolbar, keyboard shortcuts, the command palette, plugins
  and MCP tools.
- **Platform (`src/platform`)**: one interface with a Tauri implementation and a browser
  implementation, so the whole app also runs in a browser with `npm run dev`.

## Decisions (builder's calls, open to change)

- Licence: Apache-2.0 (the ROS ecosystem default, includes a patent grant). OpenCascade
  (via `occt-import-js`) is LGPL-2.1 and ships as a separate, replaceable WebAssembly file.
- Coordinate convention: Z-up, metres, radians, URDF RPY (fixed-axis XYZ = intrinsic ZYX).
- Project file: `.forge` — a zip holding `project.json` and the mesh files it references.
- Mesh export format: binary STL (universally supported by Gazebo and RViz).
- MCP transport: Streamable HTTP, JSON responses (no SSE stream), default port 8765.
- Themes: Forge Dark (default), Forge Light, Midnight, Nord, Solarized Light, High Contrast.
