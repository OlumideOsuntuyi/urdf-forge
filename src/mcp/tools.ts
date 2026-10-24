/**
 * MCP tools. The Rust side owns the HTTP transport; every tools/list and tools/call request is
 * forwarded here. Tools operate on the open project exactly like the UI does (undoable edits).
 */
import { allCommands, runCommand } from "@/commands/registry";
import {
  JOINT_TYPES,
  childrenOf,
  hasJoint,
  jointName,
  linkById,
  orderedLinks,
  safeName,
  type JointType,
  type Link,
  type RobotModel,
  type Vec3,
} from "@/core/model";
import { generateUrdf } from "@/core/ros/urdf";
import { TARGET_IDS, isTargetId } from "@/core/ros/targets";
import { validate } from "@/core/validate";
import { app } from "@/store/app";
import type { McpTool, McpToolResult } from "@/plugins/api";
import {
  addCollisionIn,
  deleteLinkIn,
  linkFromMeshIn,
  recomputeInertialIn,
  reparentIn,
  type CollisionKind,
} from "@/app/actions";
import { insertPartIn } from "@/app/parts";
import { PART_LIBRARY, defaults, findPart, type Params } from "@/core/parts";
import { PROCEDURAL_ENVS } from "@/core/env/procedural";
import { applyBuiltinEnvironment, openSample } from "@/samples/open";
import { SAMPLES } from "@/samples/catalog";

const tools = new Map<string, McpTool>();
let toolsChanged: () => void = () => {};

export function onToolsChanged(fn: () => void) {
  toolsChanged = fn;
}

export function registerMcpTool(t: McpTool): () => void {
  tools.set(t.name, t);
  toolsChanged();
  return () => {
    if (tools.get(t.name) === t) {
      tools.delete(t.name);
      toolsChanged();
    }
  };
}

export function listTools() {
  return [...tools.values()].map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const t = tools.get(name);
  if (!t) return { content: [{ type: "text", text: `Unknown tool "${name}".` }], isError: true };
  try {
    const out = await t.handler(args ?? {});
    if (typeof out === "string") return { content: [{ type: "text", text: out }] };
    if (out && typeof out === "object" && "content" in out) return out as McpToolResult;
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  } catch (e) {
    return {
      content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
      isError: true,
    };
  }
}

// ------------------------------------------------------------------ helpers

const str = (d: string) => ({ type: "string", description: d });
const num = (d: string) => ({ type: "number", description: d });
const vec = (d: string) => ({
  type: "array",
  items: { type: "number" },
  minItems: 3,
  maxItems: 3,
  description: d,
});
const schema = (props: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties: props,
  required,
  additionalProperties: false,
});

function findLink(m: RobotModel, name: unknown): Link {
  const L = m.links.find((l) => l.name === name) ?? m.links.find((l) => l.id === name);
  if (!L)
    throw new Error(
      `No link named "${String(name)}". Links: ${m.links.map((l) => l.name).join(", ") || "(none)"}`,
    );
  return L;
}

function describeLink(m: RobotModel, L: Link) {
  return {
    name: L.name,
    parent: linkById(m, L.parentId)?.name ?? null,
    children: childrenOf(m, L.id).map((c) => c.name),
    joint: hasJoint(m, L)
      ? {
          name: jointName(L),
          type: L.joint.type,
          axis: L.joint.axis,
          limits: {
            lower: L.joint.lower,
            upper: L.joint.upper,
            effort: L.joint.effort,
            velocity: L.joint.velocity,
          },
          origin: L.origin,
          mimic: L.joint.mimic,
        }
      : null,
    mass: L.inertial.mass,
    com: L.inertial.com,
    visuals: L.visuals.map((v) => v.geometry.type),
    collisions: L.collisions.map((c) => c.geometry.type),
    sensors: L.sensors.map((s) => s.type),
    drive: L.drive,
  };
}

const v3 = (x: unknown): Vec3 | undefined =>
  Array.isArray(x) && x.length === 3 && x.every((n) => typeof n === "number")
    ? (x as Vec3)
    : undefined;

