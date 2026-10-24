# How to use URDF Forge

Short answers to "how do I…?", grouped by task. For complete walkthroughs see the
[tutorials](docs/tutorials/README.md); for every option in detail see the
[user guide](docs/user-guide.md).

<kbd>Mod</kbd> means <kbd>Ctrl</kbd> on Windows, Linux and Android keyboards and <kbd>⌘</kbd> on
macOS. Every action is also in the command palette (<kbd>Mod</kbd>+<kbd>K</kbd>): start typing
what you want.

## Contents

- [The window at a glance](#the-window-at-a-glance)
- [Get a robot into the app](#get-a-robot-into-the-app)
- [Build the link tree](#build-the-link-tree)
- [Place joints and origins](#place-joints-and-origins)
- [Mass, collisions and sensors](#mass-collisions-and-sensors)
- [Materials and looks](#materials-and-looks)
- [View and navigate](#view-and-navigate)
- [Test in pose and physics](#test-in-pose-and-physics)
- [Export to ROS 2](#export-to-ros-2)
- [Save, undo and projects](#save-undo-and-projects)
- [AI assistants and plugins](#ai-assistants-and-plugins)
- [Tablets and touch](#tablets-and-touch)
- [Troubleshooting](#troubleshooting)
- [Keyboard shortcuts](#keyboard-shortcuts)

## The window at a glance

| Area                       | Where        | What it does                                                                |
| -------------------------- | ------------ | --------------------------------------------------------------------------- |
| Robot / Components / Parts | left panel   | The link tree, the parametric component library, and imported parts         |
| Viewport                   | centre       | Tools (left), shading and overlays (top right), mode bar (bottom)           |
| Inspector                  | right panel  | Properties of the selection, or of the whole robot when nothing is selected |
| Problems / Joints          | bottom panel | Validation results and joint sliders (<kbd>Mod</kbd>+<kbd>J</kbd>)          |
| Status bar                 | bottom edge  | Problem count, robot size, export target and MCP status                     |

Toggle the side panels with <kbd>Mod</kbd>+<kbd>B</kbd> (left) and
<kbd>Mod</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> (right).

## Get a robot into the app

**Import a STEP, IGES or BREP file.** **File → Import** (<kbd>Mod</kbd>+<kbd>I</kbd>) or drop the
file on the window. Units come from the file. Pick **One link per body** for an assembly,
**One rigid link** for a single part, or **Parts only** to just fill the Parts library. Untick
**Skip tiny parts** if you need the screws.

**Import STL, OBJ or DAE meshes.** Same dialog. STL has no units, so check the overall size the
dialog shows and change the unit (mm, cm, m, in) if it is wrong.

**Change the STEP tessellation quality.** **Settings → General → STEP quality**. Finer is
smoother but heavier.

**Open an existing URDF.** **File → Import** and select the `.urdf` file together with its mesh
files.

**Start from a sample robot.** **File → Browse sample robots** (<kbd>Mod</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd>).
Filter by category, click a card to download and open it. Downloads are cached; the bin icon on
a card removes the cached copy. Check the licence on the card before you redistribute a robot.

**Build from parts instead of CAD.** Open the **Components** tab in the left panel, click a
component, set its dimensions, choose the link to attach it to and press **Insert**. See
[Tutorial 2](docs/tutorials/02-rover-from-components.md).

## Build the link tree

**Make a link the child of another.** Drag it onto the parent in the Robot tree. Its world
position does not change.

**Turn a part into a link.** Drag it from **Parts** onto a link in the tree. Hold <kbd>Alt</kbd>
to add the mesh to that link instead of creating a new one.

**Add an empty or primitive link.** <kbd>Shift</kbd>+<kbd>A</kbd> adds an empty link; the
palette has **Add box / cylinder / sphere link**.

**Delete a link but keep its children.** <kbd>Shift</kbd>+<kbd>Delete</kbd>. Plain
<kbd>Delete</kbd> removes the link and everything under it.

**Duplicate a link.** <kbd>Mod</kbd>+<kbd>D</kbd>.

**Hide a link while you work.** <kbd>H</kbd>. Hidden links are still exported.

**Rename things.** Double-click a name in the tree, or edit the name in the inspector. Names
must be unique; the Problems panel tells you when they are not.

## Place joints and origins

A joint sits at the child link's **origin**. Imported links start with the origin at the centre
of their geometry, which is rarely where the hinge is.

**Move the origin without moving the geometry.** Select the link, press <kbd>W</kbd> (move) or
<kbd>E</kbd> (rotate), then <kbd>T</kbd> until the gizmo bar says **Origin**, and drag.
<kbd>T</kbd> cycles **Link** (moves everything, children too) → **Origin** (frame only) →
**Mesh** (geometry only).

**Type exact values.** Use the **Origin** fields in the inspector. They accept maths and units:
`25mm`, `1.5in`, `90deg`, `pi/2`, `0.1+0.025`.

**Snap the origin.** Inspector buttons, or the palette: **Move link origin to geometry centre**,
**to centre of mass**, **Align link origin with parent frame**, **Reset link origin rotation**.

**Seat one part against another.** Press <kbd>F</kbd> (mate faces), click a face on the part
that should move, then click the face it should sit against.

**Switch between world and local gizmo axes.** <kbd>X</kbd>. Toggle snapping with
<kbd>S</kbd>.

**Set the joint type, axis and limits.** In the inspector's **Joint** section: type, axis (X/Y/Z
presets, flip, or any vector in the link's frame), lower and upper limits, effort, velocity,
damping and friction. Turn on **Joint axes** (<kbd>J</kbd>) to see them in the viewport.

**Make one joint follow another (mimic).** In the joint section, choose the leader joint and set
the multiplier and offset. Grippers with two fingers usually mimic one joint.

## Mass, collisions and sensors

**Set the mass.** In the inspector's **Inertial** section, choose **density** (mass from volume)
or **mass** (inertia scaled to the total you know). Inertia is exact for closed meshes; open
meshes get a warning. Turn on **Inertia boxes** and **Centres of mass** to sanity-check.

**Recompute everything after changing geometry.** Palette → **Recompute inertia of all links**.

**Set collision geometry.** In the **Collision** section, or the palette: fitted box, cylinder or
sphere, convex hull, simplified mesh, or the same as the visual. Primitives simulate fastest.
Show collisions with <kbd>C</kbd>.

**Add a sensor.** In the inspector's **Sensors** section: IMU, camera, depth camera, lidar,
contact or force-torque. They are exported with their Gazebo plugins and bridge topics.
Components in the **Sensors** category already include one.

## Materials and looks

**Give a link a colour or material.** In the inspector's **Material** section pick a material,
or click the palette icon next to it to open the material library (<kbd>M</kbd>).

**Use a realistic preset.** Material library → **Presets**: anodised aluminium, brushed steel,
carbon fibre, rubber, ABS, PLA, glass and more, each with physically based metalness, roughness
and clear coat.

**Use a PBR texture.** Material library → **PBR textures (ambientCG)**. Search over 2000 CC0
materials, choose 1K or 2K, and click one to download and apply it. Textured meshes are exported
with UVs, and Gazebo gets the colour, normal, roughness, metalness and AO maps.

**Change reflections or the background.** Material library → **Reflections (HDRI)**, or the
viewport's lighting popover: **Studio**, **Neutral** or any ambientCG HDRI, with an optional
HDRI background.

**Switch between lit and flat shading.** <kbd>U</kbd> toggles **Lit** (physically based) and
**Unlit** (flat colours, easy to read). <kbd>L</kbd> toggles studio lighting.

**Change the theme.** **Settings → Appearance**: Forge Dark, Forge Light, Midnight, Nord,
Solarized Light, High Contrast, or follow the system, plus compact, comfortable and touch
densities. The sun/moon button in the title bar switches light and dark.

## View and navigate

| To                      | Do                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Orbit / pan / zoom      | Left-drag / right- or middle-drag / scroll (one, two fingers on touch)                                                                |
| Frame everything        | <kbd>Home</kbd>                                                                                                                       |
| Frame the selection     | <kbd>.</kbd>                                                                                                                          |
| Standard views          | <kbd>1</kbd> iso, <kbd>2</kbd> front, <kbd>3</kbd> right, <kbd>4</kbd> back, <kbd>5</kbd> left, <kbd>6</kbd> bottom, <kbd>7</kbd> top |
| Cycle shading           | <kbd>Z</kbd> (shaded, edges, wireframe, x-ray)                                                                                        |
| Grid on/off             | <kbd>G</kbd>                                                                                                                          |
| Grid spacing            | Lighting/grid popover, or palette **Grid: adaptive spacing** / **Grid: fixed 1 cm** …                                                 |
| Link frames, joint axes | <kbd>O</kbd>, <kbd>J</kbd>                                                                                                            |
| Collision geometry      | <kbd>C</kbd>                                                                                                                          |

Adaptive grid spacing follows the zoom level; fixed spacing stays at the size you choose (1 mm to
1 m), which is handy for measuring.

## Test in pose and physics

The mode bar at the bottom of the viewport switches **Edit** (<kbd>F5</kbd>), **Pose**
(<kbd>F6</kbd>) and **Physics** (<kbd>F7</kbd>).

**Move joints by hand.** Pose mode, then the sliders in the **Joints** tab of the bottom panel.

**Animate the drives.** <kbd>Space</kbd> plays and pauses; <kbd>Shift</kbd>+<kbd>R</kbd>
resets. Wheels spin at their drive velocity, servos sweep or go to their target. Set drives per
joint under **Drive and control** in the inspector.

**Drive a wheeled robot.** In Pose or Physics mode with the **Wheeled drive** behaviour:
<kbd>W</kbd> <kbd>S</kbd> forward and back, <kbd>A</kbd> <kbd>D</kbd> turn, <kbd>Q</kbd>
<kbd>E</kbd> strafe (omni and mecanum bases), <kbd>Space</kbd> stops. On touch screens use the
on-screen pad. Differential, skid-steer, steered (Ackermann-style), omni and mecanum bases are
detected from the wheels.

**Make a legged robot walk.** Choose **Legged gait**: quadrupeds trot, bipeds step. The same
keys steer.

**Run an arm through poses.** Choose **Arm waypoints**: the arm cycles home and a few reachable
poses, opening and closing the gripper if it has one.

**Pick or change the behaviour.** The behaviour button on the mode bar (for example **Wheeled
drive**). **Auto** chooses from the robot's joints.

**Pick a test environment.** The globe button on the mode bar, or **Simulate → Environment**:
flat ground, ramps, stairs, obstacle course, rough terrain, maze, warehouse aisle or table top.
**Choose environment…** downloads Gazebo Fuel and AWS RoboMaker worlds. The environment you pick
also becomes the exported Gazebo world.

**Fix the base in place, or turn gravity off.** The physics options button (sliders icon) on the
mode bar. Robots with wheels or legs start with a free base, arms with a fixed one. Motor
strength comes from each joint's effort limit.

## Export to ROS 2

**Export a package.** **File → Export ROS 2 package** (<kbd>Mod</kbd>+<kbd>E</kbd>). Tick the
distributions, turn on **ros2_control** if you want controllers, and export to a folder in your
workspace's `src`, or as a zip. The dialog previews every file.

**Export only a URDF or SDF.** **File → Export URDF file** or **Export SDF model**.

**Build and launch it.**

```bash
cd ~/ros2_ws && colcon build --packages-select <robot>_description
source install/setup.bash
ros2 launch <robot>_description display.launch.py                  # RViz with joint sliders
ros2 launch <robot>_description gazebo_jazzy-harmonic.launch.py    # Gazebo
```

Launch arguments: `x:=`, `y:=`, `z:=` for the spawn position and `world:=/path/to/world.sdf` to
use another world. See [Tutorial 5](docs/tutorials/05-export-and-run-in-gazebo.md).

**Fix problems before exporting.** Open the **Problems** tab (<kbd>Mod</kbd>+<kbd>J</kbd>).
Click a problem to select the link it is about.

## Save, undo and projects

- **Save** (<kbd>Mod</kbd>+<kbd>S</kbd>) writes a `.forge` file with the robot, every mesh and
  every texture. **Open** with <kbd>Mod</kbd>+<kbd>O</kbd>.
- **Undo / redo**: <kbd>Mod</kbd>+<kbd>Z</kbd> and <kbd>Mod</kbd>+<kbd>Y</kbd> (or
  <kbd>Mod</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>). Every edit is undoable, including edits made by
  plugins and AI assistants.
- Exported packages include a copy of the project as `<robot>.forge.json`.

## AI assistants and plugins

**Connect an AI assistant.** The MCP server is on by default at `http://127.0.0.1:8765/mcp` and
only accepts local connections. **Settings → AI assistants (MCP)** has copy buttons for client
configuration. See [docs/mcp.md](docs/mcp.md) and
[Tutorial 6](docs/tutorials/06-automate-with-mcp.md).

**Install a plugin.** **Settings → Plugins → Open folder**, copy the plugin's folder in, press
**Reload** and switch it on. Only enable code you trust.

**Write a plugin.** See [docs/plugins.md](docs/plugins.md) and
[Tutorial 7](docs/tutorials/07-write-a-plugin.md).

## Tablets and touch

- On narrow screens the side panels become drawers: open them from the menu button in the title
  bar.
- Choose the **touch** density in **Settings → Appearance** for larger targets.
- One finger orbits, two fingers pan and pinch to zoom.
- In physics mode an on-screen drive pad replaces the keyboard.

## Troubleshooting

| Symptom                                      | Try                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| The model is 1000 times too big or too small | Re-import and change the unit in the import dialog (STL has no units)                                                    |
| A joint rotates about the wrong point        | Move the link **Origin** (not the link) to the hinge: <kbd>W</kbd>, then <kbd>T</kbd>                                    |
| A joint rotates the wrong way                | Flip the axis in the inspector                                                                                           |
| The robot explodes or jitters in physics     | Check masses and inertia boxes; use primitive collisions; avoid overlapping collisions between parent and child          |
| A wheeled robot doesn't move                 | Wheels need continuous joints with a horizontal axis and must touch the ground; check the behaviour is **Wheeled drive** |
| A sample won't download                      | Check your connection; the sample's server may be down. Cached samples open offline                                      |
| Gazebo can't find meshes                     | Build and `source install/setup.bash` in the same terminal before launching                                              |
| The AI assistant can't connect               | Check the MCP indicator in the status bar and the port in **Settings**                                                   |

Still stuck? [Open an issue](https://github.com/OlumideOsuntuyi/urdf-forge/issues/new/choose).

## Keyboard shortcuts

Press <kbd>?</kbd> in the app for this list.

| Action                          | Shortcut                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Command palette                 | <kbd>Mod</kbd>+<kbd>K</kbd> or <kbd>Mod</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>                          |
| New / open / save               | <kbd>Mod</kbd>+<kbd>N</kbd> / <kbd>Mod</kbd>+<kbd>O</kbd> / <kbd>Mod</kbd>+<kbd>S</kbd>              |
| Save as                         | <kbd>Mod</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>                                                         |
| Import                          | <kbd>Mod</kbd>+<kbd>I</kbd>                                                                          |
| Browse sample robots            | <kbd>Mod</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd>                                                         |
| Export ROS 2 package            | <kbd>Mod</kbd>+<kbd>E</kbd>                                                                          |
| Undo / redo                     | <kbd>Mod</kbd>+<kbd>Z</kbd> / <kbd>Mod</kbd>+<kbd>Y</kbd>                                            |
| Delete / keep children          | <kbd>Delete</kbd> / <kbd>Shift</kbd>+<kbd>Delete</kbd>                                               |
| Duplicate link                  | <kbd>Mod</kbd>+<kbd>D</kbd>                                                                          |
| Add empty link                  | <kbd>Shift</kbd>+<kbd>A</kbd>                                                                        |
| Select parent / clear           | <kbd>↑</kbd> / <kbd>Esc</kbd>                                                                        |
| Select, move, rotate tools      | <kbd>Q</kbd>, <kbd>W</kbd>, <kbd>E</kbd>                                                             |
| Gizmo target (link/origin/mesh) | <kbd>T</kbd>                                                                                         |
| World / local space, snapping   | <kbd>X</kbd>, <kbd>S</kbd>                                                                           |
| Mate faces                      | <kbd>F</kbd>                                                                                         |
| Hide / show link                | <kbd>H</kbd>                                                                                         |
| Frame all / selection           | <kbd>Home</kbd> / <kbd>.</kbd>                                                                       |
| Views                           | <kbd>1</kbd>–<kbd>7</kbd>                                                                            |
| Cycle shading                   | <kbd>Z</kbd>                                                                                         |
| Lit / unlit, studio lighting    | <kbd>U</kbd>, <kbd>L</kbd>                                                                           |
| Grid, frames, axes, collisions  | <kbd>G</kbd>, <kbd>O</kbd>, <kbd>J</kbd>, <kbd>C</kbd>                                               |
| Material library                | <kbd>M</kbd>                                                                                         |
| Toggle panels                   | <kbd>Mod</kbd>+<kbd>B</kbd>, <kbd>Mod</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd>, <kbd>Mod</kbd>+<kbd>J</kbd> |
| Edit / pose / physics           | <kbd>F5</kbd> / <kbd>F6</kbd> / <kbd>F7</kbd>                                                        |
| Play / pause, reset             | <kbd>Space</kbd>, <kbd>Shift</kbd>+<kbd>R</kbd>                                                      |
| Drive (teleop)                  | <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows, <kbd>Q</kbd>/<kbd>E</kbd> strafe         |
| Settings                        | <kbd>Mod</kbd>+<kbd>,</kbd>                                                                          |
| Shortcut list                   | <kbd>?</kbd>                                                                                         |
