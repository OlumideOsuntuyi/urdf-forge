/**
 * Physics preview with Rapier. Each link on a moving joint (and each root) becomes a rigid body
 * whose frame starts aligned with the world at the link's origin; links on fixed joints share
 * their parent's body. A constant per-link offset maps body poses back to link frames.
 * Because every body starts world-aligned, a joint axis is the same vector in both bodies.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { hasJoint, linkById, type Link, type RobotModel } from "@/core/model";
import { eigenSym3, normalize, poseToMatrix, rpyToQuat } from "@/core/math";
import { linkWorldMatrices, lowestZ } from "@/core/kinematics";
import type { Environment } from "@/core/env/types";

let ready: Promise<void> | null = null;
export const initPhysics = () => (ready ??= RAPIER.init());

export interface SimOptions {
  fixedBase: boolean;
  gravity: boolean;
  /** Multipliers on the motor gains derived from each joint's effort limit (1 = default). */
  stiffness: number;
  damping: number;
}

interface BodyRec {
  link: Link;
  body: RAPIER.RigidBody;
  /** link world = body world * offset */
  offset: THREE.Matrix4;
  joint?: RAPIER.ImpulseJoint;
  axisWorld0?: THREE.Vector3;
  /** Child origin relative to the parent body at rest, in the parent body frame. */
  anchor0?: THREE.Vector3;
  parent?: BodyRec;
}

const GROUND = 0x0001;
const ROBOT = 0x0002;
const groups = (membership: number, filter: number) => (membership << 16) | filter;

export class PhysicsSim {
  private world: RAPIER.World;
  private bodies = new Map<string, BodyRec>();
  private time = 0;
  readonly dt = 1 / 240;

  /** Maps physics-world poses back into the robot's frame (the viewport adds the spawn pose). */
  private spawnInv: THREE.Matrix4;

  constructor(
    model: RobotModel,
    meshes: (id: string) => Float32Array | undefined,
    private opts: SimOptions,
    env: Environment | null = null,
  ) {
    this.world = new RAPIER.World({ x: 0, y: 0, z: opts.gravity ? -9.81 : 0 });
    this.world.timestep = this.dt;
    // Extra inner iterations keep light wheels and casters on a heavy chassis from rocking.
    this.world.numInternalPgsIterations = 4;
    const W = linkWorldMatrices(model);

    // The robot stands on the floor at its spawn pose (as in the viewport), starting 2 mm up.
    const base = -lowestZ(model, meshes);
    const lift = base + 0.002;
    const spawn = env ? poseToMatrix(env.spawn) : new THREE.Matrix4();
    // The viewport lifts the robot onto the floor itself, so outputs drop both spawn and lift.
    this.spawnInv = spawn
      .clone()
      .multiply(new THREE.Matrix4().makeTranslation(0, 0, base))
      .invert();

    if (!env || env.ground) {
      const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(100, 100, 0.05)
          .setTranslation(0, 0, -0.05)
          .setCollisionGroups(groups(GROUND, 0xffff))
          .setFriction(0.9),
        ground,
      );
    }
    if (env) this.addEnvironment(env);

