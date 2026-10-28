# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Opening a `.xacro` runs the system `xacro` (ROS 2 sourced), so macros, arguments, includes
  and `$(find pkg)` resolve. Meshes a URDF points to on disk (`file://`, `package://` in a
  source checkout, relative paths) load without selecting them.
- Gazebo sensors in `<gazebo reference>` blocks are imported (lidar, camera, depth and RGB-D
  camera, IMU, contact, force-torque), and a new RGB-D camera sensor type.
- Export option for a `diff_drive_controller` on differential and skid-steer bases.
- Optional MCP access token (`Authorization: Bearer`).
- Component library: parametric shapes, structural parts, actuators, wheels, sensors,
  electronics and ready-made assemblies, inserted as links with joints and drives.
- Sample gallery: open-source robots and environments downloaded on demand from their
  original repositories and Gazebo Fuel, cached locally, with licence and attribution.
- Test environments: flat ground, ramps, stairs, obstacle course, rough terrain, maze,
  warehouse aisle and table top, plus downloadable SDF worlds. The chosen environment is
  used by the physics preview and exported as the default Gazebo world.
- Collada (DAE) and OBJ meshes in URDF import.
- Simulation behaviours: wheeled drive with keyboard and on-screen teleop (differential,
  skid-steer, steered, omni and mecanum bases), trot and step gaits for legged robots, and
  waypoint cycles for arms and grippers. Chosen automatically, or picked from the mode bar.
- Materials: 29 physically based presets, ambientCG PBR textures (colour, normal, roughness,
  metalness, AO) with box-projected UVs, clear coat, and HDRI reflections and backgrounds.
  Textured meshes export as OBJ with UVs and Gazebo PBR materials; projects save textures.
- Lit (PBR) and unlit shading toggle (<kbd>U</kbd>).
- Infinite world grid with adaptive or fixed spacing.
- Sample gallery thumbnails, rendered locally the first time a robot is opened.
- MCP tools `list_components`, `add_component`, `set_environment`, `list_samples` and
  `open_sample`. The MCP server is now on by default (still local only).
- HOWTOUSE.md and seven step-by-step tutorials in `docs/tutorials`.

### Changed

- Robots stand on the floor: the viewport and physics lift a robot whose root frame is
  mid-body (legged robots, humanoids) so its lowest point touches z = 0.
- Links on fixed joints are merged into their parent's rigid body in the physics preview, as
  Gazebo does, which keeps light casters and sensor mounts from making the solver wobble.

### Fixed

- URDFs that repeat a material on every visual (xacro output) imported duplicates that made
  the exported URDF fail `check_urdf` and `robot_state_publisher`.
- A massless root frame (such as `base_footprint`) is exported without inertia, which KDL
  does not support.
- No geometry warnings for pure frames such as `camera_optical_frame`.
- Contact sensors named a collision that no longer exists once Gazebo merges fixed-joint
  links, so they never reported contacts. They now list every collision of their link under
  the name Gazebo gives it.
- Physics preview: joint limits were not applied and servos could not hold position against
  gravity. Motors are now force-based with gains derived from each joint's effort limit.
- URDF import gave links without `<inertial>` a 0.1 kg default mass, shifting the centre of
  mass (a TurtleBot3 tipped onto its nose). They are now massless frames, as in URDF.
- URDF continuous joints without `<limit>` were capped at 2 rad/s; they now have no practical
  velocity limit, so imported wheeled robots drive at full speed.
- Overlays and frames were sized wrongly for meshes modelled in millimetres with a 0.001 scale.

## [0.1.0] - 2026-10-24

First public version, a rewrite of the earlier Python/browser prototype as a cross-platform
Tauri application.

### Added

- STEP, IGES and BREP import through OpenCascade (WebAssembly), with unit conversion,
  assembly names and colours; STL import with unit detection and body splitting.
- Import review dialog: choose bodies, units and link layout.
- URDF import.
- Link tree editing with drag-and-drop reparenting that preserves world poses.
- Joint editing: all URDF joint types, axis presets, limits, dynamics, mimic and safety
  controllers.
- Move / rotate gizmo for links, link origins (pivots) and meshes; face mating; snapping.
- Exact mass properties from closed meshes; collision generation (primitives, convex hull,
  simplified mesh).
- Sensors: IMU, camera, depth camera, lidar, contact, force-torque.
- Viewport: four shading modes, optional lighting, shadows and reflections, and overlays for
  frames, joint axes, centres of mass, inertia and collisions.
- Pose mode with joint sliders and wheel/servo animation; Rapier physics preview with motors.
- Export for ROS 2 Humble, Jazzy, Kilted, Lyrical and Rolling with their Gazebo releases:
  URDF, xacro, SDF, launch files, ros2_control and ros_gz_bridge configuration, world file,
  package.xml and CMakeLists.txt.
- Validation panel.
- `.forge` project files.
- Plugin system (API version 1) with example plugins.
- MCP server (Streamable HTTP on 127.0.0.1) with tools to inspect and edit the robot.
- Six themes, three densities, command palette and keyboard shortcuts.
- Builds for Windows, macOS, Linux and Android.

[Unreleased]: https://github.com/OlumideOsuntuyi/urdf-forge/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/OlumideOsuntuyi/urdf-forge/releases/tag/v0.1.0