// ------------------------------------------------------------------ built-in tools

export function registerBuiltinTools(screenshot: () => string | null) {
  const add = (t: McpTool) => registerMcpTool(t);

  add({
    name: "get_robot",
    description:
      "Summary of the open robot: names, package, export targets, the link tree and validation problems.",
    inputSchema: schema({}),
    handler: () => {
      const m = app().model;
      return {
        robot: m.robot,
        package: m.packageName,
        targets: m.export.targets,
        ros2_control: m.export.ros2Control,
        links: orderedLinks(m).map((L) => describeLink(m, L)),
        parts: m.meshes.map((p) => ({
          name: p.name,
          triangles: p.triangles,
          watertight: p.watertight,
        })),
        problems: validate(m),
      };
    },
  });

  add({
    name: "get_link",
    description: "Full details of one link.",
    inputSchema: schema({ link: str("Link name") }, ["link"]),
    handler: ({ link }) => describeLink(app().model, findLink(app().model, link)),
  });

  add({
    name: "add_link_from_part",
    description:
      "Create a link from a part in the parts library. The link frame is placed at the part's centre.",
    inputSchema: schema(
      {
        part: str("Part name"),
        parent: str("Parent link name; omit to attach to the root"),
        name: str("New link name"),
      },
      ["part"],
    ),
    handler: ({ part, parent, name }) => {
      let created = "";
      app().edit((m) => {
        const asset = m.meshes.find((x) => x.name === part || x.id === part);
        if (!asset) throw new Error(`No part named "${String(part)}".`);
        const L = linkFromMeshIn(m, asset, {
          parentId: parent ? findLink(m, parent).id : undefined,
          name: name ? String(name) : undefined,
        });
        created = L.name;
      });
      return `Created link ${created}.`;
    },
  });

  add({
    name: "set_joint",
    description:
      "Set the joint that connects a link to its parent. Angles in radians, distances in metres.",
    inputSchema: schema(
      {
        link: str("Child link name"),
        type: { type: "string", enum: [...JOINT_TYPES] },
        name: str("Joint name"),
        axis: vec("Axis in the child link frame"),
        lower: num("Lower limit"),
        upper: num("Upper limit"),
        effort: num("Effort limit (N or N·m)"),
        velocity: num("Velocity limit (rad/s or m/s)"),
        damping: num("Damping"),
        friction: num("Friction"),
      },
      ["link"],
    ),
    handler: (a) => {
      app().edit((m) => {
        const L = findLink(m, a.link);
        if (!L.parentId) throw new Error(`${L.name} is the root link and has no joint.`);
        const j = L.joint;
        if (a.type !== undefined) {
          if (!JOINT_TYPES.includes(a.type as JointType))
            throw new Error(`Joint type must be one of ${JOINT_TYPES.join(", ")}.`);
          j.type = a.type as JointType;
        }
        if (a.name !== undefined) j.name = safeName(String(a.name), "joint");
        if (v3(a.axis)) j.axis = v3(a.axis)!;
        for (const k of ["lower", "upper", "effort", "velocity", "damping", "friction"] as const)
          if (typeof a[k] === "number") j[k] = a[k] as number;
      });
      return (
        describeLink(app().model, findLink(app().model, a.link)).joint ?? "The link has no joint."
      );
    },
  });

  add({
    name: "set_link_origin",
    description:
      "Set a link's origin (joint origin) relative to its parent link. Moves the link and its subtree.",
    inputSchema: schema(
      {
        link: str("Link name"),
        xyz: vec("Position, metres"),
        rpy: vec("Roll, pitch, yaw, radians"),
      },
      ["link"],
    ),
    handler: (a) => {
      app().edit((m) => {
        const L = findLink(m, a.link);
        if (v3(a.xyz)) L.origin.xyz = v3(a.xyz)!;
        if (v3(a.rpy)) L.origin.rpy = v3(a.rpy)!;
      });
      return findLink(app().model, a.link).origin;
    },
  });

  add({
    name: "reparent_link",
    description: "Move a link under a different parent, keeping where it is in the world.",
    inputSchema: schema(
      { link: str("Link name"), parent: str("New parent link name, or empty for root") },
      ["link"],
    ),
    handler: ({ link, parent }) => {
      app().edit((m) => {
        const L = findLink(m, link);
        if (!reparentIn(m, L.id, parent ? findLink(m, parent).id : null))
          throw new Error("That would create a cycle.");
      });
      return "Done.";
    },
  });

  add({
    name: "rename_link",
    description: "Rename a link.",
    inputSchema: schema({ link: str("Current name"), name: str("New name") }, ["link", "name"]),
    handler: ({ link, name }) => {
      const n = safeName(String(name));
      app().edit((m) => {
        if (m.links.some((l) => l.name === n)) throw new Error(`A link named ${n} already exists.`);
        findLink(m, link).name = n;
      });
      return `Renamed to ${n}.`;
    },
  });

  add({
    name: "delete_link",
    description: "Delete a link. With keep_children its children are re-attached to its parent.",
    inputSchema: schema({ link: str("Link name"), keep_children: { type: "boolean" } }, ["link"]),
    handler: ({ link, keep_children }) => {
      app().edit((m) => deleteLinkIn(m, findLink(m, link).id, !!keep_children));
      return "Deleted.";
    },
  });

  add({
    name: "add_collision",
    description: "Generate collision geometry for a link from its visual geometry.",
    inputSchema: schema(
      {
        link: str("Link name"),
        kind: { type: "string", enum: ["box", "cylinder", "sphere", "hull", "mesh", "simplified"] },
        replace: { type: "boolean" },
      },
      ["link", "kind"],
    ),
    handler: ({ link, kind, replace }) => {
      app().edit((m) =>
        addCollisionIn(m, findLink(m, link).id, kind as CollisionKind, replace !== false),
      );
      return describeLink(app().model, findLink(app().model, link)).collisions;
    },
  });

  add({
    name: "set_mass",
    description:
      "Set a link's mass (kg) or material density (kg/m^3). Inertia is recomputed from geometry.",
    inputSchema: schema(
      { link: str("Link name"), mass: num("Mass in kg"), density: num("Density in kg/m^3") },
      ["link"],
    ),
    handler: ({ link, mass, density }) => {
      app().edit((m) => {
        const L = findLink(m, link);
        L.inertial.auto = true;
        if (typeof mass === "number") {
          L.inertial.mode = "mass";
          L.inertial.mass = mass;
        } else if (typeof density === "number") {
          L.inertial.mode = "density";
          L.inertial.density = density;
        }
        recomputeInertialIn(m, L.id);
      });
      const L = findLink(app().model, link);
      return { mass: L.inertial.mass, com: L.inertial.com, inertia: L.inertial.inertia };
    },
  });

  add({
    name: "set_drive",
    description:
      "How the simulation preview drives a joint: servo (hold a position), wheel (spin at a velocity) or none.",
    inputSchema: schema(
      {
        link: str("Link name"),
        mode: { type: "string", enum: ["none", "servo", "wheel"] },
        target: num("Position (servo) or velocity (wheel)"),
        sweep: { type: "boolean" },
      },
      ["link", "mode"],
    ),
    handler: ({ link, mode, target, sweep }) => {
      app().edit((m) => {
        const L = findLink(m, link);
        L.drive = {
          mode: mode as Link["drive"]["mode"],
          target: typeof target === "number" ? target : L.drive.target,
          sweep: !!sweep,
        };
      });
      return "Done.";
    },
  });

  add({
    name: "validate",
    description:
      "Check the robot for errors and warnings that would break URDF tools or simulation.",
    inputSchema: schema({}),
    handler: () => validate(app().model),
  });

  add({
    name: "generate_urdf",
    description: `Return the URDF text for a target. Targets: ${TARGET_IDS.join(", ")}.`,
    inputSchema: schema({ target: { type: "string", enum: TARGET_IDS } }),
    handler: ({ target }) => {
      const t =
        typeof target === "string" && isTargetId(target)
          ? target
          : app().model.export.defaultTarget;
      return generateUrdf(app().model, t);
    },
  });

  add({
    name: "list_commands",
    description: "List editor commands that run_command can execute.",
    inputSchema: schema({}),
    handler: () =>
      allCommands()
        .filter((c) => c.palette !== false)
        .map((c) => ({ id: c.id, title: c.title, category: c.category })),
  });

  add({
    name: "run_command",
    description:
      "Run an editor command by id (see list_commands). Commands that open file dialogs wait for the user.",
    inputSchema: schema({ id: str("Command id") }, ["id"]),
    handler: async ({ id }) => {
      await runCommand(String(id));
      return `Ran ${String(id)}.`;
    },
  });

  add({
    name: "list_components",
    description:
      "The component library: parametric shapes, structural parts, actuators, wheels, sensors, electronics and assemblies, with their parameters (lengths in metres, angles in radians).",
    inputSchema: schema({ category: str("Optional category filter") }),
    handler: ({ category }) =>
      PART_LIBRARY.filter((t) => !category || t.category === category).map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        description: t.description,
        params: t.params.map((p) => ({
          key: p.key,
          kind: p.kind,
          default: p.default,
          min: p.min,
          max: p.max,
          choices: p.choices?.map((c) => c.value),
        })),
      })),
  });

  add({
    name: "add_component",
    description:
      "Insert a component from list_components, attached to a link (or as the root of an empty robot).",
    inputSchema: schema(
      {
        component: str("Component id"),
        parent: str("Link to attach to; omit for the root link"),
        params: {
          type: "object",
          description: "Parameter overrides, by key",
          additionalProperties: true,
        },
      },
      ["component"],
    ),
    handler: ({ component, parent, params }) => {
      const t = findPart(String(component));
      if (!t) throw new Error(`No component "${String(component)}". Call list_components.`);
      let root = "";
      app().edit((m) => {
        const attach = parent ? findLink(m, parent).id : null;
        root = insertPartIn(m, t, { ...defaults(t), ...((params as Params) ?? {}) }, attach);
      });
      const m = app().model;
      return { added: t.name, root: linkById(m, root)?.name, links: m.links.length };
    },
  });

  add({
    name: "list_samples",
    description:
      "Open-source robots and environments the app can download and open (with their licences).",
    inputSchema: schema({ kind: { type: "string", enum: ["robot", "environment"] } }),
    handler: ({ kind }) =>
      SAMPLES.filter((s) => !kind || s.kind === kind).map((s) => ({
        id: s.id,
        kind: s.kind,
        name: s.name,
        category: s.category,
        license: s.license,
        sizeMB: s.sizeMB,
      })),
  });

  add({
    name: "open_sample",
    description:
      "Download (or reuse the cached copy of) a sample from list_samples. Robots replace the open project; environments become the test scene.",
    inputSchema: schema({ id: str("Sample id") }, ["id"]),
    handler: async ({ id }) => {
      const s = SAMPLES.find((x) => x.id === id);
      if (!s) throw new Error(`No sample "${String(id)}". Call list_samples.`);
      const skipped = await openSample(s, () => {});
      return `Opened ${s.name}${skipped.length ? ` (${skipped.length} parts skipped)` : ""}.`;
    },
  });

  add({
    name: "set_environment",
    description: `Choose the test environment used by the physics preview and exported as the Gazebo world. Built-in: ${PROCEDURAL_ENVS.map((e) => e.id).join(", ")}.`,
    inputSchema: schema(
      { environment: { type: "string", enum: PROCEDURAL_ENVS.map((e) => e.id) } },
      ["environment"],
    ),
    handler: ({ environment }) => {
      applyBuiltinEnvironment(String(environment));
      return `Environment: ${app().environment.name}`;
    },
  });

  add({
    name: "screenshot",
    description: "A PNG of the 3D viewport as it is now.",
    inputSchema: schema({}),
    handler: () => {
      const url = screenshot();
      if (!url) throw new Error("The viewport is not ready.");
      return {
        content: [
          {
            type: "image",
            data: url.replace(/^data:image\/png;base64,/, ""),
            mimeType: "image/png",
          },
        ],
      };
    },
  });
}
