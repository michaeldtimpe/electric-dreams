import * as THREE from 'three';

export const VERT = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

let sharedTri: THREE.BufferGeometry | null = null;

/** Fullscreen-triangle geometry, shared across all passes. */
export function fullscreenTriangle(): THREE.BufferGeometry {
  if (!sharedTri) {
    sharedTri = new THREE.BufferGeometry();
    sharedTri.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
  }
  return sharedTri;
}

/** One fullscreen shader pass. Zero per-frame allocation: set uniforms, call render. */
export class QuadPass {
  readonly material: THREE.RawShaderMaterial;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();

  constructor(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, opts?: { blending?: THREE.ShaderMaterialParameters }) {
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      ...opts?.blending,
    });
    const mesh = new THREE.Mesh(fullscreenTriangle(), this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  get u(): Record<string, THREE.IUniform> {
    return this.material.uniforms;
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null): void {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.material.dispose();
  }
}

export function makeRT(w: number, h: number, opts?: { type?: THREE.TextureDataType; format?: THREE.PixelFormat }): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    type: opts?.type ?? THREE.HalfFloatType,
    format: opts?.format ?? THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

/** Common GLSL helpers injected into style shaders. */
export const GLSL_COMMON = /* glsl */ `
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    a *= 0.5;
  }
  return v;
}
`;
