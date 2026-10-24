/**
 * three.js scene manager. React hands it plain state through `update`; it never reads React.
 * Renders on demand: nothing is drawn unless something changed.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import { eigenSym3, normalize, poseToMatrix } from "@/core/math";
import { linkWorldMatrices, lowestZ } from "@/core/kinematics";
import { hasJoint, materialById, type Geometry, type Link, type RobotModel } from "@/core/model";
import type { GizmoTarget, Mode, Selection, Tool, ViewOptions } from "@/store/app";
import type { Environment } from "@/core/env/types";
import type { Material } from "@/core/model";
import { boxUVs } from "@/core/mesh/uv";
import { textureMime } from "@/store/textureStore";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { InfiniteGrid } from "./grid";

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

/** Add metre-based box-projected UVs to a non-indexed geometry (see core/mesh/uv). */
function withBoxUVs(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.attributes.position.array as ArrayLike<number>;
  geo.setAttribute("uv", new THREE.BufferAttribute(boxUVs(pos), 2));
  return geo;
}

export interface PickInfo {
  linkId: string;
  kind: "visual" | "collision";
  compId: string;
}

export interface FaceHit extends PickInfo {
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface ViewportCallbacks {
  onPick(hit: PickInfo | null, mods: { shift: boolean; alt: boolean; ctrl: boolean }): void;
  onGizmoStart(): void;
  onGizmoMove(world: THREE.Matrix4, target: GizmoTarget): void;
  onGizmoEnd(): void;
  onMate(sourceLinkId: string, newWorld: THREE.Matrix4): void;
  onHint(text: string): void;
}

export interface ViewportState {
  model: RobotModel;
  meshVersion: number;
  selection: Selection | null;
  view: ViewOptions;
  jointValues: Record<string, number>;
  mode: Mode;
  tool: Tool;
  gizmoTarget: GizmoTarget;
  gizmoSpace: "world" | "local";
  snap: boolean;
  themeKey: string;
  meshes: (id: string) => Float32Array | undefined;
  textures: (key: string) => Uint8Array | undefined;
  environment: Environment;
}

interface Theme {
  grid: THREE.Color;
  gridMajor: THREE.Color;
  accent: THREE.Color;
  selection: THREE.Color;
  collision: THREE.Color;
  joint: THREE.Color;
  shadow: number;
}

const VIEWS: Record<string, [number, number, number]> = {
  iso: [1, -1.2, 0.8],
  top: [0, -1e-4, 1],
  bottom: [0, 1e-4, -1],
  front: [1, 0, 0],
  back: [-1, 0, 0],
  right: [0, -1, 0],
  left: [0, 1, 0],
};

export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private orbit: OrbitControls;
  private gizmo: TransformControls;
  private gizmoProxy = new THREE.Object3D();
  private robot = new THREE.Group();
  /** Places the robot at the environment's spawn pose; robot, gizmo proxy and picks live in its frame. */
  private robotRoot = new THREE.Group();
  private envGroup = new THREE.Group();
  private infiniteGrid = new InfiniteGrid();
  private overlays = new THREE.Group();
  private helpers = new THREE.Group();
  private grid = new THREE.Group();
  private origin: THREE.Group;
  private ground: THREE.Mesh;
  private lights = new THREE.Group();
  private headlight: THREE.DirectionalLight;
  private key: THREE.DirectionalLight;
  private envMap: THREE.Texture | null = null;
  private pmrem: THREE.PMREMGenerator;
  private geoCache = new Map<string, { geo: THREE.BufferGeometry; edges?: THREE.EdgesGeometry }>();
  private linkObjs = new Map<string, THREE.Object3D>();
  private pickables: THREE.Mesh[] = [];
  private state: ViewportState | null = null;
  private theme!: Theme;
  private needsRender = true;
  private frame = 0;
  private resizeObs: ResizeObserver;
  private ray = new THREE.Raycaster();
  private down = { x: 0, y: 0, t: 0 };
  private mateSource: FaceHit | null = null;
  private faceMarker: THREE.Mesh;
  private overrideWorlds: Map<string, THREE.Matrix4> | null = null;
  private lastSceneKey = "";
  private worlds = new Map<string, THREE.Matrix4>();
  private hoverLink: string | null = null;

