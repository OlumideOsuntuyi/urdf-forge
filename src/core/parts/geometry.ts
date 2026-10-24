/**
 * Procedural meshes for the parametric component library.
 *
 * Every helper returns a triangle soup (Float32Array, 9 floats per triangle) in metres. Solids are
 * closed and wound outward; their vertices are shared by exact position, so isWatertight() holds.
 * Axis conventions follow URDF: round parts (cylinders, tubes, gears, wheels) run along local Z and
 * are centred on the origin unless noted otherwise.
 */
import { BoxGeometry, BufferGeometry, Matrix4, Shape, ShapeUtils, Vector2, Vector3 } from "three";
import type { Pose, Vec3 } from "../model";
import { poseToMatrix } from "../math";

export type Soup = Float32Array;
export type Vec2 = [number, number];

// ------------------------------------------------------------------ soup utilities

/** Convert a three.js geometry (indexed or not) to a triangle soup. */
export function soupFromGeometry(g: BufferGeometry): Float32Array {
  const pos = g.getAttribute("position");
  const index = g.getIndex();
  if (index) {
    const out = new Float32Array(index.count * 3);
    for (let i = 0; i < index.count; i++) {
      const v = index.getX(i);
      out[i * 3] = pos.getX(v);
      out[i * 3 + 1] = pos.getY(v);
      out[i * 3 + 2] = pos.getZ(v);
    }
    return out;
  }
  const out = new Float32Array(pos.count * 3);
  for (let v = 0; v < pos.count; v++) {
    out[v * 3] = pos.getX(v);
    out[v * 3 + 1] = pos.getY(v);
    out[v * 3 + 2] = pos.getZ(v);
  }
  return out;
}

export function merge(...soups: Float32Array[]): Float32Array {
  const out = new Float32Array(soups.reduce((a, s) => a + s.length, 0));
  let o = 0;
  for (const s of soups) {
    out.set(s, o);
    o += s.length;
  }
  return out;
}

export function triangleCount(soup: Float32Array): number {
  return Math.floor(soup.length / 9);
}

/** Reverse the winding of every triangle. */
export function flip(soup: Float32Array): Float32Array {
  const out = soup.slice();
  for (let t = 0; t + 8 < out.length; t += 9) {
    for (let k = 0; k < 3; k++) {
      out[t + 3 + k] = soup[t + 6 + k];
      out[t + 6 + k] = soup[t + 3 + k];
    }
  }
  return out;
}

/** Signed volume by the divergence theorem: positive for an outward-wound closed surface. */
export function signedVolume(soup: Float32Array): number {
  let v = 0;
  const P = soup;
  for (let t = 0; t + 8 < P.length; t += 9) {
    v +=
      P[t] * (P[t + 4] * P[t + 8] - P[t + 5] * P[t + 7]) -
      P[t + 1] * (P[t + 3] * P[t + 8] - P[t + 5] * P[t + 6]) +
      P[t + 2] * (P[t + 3] * P[t + 7] - P[t + 4] * P[t + 6]);
  }
  return v / 6;
}

/** Flip a consistently wound closed soup if it is inside out. */
export function orientOutward(soup: Float32Array): Float32Array {
  return signedVolume(soup) < 0 ? flip(soup) : soup;
}