    // Links on fixed joints are merged into their parent's body, as Gazebo does: tiny fixed
    // links (casters, sensor frames) on separate bodies make the joint solver soft and wobbly.
    const owner = (L: Link): Link => {
      let x = L;
      while (hasJoint(model, x) && x.joint.type === "fixed") x = linkById(model, x.parentId)!;
      return x;
    };
    const place = (L: Link) =>
      W.get(L.id)!
        .clone()
        .premultiply(new THREE.Matrix4().makeTranslation(0, 0, lift))
        .premultiply(spawn);
    const parts = new Map<string, { L: Link; offset: THREE.Matrix4 }[]>();
    for (const L of model.links) {
      const O = owner(L);
      let body = this.bodies.get(O.id)?.body;
      const p = new THREE.Vector3().setFromMatrixPosition(place(O));
      if (!body) {
        const isRoot = !hasJoint(model, O);
        const desc = (
          isRoot && opts.fixedBase ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic()
        )
          .setTranslation(p.x, p.y, p.z)
          .setCanSleep(false)
          .setGravityScale(O.gazebo.gravity ? 1 : 0)
          .setAngularDamping(0.05)
          .setLinearDamping(0.01);
        body = this.world.createRigidBody(desc);
        this.bodies.set(O.id, { link: O, body, offset: new THREE.Matrix4() });
      }
      // Bodies start world-aligned at their owner's origin.
      const offset = place(L).premultiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
      this.addColliders(L, body, offset, meshes);
      if (!parts.has(O.id)) parts.set(O.id, []);
      parts.get(O.id)!.push({ L, offset });
      if (L === O) this.bodies.get(O.id)!.offset = offset;
      else this.bodies.set(L.id, { link: L, body, offset });
    }
    for (const [id, list] of parts) this.setMass(this.bodies.get(id)!.body, list);

