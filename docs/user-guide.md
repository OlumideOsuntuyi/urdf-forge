# User guide

A reference for every panel, mode and option. For quick task answers see
[HOWTOUSE.md](../HOWTOUSE.md); for guided projects see the [tutorials](tutorials/README.md).

## The window

- **Robot / Parts** (left): the link tree, and the library of imported parts.
- **Viewport** (centre): tools on the left, shading and overlays on the right, and the
  Edit / Pose / Physics switch at the bottom.
- **Inspector** (right): properties of the selection, or of the robot when nothing is selected.
- **Problems / Joints** (bottom, <kbd>Ctrl</kbd>+<kbd>J</kbd>): validation results and joint
  sliders.
- **Command palette** (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd>): every action, searchable.

## 1. Import

**File → Import** or drop files on the window.

- **STEP, IGES, BREP**: OpenCascade reads the file, converts its units to metres, and keeps
  part names and colours. Tessellation quality is in **Settings → General**.
- **STL**: STL has no units, so URDF Forge guesses from the size (a part 250 units across is
  probably millimetres). Check the overall size in the import dialog and change the unit if
  needed. An STL with several separate bodies is split into parts.
- **URDF**: select the URDF together with its mesh files.
- **.forge**: a saved project.

In the import dialog choose how bodies become links:

- **One link per body**: each body becomes a link, attached to the largest one (or to the
  current root). Best for assemblies exported from CAD.
- **One rigid link**: everything welded together.
- **Parts only**: just add to the library; build links by dragging parts into the tree.

**Skip tiny parts** unticks fasteners and other small bodies.

## Model from components

The **Components** tab (left panel) is a library of parametric parts you can build a whole
robot from, without CAD:

- **Shapes**: boxes, cylinders, tubes, cones, capsules, wedges, plates with hole grids,
  L- and U-brackets, gears.
- **Structure**: 2020/2040 aluminium extrusion, plates, standoffs, frames, chassis decks.
- **Actuators**: hobby and standard servos, Dynamixel-size smart servos, NEMA 17 steppers,
  gearmotors, linear actuators, BLDC motors. Each comes with its output joint already set up.
- **Wheels**: rubber wheels, casters, omni and mecanum wheels, track sprockets, on continuous
  joints with wheel drives.
- **Sensors**: 2D and 3D lidar, depth and RGB cameras, IMU, ultrasonic, contact and
  force-torque sensors, with Gazebo sensor definitions.
- **Electronics**: single-board computers, microcontroller boards, batteries, drivers.
- **Assemblies**: differential-drive and skid-steer bases, pan-tilt units, grippers, 3- and
  6-DOF arms, a quadruped leg.

Click a component, set its dimensions (the preview updates as you type), choose the link to
attach it to, and press **Insert**. Each part arrives with geometry, collision shapes, mass
properties and joints, so it works in Pose and Physics modes straight away.

## Samples

**File → Browse sample robots** (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd>) opens a
gallery of open-source robots: mobile bases, arms, quadrupeds, humanoids, grippers and more.
They are downloaded from their original repositories when you open them (nothing is bundled
with the app) and cached for next time; remove a download from its card. Each card shows the
licence and the authors; check the licence before you redistribute a robot.

Thumbnails are rendered on your machine: the first time you open a robot, its card gets a
picture. **Download all and render missing thumbnails** in the gallery fills in the rest in one
go (it downloads every robot, so it takes a while).

## 2. Build the tree

- Drag a link onto another link to make it a child. Its position in the world does not change.
- Drag a part from **Parts** onto a link to add it as a new child link; hold <kbd>Alt</kbd>
  to add it to that link instead.
- Right-click a link for common actions.
- Every link except the root has a joint to its parent; choose the type in the inspector.

## 3. Place joints

A joint sits at the link's **origin**. Imported links start with their origin at the centre
of their geometry, which is rarely where the hinge is. To move it:

1. Select the link and press <kbd>W</kbd> (move) or <kbd>E</kbd> (rotate).
2. Choose **Origin** in the gizmo bar (or press <kbd>T</kbd> to cycle Link → Origin → Mesh).
3. Drag the gizmo to the hinge. The geometry stays where it is; only the frame moves.

Other ways to place things:

- Type exact values in **Origin** in the inspector. Fields accept maths and units:
  `25mm`, `1.5in`, `90deg`, `pi/2`, `0.1+0.025`.
- **Mate faces** (<kbd>F</kbd>): click a face on the part to move, then the face it should sit
  against.
- **Centre**, **To COM**, **To parent** and **Square up** snap the origin.

