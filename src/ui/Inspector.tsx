import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Atom,
  Box,
  Cog,
  Crosshair,
  FlipHorizontal2,
  Gauge,
  Link2,
  Move3d,
  Palette,
  Plus,
  Radar,
  Scale,
  Shield,
  Trash2,
  Waves,
} from "lucide-react";
import { useApp, app } from "@/store/app";
import {
  ARTICULATED,
  JOINT_TYPES,
  SENSOR_TYPES,
  isCameraSensor,
  hasJoint,
  isDescendantOrSelf,
  jointName,
  linkById,
  materialById,
  newMaterial,
  safeName,
  uid,
  type Collision,
  type Geometry,
  type JointType,
  type Link,
  type Material,
  type MeshAsset,
  type RobotModel,
  type SensorType,
  type Visual,
} from "@/core/model";
import { TARGETS, TARGET_IDS, targetLabel } from "@/core/ros/targets";
import {
  addCollisionIn,
  recomputeInertialIn,
  reparentIn,
  linkFromMeshIn,
  createMeshAsset,
  type CollisionKind,
} from "@/app/actions";
import { splitComponents } from "@/core/mesh/ops";
import { meshStore } from "@/store/meshStore";
import { runCommand } from "@/commands/registry";
import {
  Field,
  NumberField,
  Section,
  Select,
  TextField,
  Toggle,
  Vec3Field,
  CheckRow,
} from "./controls";

type EditFn = (fn: (m: RobotModel) => void, key?: string) => void;
const edit: EditFn = (fn, key) => app().edit(fn, key ? { coalesce: key } : undefined);

export function Inspector() {
  const model = useApp((s) => s.model);
  const sel = useApp((s) => s.selection);
  let body: ReactNode;
  if (!sel) body = <RobotInspector model={model} />;
  else if (sel.kind === "mesh") {
    const a = model.meshes.find((x) => x.id === sel.meshId);
    body = a ? <PartInspector asset={a} model={model} /> : <RobotInspector model={model} />;
  } else if (sel.kind === "material") body = <RobotInspector model={model} />;
  else {
    const L = linkById(model, sel.linkId);
    body = L ? (
      <LinkInspector link={L} model={model} focus={"compId" in sel ? sel.compId : null} />
    ) : (
      <RobotInspector model={model} />
    );
  }
  return (
    <aside className="side right" aria-label="Inspector">
      <div className="panel-body inspector">{body}</div>
    </aside>
  );
}

// ------------------------------------------------------------------ link

