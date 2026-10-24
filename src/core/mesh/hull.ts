/** Incremental 3D convex hull. Returns an outward-wound triangle soup. */

type P = [number, number, number];
interface Face {
  v: [number, number, number];
  n: P;
  d: number;
}

export function convexHull(positions: Float32Array, maxPoints = 4000): Float32Array {
  let pts = dedupe(positions);
  if (pts.length > maxPoints) pts = subsample(pts, maxPoints);
  if (pts.length < 4) throw new Error("Need at least 4 distinct points for a hull");

  const i0 = argBy(pts, (p) => p[0], Math.min);
  let i1 = argBy(pts, (p) => p[0], Math.max);
  if (i0 === i1) i1 = (i0 + 1) % pts.length;
  const i2 = farthestFromLine(pts, i0, i1);
  if (i2 < 0) throw new Error("Points are collinear");
  const i3 = farthestFromPlane(pts, i0, i1, i2);
  if (i3 < 0) throw new Error("Points are coplanar");

  let faces: Face[] = [
    face(pts, i0, i1, i2),
    face(pts, i0, i2, i3),
    face(pts, i0, i3, i1),
    face(pts, i1, i3, i2),
  ];
  const centre: P = [0, 1, 2].map(
    (k) => (pts[i0][k] + pts[i1][k] + pts[i2][k] + pts[i3][k]) / 4,
  ) as P;
  faces = faces.map((f) => (dist(f, centre) > 0 ? face(pts, f.v[0], f.v[2], f.v[1]) : f));

  const scale = Math.max(
    1,
    ...pts.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]))),
  );
  const tol = 1e-9 * scale * 10;

  for (let idx = 0; idx < pts.length; idx++) {
    const p = pts[idx];
    const visible = faces.filter((f) => dist(f, p) > tol);
    if (!visible.length) continue;
    const horizon = new Map<string, [number, number]>();
    for (const f of visible) {
      const [a, b, c] = f.v;
      for (const [u, w] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        const rev = `${w},${u}`;
        if (horizon.has(rev)) horizon.delete(rev);
        else horizon.set(`${u},${w}`, [u, w]);
      }
    }
    const vis = new Set(visible);
    faces = faces.filter((f) => !vis.has(f));
    for (const [u, w] of horizon.values()) faces.push(face(pts, u, w, idx));
  }

  const out = new Float32Array(faces.length * 9);
  faces.forEach((f, i) => f.v.forEach((vi, k) => out.set(pts[vi], i * 9 + k * 3)));
  return out;
}

function dedupe(pos: Float32Array): P[] {
  const seen = new Map<string, P>();
  for (let i = 0; i + 2 < pos.length; i += 3) {
    const k = `${Math.round(pos[i] * 1e7)},${Math.round(pos[i + 1] * 1e7)},${Math.round(pos[i + 2] * 1e7)}`;
    if (!seen.has(k)) seen.set(k, [pos[i], pos[i + 1], pos[i + 2]]);
  }
  return [...seen.values()];
}

/** Keep the extreme points along many directions plus an even sample of the rest. */
function subsample(pts: P[], n: number): P[] {
  const keep = new Set<number>();
  const dirs: P[] = [];
  for (let i = 0; i < 64; i++) {
    const z = 1 - (2 * (i + 0.5)) / 64;
    const r = Math.sqrt(1 - z * z);
    const t = i * 2.399963;
    dirs.push([r * Math.cos(t), r * Math.sin(t), z]);
  }
  for (const d of dirs)
    keep.add(argBy(pts, (p) => p[0] * d[0] + p[1] * d[1] + p[2] * d[2], Math.max));
  const step = pts.length / Math.max(1, n - keep.size);
  for (let f = 0; f < pts.length && keep.size < n; f += step) keep.add(Math.floor(f));
  return [...keep].map((i) => pts[i]);
}

function argBy(pts: P[], key: (p: P) => number, pick: (...v: number[]) => number): number {
  let best = 0;
  let bv = key(pts[0]);
  for (let i = 1; i < pts.length; i++) {
    const v = key(pts[i]);
    if (pick(v, bv) === v && v !== bv) {
      best = i;
      bv = v;
    }
  }
  return best;
}

function plane(pts: P[], a: number, b: number, c: number): { n: P; d: number } {
  const [ax, ay, az] = pts[a];
  const ux = pts[b][0] - ax,
    uy = pts[b][1] - ay,
    uz = pts[b][2] - az;
  const vx = pts[c][0] - ax,
    vy = pts[c][1] - ay,
    vz = pts[c][2] - az;
  let nx = uy * vz - uz * vy,
    ny = uz * vx - ux * vz,
    nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  return { n: [nx, ny, nz], d: -(nx * ax + ny * ay + nz * az) };
}

function face(pts: P[], a: number, b: number, c: number): Face {
  return { v: [a, b, c], ...plane(pts, a, b, c) };
}

function dist(f: { n: P; d: number }, p: P): number {
  return f.n[0] * p[0] + f.n[1] * p[1] + f.n[2] * p[2] + f.d;
}

function farthestFromLine(pts: P[], a: number, b: number): number {
  const [ax, ay, az] = pts[a];
  const ux = pts[b][0] - ax,
    uy = pts[b][1] - ay,
    uz = pts[b][2] - az;
  let best = 1e-18,
    bi = -1;
  pts.forEach((p, i) => {
    const vx = p[0] - ax,
      vy = p[1] - ay,
      vz = p[2] - az;
    const d = (uy * vz - uz * vy) ** 2 + (uz * vx - ux * vz) ** 2 + (ux * vy - uy * vx) ** 2;
    if (d > best) {
      best = d;
      bi = i;
    }
  });
  return bi;
}

function farthestFromPlane(pts: P[], a: number, b: number, c: number): number {
  const pl = plane(pts, a, b, c);
  let best = 1e-12,
    bi = -1;
  pts.forEach((p, i) => {
    const d = Math.abs(dist(pl, p));
    if (d > best) {
      best = d;
      bi = i;
    }
  });
  return bi;
}