    for (const rec of this.bodies.values()) {
      const L = rec.link;
      if (!hasJoint(model, L) || owner(L) !== L) continue;
      const parent = this.bodies.get(L.parentId!)!;
      rec.parent = parent;
      const pw = parent.body.translation();
      const cw = rec.body.translation();
      const a1 = { x: cw.x - pw.x, y: cw.y - pw.y, z: cw.z - pw.z };
      const a2 = { x: 0, y: 0, z: 0 };
      const axis = new THREE.Vector3(...normalize(L.joint.axis))
        .applyMatrix4(rec.offset)
        .normalize();
      rec.axisWorld0 = axis;
      rec.anchor0 = new THREE.Vector3(a1.x, a1.y, a1.z);
      const ax = { x: axis.x, y: axis.y, z: axis.z };
      const t = L.joint.type;
      let data: RAPIER.JointData;
      if (t === "revolute" || t === "continuous") data = RAPIER.JointData.revolute(a1, a2, ax);
      else if (t === "prismatic") data = RAPIER.JointData.prismatic(a1, a2, ax);
      else
        data = RAPIER.JointData.fixed(a1, { w: 1, x: 0, y: 0, z: 0 }, a2, {
          w: 1,
          x: 0,
          y: 0,
          z: 0,
        });
      const j = this.world.createImpulseJoint(data, parent.body, rec.body, true);
      j.setContactsEnabled(false);
      if (t === "revolute" || t === "prismatic" || t === "continuous") {
        const u = j as RAPIER.UnitImpulseJoint;
        // Limits set on JointData are not applied by rapier.js; set them on the joint itself.
        if (t !== "continuous") u.setLimits(L.joint.lower, L.joint.upper);
        u.configureMotorModel(RAPIER.MotorModel.ForceBased);
      }
      rec.joint = j;
    }
    this.applyDrives(0);
  }

  /** Static colliders for the scenery. Meshes become triangle meshes (fine for fixed bodies). */
  private addEnvironment(env: Environment) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const o of env.objects) {
      if (o.noCollide) continue;
      const g = o.geometry;
      const pos = new THREE.Vector3(...o.pose.xyz);
      const q = rpyToQuat(o.pose.rpy);
      let desc: RAPIER.ColliderDesc;
      if (g.type === "box")
        desc = RAPIER.ColliderDesc.cuboid(g.size[0] / 2, g.size[1] / 2, g.size[2] / 2);
      else if (g.type === "sphere") desc = RAPIER.ColliderDesc.ball(g.radius);
      else if (g.type === "cylinder") {
        desc = RAPIER.ColliderDesc.cylinder(g.length / 2, g.radius);
        q.multiply(
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
        );
      } else {
        const src = env.meshes[g.mesh];
        if (!src || src.length < 9) continue;
        const s = g.scale ?? [1, 1, 1];
        const verts = new Float32Array(src.length);
        for (let i = 0; i < src.length; i++) verts[i] = src[i] * s[i % 3];
        const idx = new Uint32Array(src.length / 3).map((_, i) => i);
        desc = RAPIER.ColliderDesc.trimesh(verts, idx);
      }
      desc
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setFriction(0.8)
        .setCollisionGroups(groups(GROUND, 0xffff));
      this.world.createCollider(desc, body);
    }
  }

  private addColliders(
    L: Link,
    body: RAPIER.RigidBody,
    offset: THREE.Matrix4,
    meshes: (id: string) => Float32Array | undefined,
  ) {
    const self = L.gazebo.selfCollide;
    for (const c of L.collisions) {
      const g = c.geometry;
      const local = offset.clone().multiply(poseToMatrix(c.origin));
      const pos = new THREE.Vector3();
      const q = new THREE.Quaternion();
      local.decompose(pos, q, new THREE.Vector3());
      let desc: RAPIER.ColliderDesc | null = null;
      if (g.type === "box")
        desc = RAPIER.ColliderDesc.cuboid(g.size[0] / 2, g.size[1] / 2, g.size[2] / 2);
      else if (g.type === "sphere") desc = RAPIER.ColliderDesc.ball(g.radius);
      else if (g.type === "cylinder") {
        desc = RAPIER.ColliderDesc.cylinder(g.length / 2, g.radius);
        q.multiply(
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
        );
      } else {
        const src = meshes(g.meshId);
        if (src) {
          const scaled = new Float32Array(src.length);
          for (let i = 0; i < src.length; i++) scaled[i] = src[i] * g.scale[i % 3];
          desc = RAPIER.ColliderDesc.convexHull(scaled);
        }
      }
      if (!desc) continue;
      desc
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setDensity(0)
        .setFriction((L.gazebo.mu1 + L.gazebo.mu2) / 2)
        .setCollisionGroups(groups(ROBOT, self ? GROUND | ROBOT : GROUND));
      this.world.createCollider(desc, body);
    }
  }

  /** Mass properties of a body from all the links merged into it (offsets are body-frame). */
  private setMass(body: RAPIER.RigidBody, parts: { L: Link; offset: THREE.Matrix4 }[]) {
    const items = parts.map(({ L, offset }) => {
      const ine = L.inertial;
      const R = new THREE.Matrix3().setFromMatrix4(offset);
      const i = ine.inertia;
      const I = new THREE.Matrix3().set(
        i.ixx,
        i.ixy,
        i.ixz,
        i.ixy,
        i.iyy,
        i.iyz,
        i.ixz,
        i.iyz,
        i.izz,
      );
      return {
        m: Math.max(ine.mass, 0),
        c: new THREE.Vector3(...ine.com).applyMatrix4(offset),
        I: R.clone().multiply(I).multiply(R.clone().transpose()),
      };
    });
    const M = Math.max(
      items.reduce((a, x) => a + x.m, 0),
      1e-4,
    );
    const C = items.reduce((a, x) => a.addScaledVector(x.c, x.m / M), new THREE.Vector3());
    // Parallel-axis theorem about the combined centre of mass.
    const T = new Array(9).fill(0);
    for (const { m, c, I } of items) {
      const d = c.clone().sub(C);
      const dd = d.dot(d);
      const dv = [d.x, d.y, d.z];
      for (let r = 0; r < 3; r++)
        for (let k = 0; k < 3; k++)
          T[r * 3 + k] += I.elements[k * 3 + r] + m * ((r === k ? dd : 0) - dv[r] * dv[k]);
    }
    const { values, vectors } = eigenSym3({
      ixx: T[0],
      ixy: T[1],
      ixz: T[2],
      iyy: T[4],
      iyz: T[5],
      izz: T[8],
    });
    const basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(vectors[0][0], vectors[1][0], vectors[2][0]),
      new THREE.Vector3(vectors[0][1], vectors[1][1], vectors[2][1]),
      new THREE.Vector3(vectors[0][2], vectors[1][2], vectors[2][2]),
    );
    if (basis.determinant() < 0) basis.scale(new THREE.Vector3(1, 1, -1));
    const q = new THREE.Quaternion().setFromRotationMatrix(basis);
    const floor = Math.max(M * 1e-6, 1e-9);
    body.setAdditionalMassProperties(
      M,
      { x: C.x, y: C.y, z: C.z },
      {
        x: Math.max(values[0], floor),
        y: Math.max(values[1], floor),
        z: Math.max(values[2], floor),
      },
      { x: q.x, y: q.y, z: q.z, w: q.w },
      true,
    );
  }

  /** Push drive targets (servo positions, wheel velocities) into the joint motors. */
  applyDrives(time: number, overrides: Record<string, number> = {}) {
    for (const rec of this.bodies.values()) {
      const j = rec.joint as RAPIER.RevoluteImpulseJoint | undefined;
      const L = rec.link;
      if (!j || !("configureMotorPosition" in j)) continue;
      const d = L.drive;
      const manual = overrides[L.id];
      // Force-based motors with gains from the joint's effort limit, like a real servo:
      // full effort at about 3 degrees (or 3 mm) of error, critically damped-ish.
      const effort = Math.max(L.joint.effort, 0.1);
      const kp = (effort / 0.05) * this.opts.stiffness;
      const kd = effort * 0.5 * this.opts.damping;
      if (d.mode === "wheel") {
        j.configureMotorVelocity(manual ?? d.target, effort * 2 * this.opts.damping);
      } else if (d.mode === "servo" || manual !== undefined) {
        let target = manual ?? d.target;
        if (d.sweep && manual === undefined) {
          const mid = (L.joint.lower + L.joint.upper) / 2;
          const amp = (L.joint.upper - L.joint.lower) / 2;
          target =
            mid + amp * Math.sin(time * Math.max(0.2, L.joint.velocity / Math.max(amp, 1e-3)));
        }
        j.configureMotorPosition(target, kp, kd);
      } else {
        // Undriven joints: friction from the joint's damping.
        j.configureMotorVelocity(0, L.joint.damping);
      }
    }
  }

  step(frameSeconds: number, overrides?: Record<string, number>) {
    const n = Math.min(16, Math.max(1, Math.round(frameSeconds / this.dt)));
    for (let i = 0; i < n; i++) {
      this.time += this.dt;
      this.applyDrives(this.time, overrides);
      this.world.step();
    }
  }

  /** Current link frames in model coordinates. */
  linkWorlds(): Map<string, THREE.Matrix4> {
    const out = new Map<string, THREE.Matrix4>();
    for (const [id, rec] of this.bodies) {
      const t = rec.body.translation();
      const r = rec.body.rotation();
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(t.x, t.y, t.z),
        new THREE.Quaternion(r.x, r.y, r.z, r.w),
        new THREE.Vector3(1, 1, 1),
      );
      out.set(id, m.multiply(rec.offset).premultiply(this.spawnInv));
    }
    return out;
  }

  /** Measured joint positions (rad or m) by link id. */
  jointPositions(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, rec] of this.bodies) {
      if (!rec.parent || !rec.axisWorld0) continue;
      const t = rec.link.joint.type;
      const pr = rec.parent.body.rotation();
      const cr = rec.body.rotation();
      const qp = new THREE.Quaternion(pr.x, pr.y, pr.z, pr.w);
      const qc = new THREE.Quaternion(cr.x, cr.y, cr.z, cr.w);
      if (t === "revolute" || t === "continuous") {
        const rel = qp.clone().invert().multiply(qc);
        const v = new THREE.Vector3(rel.x, rel.y, rel.z);
        out[id] = 2 * Math.atan2(v.dot(rec.axisWorld0), rel.w);
      } else if (t === "prismatic") {
        const a = rec.parent.body.translation();
        const b = rec.body.translation();
        const d = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).applyQuaternion(
          qp.clone().invert(),
        );
        out[id] = d.sub(rec.anchor0!).dot(rec.axisWorld0);
      }
    }
    return out;
  }

  dispose() {
    this.world.free();
  }
}