Then set the **axis** (X/Y/Z presets, or any vector, in the link's frame), the limits, and
effort and velocity limits. Turn on **Joint axes** in the overlays to see them.

## 4. Mass and collisions

Mass and inertia are computed from the visual geometry at the density you set (or scaled to a
total mass you know). This is exact for closed meshes; a warning appears when a mesh is open.
Turn on **Inertia boxes** to sanity-check them.

Collision geometry starts as a fitted box. Replace it with a cylinder, sphere, convex hull, a
simplified mesh or a copy of the visual. Primitives simulate fastest.

## 5. Try it

- **Pose**: drag joint sliders (bottom panel). Press <kbd>Space</kbd> to animate: wheels spin
  at their drive velocity and servos sweep or move to their target.
- **Physics**: gravity, contacts and motors. Wheels are velocity-controlled, servos
  position-controlled. A robot with wheels starts with a free base; otherwise the base is
  fixed. Change that in the physics options.

Set drives per joint under **Drive and control** in the inspector.

### Behaviours

A behaviour is a small controller that drives the joints in Pose and Physics modes. The
behaviour button on the mode bar shows the active one; **Auto** picks one from the robot:

| Behaviour     | Chosen for                     | Controls                                                                                                                             |
| ------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Wheeled drive | robots with two or more wheels | <kbd>W</kbd>/<kbd>S</kbd> drive, <kbd>A</kbd>/<kbd>D</kbd> turn, <kbd>Q</kbd>/<kbd>E</kbd> strafe (holonomic), <kbd>Space</kbd> stop |
| Legged gait   | robots with two or four legs   | the same keys set stride, turning and side-stepping; quadrupeds trot, bipeds step                                                    |
| Arm waypoints | arms and grippers              | none: cycles home and reachable poses, opening and closing the gripper                                                               |
| None          | anything                       | drives from the inspector only                                                                                                       |

Wheels are found from continuous joints with a horizontal axis near the ground; the base type
(differential, skid-steer, steered, omni or mecanum) comes from their layout and names. On touch
screens an on-screen pad replaces the keyboard. Physics options (sliders button): **Fix the base
in place** and **Gravity**. Motor strength comes from each joint's effort limit.

Robots stand on the floor: when the root frame is mid-body (common on legged robots), the robot
is lifted so its lowest point touches the ground, in the viewport and in physics.

### Environments

The globe button at the bottom of the viewport picks the scene your robot is tested in:

| Environment     | Good for                                          |
| --------------- | ------------------------------------------------- |
| Flat ground     | everything                                        |
| Ramps (5–20°)   | traction, climbing, motor torque                  |
| Table top       | arms and grippers (the robot spawns on the table) |
| Stairs          | legged robots                                     |
| Obstacle course | navigation, bumpers, lidar                        |
| Rough terrain   | suspension, legged locomotion                     |
| Maze            | mapping and navigation                            |
| Warehouse aisle | mobile manipulation                               |

**Choose environment…** also offers downloadable Gazebo worlds and models. The chosen
environment is exported as the package's default Gazebo world, so
`ros2 launch <robot>_description gazebo_<target>.launch.py` opens the same scene; pass
`world:=/path/to/other.sdf` to override it.

## Materials and display

Each link's visual has a material: colour, metalness, roughness, optional clear coat and
optional texture maps. The **Material library** (<kbd>M</kbd>) has three tabs:

- **Presets**: 29 physically based materials (metals, plastics, filaments, rubber, paint, PCB,
  glass…).
- **PBR textures (ambientCG)**: search 2000+ CC0 materials, download at 1K or 2K, and apply.
  Maps are box-projected, so meshes need no UVs; textured meshes export as OBJ with UVs, and
  Gazebo gets PBR maps.
- **Reflections (HDRI)**: environment lighting for reflections, with an optional background.

Display settings, in the viewport's top-right controls and the **View** menu:

| Setting         | Options                                                         | Key          |
| --------------- | --------------------------------------------------------------- | ------------ |
| Lighting model  | Lit (physically based) or Unlit (flat colours)                  | <kbd>U</kbd> |
| Shading         | Shaded, shaded with edges, wireframe, x-ray                     | <kbd>Z</kbd> |
| Studio lighting | on/off, with shadows                                            | <kbd>L</kbd> |
| Reflections     | Studio, Neutral or an ambientCG HDRI; strength; HDRI background |              |
| Grid            | on/off; adaptive spacing, or fixed 1 mm to 1 m                  | <kbd>G</kbd> |

## 6. Export

**File → Export ROS 2 package** (<kbd>Ctrl</kbd>+<kbd>E</kbd>). Tick the distributions you need,
turn on **ros2_control** if you want controllers, and export to a folder in your workspace's
`src`, or save a zip. Then:

```bash
colcon build --packages-select <robot>_description
source install/setup.bash
ros2 launch <robot>_description display.launch.py                 # RViz + sliders
ros2 launch <robot>_description gazebo_jazzy-harmonic.launch.py   # Gazebo
```

With ros2_control on, the launch file starts `joint_state_broadcaster` plus a position
controller for servos and a velocity controller for wheels and continuous joints:

```bash
ros2 topic pub /velocity_controller/commands std_msgs/msg/Float64MultiArray "{data: [3, 3, 3, 3]}"
```

## Projects

**File → Save** writes a `.forge` file containing the robot and every mesh. Exported packages
also include a copy of the project as `<robot>.forge.json` for reference.
