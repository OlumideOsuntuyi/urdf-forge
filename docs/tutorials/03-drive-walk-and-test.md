# Tutorial 3: Drive, walk and test in physics

Use the physics preview to check a robot before it ever reaches ROS: drive a mobile base
through an obstacle course, make a quadruped trot over rough terrain, and run an arm through
its workspace on a table.

![A TurtleBot3 driven through the obstacle course](../images/physics-teleop.png)

**You will learn to:** open sample robots, switch modes, choose behaviours and environments,
drive with teleop, and tune the physics options.

**Time:** about 20 minutes. Needs an internet connection the first time each sample opens.

## The three modes

The bar at the bottom of the viewport switches mode:

| Mode    | Key           | What happens                                                                 |
| ------- | ------------- | ---------------------------------------------------------------------------- |
| Edit    | <kbd>F5</kbd> | Build and change the robot. Nothing moves on its own.                        |
| Pose    | <kbd>F6</kbd> | Kinematics only: sliders and behaviours move joints, no gravity or contacts. |
| Physics | <kbd>F7</kbd> | Rapier rigid-body simulation: gravity, contacts, friction and motors.        |

<kbd>Space</kbd> plays and pauses, <kbd>Shift</kbd>+<kbd>R</kbd> resets.

## Part A: drive a mobile base

1. **File → Browse sample robots** (<kbd>Mod</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd>).
2. Open **TurtleBot3 Waffle Pi** from **Mobile bases**. The first open downloads it from the
   ROBOTIS repository; later opens come from the cache.
3. Press <kbd>F7</kbd>. The behaviour button shows **Wheeled drive**, detected from the two
   continuous wheel joints.
4. Hold <kbd>W</kbd> to drive forward, <kbd>A</kbd>/<kbd>D</kbd> to turn, <kbd>S</kbd> to
   reverse, <kbd>Space</kbd> to stop.
5. Click the globe button and choose **Obstacle course**. The robot respawns at the start.
   Push a crate, then try the narrow passage between the two walls.

What the controller does: it reads each wheel's position, axis and radius, works out the base
type (differential, skid-steer, steered, omni or mecanum) and turns your input into wheel
velocities, ramping them so the robot does not wheelie. On holonomic bases <kbd>Q</kbd> and
<kbd>E</kbd> strafe.

## Part B: make a quadruped walk

![ANYmal C on rough terrain](../images/robot-anymal.png)

1. Open **ANYmal C** from the samples (**Quadrupeds**).
2. Choose **Rough terrain** from the globe button.
3. Press <kbd>F7</kbd>. The behaviour is **Legged gait**: four legs are found automatically and
   the robot trots in place.
4. <kbd>W</kbd>/<kbd>S</kbd> set the stride, <kbd>A</kbd>/<kbd>D</kbd> turn, <kbd>Q</kbd>/<kbd>E</kbd>
   side-step.

Try **Stairs** too. Bipeds such as **Berkeley Humanoid** (**Humanoids**) use a stepping gait with the same
keys. The gait is a simple open-loop pattern for checking leg kinematics, joint limits and
motor strength, not a balance controller, so a humanoid may need a fixed base (see Part D).

## Part C: exercise an arm

1. Open **Franka Emika Panda** (**Arms**).
2. Choose **Table top**. The arm spawns on the table.
3. Press <kbd>F6</kbd> for pose mode and pick **Arm waypoints**. The arm cycles home and a few
   reachable poses, opening and closing the gripper.
4. Press <kbd>F7</kbd> to run the same waypoints with gravity and motors. If a joint sags,
   its effort limit is too low for the load.

## Part D: tune the physics

The physics options button (sliders icon) on the mode bar has:

- **Fix the base in place:** pin the root link. On by default for arms, off for robots with
  wheels or legs.
- **Gravity:** off is handy for checking joint motion without load.

Motor strength comes from each joint's **effort** limit, so a joint with a realistic effort
behaves like a real servo: too low and it sags under load, which is worth knowing before you
buy motors.

Joint drives are set per joint in the inspector under **Drive and control**: **servo**
(position, optionally sweeping between the limits), **wheel** (velocity) or **none** (free,
with the joint's damping and friction).

## Part E: environments

| Environment     | Use it for                       |
| --------------- | -------------------------------- |
| Flat ground     | everything                       |
| Ramps (5–20°)   | traction, climbing, motor torque |
| Table top       | arms and grippers                |
| Stairs          | legged robots                    |
| Obstacle course | navigation, bumpers, lidar       |
| Rough terrain   | suspension, legged locomotion    |
| Maze            | mapping and navigation           |
| Warehouse aisle | mobile manipulation              |

**Choose environment…** adds downloadable worlds from Gazebo Fuel and AWS RoboMaker (NIST test
stairs, ramps and mazes, houses, offices, a depot, a raceway, and the AWS small house, hospital,
bookstore and warehouse). Whatever you choose is also exported as
the package's default Gazebo world, so the scene you tested in is the scene you launch.

## Troubleshooting

- **The robot jitters or explodes.** Usually overlapping collisions between a parent and child,
  tiny masses, or inertia far too small for the mass. Show inertia boxes and collisions and
  look for anything odd.
- **A wheeled robot does not move.** Wheels must be continuous joints with a roughly horizontal
  axis, and must touch the ground. Show collisions (<kbd>C</kbd>) and check the wheel
  collision is a cylinder about the axle.
- **The robot sinks into the floor.** The collision geometry is missing or much smaller than
  the visual.

## Next

[Tutorial 4, Materials and lighting](04-materials-and-lighting.md), or go straight to
[Tutorial 5, Export and run in Gazebo](05-export-and-run-in-gazebo.md).
