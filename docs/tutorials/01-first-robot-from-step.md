# Tutorial 1: Your first robot from a STEP file

In this tutorial you turn a CAD assembly into a robot description: a two-joint pan-tilt
turret with a base, a yaw stage and a tilting head. The same steps work for any assembly.

**You will learn to:** import STEP, split bodies into links, build the tree, put joint origins
on the hinges, set axes and limits, and check the result in pose mode.

**Time:** about 20 minutes.

## What you need

A STEP file of an assembly with separate bodies. Any mechanism you have designed will do. If
you have none, export a simple one from your CAD tool (FreeCAD, Onshape and Fusion all export
STEP), or skip to [Tutorial 2](02-rover-from-components.md) and build one from components.

Before exporting from CAD, it helps to:

- keep moving parts as separate bodies (fasteners can stay; you can skip them on import);
- model in real units (URDF Forge converts to metres for you);
- note where each hinge is and which way it turns.

## 1. Import

1. **File → Import** (<kbd>Mod</kbd>+<kbd>I</kbd>), or drop the `.step` file on the window.
2. The import dialog lists every body with its size. Check the overall size looks right; STEP
   carries its units, so it usually does.
3. Leave **Skip tiny parts** ticked to drop screws and washers.
4. Choose **One link per body** and press **Import**.

Each body becomes a link attached to the largest body. The Robot tree on the left now has a
root link and one child per body, all on fixed joints.

> **Tip:** if the parts look faceted, raise **Settings → General → STEP quality** and import
> again.

## 2. Build the tree

A URDF is a tree: every link except the root has exactly one parent and one joint to it.

1. Decide the chain. For the turret: `base` → `yaw_stage` → `head`.
2. Rename links to match: double-click a name in the tree (or edit **Name** in the inspector).
   Use `snake_case`; ROS tools prefer it.
3. Drag `head` onto `yaw_stage`. It keeps its place in the world; only its parent changes.
4. Merge parts that move together. If the yaw stage is several bodies, drag the extra parts
   onto `yaw_stage` and set their joints to **fixed**, or select a part in **Parts** and drag it
   onto the link with <kbd>Alt</kbd> held to add the mesh to that link directly.

## 3. Put the joint where the hinge is

Imported links start with their origin (the joint frame) at the centre of their geometry. A
revolute joint rotates about its origin, so move the origin to the hinge without moving the
geometry.

1. Select `yaw_stage`.
2. Press <kbd>W</kbd> for the move gizmo, then <kbd>T</kbd> until the gizmo bar shows
   **Origin**.
3. Drag the gizmo onto the yaw bearing's centre. The mesh stays put; the frame moves.
4. For precision, type the values in **Origin** in the inspector instead. Fields understand
   units and maths: `42mm`, `0.5in`, `0.1+0.012`.

Other helpers:

- **Mate faces** (<kbd>F</kbd>): click a face on the moving part, then the face it should sit
  on. Good for seating a part flush.
- **Move link origin to geometry centre** puts the origin in the middle of a round part, for
  example a shaft or a wheel. **Align link origin with parent frame** copies the parent's
  orientation.

Turn on **Link frames** (<kbd>O</kbd>) to see every origin as a small RGB axis triad (X red,
Y green, Z blue).

## 4. Set joint type, axis and limits

With `yaw_stage` selected, in the inspector's **Joint** section:

1. **Type:** revolute.
2. **Axis:** Z (the yaw stage turns about vertical). Axes are in the link's own frame.
3. **Limits:** lower `-170deg`, upper `170deg`. Effort `2` (N·m) and velocity `3` (rad/s) are
   reasonable for a hobby servo.

Repeat for `head`: revolute about its tilt axis (often Y), limits `-45deg` to `90deg`.

Turn on **Joint axes** (<kbd>J</kbd>) to see each axis as an arrow with its rotation
direction. If a joint turns the wrong way, press **Flip** next to the axis.

## 5. Check mass and collisions

1. Select each link and look at **Inertial**. Mass comes from volume times density; set the
   density of your material (PLA is about 1250 kg/m³, aluminium 2700 kg/m³) or switch to
   **mass** and type the weight you measured.
2. A warning icon means the mesh is open, so its volume (and mass) is only approximate.
3. Turn on **Centres of mass** and **Inertia boxes** to sanity-check them.
4. Under **Collision**, the default fitted box is fine for most parts. Use **cylinder** for
   round parts and **convex hull** for odd shapes. Show collisions with <kbd>C</kbd>.

## 6. Try it

1. Press <kbd>F6</kbd> for **Pose** mode and open the **Joints** tab
   (<kbd>Mod</kbd>+<kbd>J</kbd>).
2. Drag the sliders. The head should tilt about its hinge and the yaw stage should carry it.
3. In **Drive and control** for each joint, choose **servo** and tick **Sweep**, then press
   <kbd>Space</kbd>: the turret scans back and forth.
4. Press <kbd>F7</kbd> for **Physics**. Arms and turrets start with a fixed base, so it stays
   put while gravity and the servos act on the joints.

## 7. Validate and save

1. Open the **Problems** tab. Fix any errors (red); read the warnings (amber). Clicking a
   problem selects the link it is about.
2. **File → Save** (<kbd>Mod</kbd>+<kbd>S</kbd>) writes a `.forge` project with every mesh in
   it.

## Next

- Make it look right: [Tutorial 4, Materials](04-materials-and-lighting.md).
- Ship it to ROS: [Tutorial 5, Export and run in Gazebo](05-export-and-run-in-gazebo.md).
