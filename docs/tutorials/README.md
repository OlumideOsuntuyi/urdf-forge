# Tutorials

Step-by-step projects, each 10 to 30 minutes. They build on each other but can be read on
their own. For quick answers use [HOWTOUSE.md](../../HOWTOUSE.md); for every option in detail
use the [user guide](../user-guide.md).

| #   | Tutorial                                                         | You will learn                                                                  |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | [Your first robot from a STEP file](01-first-robot-from-step.md) | Import CAD, split it into links, place joint origins and axes, check the result |
| 2   | [A rover from components](02-rover-from-components.md)           | Model a robot without CAD from the parametric component library                 |
| 3   | [Drive, walk and test in physics](03-drive-walk-and-test.md)     | Physics mode, behaviours, teleop, test environments and sample robots           |
| 4   | [Materials, lighting and looks](04-materials-and-lighting.md)    | PBR presets, ambientCG textures, HDRI reflections, lit/unlit, grid and themes   |
| 5   | [Export and run in Gazebo](05-export-and-run-in-gazebo.md)       | Validation, the ROS 2 package, ros2_control, launch files and worlds            |
| 6   | [Automate with an AI assistant (MCP)](06-automate-with-mcp.md)   | Connect a client and edit robots by asking                                      |
| 7   | [Write a plugin](07-write-a-plugin.md)                           | Add a command, an exporter and an MCP tool in JavaScript                        |

## Before you start

- Install URDF Forge from the
  [releases page](https://github.com/OlumideOsuntuyi/urdf-forge/releases), or
  [build it from source](../building.md).
- Tutorials 1 to 4 need nothing else. Tutorial 3 downloads sample robots, so it needs an
  internet connection the first time.
- Tutorial 5 needs a ROS 2 installation (Humble, Jazzy, Kilted, Lyrical or Rolling) with
  Gazebo, on Linux or in a container or VM.
- Tutorial 6 needs an MCP client such as Cursor or VS Code.

Conventions: <kbd>Mod</kbd> is <kbd>Ctrl</kbd> (<kbd>⌘</kbd> on macOS). Units follow ROS
REP 103: metres, kilograms, radians, Z up, X forward.