/** Apply a matrix or a URDF pose. Mirroring transforms keep the winding outward. */
export function transform(soup: Float32Array, m: Matrix4 | Partial<Pose>): Float32Array {
  const mat =
    m instanceof Matrix4 ? m : poseToMatrix({ xyz: m.xyz ?? [0, 0, 0], rpy: m.rpy ?? [0, 0, 0] });
  const e = mat.elements;
  const out = new Float32Array(soup.length);
  for (let i = 0; i + 2 < soup.length; i += 3) {
    const x = soup[i],
      y = soup[i + 1],
      z = soup[i + 2];
    out[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  return mat.determinant() < 0 ? flip(out) : out;
}

export function translate(soup: Float32Array, x: number, y: number, z: number): Float32Array {
  return transform(soup, { xyz: [x, y, z] });
}

// ------------------------------------------------------------------ builders

/** Collects shared vertices and triangles; vertices referenced by index stay bit-identical. */
class SoupBuilder {
  private v: number[] = [];
  private t: number[] = [];

  vertex(x: number, y: number, z: number): number {
    this.v.push(x, y, z);
    return this.v.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    if (a === b || b === c || a === c) return;
    this.t.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  build(): Float32Array {
    const out = new Float32Array(this.t.length * 3);
    for (let i = 0; i < this.t.length; i++) {
      const k = this.t[i] * 3;
      out[i * 3] = this.v[k];
      out[i * 3 + 1] = this.v[k + 1];
      out[i * 3 + 2] = this.v[k + 2];
    }
    return out;
  }
}

const EPS = 1e-12;

/**
 * Revolve a profile of (radius, z) points about the Z axis. Points with radius 0 lie on the
 * axis (an open profile should start and end there); `closedLoop` joins the last point back to
 * the first, for profiles that do not touch the axis (tubes, tori).
 */
export function revolve(input: Vec2[], segments = 32, closedLoop = false): Float32Array {
  const profile = input.filter(
    (p, i) => i === 0 || Math.hypot(p[0] - input[i - 1][0], p[1] - input[i - 1][1]) > 1e-9,
  );
  const n = profile.length;
  const seg = Math.max(3, Math.round(segments));
  const b = new SoupBuilder();
  const ids: number[][] = [];
  for (let j = 0; j < n; j++) {
    const [r, z] = profile[j];
    const row: number[] = [];
    if (r <= EPS) {
      const id = b.vertex(0, 0, z);
      for (let i = 0; i < seg; i++) row.push(id);
    } else {
      for (let i = 0; i < seg; i++) {
        const a = (2 * Math.PI * i) / seg;
        row.push(b.vertex(r * Math.cos(a), r * Math.sin(a), z));
      }
    }
    ids.push(row);
  }
  const edges = closedLoop ? n : n - 1;
  for (let j = 0; j < edges; j++) {
    const j2 = (j + 1) % n;
    for (let i = 0; i < seg; i++) {
      const i2 = (i + 1) % seg;
      b.quad(ids[j][i], ids[j][i2], ids[j2][i2], ids[j2][i]);
    }
  }
  return orientOutward(b.build());
}

/** Remove duplicate, closing and collinear points so caps and walls share every vertex. */
function cleanLoop(pts: Vec2[]): Vec2[] {
  let out = pts.slice();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    const next: Vec2[] = [];
    for (let i = 0; i < out.length; i++) {
      const p = out[(i + out.length - 1) % out.length];
      const c = out[i];
      const q = out[(i + 1) % out.length];
      const dup = Math.hypot(c[0] - p[0], c[1] - p[1]) < 1e-9;
      const cross = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]);
      const scale = Math.hypot(c[0] - p[0], c[1] - p[1]) * Math.hypot(q[0] - c[0], q[1] - c[1]);
      if (dup || Math.abs(cross) <= 1e-10 * scale) {
        changed = true;
        continue;
      }
      next.push(c);
    }
    out = next;
  }
  return out;
}

function loopArea(pts: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}

/**
 * Extrude a polygon with optional holes along +Z from z = 0 to z = depth. Outer loop and holes
 * may be given in either winding; holes must lie strictly inside the outer loop.
 */
export function extrudeLoops(outer: Vec2[], holes: Vec2[][], depth: number): Float32Array {
  let o = cleanLoop(outer);
  if (loopArea(o) < 0) o = o.reverse();
  const hs = holes
    .map(cleanLoop)
    .filter((h) => h.length >= 3)
    .map((h) => (loopArea(h) > 0 ? h.reverse() : h));
  const loops = [o, ...hs];
  const flat = loops.flat();
  const b = new SoupBuilder();
  const bottom = flat.map(([x, y]) => b.vertex(x, y, 0));
  const top = flat.map(([x, y]) => b.vertex(x, y, depth));
  const faces = ShapeUtils.triangulateShape(
    o.map(([x, y]) => new Vector2(x, y)),
    hs.map((h) => h.map(([x, y]) => new Vector2(x, y))),
  );
  for (const [i, j, k] of faces) {
    const [ax, ay] = flat[i];
    const [bx, by] = flat[j];
    const [cx, cy] = flat[k];
    const ccw = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) > 0;
    if (ccw) {
      b.tri(top[i], top[j], top[k]);
      b.tri(bottom[i], bottom[k], bottom[j]);
    } else {
      b.tri(top[i], top[k], top[j]);
      b.tri(bottom[i], bottom[j], bottom[k]);
    }
  }
  let base = 0;
  for (const loop of loops) {
    const n = loop.length;
    for (let i = 0; i < n; i++) {
      const a = base + i;
      const c = base + ((i + 1) % n);
      b.quad(bottom[a], bottom[c], top[c], top[a]);
    }
    base += n;
  }
  return orientOutward(b.build());
}

