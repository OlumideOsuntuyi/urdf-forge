# Tutorial 8: Export to Isaac Sim and Isaac Lab

Take a robot from URDF Forge into NVIDIA Isaac Sim and Isaac Lab without ROS: export a folder
with a URDF and an Isaac Lab `ArticulationCfg`, convert it to USD, check that it stands, and use
the cfg in a task.

**You will learn to:** pick a fixed or floating base, set the initial pose, export and convert
to USD from the app, read the generated actuator groups, and load the robot in Isaac Lab.

**Time:** about 20 minutes. The first conversion takes a minute or two while Isaac Sim starts.

## What you need

- A robot in URDF Forge. A wheel-legged robot (legs on revolute joints, a wheel at each foot on
  a continuous joint) is a good example; the rover from
  [Tutorial 2](02-rover-from-components.md) works too.
- Isaac Lab 3 with Isaac Sim 6 installed with uv, for example on Windows in
  `C:\Dev\Robotics\Isaac\IsaacLab`, so that `uv run --extra isaacsim python ...` works there.
  ROS, Gazebo and WSL are not needed.

## 1. Validate and pose

Open the **Problems** tab (<kbd>Mod</kbd>+<kbd>J</kbd>) and fix the errors: Isaac Sim's importer
rejects the same broken trees, zero masses and bad limits as ROS does.

Then switch to **Pose** mode and put the robot in the pose it should start in, for example a
wheel-legged robot with its knees bent. The export uses the current joint positions as
`init_state.joint_pos` and places a free robot so its lowest point starts 2 cm above the ground.

## 2. Tell URDF Forge where Isaac Lab is

**Settings → General → Isaac Lab folder.** The default is `C:\Dev\Robotics\Isaac\IsaacLab`.

## 3. Export

**File → Export for Isaac Sim / Isaac Lab…** (or switch the export dialog to **NVIDIA Isaac Sim /
Isaac Lab**).

- **Base:** **Auto** fixes arms and robots anchored to a `world` link, and leaves robots that
  move themselves (wheels, legs) free. Choose **Fixed** or **Floating** to override; the choice
  is saved with the project.
- **Actuators** shows how the joints are grouped (see step 5).
- **Isaac Lab** shows whether the folder was found and `uv` runs. If not, the reason is shown
  and **Export to folder** still writes everything.

Press **Export and convert to USD** and pick a folder. URDF Forge writes `<robot>_isaac/`, then
runs its `convert_to_usd.ps1` headless and streams the output into the dialog. When it finishes,
the USD is at `<robot>_isaac/usd/<robot>/<robot>.usda`.

The folder:

| Path                         | What it is                                                         |
| ---------------------------- | ------------------------------------------------------------------ |
| `urdf/<robot>.urdf`          | The robot, with mesh paths relative to it. No `package://` URIs.   |
| `urdf/meshes/`               | Meshes in metres                                                   |
| `isaaclab/<robot>_cfg.py`    | The Isaac Lab `ArticulationCfg`                                    |
| `isaaclab/check_<robot>.py`  | Spawns the robot on a ground plane and holds its initial pose      |
| `convert_to_usd.ps1` / `.sh` | URDF to USD with Isaac Lab's `scripts/tools/convert_urdf.py`       |
| `usd/<robot>/<robot>.usda`   | The converted robot, after conversion (payloads in `usd/<robot>/`) |

To convert by hand (or again after editing the URDF):

```powershell
powershell -ExecutionPolicy Bypass -File .\convert_to_usd.ps1 -IsaacLab C:\Dev\Robotics\Isaac\IsaacLab
```

## 4. Look at it in Isaac Sim

Open `usd/<robot>/<robot>.usda` with **File → Open** in Isaac Sim and press Play. A floating
robot drops onto the ground; with no controller a wheel-legged robot then tips over, which is
expected.

## 5. Check the actuators

`isaaclab/<robot>_cfg.py` groups the joints into `ImplicitActuatorCfg`s:

| Group      | Joints                                   | Control                                       |
| ---------- | ---------------------------------------- | --------------------------------------------- |
| `position` | revolute and prismatic                   | PD to a position target                       |
| `velocity` | continuous (wheels)                      | velocity target: stiffness 0, damping as gain |
| `effort`   | all, when the export interface is effort | torque straight from the policy               |
| `passive`  | joints not controlled, and mimic joints  | not driven                                    |

`joint_effort_limit` and `joint_velocity_limit` come from each joint's URDF limits. Stiffness
and damping are starting points: full effort at 0.2 rad (2 cm for prismatic joints) of error,
damping a twentieth of stiffness, and wheels at full effort 10% below their target speed. Tune
them for your motors (for example from the motor's datasheet torque and speed) before training.

Check the cfg in Isaac Lab before writing a task (add `--viz kit` to watch):

```powershell
cd C:\Dev\Robotics\Isaac\IsaacLab
uv run --extra isaacsim python <folder>\<robot>_isaac\isaaclab\check_<robot>.py --steps 300
```

It prints the joint and body names, the stiffness, damping and limits Isaac applied, and how far
the root moved.

## 6. Use it in an Isaac Lab task

Put the `isaaclab/` folder on the task's Python path and use the cfg in a scene:

```python
import sys
sys.path.append(r"C:\path\to\<robot>_isaac\isaaclab")

from isaaclab.scene import InteractiveSceneCfg
from isaaclab.utils import configclass
from my_robot_cfg import MY_ROBOT_CFG


@configclass
class MySceneCfg(InteractiveSceneCfg):
    robot = MY_ROBOT_CFG.replace(prim_path="{ENV_REGEX_NS}/Robot")
```

The cfg spawns from the converted USD when it exists, and otherwise converts the URDF on first
use and caches the USD in the same place.

## Troubleshooting

| Symptom                                      | Fix                                                                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| "Isaac Lab was not found"                    | Set the folder in Settings → General; it must contain `scripts\tools\convert_urdf.py`                                 |
| "uv was not found on PATH"                   | Install uv and restart URDF Forge so it sees the new PATH                                                             |
| The robot starts inside the ground or floats | Pose it in the editor and export again; the spawn height comes from the pose                                          |
| A sensor link is missing in Isaac Lab        | Links on fixed joints are merged into their parent; turn off `merge_fixed_joints` (and `--merge_joints`) to keep them |
| Joints sag or oscillate                      | Raise or lower stiffness and damping in the cfg; check the URDF effort limits are the motor's real torque             |
| Concave parts collide strangely              | Mesh collisions become convex hulls; give those links primitive or convex collisions in the editor                    |

## Next

Automate exports from an assistant with the `export_isaac` MCP tool:
[Tutorial 6, Automate with MCP](06-automate-with-mcp.md).
