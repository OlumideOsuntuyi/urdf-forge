/**
 * Infinite ground grid drawn in a shader: anti-aliased lines, a major grid every 10 cells, red X
 * and green Y axes, and a distance fade. Adaptive mode picks the spacing from the camera
 * distance and cross-fades between powers of ten; fixed mode uses a set cell size.
 */
import * as THREE from "three";

const vertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragment = /* glsl */ `
  uniform float uMinor;
  uniform float uMajor;
  uniform float uMinorAlpha;
  uniform vec3 uColor;
  uniform vec3 uMajorColor;
  uniform vec3 uCam;
  uniform float uFade;
  uniform float uOpacity;
  varying vec3 vWorld;

  float line(vec2 p, float size, float width) {
    vec2 r = p / size;
    vec2 d = fwidth(r);
    vec2 g = abs(fract(r - 0.5) - 0.5) / (d * width);
    return 1.0 - min(min(g.x, g.y), 1.0);
  }
  float axis(float v, float width) {
    float d = fwidth(v);
    return 1.0 - min(abs(v) / (d * width), 1.0);
  }

  void main() {
    vec2 p = vWorld.xy;
    float fade = 1.0 - smoothstep(uFade * 0.35, uFade, distance(p, uCam.xy));
    float minor = line(p, uMinor, 1.0) * uMinorAlpha;
    float major = line(p, uMajor, 1.4);
    float ax = axis(p.y, 2.0);
    float ay = axis(p.x, 2.0);
    vec3 col = mix(uColor, uMajorColor, major);
    float a = max(minor * 0.55, major);
    col = mix(col, vec3(0.90, 0.28, 0.30), ax);
    col = mix(col, vec3(0.36, 0.78, 0.43), ay);
    a = max(a, max(ax, ay));
    a *= fade * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
  }
`;

export class InfiniteGrid {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  mode: "adaptive" | "fixed" = "adaptive";
  size = 0.1;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uMinor: { value: 0.1 },
        uMajor: { value: 1 },
        uMinorAlpha: { value: 1 },
        uColor: { value: new THREE.Color(0x2b3038) },
        uMajorColor: { value: new THREE.Color(0x3d4450) },
        uCam: { value: new THREE.Vector3() },
        uFade: { value: 50 },
        uOpacity: { value: 1 },
      },
      extensions: { derivatives: true } as never,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
  }

  setColors(minor: THREE.Color, major: THREE.Color) {
    this.mat.uniforms.uColor.value.copy(minor);
    this.mat.uniforms.uMajorColor.value.copy(major);
  }

  /** Call every frame (cheap): follows the camera and picks the spacing. */
  update(camera: THREE.Camera, target: THREE.Vector3) {
    const u = this.mat.uniforms;
    const dist = Math.max(camera.position.distanceTo(target), 0.01);
    if (this.mode === "fixed") {
      u.uMinor.value = this.size;
      u.uMajor.value = this.size * 10;
      u.uMinorAlpha.value = 1;
    } else {
      // About 15-150 minor cells across the view; fade the minor lines in as they grow.
      const l = Math.log10(dist / 15);
      const s = Math.pow(10, Math.floor(l));
      u.uMinor.value = s;
      u.uMajor.value = s * 10;
      u.uMinorAlpha.value = 1 - (l - Math.floor(l));
    }
    const extent = Math.max(dist * 30, u.uMajor.value * 40);
    u.uFade.value = extent * 0.45;
    u.uCam.value.copy(camera.position);
    this.mesh.scale.set(extent, extent, 1);
    this.mesh.position.x = Math.round(camera.position.x / u.uMajor.value) * u.uMajor.value;
    this.mesh.position.y = Math.round(camera.position.y / u.uMajor.value) * u.uMajor.value;
  }

  /** The spacing currently drawn (for the status bar). */
  get spacing(): number {
    return this.mat.uniforms.uMinor.value;
  }
}