/** Extrude a three.js Shape (with holes) along +Z from 0 to depth, without bevels. */
export function extrudeProfile(shape: Shape, depth: number, curveSegments = 8): Float32Array {
  const { shape: outer, holes } = shape.extractPoints(curveSegments);
  return extrudeLoops(
    outer.map((p) => [p.x, p.y] as Vec2),
    holes.map((h) => h.map((p) => [p.x, p.y] as Vec2)),
    depth,
  );
}

/**
 * Extrude a profile drawn in the XZ plane (x right, second coordinate up) through `width`
 * along Y, centred on y = 0. Handy for brackets and ramps.
 */
export function extrudeXZ(outer: Vec2[], holes: Vec2[][], width: number): Float32Array {
  const s = extrudeLoops(outer, holes, width);
  return transform(s, new Matrix4().makeTranslation(0, width / 2, 0).multiply(rotX90()));
}

function rotX90(): Matrix4 {
  return new Matrix4().makeRotationX(Math.PI / 2);
}

export function circleLoop(cx: number, cy: number, r: number, n = 24): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

export function rectLoop(cx: number, cy: number, w: number, h: number): Vec2[] {
  return [
    [cx - w / 2, cy - h / 2],
    [cx + w / 2, cy - h / 2],
    [cx + w / 2, cy + h / 2],
    [cx - w / 2, cy + h / 2],
  ];
}

// ------------------------------------------------------------------ primitives

export function box(sx: number, sy: number, sz: number): Float32Array {
  return orientOutward(soupFromGeometry(new BoxGeometry(sx, sy, sz)));
}

/** Box of the given size with every edge and corner rounded to radius r. */
export function roundedBox(
  sx: number,
  sy: number,
  sz: number,
  r: number,
  segments = 4,
): Float32Array {
  const h: Vec3 = [sx / 2, sy / 2, sz / 2];
  const rr = Math.min(Math.max(r, 0), Math.min(...h) * 0.999);
  if (rr < 1e-6) return box(sx, sy, sz);
  const seg = Math.max(1, Math.round(segments));
  // Grid coordinates per axis: dense across the rounded bands, a single span in between.
  const coords = h.map((hk) => {
    const inner = hk - rr;
    const c: number[] = [];
    for (let i = 0; i <= seg; i++) c.push(-hk + (rr * i) / seg);
    for (let i = 0; i <= seg; i++) c.push(inner + (rr * i) / seg);
    return c.filter((v, i) => i === 0 || Math.abs(v - c[i - 1]) > 1e-9);
  });
  const inner = h.map((hk) => hk - rr);
  const map = (q: Vec3): Vec3 => {
    const c = q.map((v, k) => Math.max(-inner[k], Math.min(inner[k], v))) as Vec3;
    const d = [q[0] - c[0], q[1] - c[1], q[2] - c[2]];
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    return [c[0] + (rr * d[0]) / len, c[1] + (rr * d[1]) / len, c[2] + (rr * d[2]) / len];
  };
  const b = new SoupBuilder();
  const cache = new Map<string, number>();
  const vid = (q: Vec3) => {
    const k = q.join(",");
    let id = cache.get(k);
    if (id === undefined) {
      const p = map(q);
      id = b.vertex(p[0], p[1], p[2]);
      cache.set(k, id);
    }
    return id;
  };
  for (let a = 0; a < 3; a++) {
    const u = (a + 1) % 3;
    const v = (a + 2) % 3;
    for (const s of [-1, 1]) {
      const U = coords[u];
      const V = coords[v];
      for (let i = 0; i + 1 < U.length; i++) {
        for (let j = 0; j + 1 < V.length; j++) {
          const pt = (iu: number, jv: number) => {
            const q: Vec3 = [0, 0, 0];
            q[a] = s * h[a];
            q[u] = U[iu];
            q[v] = V[jv];
            return vid(q);
          };
          const p00 = pt(i, j),
            p10 = pt(i + 1, j),
            p11 = pt(i + 1, j + 1),
            p01 = pt(i, j + 1);
          if (s > 0) b.quad(p00, p10, p11, p01);
          else b.quad(p00, p01, p11, p10);
        }
      }
    }
  }
  return orientOutward(b.build());
}