function LinkInspector({
  link: L,
  model,
  focus,
}: {
  link: Link;
  model: RobotModel;
  focus: string | null;
}) {
  const id = L.id;
  const upd = (fn: (l: Link) => void, key?: string, recompute = false) =>
    edit(
      (m) => {
        const x = linkById(m, id)!;
        fn(x);
        if (recompute && x.inertial.auto) recomputeInertialIn(m, id);
      },
      key && `${id}.${key}`,
    );
  const joint = hasJoint(model, L);
  const j = L.joint;
  const angular = j.type === "revolute" || j.type === "continuous";
  const parents = model.links.filter((x) => !isDescendantOrSelf(model, x.id, L.id));

  return (
    <>
      <div className="insp-head">
        <Link2 size={18} className="muted" />
        <div className="title">
          <div className="kind">{joint ? `${j.type} link` : "Root link"}</div>
          <TextField
            value={L.name}
            onCommit={(v) => {
              const n = safeName(v);
              if (model.links.some((x) => x.name === n && x.id !== id))
                return app().toast(`A link named ${n} already exists.`, "warning");
              upd((x) => (x.name = n));
            }}
          />
        </div>
        <button
          className="icon-btn"
          title="Delete link (Del)"
          onClick={() => runCommand("edit.delete")}
        >
          <Trash2 size={15} />
        </button>
      </div>

      <Section title="Joint" icon={<Cog size={14} />} id="joint">
        <Field label="Parent">
          <Select
            value={L.parentId ?? ""}
            options={[
              { value: "", label: "— none (root) —" },
              ...parents.map((p) => ({ value: p.id, label: p.name })),
            ]}
            onChange={(v) => edit((m) => reparentIn(m, id, v || null))}
          />
        </Field>
        {joint && (
          <>
            <Field label="Type">
              <Select
                value={j.type}
                options={JOINT_TYPES.map((t) => ({ value: t, label: t }))}
                onChange={(v) => upd((x) => (x.joint.type = v as JointType))}
              />
            </Field>
            <Field label="Joint name" hint={!j.name ? `Default: ${jointName(L)}` : undefined}>
              <TextField
                value={j.name}
                placeholder={jointName(L)}
                onCommit={(v) => upd((x) => (x.joint.name = v ? safeName(v, "joint") : ""))}
                mono
              />
            </Field>
            {(ARTICULATED.includes(j.type) || j.type === "planar") && (
              <>
                <Field label="Axis">
                  <Vec3Field
                    unit="none"
                    value={j.axis}
                    onChange={(v) => upd((x) => (x.joint.axis = v), "axis")}
                  />
                </Field>
                <div className="chips" style={{ paddingLeft: 100 }}>
                  {(
                    [
                      ["X", [1, 0, 0]],
                      ["Y", [0, 1, 0]],
                      ["Z", [0, 0, 1]],
                    ] as const
                  ).map(([n, ax]) => (
                    <button
                      key={n}
                      className="chip-btn"
                      aria-pressed={j.axis.every((v, i) => Math.abs(v - ax[i]) < 1e-9)}
                      onClick={() => upd((x) => (x.joint.axis = [...ax]))}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    className="chip-btn"
                    title="Reverse the axis direction"
                    onClick={() =>
                      upd(
                        (x) =>
                          (x.joint.axis = x.joint.axis.map((v) => (v ? -v : 0)) as typeof j.axis),
                      )
                    }
                  >
                    <FlipHorizontal2 size={12} /> Flip
                  </button>
                </div>
              </>
            )}
            {(j.type === "revolute" || j.type === "prismatic") && (
              <Field label="Limits">
                <div className="vec3" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <NumberField
                    tag="↓"
                    unit={angular ? "deg" : "m"}
                    value={j.lower}
                    onChange={(v) => upd((x) => (x.joint.lower = v), "lower")}
                  />
                  <NumberField
                    tag="↑"
                    unit={angular ? "deg" : "m"}
                    value={j.upper}
                    onChange={(v) => upd((x) => (x.joint.upper = v), "upper")}
                  />
                </div>
              </Field>
            )}
            {ARTICULATED.includes(j.type) && (
              <>
                <Field label="Max effort">
                  <NumberField
                    unit={angular ? "Nm" : "N"}
                    value={j.effort}
                    min={0}
                    onChange={(v) => upd((x) => (x.joint.effort = v), "effort")}
                  />
                </Field>
                <Field label="Max velocity">
                  <NumberField
                    unit={angular ? "radps" : "mps"}
                    value={j.velocity}
                    min={0}
                    onChange={(v) => upd((x) => (x.joint.velocity = v), "velocity")}
                  />
                </Field>
                <Field label="Damping">
                  <NumberField
                    value={j.damping}
                    min={0}
                    onChange={(v) => upd((x) => (x.joint.damping = v), "damping")}
                  />
                </Field>
                <Field label="Friction">
                  <NumberField
                    value={j.friction}
                    min={0}
                    onChange={(v) => upd((x) => (x.joint.friction = v), "friction")}
                  />
                </Field>
                <Field label="Mimic">
                  <Select
                    value={j.mimic?.joint ?? ""}
                    options={[
                      { value: "", label: "— independent —" },
                      ...model.links
                        .filter(
                          (x) =>
                            x.id !== id && hasJoint(model, x) && ARTICULATED.includes(x.joint.type),
                        )
                        .map((x) => ({ value: jointName(x), label: jointName(x) })),
                    ]}
                    onChange={(v) =>
                      upd(
                        (x) =>
                          (x.joint.mimic = v
                            ? {
                                joint: v,
                                multiplier: x.joint.mimic?.multiplier ?? 1,
                                offset: x.joint.mimic?.offset ?? 0,
                              }
                            : null),
                      )
                    }
                  />
                </Field>
                {j.mimic && (
                  <Field label="× / offset">
                    <div className="vec3" style={{ gridTemplateColumns: "1fr 1fr" }}>
                      <NumberField
                        tag="×"
                        value={j.mimic.multiplier}
                        onChange={(v) => upd((x) => (x.joint.mimic!.multiplier = v), "mm")}
                      />
                      <NumberField
                        tag="+"
                        value={j.mimic.offset}
                        onChange={(v) => upd((x) => (x.joint.mimic!.offset = v), "mo")}
                      />
                    </div>
                  </Field>
                )}
              </>
            )}
          </>
        )}
      </Section>

      <Section
        title="Origin"
        icon={<Move3d size={14} />}
        id="origin"
        extra={
          <button
            className="chip-btn"
            title="Move the link origin to the geometry centre"
            onClick={() => runCommand("link.pivotToCentre")}
          >
            <Crosshair size={12} /> Centre
          </button>
        }
      >
        <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
          {joint
            ? `Joint origin relative to ${linkById(model, L.parentId)!.name}.`
            : "Pose of the root link in the model frame."}{" "}
          Moving it moves the link and its children; use the pivot gizmo (T) to move only the frame.
        </div>
        <Field label="Position (m)">
          <Vec3Field
            value={L.origin.xyz}
            onChange={(v) => upd((x) => (x.origin.xyz = v), "oxyz")}
          />
        </Field>
        <Field label="Rotation (°)">
          <Vec3Field
            unit="deg"
            labels={["R", "P", "Y"]}
            value={L.origin.rpy}
            onChange={(v) => upd((x) => (x.origin.rpy = v), "orpy")}
          />
        </Field>
        <div className="chips" style={{ paddingLeft: 100 }}>
          <button className="chip-btn" onClick={() => runCommand("link.pivotToCom")}>
            To COM
          </button>
          {joint && (
            <button className="chip-btn" onClick={() => runCommand("link.pivotToParent")}>
              To parent
            </button>
          )}
          <button className="chip-btn" onClick={() => runCommand("link.resetRotation")}>
            Square up
          </button>
        </div>
      </Section>

      <Section title={`Visual (${L.visuals.length})`} icon={<Box size={14} />} id="visual">
        {L.visuals.map((v) => (
          <ComponentCard
            key={v.id}
            link={L}
            comp={v}
            kind="visual"
            model={model}
            focused={focus === v.id}
          />
        ))}
        {!L.visuals.length && (
          <div className="muted">
            No visual geometry. Drag a part here from the Parts tab, or add a primitive.
          </div>
        )}
        <div className="chips">
          {(["box", "cylinder", "sphere"] as const).map((k) => (
            <button
              key={k}
              className="chip-btn"
              onClick={() =>
                upd(
                  (x) =>
                    x.visuals.push({
                      id: uid("vis"),
                      name: "",
                      origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
                      geometry: primitive(k),
                      materialId: model.materials[0]?.id ?? null,
                    }),
                  undefined,
                  true,
                )
              }
            >
              <Plus size={12} /> {k}
            </button>
          ))}
        </div>
      </Section>

      <Section
        title={`Collision (${L.collisions.length})`}
        icon={<Shield size={14} />}
        id="collision"
      >
        {L.collisions.map((c) => (
          <ComponentCard
            key={c.id}
            link={L}
            comp={c}
            kind="collision"
            model={model}
            focused={focus === c.id}
          />
        ))}
        <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
          Replace with geometry fitted to the visual. Primitives and convex hulls simulate fastest.
        </div>
        <div className="chips">
          {(
            [
              ["box", "Box"],
              ["cylinder", "Cylinder"],
              ["sphere", "Sphere"],
              ["hull", "Convex hull"],
              ["simplified", "Simplified"],
              ["mesh", "Copy visual"],
            ] as [CollisionKind, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              className="chip-btn"
              onClick={() => edit((m) => addCollisionIn(m, id, k, true))}
            >
              {label}
            </button>
          ))}
        </div>
      </Section>

      <InertialSection link={L} upd={upd} />

      {joint && j.type !== "fixed" && (
        <Section title="Drive and control" icon={<Gauge size={14} />} id="drive">
          <Field label="Preview drive">
            <Select
              value={L.drive.mode}
              options={[
                { value: "none", label: "None (passive)" },
                { value: "servo", label: "Servo (position)" },
                { value: "wheel", label: "Wheel (velocity)" },
              ]}
              onChange={(v) => upd((x) => (x.drive.mode = v))}
            />
          </Field>
          {L.drive.mode !== "none" && (
            <Field label={L.drive.mode === "wheel" ? "Velocity" : "Target"}>
              <NumberField
                unit={
                  L.drive.mode === "wheel" ? (angular ? "radps" : "mps") : angular ? "deg" : "m"
                }
                value={L.drive.target}
                onChange={(v) => upd((x) => (x.drive.target = v), "drive")}
              />
            </Field>
          )}
          {L.drive.mode === "servo" && (
            <CheckRow checked={L.drive.sweep} onChange={(v) => upd((x) => (x.drive.sweep = v))}>
              Sweep between the limits
            </CheckRow>
          )}
          <CheckRow checked={L.controlled} onChange={(v) => upd((x) => (x.controlled = v))}>
            Include in ros2_control
          </CheckRow>
        </Section>
      )}

      <Section
        title={`Sensors (${L.sensors.length})`}
        icon={<Radar size={14} />}
        id="sensors"
        defaultOpen={L.sensors.length > 0}
      >
        {L.sensors.map((s, i) => (
          <div className="card" key={s.id}>
            <div className="card-head">
              <b style={{ color: "var(--text)" }}>{s.type.replace("_", " ")}</b>
              <span className="grow" />
              <button
                className="icon-btn"
                title="Remove sensor"
                onClick={() => upd((x) => x.sensors.splice(i, 1))}
              >
                <Trash2 size={13} />
              </button>
            </div>
            <Field label="Name">
              <TextField
                value={s.name}
                onCommit={(v) => upd((x) => (x.sensors[i].name = safeName(v, "sensor")))}
                mono
              />
            </Field>
            <Field label="Topic">
              <TextField
                value={s.topic}
                placeholder="default"
                onCommit={(v) => upd((x) => (x.sensors[i].topic = v.trim()))}
                mono
              />
            </Field>
            <Field label="Rate">
              <NumberField
                unit="hz"
                value={s.rate}
                min={0.1}
                onChange={(v) => upd((x) => (x.sensors[i].rate = v), `s${i}r`)}
              />
            </Field>
            {isCameraSensor(s.type) && (
              <>
                <Field label="Resolution">
                  <div className="vec3" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <NumberField
                      tag="W"
                      precision={0}
                      value={s.width ?? 640}
                      onChange={(v) => upd((x) => (x.sensors[i].width = Math.round(v)), `s${i}w`)}
                    />
                    <NumberField
                      tag="H"
                      precision={0}
                      value={s.height ?? 480}
                      onChange={(v) => upd((x) => (x.sensors[i].height = Math.round(v)), `s${i}h`)}
                    />
                  </div>
                </Field>
                <Field label="Field of view">
                  <NumberField
                    unit="deg"
                    value={s.fov ?? 1.047}
                    onChange={(v) => upd((x) => (x.sensors[i].fov = v), `s${i}f`)}
                  />
                </Field>
              </>
            )}
            {s.type === "lidar" && (
              <>
                <Field label="Samples">
                  <NumberField
                    precision={0}
                    value={s.samples ?? 360}
                    min={1}
                    onChange={(v) => upd((x) => (x.sensors[i].samples = Math.round(v)), `s${i}n`)}
                  />
                </Field>
                <Field label="Range">
                  <div className="vec3" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <NumberField
                      tag="↓"
                      unit="m"
                      value={s.rangeMin ?? 0.12}
                      onChange={(v) => upd((x) => (x.sensors[i].rangeMin = v), `s${i}a`)}
                    />
                    <NumberField
                      tag="↑"
                      unit="m"
                      value={s.rangeMax ?? 12}
                      onChange={(v) => upd((x) => (x.sensors[i].rangeMax = v), `s${i}b`)}
                    />
                  </div>
                </Field>
              </>
            )}
          </div>
        ))}
        <div className="chips">
          {SENSOR_TYPES.map((t) => (
            <button
              key={t}
              className="chip-btn"
              onClick={() =>
                upd((x) =>
                  x.sensors.push({
                    id: uid("sen"),
                    type: t as SensorType,
                    name: `${x.name}_${t}`,
                    rate: t === "imu" ? 100 : t === "lidar" ? 10 : 30,
                    topic: "",
                  }),
                )
              }
            >
              <Plus size={12} /> {t.replace("_", " ")}
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="Contact and physics"
        icon={<Waves size={14} />}
        id="gazebo"
        defaultOpen={false}
      >
        <Field label="Friction μ1 / μ2">
          <div className="vec3" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <NumberField
              tag="1"
              value={L.gazebo.mu1}
              min={0}
              onChange={(v) => upd((x) => (x.gazebo.mu1 = v), "mu1")}
            />
            <NumberField
              tag="2"
              value={L.gazebo.mu2}
              min={0}
              onChange={(v) => upd((x) => (x.gazebo.mu2 = v), "mu2")}
            />
          </div>
        </Field>
        <Field label="Stiffness kp">
          <NumberField
            value={L.gazebo.kp}
            min={0}
            onChange={(v) => upd((x) => (x.gazebo.kp = v), "kp")}
          />
        </Field>
        <Field label="Damping kd">
          <NumberField
            value={L.gazebo.kd}
            min={0}
            onChange={(v) => upd((x) => (x.gazebo.kd = v), "kd")}
          />
        </Field>
        <CheckRow
          checked={L.gazebo.selfCollide}
          onChange={(v) => upd((x) => (x.gazebo.selfCollide = v))}
        >
          Collide with other links of this robot
        </CheckRow>
        <CheckRow checked={L.gazebo.gravity} onChange={(v) => upd((x) => (x.gazebo.gravity = v))}>
          Affected by gravity
        </CheckRow>
      </Section>
    </>
  );
}

function primitive(k: "box" | "cylinder" | "sphere"): Geometry {
  return k === "box"
    ? { type: "box", size: [0.1, 0.1, 0.1] }
    : k === "cylinder"
      ? { type: "cylinder", radius: 0.05, length: 0.1 }
      : { type: "sphere", radius: 0.05 };
}

function ComponentCard({
  link,
  comp,
  kind,
  model,
  focused,
}: {
  link: Link;
  comp: Visual | Collision;
  kind: "visual" | "collision";
  model: RobotModel;
  focused: boolean;
}) {
  const list = kind === "visual" ? "visuals" : "collisions";
  const upd = (fn: (c: Visual | Collision) => void, key?: string) =>
    edit(
      (m) => {
        const L = linkById(m, link.id)!;
        const c = (L[list] as (Visual | Collision)[]).find((x) => x.id === comp.id);
        if (!c) return;
        fn(c);
        if (kind === "visual" && L.inertial.auto) recomputeInertialIn(m, L.id);
      },
      key && `${comp.id}.${key}`,
    );
  const g = comp.geometry;
  const asset = g.type === "mesh" ? model.meshes.find((x) => x.id === g.meshId) : undefined;
  return (
    <div
      className="card"
      style={focused ? { borderColor: "var(--accent)" } : undefined}
      onClick={() => app().select({ kind, linkId: link.id, compId: comp.id })}
    >
      <div className="card-head">
        {kind === "visual" ? (
          <Box size={13} />
        ) : (
          <Shield size={13} style={{ color: "var(--vp-collision)" }} />
        )}
        <span className="grow" style={{ color: "var(--text)" }}>
          {g.type === "mesh" ? (asset?.name ?? "missing part") : g.type}
        </span>
        <button
          className="icon-btn"
          title="Remove"
          onClick={(e) => {
            e.stopPropagation();
            edit((m) => {
              const L = linkById(m, link.id)!;
              if (kind === "visual") L.visuals = L.visuals.filter((x) => x.id !== comp.id);
              else L.collisions = L.collisions.filter((x) => x.id !== comp.id);
              if (L.inertial.auto) recomputeInertialIn(m, L.id);
            });
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
      {g.type === "box" && (
        <Field label="Size (m)">
          <Vec3Field
            value={g.size}
            onChange={(v) => upd((c) => ((c.geometry as { size: typeof v }).size = v), "size")}
          />
        </Field>
      )}
      {(g.type === "cylinder" || g.type === "sphere") && (
        <Field label="Radius">
          <NumberField
            unit="m"
            min={1e-5}
            value={g.radius}
            onChange={(v) => upd((c) => ((c.geometry as { radius: number }).radius = v), "radius")}
          />
        </Field>
      )}
      {g.type === "cylinder" && (
        <Field label="Length">
          <NumberField
            unit="m"
            min={1e-5}
            value={g.length}
            onChange={(v) => upd((c) => ((c.geometry as { length: number }).length = v), "length")}
          />
        </Field>
      )}
      {g.type === "mesh" && (
        <Field label="Scale">
          <Vec3Field
            unit="none"
            value={g.scale}
            onChange={(v) => upd((c) => ((c.geometry as { scale: typeof v }).scale = v), "scale")}
          />
        </Field>
      )}
      <Field label="Offset (m)">
        <Vec3Field
          value={comp.origin.xyz}
          onChange={(v) => upd((c) => (c.origin.xyz = v), "xyz")}
        />
      </Field>
      <Field label="Rotation (°)">
        <Vec3Field
          unit="deg"
          labels={["R", "P", "Y"]}
          value={comp.origin.rpy}
          onChange={(v) => upd((c) => (c.origin.rpy = v), "rpy")}
        />
      </Field>
      {kind === "visual" && (
        <Field label="Material">
          <Select
            value={(comp as Visual).materialId ?? ""}
            options={[
              { value: "", label: "— none —" },
              ...model.materials.map((m) => ({ value: m.id, label: m.name })),
            ]}
            onChange={(v) => upd((c) => ((c as Visual).materialId = v || null))}
          />
        </Field>
      )}
    </div>
  );
}

function InertialSection({
  link: L,
  upd,
}: {
  link: Link;
  upd: (fn: (l: Link) => void, key?: string, recompute?: boolean) => void;
}) {
  const ine = L.inertial;
  const I = ine.inertia;
  const inertiaField = (k: keyof typeof I, label: string) => (
    <NumberField
      tag={label}
      unit="none"
      precision={8}
      value={I[k]}
      disabled={ine.auto}
      onChange={(v) => upd((x) => (x.inertial.inertia[k] = v), `I${k}`)}
    />
  );
  return (
    <Section title="Mass and inertia" icon={<Scale size={14} />} id="inertial">
      <CheckRow
        checked={ine.auto}
        onChange={(v) => upd((x) => (x.inertial.auto = v), undefined, true)}
      >
        Compute from geometry
      </CheckRow>
      {ine.auto && (
        <Field label="From">
          <Select
            value={ine.mode}
            options={[
              { value: "density", label: "Material density" },
              { value: "mass", label: "Known total mass" },
            ]}
            onChange={(v) => upd((x) => (x.inertial.mode = v), undefined, true)}
          />
        </Field>
      )}
      {ine.auto && ine.mode === "density" ? (
        <>
          <Field
            label="Density"
            hint="Aluminium 2700 · ABS/PLA (100% infill) 1050–1250 · steel 7850"
          >
            <NumberField
              unit="kgm3"
              min={0.001}
              value={ine.density}
              onChange={(v) => upd((x) => (x.inertial.density = v), "density", true)}
            />
          </Field>
          <div className="stat-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="stat">
              <div className="k">Mass</div>
              <div className="v">{ine.mass.toPrecision(4)} kg</div>
            </div>
            <div className="stat">
              <div className="k">Volume</div>
              <div className="v">{(ine.volume * 1e6).toPrecision(4)} cm³</div>
            </div>
          </div>
        </>
      ) : (
        <Field label="Mass">
          <NumberField
            unit="kg"
            min={1e-6}
            value={ine.mass}
            onChange={(v) => upd((x) => (x.inertial.mass = v), "mass", true)}
          />
        </Field>
      )}
      <Field label="COM (m)">
        <Vec3Field
          value={ine.com}
          disabled={ine.auto}
          onChange={(v) => upd((x) => (x.inertial.com = v), "com")}
        />
      </Field>
      <Field label="Ixx Iyy Izz">
        <div className="vec3">
          {inertiaField("ixx", "x")}
          {inertiaField("iyy", "y")}
          {inertiaField("izz", "z")}
        </div>
      </Field>
      <Field label="Ixy Iyz Ixz">
        <div className="vec3">
          {inertiaField("ixy", "·")}
          {inertiaField("iyz", "·")}
          {inertiaField("ixz", "·")}
        </div>
      </Field>
      {!ine.watertight && (
        <div className="callout warn">
          <AlertTriangle size={14} />
          <span>
            A mesh on this link is not a closed surface, so the computed mass and inertia are
            approximate. Enter known values, or use a primitive.
          </span>
        </div>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ part

function PartInspector({ asset, model }: { asset: MeshAsset; model: RobotModel }) {
  const size = [0, 1, 2].map((i) => asset.bbox.max[i] - asset.bbox.min[i]);
  const users = model.links.filter((l) =>
    [...l.visuals, ...l.collisions].some(
      (c) => c.geometry.type === "mesh" && c.geometry.meshId === asset.id,
    ),
  );
  return (
    <>
      <div className="insp-head">
        <Atom size={18} className="muted" />
        <div className="title">
          <div className="kind">Part · {asset.source}</div>
          <TextField
            value={asset.name}
            onCommit={(v) =>
              edit((m) => {
                const a = m.meshes.find((x) => x.id === asset.id)!;
                a.name = safeName(v, "part");
                a.file = `${a.name}.stl`;
              })
            }
          />
        </div>
      </div>
      <Section title="Geometry" icon={<Box size={14} />} id="part-geo">
        <div className="stat-grid">
          <div className="stat">
            <div className="k">Triangles</div>
            <div className="v">{asset.triangles.toLocaleString()}</div>
          </div>
          <div className="stat">
            <div className="k">Volume</div>
            <div className="v">{(asset.volume * 1e6).toPrecision(4)} cm³</div>
          </div>
          <div className="stat">
            <div className="k">Closed</div>
            <div className="v" style={{ color: asset.watertight ? "var(--ok)" : "var(--warn)" }}>
              {asset.watertight ? "yes" : "no"}
            </div>
          </div>
        </div>
        <Field label="Size (m)">
          <div className="mono dim">
            {size.map((s) => `${(s * 1000).toFixed(1)}`).join(" × ")} mm
          </div>
        </Field>
        <Field label="Source">
          <div className="dim">{asset.origin}</div>
        </Field>
        <Field label="Export file">
          <div className="mono dim">
            {model.meshDir}/{asset.file}
          </div>
        </Field>
        <Field label="Used by">
          <div className="dim">{users.map((u) => u.name).join(", ") || "nothing"}</div>
        </Field>
        <div className="row">
          <button
            className="btn primary sm"
            onClick={() =>
              edit((m) => {
                const a = m.meshes.find((x) => x.id === asset.id)!;
                app().select({ kind: "link", linkId: linkFromMeshIn(m, a).id });
              })
            }
          >
            <Plus size={13} /> Add as link
          </button>
          <button
            className="btn sm"
            title="Split into connected bodies"
            onClick={() => {
              const pos = meshStore.get(asset.id);
              if (!pos) return;
              const parts = splitComponents(pos);
              if (parts.length < 2) return app().toast("This part is a single connected body.");
              edit((m) =>
                parts.forEach((p, i) =>
                  createMeshAsset(
                    m,
                    `${asset.name}_${i + 1}`,
                    p,
                    asset.source,
                    asset.origin,
                    asset.color,
                  ),
                ),
              );
              app().toast(`Split into ${parts.length} parts`, "success");
            }}
          >
            Split bodies
          </button>
        </div>
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ robot

function RobotInspector({ model }: { model: RobotModel }) {
  const ex = model.export;
  const joints = model.links.filter((l) => hasJoint(model, l));
  const moving = joints.filter((l) => l.joint.type !== "fixed");
  const mass = model.links.reduce((a, l) => a + l.inertial.mass, 0);
  return (
    <>
      <div className="insp-head">
        <Cog size={18} className="muted" />
        <div className="title">
          <div className="kind">Robot</div>
          <TextField
            value={model.robot}
            onCommit={(v) =>
              edit((m) => {
                const n = safeName(v, "robot");
                if (m.packageName === `${m.robot}_description`)
                  m.packageName = `${n.toLowerCase()}_description`;
                m.robot = n;
              })
            }
          />
        </div>
      </div>
      <Section title="Overview" icon={<Gauge size={14} />} id="robot-overview">
        <div className="stat-grid">
          <div className="stat">
            <div className="k">Links</div>
            <div className="v">{model.links.length}</div>
          </div>
          <div className="stat">
            <div className="k">Moving joints</div>
            <div className="v">{moving.length}</div>
          </div>
          <div className="stat">
            <div className="k">Mass</div>
            <div className="v">{mass.toPrecision(3)} kg</div>
          </div>
        </div>
      </Section>
      <Section title="ROS package" icon={<Box size={14} />} id="robot-pkg">
        <Field label="Package">
          <TextField
            value={model.packageName}
            onCommit={(v) =>
              edit(
                (m) =>
                  (m.packageName = v
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9_]/g, "_")),
              )
            }
            mono
          />
        </Field>
        <Field label="Mesh folder">
          <TextField
            value={model.meshDir}
            onCommit={(v) =>
              edit((m) => (m.meshDir = v.trim().replace(/[^A-Za-z0-9_-]/g, "_") || "meshes"))
            }
            mono
          />
        </Field>
        <Field label="Default target">
          <Select
            value={ex.defaultTarget}
            options={TARGET_IDS.map((t) => ({ value: t, label: targetLabel(TARGETS[t]) }))}
            onChange={(v) =>
              edit((m) => {
                m.export.defaultTarget = v;
                if (!m.export.targets.includes(v)) m.export.targets.push(v);
              })
            }
          />
        </Field>
        <Field label="ros2_control">
          <div className="row">
            <Toggle
              checked={ex.ros2Control}
              onChange={(v) => edit((m) => (m.export.ros2Control = v))}
            />
            <span className="dim">
              {ex.ros2Control ? "Controllers and Gazebo plugin" : "Joint states only"}
            </span>
          </div>
        </Field>
        {ex.ros2Control && (
          <Field label="Command">
            <Select
              value={ex.commandInterface}
              options={[
                { value: "auto", label: "Auto (wheels velocity, rest position)" },
                { value: "position", label: "Position" },
                { value: "velocity", label: "Velocity" },
                { value: "effort", label: "Effort" },
              ]}
              onChange={(v) => edit((m) => (m.export.commandInterface = v))}
            />
          </Field>
        )}
        <button className="btn sm" onClick={() => runCommand("file.export")}>
          Export settings and preview…
        </button>
      </Section>
      <Section
        title={`Materials (${model.materials.length})`}
        icon={<Palette size={14} />}
        id="robot-mats"
      >
        {model.materials.map((mt) => (
          <MaterialEditor key={mt.id} mt={mt} />
        ))}
        <div className="row">
          <button
            className="btn sm ghost"
            onClick={() =>
              edit((m) =>
                m.materials.push(
                  newMaterial(`material_${m.materials.length + 1}`, [0.7, 0.7, 0.72, 1]),
                ),
              )
            }
          >
            <Plus size={13} /> Add material
          </button>
          <button className="btn sm ghost" onClick={() => app().openDialog("materials")}>
            <Palette size={13} /> Library…
          </button>
        </div>
      </Section>
      {!model.links.length && (
        <div style={{ padding: 12 }}>
          <div className="callout info">
            <Link2 size={14} />
            <span>
              Select a link in the viewport or the Robot tab to edit its joint, origin, geometry and
              mass.
            </span>
          </div>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ material editor

const hex = (rgba: number[]) =>
  `#${rgba
    .slice(0, 3)
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

function MaterialEditor({ mt }: { mt: Material }) {
  const [open, setOpen] = useState(false);
  const upd = (fn: (m: Material) => void, key?: string) =>
    edit((model) => fn(materialById(model, mt.id)!), key && `mat.${mt.id}.${key}`);
  const users = useApp(
    (s) => s.model.links.filter((l) => l.visuals.some((v) => v.materialId === mt.id)).length,
  );
  const tex = mt.textures;
  return (
    <div className="card" style={{ padding: 6 }}>
      <div className="row">
        <input
          type="color"
          aria-label={`${mt.name} colour`}
          value={hex(mt.rgba)}
          onChange={(e) => {
            const h = e.target.value;
            upd((x) => {
              x.rgba = [
                parseInt(h.slice(1, 3), 16) / 255,
                parseInt(h.slice(3, 5), 16) / 255,
                parseInt(h.slice(5, 7), 16) / 255,
                x.rgba[3],
              ];
            }, "rgb");
          }}
          style={{ width: 28, height: 24, border: 0, background: "none", padding: 0 }}
        />
        <div className="grow">
          <TextField
            value={mt.name}
            onCommit={(v) => upd((x) => (x.name = safeName(v, "material")))}
          />
        </div>
        {tex && (
          <span className="badge ok" title={tex.source}>
            PBR
          </span>
        )}
        <button
          className="icon-btn"
          title={open ? "Hide settings" : "Edit material"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Palette size={14} />
        </button>
      </div>
      {open && (
        <div className="col" style={{ paddingTop: 4 }}>
          <Field label="Metalness">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={mt.metalness}
              onChange={(e) => upd((x) => (x.metalness = +e.target.value), "metal")}
            />
          </Field>
          <Field label="Roughness">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={mt.roughness}
              onChange={(e) => upd((x) => (x.roughness = +e.target.value), "rough")}
            />
          </Field>
          <Field label="Clear coat" title="A glossy lacquer layer over the base material">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={mt.clearcoat ?? 0}
              onChange={(e) => upd((x) => (x.clearcoat = +e.target.value), "coat")}
            />
          </Field>
          <Field label="Opacity">
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.01}
              value={mt.rgba[3]}
              onChange={(e) =>
                upd((x) => (x.rgba = [x.rgba[0], x.rgba[1], x.rgba[2], +e.target.value]), "alpha")
              }
            />
          </Field>
          {tex && (
            <>
              <Field label="Tile size (m)" hint={tex.source}>
                <NumberField
                  value={tex.tile}
                  unit="m"
                  min={0.005}
                  onChange={(v) => upd((x) => (x.textures!.tile = v), "tile")}
                />
              </Field>
              <button className="btn sm ghost" onClick={() => upd((x) => (x.textures = null))}>
                Remove textures
              </button>
            </>
          )}
          <div className="row">
            <button
              className="btn sm"
              onClick={() => app().openDialog("materials", { materialId: mt.id })}
            >
              Finishes and PBR textures…
            </button>
            <span className="grow" />
            <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
              {users} link{users === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
