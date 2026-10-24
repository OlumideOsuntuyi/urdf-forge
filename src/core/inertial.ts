import type { Inertial, Link } from "./model";
import { poseToMatrix, rotateInertia, rpyToQuat, scaleInertia } from "./math";
import { combine, massProperties, primitiveMassProps, type MassProps } from "./mesh/massprops";
import { Vector3 } from "three";

/** Returns geometry for a mesh asset id, or undefined if it has not been loaded. */
export type MeshLookup = (meshId: string) => Float32Array | undefined;

/**
 * Recompute a link's inertial from its visual geometry (solid, uniform density).
 * Returns a new Inertial; the input is not modified. Links with `auto` off are returned as is.
 */
export function computeInertial(link: Link, meshes: MeshLookup): Inertial {
  const ine = link.inertial;
  if (!ine.auto) return ine;
  const parts: MassProps[] = [];
  for (const v of link.visuals) {
    const g = v.geometry;
    if (g.type === "mesh") {
      const pos = meshes(g.meshId);
      if (!pos) continue;
      const mp = massProperties(pos, poseToMatrix(v.origin, g.scale));
      if (mp) parts.push(mp);
    } else {
      const mp = primitiveMassProps(g);
      const com = new Vector3(...mp.com).applyMatrix4(poseToMatrix(v.origin));
      parts.push({
        ...mp,
        com: [com.x, com.y, com.z],
        inertia: rotateInertia(mp.inertia, rpyToQuat(v.origin.rpy)),
      });
    }
  }
  const total = combine(parts);
  if (!total) return ine;
  const mass =
    ine.mode === "density" ? Math.max(1e-9, total.volume * ine.density) : Math.max(1e-9, ine.mass);
  return {
    ...ine,
    mass,
    volume: total.volume,
    com: total.com,
    inertia: scaleInertia(total.inertia, mass / total.volume),
    watertight: total.watertight,
  };
}