export function cylinder(radius: number, length: number, segments = 32): Float32Array {
  const h = length / 2;
  return revolve(
    [
      [0, -h],
      [radius, -h],
      [radius, h],
      [0, h],
    ],
    segments,
  );
}

/** Regular prism along Z with `sides` faces; `acrossFlats` is the spanner size. */
export function prism(sides: number, acrossFlats: number, length: number): Float32Array {
  const n = Math.max(3, Math.round(sides));
  const r = acrossFlats / 2 / Math.cos(Math.PI / n);
  return cylinder(r, length, n);
}

export function tube(outerR: number, innerR: number, length: number, segments = 32): Float32Array {
  const h = length / 2;
  const ri = Math.min(Math.max(innerR, 0), outerR * 0.98);
  if (ri <= 1e-6) return cylinder(outerR, length, segments);
  return revolve(
    [
      [ri, -h],
      [outerR, -h],
      [outerR, h],
      [ri, h],
    ],
    segments,
    true,
  );
}

/** Cone along +Z: base of the given radius at z = -h/2, apex at z = +h/2. */
export function cone(radius: number, height: number, segments = 32): Float32Array {
  const h = height / 2;
  return revolve(
    [
      [0, -h],
      [radius, -h],
      [0, h],
    ],
    segments,
  );
}

export function sphere(radius: number, segments = 24): Float32Array {
  const rings = Math.max(4, Math.round(segments / 2));
  const prof: Vec2[] = [];
  for (let i = 0; i <= rings; i++) {
    const a = (Math.PI * i) / rings;
    prof.push([i === 0 || i === rings ? 0 : radius * Math.sin(a), -radius * Math.cos(a)]);
  }
  return revolve(prof, segments);
}

/** Capsule along Z with the given radius and overall length (including the hemispheres). */
export function capsule(radius: number, length: number, segments = 24): Float32Array {
  const half = Math.max(length / 2 - radius, 0);
  const rings = Math.max(2, Math.round(segments / 4));
  const prof: Vec2[] = [];
  for (let i = 0; i <= rings; i++) {
    const a = ((Math.PI / 2) * i) / rings;
    prof.push([i === 0 ? 0 : radius * Math.sin(a), -half - radius * Math.cos(a)]);
  }
  for (let i = 0; i <= rings; i++) {
    const a = Math.PI / 2 + ((Math.PI / 2) * i) / rings;
    prof.push([i === rings ? 0 : radius * Math.sin(a), half - radius * Math.cos(a)]);
  }
  return revolve(prof, segments);
}

/** Torus about Z: ring radius R (centre of the tube), tube radius r. */
export function torus(R: number, r: number, radial = 16, tubular = 32): Float32Array {
  const rr = Math.min(r, R * 0.98);
  return revolve(circleLoop(R, 0, rr, radial), tubular, true);
}

/** Ramp: length along X, width along Y, rising to `height` at the -X end. Centred on its box. */
export function wedge(length: number, width: number, height: number): Float32Array {
  const l = length / 2;
  const h = height / 2;
  return extrudeXZ(
    [
      [-l, -h],
      [l, -h],
      [-l, h],
    ],
    [],
    width,
  );
}

