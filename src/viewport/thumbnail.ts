/** Offscreen thumbnails of robots and environments (studio lighting, isometric view). */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import { linkWorldMatrices } from "@/core/kinematics";
import { poseToMatrix } from "@/core/math";
import { materialById, type Geometry, type RobotModel } from "@/core/model";
import type { Environment } from "@/core/env/types";

let shared: { renderer: THREE.WebGLRenderer; env: THREE.Texture } | null = null;

function context(w: number, h: number) {
  if (!shared) {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    shared = { renderer, env };
  }
  shared.renderer.setPixelRatio(1);
  shared.renderer.setSize(w, h, false);
  return shared;
}

function geometry(
  g: Geometry | { type: "mesh"; positions: Float32Array },
  meshes: (id: string) => Float32Array | undefined,
): THREE.BufferGeometry | null {
  if (g.type === "box") return new THREE.BoxGeometry(...g.size);
  if (g.type === "sphere") return new THREE.SphereGeometry(g.radius, 24, 12);
  if (g.type === "cylinder")
    return new THREE.CylinderGeometry(g.radius, g.radius, g.length, 28).rotateX(Math.PI / 2);
  const pos = "positions" in g ? g.positions : meshes(g.meshId);
  if (!pos?.length) return null;
  let geo = new THREE.BufferGeometry();
  // Thumbnails don't need every triangle of a huge mesh.
  const stride = Math.max(1, Math.floor(pos.length / 9 / 400000));
  const src = stride === 1 ? pos : pos.filter((_, i) => Math.floor(i / 9) % stride === 0);
  geo.setAttribute(
    "position",
    new THREE.BufferAttribute(src instanceof Float32Array ? src : new Float32Array(src), 3),
  );
  geo = toCreasedNormals(geo, Math.PI / 6);
  return geo;
}

function shoot(scene: THREE.Scene, w: number, h: number): string {
  const { renderer, env } = context(w, h);
  scene.environment = env;
  scene.environmentIntensity = 0.7;
  const box = new THREE.Box3().setFromObject(scene);
  if (box.isEmpty()) return "";
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const cam = new THREE.PerspectiveCamera(32, w / h, sphere.radius / 100, sphere.radius * 20);
  cam.up.set(0, 0, 1);
  const dir = new THREE.Vector3(1, -1.25, 0.8).normalize();
  cam.position
    .copy(sphere.center)
    .addScaledVector(dir, (sphere.radius / Math.sin(THREE.MathUtils.degToRad(16))) * 1.02);
  cam.lookAt(sphere.center);
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.position.copy(cam.position).add(new THREE.Vector3(0, 0, sphere.radius * 3));
  scene.add(key, new THREE.HemisphereLight(0xdde6f0, 0x30343a, 0.8));
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL("image/png");
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
  return url;
}

export function robotThumbnail(
  model: RobotModel,
  meshes: (id: string) => Float32Array | undefined,
  w = 320,
  h = 220,
): string {
  const scene = new THREE.Scene();
  const worlds = linkWorldMatrices(model);
  for (const L of model.links)
    for (const v of L.visuals) {
      const geo = geometry(v.geometry, meshes);
      if (!geo) continue;
      const mat = materialById(model, v.materialId);
      const rgba = mat?.rgba ?? [0.75, 0.77, 0.8, 1];
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          color: new THREE.Color().setRGB(rgba[0], rgba[1], rgba[2], THREE.SRGBColorSpace),
          metalness: Math.min(mat?.metalness ?? 0.2, 0.6),
          roughness: mat?.roughness ?? 0.55,
          side: THREE.DoubleSide,
        }),
      );
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(
        (worlds.get(L.id) ?? new THREE.Matrix4())
          .clone()
          .multiply(
            poseToMatrix(v.origin, v.geometry.type === "mesh" ? v.geometry.scale : undefined),
          ),
      );
      scene.add(mesh);
    }
  scene.updateMatrixWorld(true);
  return shoot(scene, w, h);
}

export function environmentThumbnail(env: Environment, w = 320, h = 220): string {
  const scene = new THREE.Scene();
  for (const o of env.objects) {
    if (o.color[3] <= 0) continue;
    const g = o.geometry;
    const geo =
      g.type === "mesh"
        ? geometry({ type: "mesh", positions: env.meshes[g.mesh] }, () => undefined)
        : geometry(g, () => undefined);
    if (!geo) continue;
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setRGB(o.color[0], o.color[1], o.color[2], THREE.SRGBColorSpace),
        roughness: 0.8,
      }),
    );
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(poseToMatrix(o.pose, g.type === "mesh" ? (g.scale ?? [1, 1, 1]) : undefined));
    scene.add(mesh);
  }
  if (!env.objects.length) {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.MeshStandardMaterial({ color: 0x8a8f96 }),
    );
    scene.add(floor);
  }
  scene.updateMatrixWorld(true);
  return shoot(scene, w, h);
}
