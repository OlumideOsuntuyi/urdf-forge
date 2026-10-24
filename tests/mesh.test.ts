import { describe, expect, it } from "vitest";
import { Matrix4 } from "three";
import { parseStl, writeStl } from "../src/core/mesh/stl";
import { isWatertight, massProperties, primitiveMassProps } from "../src/core/mesh/massprops";
import {
  boxPositions,
  decimate,
  fitPrimitive,
  guessUnit,
  splitComponents,
} from "../src/core/mesh/ops";
import { convexHull } from "../src/core/mesh/hull";

const close = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe("STL", () => {
  it("round-trips binary STL", () => {
    const box = boxPositions(1, 2, 3);
    const back = parseStl(writeStl(box)).positions;
    expect(Array.from(back)).toEqual(Array.from(box));
  });

  it("reads ASCII STL", () => {
    const text = `solid t
facet normal 0 0 1
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 1 0
 endloop
endfacet
endsolid t`;
    const { positions } = parseStl(new TextEncoder().encode(text));
    expect(Array.from(positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it("reads binary STL whose header starts with 'solid'", () => {
    const bin = writeStl(boxPositions(1, 1, 1), "solid looking header");
    expect(parseStl(bin).positions.length).toBe(12 * 9);
  });

  it("rejects garbage", () => {
    expect(() => parseStl(new Uint8Array([1, 2, 3]))).toThrow();
  });
});

describe("mass properties", () => {
  it("matches the analytic box", () => {
    const mp = massProperties(boxPositions(1, 2, 3))!;
    const ref = primitiveMassProps({ type: "box", size: [1, 2, 3] });
    close(mp.volume, 6);
    close(mp.inertia.ixx, ref.inertia.ixx);
    close(mp.inertia.iyy, ref.inertia.iyy);
    close(mp.inertia.izz, ref.inertia.izz);
    close(mp.inertia.ixy, 0);
    expect(mp.watertight).toBe(true);
  });

  it("finds the COM of an offset box and keeps inertia about the COM", () => {
    const m = new Matrix4().makeTranslation(1, 2, 3);
    const mp = massProperties(boxPositions(1, 1, 1), m)!;
    close(mp.com[0], 1);
    close(mp.com[1], 2);
    close(mp.com[2], 3);
    close(mp.inertia.ixx, 1 / 6);
  });

  it("is independent of winding", () => {
    const box = boxPositions(1, 1, 1);
    const flipped = new Float32Array(box.length);
    for (let t = 0; t < box.length; t += 9) {
      flipped.set(box.subarray(t, t + 3), t);
      flipped.set(box.subarray(t + 6, t + 9), t + 3);
      flipped.set(box.subarray(t + 3, t + 6), t + 6);
    }
    close(massProperties(flipped)!.volume, 1);
  });

  it("flags open meshes", () => {
    expect(isWatertight(boxPositions(1, 1, 1).slice(0, 9 * 10))).toBe(false);
  });
});

describe("mesh ops", () => {
  it("splits disjoint bodies into components, largest first", () => {
    const a = boxPositions(1, 1, 1);
    const b = new Matrix4().makeTranslation(5, 0, 0);
    const moved = boxPositions(1, 1, 1).map((v, i) => (i % 3 === 0 ? v + 5 : v));
    const both = new Float32Array([...a, ...moved]);
    const parts = splitComponents(both);
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBe(a.length);
    expect(b).toBeDefined();
  });

  it("builds a closed convex hull of a box", () => {
    const hull = convexHull(boxPositions(2, 2, 2));
    const mp = massProperties(hull)!;
    close(mp.volume, 8, 1e-4);
    expect(isWatertight(hull)).toBe(true);
  });

  it("decimation reduces triangle count", () => {
    // A finely tessellated sphere-ish soup: many small boxes merged.
    const parts: number[] = [];
    for (let i = 0; i < 40; i++)
      parts.push(...boxPositions(1, 1, 1).map((v, k) => (k % 3 === 0 ? v + i * 0.01 : v)));
    const src = new Float32Array(parts);
    expect(decimate(src, 0.1).length).toBeLessThan(src.length);
  });

  it("fits primitives around geometry", () => {
    const { geometry, centre } = fitPrimitive(boxPositions(2, 4, 6), "box");
    expect(geometry).toEqual({ type: "box", size: [2, 4, 6] });
    expect(centre).toEqual([0, 0, 0]);
  });

  it("guesses units from size", () => {
    expect(guessUnit(250)).toBe("mm");
    expect(guessUnit(12)).toBe("cm");
    expect(guessUnit(0.4)).toBe("m");
  });
});