/** Plate centred on the origin, thickness along Z, with round through-holes. */
export function plateWithHoles(
  w: number,
  h: number,
  t: number,
  holes: { x: number; y: number; r: number }[],
  holeSegments = 16,
): Float32Array {
  const loops = holes.map((c) => circleLoop(c.x, c.y, c.r, holeSegments));
  return translate(extrudeLoops(rectLoop(0, 0, w, h), loops, t), 0, 0, -t / 2);
}

/** Holes on a regular grid inside a plate, at least `margin` from the edges, capped in number. */
export function holeGrid(
  w: number,
  h: number,
  spacing: number,
  diameter: number,
  margin = diameter,
  maxHoles = 200,
): { x: number; y: number; r: number }[] {
  const r = diameter / 2;
  let s = Math.max(spacing, diameter * 1.5);
  const count = (step: number, span: number) =>
    Math.max(0, Math.floor((span - 2 * margin - 2 * r) / step + 1e-9) + 1);
  while (count(s, w) * count(s, h) > maxHoles) s *= 1.1;
  const nx = count(s, w);
  const ny = count(s, h);
  if (w - 2 * margin - 2 * r < 0 || h - 2 * margin - 2 * r < 0) return [];
  const out: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      out.push({ x: (i - (nx - 1) / 2) * s, y: (j - (ny - 1) / 2) * s, r });
  return out;
}

// ------------------------------------------------------------------ structural profiles

/**
 * Aluminium T-slot extrusion along Z, centred. Series 20 gives the 20x20 mm profile (four slots
 * and a centre bore); series 40 gives the 20x40 mm profile (six slots, two bores). Slot geometry
 * follows the common B-type 6 mm slot.
 */
export function extrusionProfile2020(length: number, series: 20 | 40 = 20): Float32Array {
  const mm = 0.001;
  const hx = (series === 40 ? 20 : 10) * mm;
  const hy = 10 * mm;
  const a = 3.1 * mm; // half slot opening
  const lip = 1.8 * mm;
  const b = 5.5 * mm; // half width under the lip
  const c = 3.0 * mm; // half width at the slot floor
  const d = 6.1 * mm; // slot depth
  const notch: Vec2[] = [
    [-a, 0],
    [-a, lip],
    [-b, lip],
    [-c, d],
    [c, d],
    [b, lip],
    [a, lip],
    [a, 0],
  ];
  const cellCentres = series === 40 ? [-10 * mm, 10 * mm] : [0];
  const pts: Vec2[] = [];
  // Walk the rectangle counter-clockwise; notch (u along the side, v inward) maps per side.
  const side = (
    from: Vec2,
    dir: Vec2,
    inward: Vec2,
    centres: number[],
    origin: Vec2,
    alongOf: (p: number) => number,
  ) => {
    pts.push(from);
    for (const cc of centres) {
      const u0 = alongOf(cc);
      for (const [u, v] of notch)
        pts.push([
          origin[0] + dir[0] * (u0 + u) + inward[0] * v,
          origin[1] + dir[1] * (u0 + u) + inward[1] * v,
        ]);
    }
  };
  const ys = [0];
  // bottom: from (-hx,-hy) towards +x
  side([-hx, -hy], [1, 0], [0, 1], cellCentres, [0, -hy], (x) => x);
  // right: from (hx,-hy) towards +y
  side([hx, -hy], [0, 1], [-1, 0], ys, [hx, 0], (y) => y);
  // top: from (hx,hy) towards -x
  side([hx, hy], [-1, 0], [0, -1], [...cellCentres].reverse(), [0, hy], (x) => -x);
  // left: from (-hx,hy) towards -y
  side([-hx, hy], [0, -1], [1, 0], ys, [-hx, 0], (y) => -y);
  const bores = cellCentres.map((x) => circleLoop(x, 0, 2.1 * mm, 16));
  return translate(extrudeLoops(pts, bores, length), 0, 0, -length / 2);
}