  constructor(
    private container: HTMLElement,
    private cb: ViewportCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = "vp-canvas";
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = "vp-labels";
    // Behind the React overlays that share the container.
    container.prepend(this.renderer.domElement, this.labelRenderer.domElement);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.002, 500);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(1.2, -1.5, 1);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.screenSpacePanning = true;
    this.orbit.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.orbit.addEventListener("change", () => this.invalidate());

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSize(0.9);
    this.gizmo.attach(this.gizmoProxy);
    this.robotRoot.add(this.robot, this.gizmoProxy);
    this.scene.add(this.robotRoot, this.envGroup, this.gizmo.getHelper());
    this.gizmo.addEventListener("dragging-changed", (e) => {
      this.orbit.enabled = !e.value;
      if (e.value) this.cb.onGizmoStart();
      else this.cb.onGizmoEnd();
    });
    this.gizmo.addEventListener("objectChange", () => {
      if (!this.state) return;
      this.gizmoProxy.updateMatrix();
      this.cb.onGizmoMove(this.gizmoProxy.matrix.clone(), this.state.gizmoTarget);
    });
    this.gizmo.addEventListener("change", () => this.invalidate());

    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    const hemi = new THREE.HemisphereLight(0xdde6f0, 0x2a2e33, 0.9);
    this.key = new THREE.DirectionalLight(0xfff3e4, 2.2);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.6);
    fill.position.set(-2, 1.5, 1);
    const rim = new THREE.DirectionalLight(0xffffff, 0.5);
    rim.position.set(0.5, 2.5, -1);
    this.lights.add(hemi, this.key, this.key.target, fill, rim);
    this.headlight = new THREE.DirectionalLight(0xffffff, 2.4);
    this.camera.add(this.headlight);
    this.headlight.position.set(0.3, 0.6, 1);
    this.scene.add(this.camera, this.lights, new THREE.AmbientLight(0xffffff, 0.25));

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ opacity: 0.22 }),
    );
    this.ground.receiveShadow = true;
    this.origin = this.makeAxes(1, true);
    this.faceMarker = new THREE.Mesh(
      new THREE.CircleGeometry(1, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.6,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    this.faceMarker.visible = false;
    this.faceMarker.renderOrder = 10;
    this.scene.add(
      this.grid,
      this.origin,
      this.ground,
      this.overlays,
      this.helpers,
      this.faceMarker,
    );

    this.readTheme();
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerleave", () => this.setHover(null));
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.loop();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObs.disconnect();
    this.gizmo.dispose();
    this.orbit.dispose();
    this.geoCache.forEach((g) => {
      g.geo.dispose();
      g.edges?.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }

  invalidate() {
    this.needsRender = true;
  }

  // ------------------------------------------------------------------ state

  update(s: ViewportState) {
    const prev = this.state;
    this.state = s;
    if (!prev || prev.themeKey !== s.themeKey) this.readTheme();
    const sceneKey = [s.meshVersion, s.themeKey, JSON.stringify(s.view)].join("|");
    const rebuild =
      !prev ||
      prev.model !== s.model ||
      sceneKey !== this.lastSceneKey ||
      prev.selection !== s.selection;
    this.lastSceneKey = sceneKey;
    if (!prev || prev.environment !== s.environment || prev.themeKey !== s.themeKey)
      this.buildEnvironment();
    if (rebuild) this.rebuild();
    else if (prev.jointValues !== s.jointValues || prev.mode !== s.mode) this.applyPoses();
    this.applyView();
    this.updateGizmo();
    if (s.tool !== "mate") this.cancelMate();
    this.invalidate();
  }

  private buildEnvironment() {
    const env = this.state!.environment;
    this.clearGroup(this.envGroup);
    for (const g of this.envGroup.userData.geos ?? []) (g as THREE.BufferGeometry).dispose();
    const geos: THREE.BufferGeometry[] = [];
    const meshGeo = new Map<string, THREE.BufferGeometry>();
    for (const o of env.objects) {
      // Fully transparent objects are collision-only.
      if (o.color[3] <= 0) continue;
      let geo: THREE.BufferGeometry | undefined;
      const g = o.geometry;
      if (g.type === "box") geo = new THREE.BoxGeometry(...g.size);
      else if (g.type === "sphere") geo = new THREE.SphereGeometry(g.radius, 32, 16);
      else if (g.type === "cylinder")
        geo = new THREE.CylinderGeometry(g.radius, g.radius, g.length, 32).rotateX(Math.PI / 2);
      else {
        geo = meshGeo.get(g.mesh);
        const pos = env.meshes[g.mesh];
        if (!geo && pos) {
          const b = new THREE.BufferGeometry();
          b.setAttribute("position", new THREE.BufferAttribute(pos, 3));
          geo =
            pos.length / 9 < 300_000
              ? toCreasedNormals(b, Math.PI / 5)
              : (b.computeVertexNormals(), b);
          meshGeo.set(g.mesh, geo);
        }
      }
      if (!geo) continue;
      geos.push(geo);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setRGB(o.color[0], o.color[1], o.color[2], THREE.SRGBColorSpace),
        roughness: 0.85,
        metalness: 0.05,
        transparent: o.color[3] < 1,
        opacity: o.color[3],
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(
        poseToMatrix(o.pose, g.type === "mesh" ? (g.scale ?? [1, 1, 1]) : undefined),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.raycast = () => {};
      this.envGroup.add(mesh);
    }
    this.envGroup.userData.geos = geos;
    this.placeRobot();
    this.invalidate();
  }

  /** Frame the robot together with the environment. */
  frameEnvironment() {
    const box = new THREE.Box3();
    if (this.envGroup.children.length) box.setFromObject(this.envGroup);
    this.robotRoot.updateMatrixWorld(true);
    this.robot.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) box.expandByObject(o);
    });
    this.fitBox(box, new THREE.Vector3(1, -1.3, 0.9));
  }

  /** Physics mode drives link poses directly. Pass null to return to kinematic poses. */
  setOverrideWorlds(w: Map<string, THREE.Matrix4> | null) {
    this.overrideWorlds = w;
    this.applyPoses();
    this.invalidate();
  }

  private readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const c = (name: string, fb: string) =>
      new THREE.Color((cs.getPropertyValue(name).trim() || fb) as THREE.ColorRepresentation);
    this.theme = {
      grid: c("--vp-grid", "#2b3038"),
      gridMajor: c("--vp-grid-major", "#3a414b"),
      accent: c("--accent", "#ff8a3d"),
      selection: c("--vp-selection", "#ffb15c"),
      collision: c("--vp-collision", "#3ddc97"),
      joint: c("--vp-joint", "#f7c948"),
      shadow: parseFloat(cs.getPropertyValue("--vp-shadow")) || 0.22,
    };
    (this.ground.material as THREE.ShadowMaterial).opacity = this.theme.shadow;
  }

  // ------------------------------------------------------------------ scene

  private geometryFor(g: Geometry): THREE.BufferGeometry | null {
    if (g.type === "mesh") {
      const cached = this.geoCache.get(g.meshId);
      if (cached) return cached.geo;
      const pos = this.state!.meshes(g.meshId);
      if (!pos) return null;
      let geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo =
        pos.length / 9 < 400_000
          ? toCreasedNormals(geo, Math.PI / 6)
          : (geo.computeVertexNormals(), geo);
      withBoxUVs(geo);
      geo.computeBoundingSphere();
      this.geoCache.set(g.meshId, { geo });
      return geo;
    }
    const key = JSON.stringify(g);
    const cached = this.geoCache.get(key);
    if (cached) return cached.geo;
    let geo: THREE.BufferGeometry;
    if (g.type === "box") geo = new THREE.BoxGeometry(...g.size);
    else if (g.type === "sphere") geo = new THREE.SphereGeometry(g.radius, 32, 16);
    else geo = new THREE.CylinderGeometry(g.radius, g.radius, g.length, 40).rotateX(Math.PI / 2);
    // Metre-based box-projected UVs, the same mapping the exporter writes into OBJ files.
    geo = withBoxUVs(geo.toNonIndexed());
    this.geoCache.set(key, { geo });
    return geo;
  }

  // ------------------------------------------------------------------ materials

  private texCache = new Map<string, THREE.Texture | "loading" | "failed">();
  private rebuildTimer = 0;

  /** A texture from the project's texture store; loads asynchronously, then redraws. */
  private texture(key: string | undefined, srgb: boolean, tile: number): THREE.Texture | null {
    if (!key) return null;
    const cacheKey = `${key}|${srgb}`;
    const hit = this.texCache.get(cacheKey);
    if (hit instanceof THREE.Texture) {
      hit.repeat.set(1 / tile, 1 / tile);
      return hit;
    }
    if (hit) return null;
    const bytes = this.state!.textures(key);
    if (!bytes) return null;
    this.texCache.set(cacheKey, "loading");
    createImageBitmap(new Blob([bytes as BlobPart], { type: textureMime(key) }), {
      imageOrientation: "flipY",
    })
      .then((img) => {
        const t = new THREE.Texture(img);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        t.needsUpdate = true;
        this.texCache.set(cacheKey, t);
        clearTimeout(this.rebuildTimer);
        this.rebuildTimer = window.setTimeout(() => this.state && this.rebuild(), 30);
      })
      .catch(() => this.texCache.set(cacheKey, "failed"));
    return null;
  }

  private visualMaterial(
    m: Material | undefined,
    linkSelected: boolean,
    compSelected: boolean,
  ): THREE.Material {
    const v = this.state!.view;
    const rgba = m?.rgba ?? [0.7, 0.7, 0.72, 1];
    const color = new THREE.Color().setRGB(rgba[0], rgba[1], rgba[2], THREE.SRGBColorSpace);
    const tex = m?.textures;
    const tile = tex?.tile ?? 1;
    const map = this.texture(tex?.maps.color, true, tile);
    const xray = v.shading === "xray";
    const transparent = xray || rgba[3] < 1;
    const opacity = xray ? 0.32 : rgba[3];
    if (!v.lit) {
      const basic = new THREE.MeshBasicMaterial({
        color,
        map,
        transparent,
        opacity,
        side: THREE.DoubleSide,
      });
      if (linkSelected) basic.color.lerp(this.theme.selection, compSelected ? 0.45 : 0.25);
      return basic;
    }
    const mat = new THREE.MeshPhysicalMaterial({
      color,
      map,
      normalMap: this.texture(tex?.maps.normal, false, tile),
      roughnessMap: this.texture(tex?.maps.roughness, false, tile),
      metalnessMap: this.texture(tex?.maps.metalness, false, tile),
      aoMap: this.texture(tex?.maps.ao, false, tile),
      metalness: m?.metalness ?? 0.1,
      roughness: m?.roughness ?? 0.6,
      clearcoat: m?.clearcoat ?? 0,
      clearcoatRoughness: 0.08,
      transparent,
      opacity,
      depthWrite: !xray,
      side: THREE.DoubleSide,
      envMapIntensity: v.envIntensity,
    });
    // A metalness map scales the metalness value; full strength lets the map decide.
    if (mat.metalnessMap) mat.metalness = 1;
    if (mat.roughnessMap) mat.roughness = 1;
    if (linkSelected) {
      mat.emissive = this.theme.selection.clone();
      mat.emissiveIntensity = compSelected ? 0.45 : 0.22;
    }
    return mat;
  }

  private edgesFor(g: Geometry): THREE.EdgesGeometry | null {
    const key = g.type === "mesh" ? g.meshId : JSON.stringify(g);
    const entry = this.geoCache.get(key);
    if (!entry) return null;
    entry.edges ??= new THREE.EdgesGeometry(entry.geo, 30);
    return entry.edges;
  }

  private clearGroup(g: THREE.Object3D) {
    g.traverse((o) => {
      if (o instanceof CSS2DObject) o.element.remove();
      const m = (o as THREE.Mesh).material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
    });
    g.clear();
  }

  private rebuild() {
    const s = this.state!;
    const v = s.view;
    // Drop cached geometry for meshes that no longer exist.
    const live = new Set(s.model.meshes.map((m) => m.id));
    for (const [k, e] of this.geoCache)
      if (!k.startsWith("{") && !live.has(k)) {
        e.geo.dispose();
        e.edges?.dispose();
        this.geoCache.delete(k);
      }
    this.clearGroup(this.robot);
    this.clearGroup(this.overlays);
    this.linkObjs.clear();
    this.pickables = [];
    const selLink = s.selection && "linkId" in s.selection ? s.selection.linkId : null;
    const selComp = s.selection && "compId" in s.selection ? s.selection.compId : null;
    const size = this.modelSize();

    for (const L of s.model.links) {
      const grp = new THREE.Group();
      grp.matrixAutoUpdate = false;
      grp.userData.linkId = L.id;
      if (!L.hidden) {
        if (v.visuals)
          for (const vis of L.visuals) {
            const mesh = this.componentMesh(
              L,
              vis.geometry,
              vis.origin,
              "visual",
              vis.id,
              vis.materialId,
              L.id === selLink,
              vis.id === selComp,
            );
            if (mesh) grp.add(mesh);
          }
        if (v.collisions || selComp)
          for (const col of L.collisions)
            if (v.collisions || col.id === selComp) {
              const mesh = this.componentMesh(
                L,
                col.geometry,
                col.origin,
                "collision",
                col.id,
                null,
                L.id === selLink,
                col.id === selComp,
              );
              if (mesh) grp.add(mesh);
            }
      }
      this.robot.add(grp);
      this.linkObjs.set(L.id, grp);
      this.addLinkOverlays(L, grp, size, L.id === selLink);
    }
    // Poses first: the floor height depends on where the links are.
    this.applyPoses();
    this.layoutEnvironment(size);
  }

  private componentMesh(
    L: Link,
    g: Geometry,
    origin: { xyz: [number, number, number]; rpy: [number, number, number] },
    kind: "visual" | "collision",
    compId: string,
    materialId: string | null,
    linkSelected: boolean,
    compSelected: boolean,
  ): THREE.Object3D | null {
    const s = this.state!;
    const geo = this.geometryFor(g);
    if (!geo) return null;
    const v = s.view;
    let mat: THREE.Material;
    if (kind === "collision") {
      mat = new THREE.MeshBasicMaterial({
        color: compSelected ? this.theme.selection : this.theme.collision,
        transparent: true,
        opacity: compSelected ? 0.45 : 0.28,
        depthWrite: false,
      });
    } else if (v.shading === "wireframe") {
      const rgba = materialById(s.model, materialId)?.rgba ?? [0.7, 0.7, 0.7, 1];
      mat = new THREE.MeshBasicMaterial({
        color: linkSelected ? this.theme.selection : new THREE.Color(rgba[0], rgba[1], rgba[2]),
        wireframe: true,
      });
    } else {
      mat = this.visualMaterial(materialById(s.model, materialId), linkSelected, compSelected);
    }
    const mesh = new THREE.Mesh(geo, mat);
    const scale = g.type === "mesh" ? g.scale : undefined;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(poseToMatrix(origin, scale));
    mesh.castShadow = kind === "visual" && v.shadows && v.lighting && v.lit;
    mesh.receiveShadow = false;
    mesh.userData = { linkId: L.id, kind, compId };
    this.pickables.push(mesh);
    if (kind === "visual" && v.shading === "shaded-wire") {
      const edges = this.edgesFor(g);
      if (edges) {
        const lines = new THREE.LineSegments(
          edges,
          new THREE.LineBasicMaterial({
            color: linkSelected ? this.theme.selection : 0x000000,
            transparent: true,
            opacity: linkSelected ? 0.9 : 0.35,
          }),
        );
        lines.raycast = () => {};
        const holder = new THREE.Group();
        holder.add(mesh, lines);
        holder.matrixAutoUpdate = false;
        holder.matrix.copy(mesh.matrix);
        mesh.matrix.identity();
        return holder;
      }
    }
    return mesh;
  }

  private addLinkOverlays(L: Link, grp: THREE.Group, size: number, selected: boolean) {
    const v = this.state!.view;
    const s = size * 0.12 * v.frameScale;
    if (v.linkFrames || selected) {
      const ax = this.makeAxes(selected ? s * 1.25 : s, false);
      ax.userData.overlay = true;
      grp.add(ax);
    }
    if (v.jointAxes && hasJoint(this.state!.model, L) && L.joint.type !== "fixed") {
      const dir = new THREE.Vector3(...normalize(L.joint.axis));
      const len = size * 0.18 * v.frameScale;
      const arrow = new THREE.ArrowHelper(
        dir,
        new THREE.Vector3(),
        len,
        this.theme.joint,
        len * 0.22,
        len * 0.12,
      );
      (arrow.line.material as THREE.LineBasicMaterial).depthTest = false;
      (arrow.cone.material as THREE.MeshBasicMaterial).depthTest = false;
      arrow.renderOrder = 5;
      grp.add(arrow);
      if (L.joint.type !== "prismatic") {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(len * 0.32, len * 0.025, 6, 40, Math.PI * 1.5),
          new THREE.MeshBasicMaterial({
            color: this.theme.joint,
            depthTest: false,
            transparent: true,
            opacity: 0.85,
          }),
        );
        ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
        ring.position.copy(dir.clone().multiplyScalar(len * 0.45));
        ring.renderOrder = 5;
        grp.add(ring);
      }
    }
    if (v.com || v.inertia) {
      const com = new THREE.Vector3(...L.inertial.com);
      if (v.com) {
        const ball = new THREE.Mesh(
          new THREE.SphereGeometry(size * 0.012, 16, 8),
          new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
        );
        const ring = new THREE.Mesh(
          new THREE.SphereGeometry(size * 0.016, 16, 8),
          new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false, wireframe: true }),
        );
        ball.position.copy(com);
        ring.position.copy(com);
        ball.renderOrder = ring.renderOrder = 6;
        grp.add(ball, ring);
      }
      if (v.inertia && L.inertial.mass > 0) {
        // Box of uniform density with the same principal moments.
        const { values, vectors } = eigenSym3(L.inertial.inertia);
        const m = L.inertial.mass;
        const [a, b, c] = values.map((x) => Math.max(x, 1e-12));
        const dims = [b + c - a, a + c - b, a + b - c].map((x) =>
          Math.sqrt(Math.max((6 * x) / m, 1e-12)),
        );
        const box = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(dims[0], dims[1], dims[2])),
          new THREE.LineBasicMaterial({ color: this.theme.accent, depthTest: false }),
        );
        const basis = new THREE.Matrix4().makeBasis(
          new THREE.Vector3(vectors[0][0], vectors[1][0], vectors[2][0]),
          new THREE.Vector3(vectors[0][1], vectors[1][1], vectors[2][1]),
          new THREE.Vector3(vectors[0][2], vectors[1][2], vectors[2][2]),
        );
        box.quaternion.setFromRotationMatrix(basis);
        box.position.copy(com);
        box.renderOrder = 6;
        grp.add(box);
      }
    }
    if (v.labels) {
      const el = document.createElement("div");
      el.className = "vp-label" + (selected ? " is-selected" : "");
      el.textContent = L.name;
      const lab = new CSS2DObject(el);
      grp.add(lab);
    }
  }

  private makeAxes(len: number, thick: boolean): THREE.Group {
    const g = new THREE.Group();
    const cols = [0xe5484d, 0x46a758, 0x3e7bfa];
    const dirs = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
    ];
    dirs.forEach((d, i) => {
      const r = len * (thick ? 0.012 : 0.03);
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, len, 8).rotateX(Math.PI / 2).translate(0, 0, len / 2),
        new THREE.MeshBasicMaterial({
          color: cols[i],
          depthTest: thick,
          transparent: !thick,
          opacity: 0.95,
        }),
      );
      shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
      shaft.renderOrder = thick ? 0 : 4;
      shaft.raycast = () => {};
      g.add(shaft);
    });
    return g;
  }

  /**
   * Overall size of the robot in metres (the radius of its visual geometry around its centre),
   * used to scale frames, axes and markers. Mesh bounds go through each visual's scale and pose,
   * so robots modelled in millimetres with scale 0.001 measure correctly.
   */
  private modelSize(): number {
    const box = this.robotBox();
    const r = box.isEmpty() ? 0 : box.getBoundingSphere(new THREE.Sphere()).radius;
    return Math.min(Math.max(r, 0.05), 50);
  }

  /** Bounding box of the robot's visual geometry in its own frame, at zero joint positions. */
  private robotBox(): THREE.Box3 {
    const s = this.state!;
    const worlds = linkWorldMatrices(s.model);
    const box = new THREE.Box3();
    const corner = new THREE.Vector3();
    for (const L of s.model.links) {
      const w = worlds.get(L.id);
      if (!w) continue;
      box.expandByPoint(corner.setFromMatrixPosition(w));
      for (const v of L.visuals) {
        const g = v.geometry;
        let lo: number[], hi: number[];
        if (g.type === "mesh") {
          const a = s.model.meshes.find((x) => x.id === g.meshId);
          if (!a) continue;
          lo = a.bbox.min;
          hi = a.bbox.max;
        } else {
          const h =
            g.type === "box"
              ? g.size.map((x) => x / 2)
              : g.type === "sphere"
                ? [g.radius, g.radius, g.radius]
                : [g.radius, g.radius, g.length / 2];
          lo = h.map((x) => -x);
          hi = h;
        }
        const m = w
          .clone()
          .multiply(poseToMatrix(v.origin, g.type === "mesh" ? g.scale : undefined));
        for (const x of [lo[0], hi[0]])
          for (const y of [lo[1], hi[1]])
            for (const z of [lo[2], hi[2]]) box.expandByPoint(corner.set(x, y, z).applyMatrix4(m));
      }
    }
    return box;
  }

  /**
   * Stand the robot on the floor: URDF roots are often mid-body (ANYmal, humanoids), so the
   * robot is raised until its lowest point touches z = 0 at its spawn pose. Physics uses the same lift.
   */
  private placeRobot() {
    const s = this.state!.environment.spawn;
    const lift = -lowestZ(this.state!.model, this.state!.meshes);
    this.robotRoot.position.set(s.xyz[0], s.xyz[1], s.xyz[2] + lift);
    this.robotRoot.quaternion.setFromEuler(new THREE.Euler(s.rpy[0], s.rpy[1], s.rpy[2], "ZYX"));
    this.robotRoot.updateMatrixWorld(true);
  }

  private layoutEnvironment(size: number) {
    const v = this.state!.view;
    if (!this.grid.children.length) this.grid.add(this.infiniteGrid.mesh);
    this.infiniteGrid.setColors(this.theme.grid, this.theme.gridMajor);
    this.infiniteGrid.mode = v.gridMode;
    this.infiniteGrid.size = Math.max(v.gridSize, 1e-4);
    this.grid.visible = v.grid;
    this.origin.visible = v.worldOrigin;
    this.origin.scale.setScalar(size * 0.3);

    // The robot is lifted to stand on z = 0 (see placeRobot), so the floor stays at 0.
    this.placeRobot();
    this.grid.position.z = 0;
    this.ground.scale.setScalar(size * 12);
    this.ground.position.set(0, 0, -1e-4);
    this.ground.visible = v.shadows && v.lighting;
    const k = this.key;
    k.position.set(size * 1.5, -size * 1.0, size * 3);
    const sc = k.shadow.camera;
    sc.left = sc.bottom = -size * 2;
    sc.right = sc.top = size * 2;
    sc.near = 0.01;
    sc.far = size * 10;
    sc.updateProjectionMatrix();
  }

  private applyPoses() {
    const s = this.state;
    if (!s) return;
    const values = s.mode === "edit" ? {} : s.jointValues;
    this.worlds = this.overrideWorlds ?? linkWorldMatrices(s.model, values);
    for (const [id, obj] of this.linkObjs) {
      const w = this.worlds.get(id);
      if (w) obj.matrix.copy(w);
      obj.matrixWorldNeedsUpdate = true;
    }
    this.updateGizmo();
    this.invalidate();
  }

  private applyView() {
    const v = this.state!.view;
    // "lighting" is the studio rig (vs a camera headlight); "lit" is PBR vs unlit albedo.
    const studio = v.lighting;
    this.lights.visible = studio;
    this.headlight.visible = !studio;
    this.key.castShadow = studio && v.shadows && v.lit;
    this.renderer.shadowMap.enabled = studio && v.shadows && v.lit;
    this.infiniteGrid.mode = v.gridMode;
    this.infiniteGrid.size = Math.max(v.gridSize, 1e-4);
    const env = v.environment && v.lit ? this.environmentTexture(v.envMap) : null;
    this.scene.environment = env;
    this.scene.environmentIntensity =
      v.envMap === "studio" ? 0.55 * v.envIntensity : v.envIntensity;
    this.scene.background =
      env && v.envBackground && v.envMap.startsWith("hdri:") ? this.hdriBackground : null;
    this.scene.backgroundIntensity = v.envIntensity;
    this.renderer.toneMappingExposure = studio ? 1.0 : 1.1;
  }

  private envTextures = new Map<string, THREE.Texture | "loading" | "failed">();
  private hdriBackground: THREE.Texture | null = null;

  /** Image-based lighting: the studio room, a neutral grey, or a downloaded HDRI. */
  private environmentTexture(key: string): THREE.Texture | null {
    if (key === "studio")
      return (this.envMap ??= this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture);
    if (key === "neutral") {
      const hit = this.envTextures.get(key);
      if (hit instanceof THREE.Texture) return hit;
      const room = new THREE.Scene();
      room.background = new THREE.Color(0x8a8d92);
      const t = this.pmrem.fromScene(room, 0).texture;
      this.envTextures.set(key, t);
      return t;
    }
    if (!key.startsWith("hdri:")) return null;
    const hit = this.envTextures.get(key);
    if (hit instanceof THREE.Texture) return hit;
    if (hit) return this.envMap;
    const texKey = key.slice(5);
    const bytes = this.state!.textures(texKey);
    if (!bytes) return this.envMap;
    this.envTextures.set(key, "loading");
    try {
      const buf = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const tex = /\.exr$/i.test(texKey) ? new EXRLoader().parse(buf) : new RGBELoader().parse(buf);
      const data = new THREE.DataTexture(
        tex.data as never,
        tex.width,
        tex.height,
        THREE.RGBAFormat,
        tex.type,
      );
      data.mapping = THREE.EquirectangularReflectionMapping;
      data.colorSpace = THREE.LinearSRGBColorSpace;
      data.flipY = true;
      data.needsUpdate = true;
      const pm = this.pmrem.fromEquirectangular(data).texture;
      this.hdriBackground = data;
      this.envTextures.set(key, pm);
      return pm;
    } catch {
      this.envTextures.set(key, "failed");
      return this.envMap;
    }
  }

  // ------------------------------------------------------------------ gizmo

  private gizmoWorld(): THREE.Matrix4 | null {
    const s = this.state!;
    const sel = s.selection;
    if (!sel || !("linkId" in sel)) return null;
    const lw = this.worlds.get(sel.linkId);
    if (!lw) return null;
    if (s.gizmoTarget === "mesh") {
      const L = s.model.links.find((l) => l.id === sel.linkId);
      const comp =
        sel.kind === "visual"
          ? L?.visuals.find((c) => c.id === sel.compId)
          : sel.kind === "collision"
            ? L?.collisions.find((c) => c.id === sel.compId)
            : L?.visuals[0];
      if (!comp) return null;
      return lw.clone().multiply(poseToMatrix(comp.origin));
    }
    return lw.clone();
  }

  private updateGizmo() {
    const s = this.state;
    if (!s) return;
    const active = s.mode === "edit" && (s.tool === "translate" || s.tool === "rotate");
    const w = active ? this.gizmoWorld() : null;
    this.gizmo.enabled = !!w;
    this.gizmo.getHelper().visible = !!w;
    if (!w || this.gizmo.dragging) return;
    w.decompose(this.gizmoProxy.position, this.gizmoProxy.quaternion, this.gizmoProxy.scale);
    this.gizmoProxy.scale.set(1, 1, 1);
    this.gizmo.setMode(s.tool === "rotate" ? "rotate" : "translate");
    this.gizmo.setSpace(s.gizmoSpace);
    this.gizmo.setTranslationSnap(s.snap ? 0.005 : null);
    this.gizmo.setRotationSnap(s.snap ? THREE.MathUtils.degToRad(15) : null);
  }

  // ------------------------------------------------------------------ input

  private setRay(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      ),
      this.camera,
    );
  }

  private pick(e: PointerEvent): THREE.Intersection | null {
    this.setRay(e);
    this.robot.updateMatrixWorld(true);
    const hits = this.ray.intersectObjects(
      this.pickables.filter((m) => m.visible),
      false,
    );
    return hits[0] ?? null;
  }

  private faceHit(hit: THREE.Intersection): FaceHit {
    const obj = hit.object;
    const n = hit
      .face!.normal.clone()
      .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(obj.matrixWorld))
      .normalize();
    return { ...(obj.userData as PickInfo), point: hit.point.clone(), normal: n };
  }

  private onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private onUp = (e: PointerEvent) => {
    if (this.gizmo.dragging || (this.gizmo.axis && this.gizmo.enabled)) return;
    const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
    if (moved > 5 || e.button !== 0) return;
    const hit = this.pick(e);
    const s = this.state!;
    if (s.tool === "mate" && s.mode === "edit") return this.mateClick(hit);
    this.cb.onPick(hit ? (hit.object.userData as PickInfo) : null, {
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey || e.metaKey,
    });
  };

  private onMove = (e: PointerEvent) => {
    if (e.buttons || !this.state) return;
    const hit = this.pick(e);
    if (this.state.tool === "mate") {
      if (hit && hit.face) {
        const fh = this.faceHit(hit);
        const size = this.modelSize() * 0.03;
        this.faceMarker.position.copy(fh.point).addScaledVector(fh.normal, size * 0.05);
        this.faceMarker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), fh.normal);
        this.faceMarker.scale.setScalar(size);
        (this.faceMarker.material as THREE.MeshBasicMaterial).color.copy(
          this.mateSource ? this.theme.joint : this.theme.accent,
        );
        this.faceMarker.visible = true;
      } else this.faceMarker.visible = false;
      this.invalidate();
    }
    this.setHover(hit ? (hit.object.userData.linkId as string) : null);
  };

  private setHover(linkId: string | null) {
    if (linkId === this.hoverLink) return;
    this.hoverLink = linkId;
    this.renderer.domElement.style.cursor = linkId ? "pointer" : "";
  }

  private mateClick(hit: THREE.Intersection | null) {
    if (!hit || !hit.face) return this.cb.onHint("Click a face on a part.");
    const fh = this.faceHit(hit);
    if (!this.mateSource) {
      this.mateSource = fh;
      return this.cb.onHint("Now click the face it should sit against.");
    }
    // Work in the robot's model frame (the robot may be placed at an environment spawn pose).
    const inv = this.robotRoot.matrixWorld.clone().invert();
    const local = (f: FaceHit): FaceHit => ({
      ...f,
      point: f.point.clone().applyMatrix4(inv),
      normal: f.normal.clone().transformDirection(inv),
    });
    const src = local(this.mateSource);
    const tgt = local(fh);
    this.mateSource = null;
    if (src.linkId === tgt.linkId) return this.cb.onHint("Pick a face on a different link.");
    // Rotate the source so its face normal opposes the target's, then move the points together.
    const want = tgt.normal.clone().negate();
    const q = new THREE.Quaternion();
    if (src.normal.dot(want) < -0.999999) {
      const perp = new THREE.Vector3()
        .crossVectors(
          src.normal,
          Math.abs(src.normal.x) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0),
        )
        .normalize();
      q.setFromAxisAngle(perp, Math.PI);
    } else q.setFromUnitVectors(src.normal, want);
    const D = new THREE.Matrix4()
      .makeTranslation(tgt.point.x, tgt.point.y, tgt.point.z)
      .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
      .multiply(new THREE.Matrix4().makeTranslation(-src.point.x, -src.point.y, -src.point.z));
    const start = this.worlds.get(src.linkId);
    if (!start) return;
    this.faceMarker.visible = false;
    this.cb.onMate(src.linkId, D.multiply(start));
  }

  private cancelMate() {
    this.mateSource = null;
    this.faceMarker.visible = false;
  }

  // ------------------------------------------------------------------ camera

  private fitBox(box: THREE.Box3, dir?: THREE.Vector3) {
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, -0.5, 0), new THREE.Vector3(0.5, 0.5, 0.5));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 0.02);
    const d = dir ?? this.camera.position.clone().sub(this.orbit.target).normalize();
    const dist = (r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.15;
    this.orbit.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(d.normalize(), dist);
    this.camera.near = dist / 500;
    this.camera.far = dist * 50;
    this.camera.updateProjectionMatrix();
    this.orbit.update();
    this.invalidate();
  }

  frameAll(dir?: THREE.Vector3) {
    this.robot.updateMatrixWorld(true);
    const box = new THREE.Box3();
    this.robot.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) box.expandByObject(o);
    });
    this.fitBox(box, dir);
  }

  frameSelection() {
    const s = this.state;
    const id = s?.selection && "linkId" in s.selection ? s.selection.linkId : null;
    const obj = id ? this.linkObjs.get(id) : null;
    if (!obj) return this.frameAll();
    this.robot.updateMatrixWorld(true);
    this.fitBox(new THREE.Box3().setFromObject(obj));
  }

  setView(name: keyof typeof VIEWS | string) {
    const d = VIEWS[name] ?? VIEWS.iso;
    this.frameAll(new THREE.Vector3(...d));
  }

  screenshot(): string {
    this.render();
    return this.renderer.domElement.toDataURL("image/png");
  }

  // ------------------------------------------------------------------ loop

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  private render() {
    this.infiniteGrid.update(this.camera, this.orbit.target);
    this.renderer.render(this.scene, this.camera);
    if (this.state?.view.labels) this.labelRenderer.render(this.scene, this.camera);
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    const moving = this.orbit.update();
    if (this.needsRender || moving) {
      this.needsRender = false;
      this.render();
    }
  };
}
