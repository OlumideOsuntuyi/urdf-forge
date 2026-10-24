/** STL reading and writing. Geometry is a flat triangle soup: 9 floats per triangle. */

export interface MeshData {
  positions: Float32Array;
}

export function parseStl(data: ArrayBuffer | Uint8Array): MeshData {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength >= 84) {
    const n = view.getUint32(80, true);
    if (84 + n * 50 === bytes.byteLength) return parseBinary(view, n);
  }
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(512, bytes.byteLength)));
  if (/^\s*solid/i.test(head)) {
    const ascii = tryParseAscii(new TextDecoder().decode(bytes));
    if (ascii) return ascii;
  }
  if (bytes.byteLength >= 84) {
    const n = view.getUint32(80, true);
    if (84 + n * 50 <= bytes.byteLength) return parseBinary(view, n);
  }
  throw new Error("Not a readable STL file");
}

function parseBinary(view: DataView, n: number): MeshData {
  const positions = new Float32Array(n * 9);
  let off = 84;
  for (let i = 0; i < n; i++) {
    off += 12; // facet normal, recomputed on display
    for (let k = 0; k < 9; k++) positions[i * 9 + k] = view.getFloat32(off + k * 4, true);
    off += 38;
  }
  return { positions };
}

function tryParseAscii(text: string): MeshData | null {
  const out: number[] = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(+m[1], +m[2], +m[3]);
  if (!out.length || out.length % 9 || out.some((v) => !Number.isFinite(v))) return null;
  return { positions: new Float32Array(out) };
}

export function writeStl(positions: Float32Array, name = "urdf-forge"): Uint8Array {
  const n = Math.floor(positions.length / 9);
  const buf = new ArrayBuffer(84 + n * 50);
  const view = new DataView(buf);
  const header = new TextEncoder().encode(name.slice(0, 79));
  new Uint8Array(buf).set(header, 0);
  view.setUint32(80, n, true);
  let off = 84;
  for (let t = 0; t < n; t++) {
    const b = t * 9;
    const ux = positions[b + 3] - positions[b];
    const uy = positions[b + 4] - positions[b + 1];
    const uz = positions[b + 5] - positions[b + 2];
    const vx = positions[b + 6] - positions[b];
    const vy = positions[b + 7] - positions[b + 1];
    const vz = positions[b + 8] - positions[b + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    view.setFloat32(off, nx, true);
    view.setFloat32(off + 4, ny, true);
    view.setFloat32(off + 8, nz, true);
    for (let k = 0; k < 9; k++) view.setFloat32(off + 12 + k * 4, positions[b + k], true);
    view.setUint16(off + 48, 0, true);
    off += 50;
  }
  return new Uint8Array(buf);
}