/** L-shaped angle bracket: horizontal leg along +X, vertical leg along +Z, width along Y. */
export function lBracket(
  legX: number,
  legZ: number,
  thickness: number,
  width: number,
): Float32Array {
  const t = Math.min(thickness, legX * 0.9, legZ * 0.9);
  return extrudeXZ(
    [
      [0, 0],
      [legX, 0],
      [legX, t],
      [t, t],
      [t, legZ],
      [0, legZ],
    ],
    [],
    width,
  );
}

/** U-shaped bracket opening upward (+Z): base along X, two side walls, width along Y. */
export function uBracket(
  span: number,
  height: number,
  thickness: number,
  width: number,
): Float32Array {
  const w = span / 2;
  const t = Math.min(thickness, span * 0.3, height * 0.9);
  return extrudeXZ(
    [
      [-w, 0],
      [w, 0],
      [w, height],
      [w - t, height],
      [w - t, t],
      [-w + t, t],
      [-w + t, height],
      [-w, height],
    ],
    [],
    width,
  );
}

/** Triangular gusset corner bracket (hollow), legs along +X and +Z, width along Y. */
export function cornerBracket(leg: number, thickness: number, width: number): Float32Array {
  const t = Math.min(thickness, leg / 3);
  const outer: Vec2[] = [
    [0, 0],
    [leg, 0],
    [leg, t],
    [t, leg],
    [0, leg],
  ];
  const k = leg - t * Math.SQRT2;
  const holes: Vec2[][] =
    k - t > t * 0.5
      ? [
          [
            [t, t],
            [k, t],
            [t, k],
          ],
        ]
      : [];
  return extrudeXZ(outer, holes, width);
}

// ------------------------------------------------------------------ gears and wheels

/**
 * Spur gear along Z (centred), 20 degree pressure angle with true involute flanks.
 * Teeth are clamped to 6..100; an optional bore is cut through the middle.
 */
export function spurGear(module: number, teeth: number, width: number, bore = 0): Float32Array {
  const z = Math.min(100, Math.max(6, Math.round(teeth)));
  const m = module;
  const rp = (m * z) / 2;
  const ra = rp + m;
  const rf = Math.max(rp - 1.25 * m, rp * 0.3);
  const alpha = (20 * Math.PI) / 180;
  const rb = rp * Math.cos(alpha);
  const inv = (r: number) => {
    if (r <= rb) return 0;
    const a = Math.acos(rb / r);
    return Math.tan(a) - a;
  };
  const halfPitch = Math.PI / (2 * z) + inv(rp);
  const theta = (r: number) => halfPitch - inv(r);
  const flankStart = Math.max(rb, rf);
  const flank: number[] = [];
  const steps = 5;
  for (let i = 0; i <= steps; i++) flank.push(flankStart + ((ra - flankStart) * i) / steps);
  const pts: Vec2[] = [];
  const polar = (r: number, a: number): Vec2 => [r * Math.cos(a), r * Math.sin(a)];
  for (let k = 0; k < z; k++) {
    const phi = (2 * Math.PI * k) / z;
    const thRoot = theta(flankStart);
    // root arc midpoint between the previous tooth and this one
    pts.push(polar(rf, phi - Math.PI / z));
    if (rf < flankStart) pts.push(polar(rf, phi - thRoot));
    for (const r of flank) pts.push(polar(r, phi - Math.max(theta(r), 0)));
    for (const r of [...flank].reverse()) pts.push(polar(r, phi + Math.max(theta(r), 0)));
    if (rf < flankStart) pts.push(polar(rf, phi + thRoot));
  }
  const holes = bore > 0 && bore / 2 < rf * 0.8 ? [circleLoop(0, 0, bore / 2, 24)] : [];
  return translate(extrudeLoops(pts, holes, width), 0, 0, -width / 2);
}

/** Pitch-radius driven gear: chooses the module so the pitch diameter is 2 x radius. */
export function gearByRadius(radius: number, teeth: number, width: number, bore = 0) {
  return spurGear((2 * radius) / Math.max(6, Math.round(teeth)), teeth, width, bore);
}

/** Wheel along Z (centred): rounded rubber tyre on a rim with a web and a protruding hub. */
export function tyreWheel(radius: number, width: number, segments = 48): Float32Array {
  const R = radius;
  const hw = width / 2;
  const rr = R * 0.68;
  const rh = Math.max(R * 0.22, 0.004);
  const web = hw * 0.35;
  const hub = hw * 0.95;
  const c = Math.min(hw * 0.45, (R - rr) * 0.45);
  const prof: Vec2[] = [
    [0, -hub],
    [rh, -hub],
    [rh, -web],
    [rr, -web],
    [rr, -hw],
  ];
  const arc = (cx: number, cz: number, a0: number, a1: number) => {
    const n = 6;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      prof.push([cx + c * Math.cos(a), cz + c * Math.sin(a)]);
    }
  };
  arc(R - c, -hw + c, -Math.PI / 2, 0);
  arc(R - c, hw - c, 0, Math.PI / 2);
  prof.push([rr, hw], [rr, web], [rh, web], [rh, hub], [0, hub]);
  return revolve(prof, segments);
}

/** Small barrel-shaped roller along Z (centred). */
export function roller(radius: number, length: number, segments = 12): Float32Array {
  const h = length / 2;
  const prof: Vec2[] = [[0, -h]];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const zz = -h + (length * i) / n;
    const s = zz / h;
    prof.push([radius * (0.55 + 0.45 * Math.sqrt(Math.max(0, 1 - s * s))), zz]);
  }
  prof.push([0, h]);
  return revolve(prof, segments);
}

/** Omni wheel along Z: hub plus two staggered rows of tangential rollers. One visual mesh. */
export function omniWheel(radius: number, width: number, rollers = 8): Float32Array {
  const n = Math.max(4, Math.round(rollers));
  const rr = radius * 0.2;
  const rc = radius - rr;
  const len = ((2 * Math.PI * rc) / n) * 0.85;
  const parts: Float32Array[] = [cylinder(rc - rr * 0.6, width * 0.6, 32)];
  parts.push(cylinder(radius * 0.25, width, 24));
  const base = roller(rr, len, 10);
  for (const [row, z] of [
    [0, -width / 4],
    [1, width / 4],
  ] as const) {
    for (let i = 0; i < n; i++) {
      const th = (2 * Math.PI * (i + row * 0.5)) / n;
      parts.push(
        transform(base, {
          xyz: [rc * Math.cos(th), rc * Math.sin(th), z],
          rpy: [0, Math.PI / 2, th + Math.PI / 2],
        }),
      );
    }
  }
  return merge(...parts);
}

/** Mecanum wheel along Z: two side plates, hub and rollers whose axes sit at 45 degrees. */
export function mecanumWheel(
  radius: number,
  width: number,
  rollers = 10,
  hand: "left" | "right" = "left",
): Float32Array {
  const n = Math.max(6, Math.round(rollers));
  const rr = radius * 0.22;
  const rc = radius - rr;
  const len = (width * 0.9) / Math.SQRT1_2;
  const parts: Float32Array[] = [
    translate(cylinder(rc - rr * 0.4, width * 0.08, 32), 0, 0, -width / 2 + width * 0.04),
    translate(cylinder(rc - rr * 0.4, width * 0.08, 32), 0, 0, width / 2 - width * 0.04),
    cylinder(radius * 0.3, width, 24),
  ];
  const base = roller(rr, Math.min(len, width * 1.25), 10);
  const sgn = hand === "left" ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const th = (2 * Math.PI * i) / n;
    const er = new Vector3(Math.cos(th), Math.sin(th), 0);
    const et = new Vector3(-Math.sin(th), Math.cos(th), 0);
    const d = et
      .clone()
      .multiplyScalar(Math.SQRT1_2)
      .add(new Vector3(0, 0, sgn * Math.SQRT1_2));
    const y = d.clone().cross(er);
    const m = new Matrix4().makeBasis(er, y, d).setPosition(rc * er.x, rc * er.y, 0);
    parts.push(transform(base, m));
  }
  return merge(...parts);
}

/** Track sprocket along Z: toothed disc plus a hub boss. */
export function sprocket(radius: number, teeth: number, width: number): Float32Array {
  const g = gearByRadius(radius, teeth, width);
  return merge(g, cylinder(radius * 0.3, width * 1.8, 24));
}
