import * as THREE from 'three';
import type { StyleManifest } from '@ed/shared';
import type { Style, StyleContext } from '../engine/types';
import { QuadPass, VERT, GLSL_COMMON } from '../engine/quad';

const P = { speed: 0, size: 1, burst: 2, attract: 3, hue: 4, hueSpan: 5, turbulence: 6 } as const;

export const SWARM_MANIFEST: StyleManifest = {
  id: 'swarm',
  name: 'Swarm',
  kind: 'layer',
  description: 'GPU particle field — pulses, swarms, explodes',
  costHint: 2,
  preferredBlend: 'add',
  params: [
    { key: 'speed', label: 'Speed', min: 0, max: 3, default: 0.8, suggestedFeatures: ['audio.mix.rms'] },
    { key: 'size', label: 'Particle size', min: 0.5, max: 6, default: 1.8, suggestedFeatures: ['audio.bass.rms'] },
    { key: 'burst', label: 'Burst', min: 0, max: 1, default: 0, suggestedFeatures: ['audio.drums.onset'] },
    { key: 'attract', label: 'Attraction', min: -1, max: 1, default: 0.12, suggestedFeatures: ['audio.vocals.presence'] },
    { key: 'hue', label: 'Hue', min: 0, max: 1, default: 0.5, suggestedFeatures: ['audio.mix.centroid'] },
    { key: 'hueSpan', label: 'Hue span', min: 0, max: 1, default: 0.3 },
    { key: 'turbulence', label: 'Turbulence', min: 0, max: 1, default: 0.5, suggestedFeatures: ['audio.mix.flux'] },
  ],
};

const VEL_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPos;
uniform sampler2D uVel;
uniform float uDt, uTime, uSpeed, uBurst, uAttract, uTurb;
${GLSL_COMMON}

void main() {
  vec4 pos = texture(uPos, vUv);
  vec4 vel = texture(uVel, vUv);
  vec2 p = pos.xy;
  vec2 rnd = hash22(vUv * 311.7);

  // curl-ish noise force
  float e = 0.04;
  float n1 = fbm(p * 1.8 + uTime * 0.07 + rnd.x * 3.0);
  float n2 = fbm(p * 1.8 + vec2(e, 0.0) + uTime * 0.07 + rnd.x * 3.0);
  float n3 = fbm(p * 1.8 + vec2(0.0, e) + uTime * 0.07 + rnd.x * 3.0);
  vec2 curl = vec2(n3 - n1, -(n2 - n1)) / e;

  vec2 force = curl * uTurb * 1.6;
  // attraction toward / repulsion from center
  float d = max(0.08, length(p));
  force += -p / d * uAttract * 1.2;
  // burst: radial impulse, randomized per particle
  force += normalize(p + (rnd - 0.5) * 0.3) * uBurst * (8.0 + rnd.y * 10.0);

  vec2 v = vel.xy + force * uDt * uSpeed;
  v *= exp(-uDt * 2.2); // drag
  outColor = vec4(v, 0.0, 1.0);
}
`;

const POS_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPos;
uniform sampler2D uVel;
uniform float uDt, uTime;
${GLSL_COMMON}

void main() {
  vec4 pos = texture(uPos, vUv);
  vec2 vel = texture(uVel, vUv).xy;
  vec2 p = pos.xy + vel * uDt;
  float life = pos.w - uDt * 0.08;

  // respawn when dead or far out of view
  vec2 rnd = hash22(vUv * 217.3 + uTime);
  if (life <= 0.0 || abs(p.x) > 2.2 || abs(p.y) > 2.2) {
    float a = rnd.x * 6.28318;
    float r = 0.15 + rnd.y * 0.9;
    p = vec2(cos(a), sin(a)) * r;
    life = 0.4 + rnd.y;
  }
  outColor = vec4(p, pos.z, life);
}
`;

const POINT_VERT = /* glsl */ `
in vec2 ref;
uniform sampler2D uPos;
uniform float uSize;
uniform vec2 uRes;
out float vLife;
out vec2 vRef;
void main() {
  vec4 pos = texture(uPos, ref);
  vLife = pos.w;
  vRef = ref;
  vec2 p = pos.xy;
  p.x /= uRes.x / uRes.y; // aspect-correct
  gl_Position = vec4(p, 0.0, 1.0);
  gl_PointSize = uSize * (0.6 + fract(ref.x * 7.31) * 1.2) * (uRes.y / 1080.0);
}
`;

const POINT_FRAG = /* glsl */ `
precision highp float;
in float vLife;
in vec2 vRef;
out vec4 outColor;
uniform float uHue, uHueSpan;
${GLSL_COMMON}
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float disc = exp(-dot(d, d) * 14.0);
  float fade = smoothstep(0.0, 0.15, vLife) * smoothstep(0.0, 0.3, 1.4 - vLife);
  vec3 col = hsv2rgb(vec3(fract(uHue + (vRef.x + vRef.y) * 0.5 * uHueSpan), 0.75, 1.0));
  float a = disc * fade;
  outColor = vec4(col * a, a);
}
`;

function makeSimRT(n: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(n, n, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

export class SwarmStyle implements Style {
  readonly manifest = SWARM_MANIFEST;
  private ctx!: StyleContext;
  private n = 256;
  private posA!: THREE.WebGLRenderTarget;
  private posB!: THREE.WebGLRenderTarget;
  private velA!: THREE.WebGLRenderTarget;
  private velB!: THREE.WebGLRenderTarget;
  private velPass!: QuadPass;
  private posPass!: QuadPass;
  private seedPass!: QuadPass;
  private points!: THREE.Points;
  private pointsScene = new THREE.Scene();
  private pointsCam = new THREE.Camera();
  private pointsMat!: THREE.RawShaderMaterial;
  private needsSeed = true;
  private dt = 1 / 60;

  init(ctx: StyleContext): void {
    this.ctx = ctx;
    this.velPass = new QuadPass(VEL_FRAG, {
      uPos: { value: null },
      uVel: { value: null },
      uDt: { value: 1 / 60 },
      uTime: { value: 0 },
      uSpeed: { value: 1 },
      uBurst: { value: 0 },
      uAttract: { value: 0.3 },
      uTurb: { value: 0.5 },
    });
    this.posPass = new QuadPass(POS_FRAG, {
      uPos: { value: null },
      uVel: { value: null },
      uDt: { value: 1 / 60 },
      uTime: { value: 0 },
    });
    this.seedPass = new QuadPass(
      /* glsl */ `
      precision highp float;
      in vec2 vUv;
      out vec4 outColor;
      ${GLSL_COMMON}
      void main() {
        vec2 rnd = hash22(vUv * 173.1);
        float a = rnd.x * 6.28318;
        float r = 0.1 + rnd.y * 1.0;
        outColor = vec4(cos(a) * r, sin(a) * r, 0.0, fract(rnd.x * 17.0) * 1.4);
      }`,
      {},
    );
    this.allocate();

    this.pointsMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      uniforms: {
        uPos: { value: null },
        uSize: { value: 2 },
        uRes: { value: new THREE.Vector2(ctx.width, ctx.height) },
        uHue: { value: 0.5 },
        uHueSpan: { value: 0.3 },
      },
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.buildPoints();
  }

  private allocate(): void {
    this.posA?.dispose();
    this.posB?.dispose();
    this.velA?.dispose();
    this.velB?.dispose();
    this.posA = makeSimRT(this.n);
    this.posB = makeSimRT(this.n);
    this.velA = makeSimRT(this.n);
    this.velB = makeSimRT(this.n);
    this.needsSeed = true;
  }

  private buildPoints(): void {
    if (this.points) {
      this.pointsScene.remove(this.points);
      this.points.geometry.dispose();
    }
    const count = this.n * this.n;
    const refs = new Float32Array(count * 2);
    let k = 0;
    for (let y = 0; y < this.n; y++) {
      for (let x = 0; x < this.n; x++) {
        refs[k++] = (x + 0.5) / this.n;
        refs[k++] = (y + 0.5) / this.n;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('ref', new THREE.BufferAttribute(refs, 2));
    // three needs a position attribute to compute draw range
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.points = new THREE.Points(geo, this.pointsMat);
    this.points.frustumCulled = false;
    this.pointsScene.add(this.points);
  }

  update(_f: Float32Array, p: Float32Array, dt: number, time: number): void {
    this.dt = Math.min(dt, 1 / 30);
    const vu = this.velPass.u;
    vu.uTime.value = time;
    vu.uDt.value = this.dt;
    vu.uSpeed.value = p[P.speed];
    vu.uBurst.value = p[P.burst];
    vu.uAttract.value = p[P.attract];
    vu.uTurb.value = p[P.turbulence];
    this.posPass.u.uDt.value = this.dt;
    this.posPass.u.uTime.value = time;
    const pm = this.pointsMat.uniforms;
    pm.uSize.value = p[P.size] * 3;
    pm.uHue.value = p[P.hue];
    pm.uHueSpan.value = p[P.hueSpan];
  }

  render(target: THREE.WebGLRenderTarget | null): void {
    const r = this.ctx.renderer;
    if (this.needsSeed) {
      this.seedPass.render(r, this.posA);
      r.setRenderTarget(this.velA);
      r.setClearColor(0x000000, 1);
      r.clear();
      this.needsSeed = false;
    }
    // velocity
    this.velPass.u.uPos.value = this.posA.texture;
    this.velPass.u.uVel.value = this.velA.texture;
    this.velPass.render(r, this.velB);
    [this.velA, this.velB] = [this.velB, this.velA];
    // position
    this.posPass.u.uPos.value = this.posA.texture;
    this.posPass.u.uVel.value = this.velA.texture;
    this.posPass.render(r, this.posB);
    [this.posA, this.posB] = [this.posB, this.posA];
    // draw
    this.pointsMat.uniforms.uPos.value = this.posA.texture;
    r.setRenderTarget(target);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.pointsScene, this.pointsCam);
  }

  resize(w: number, h: number): void {
    (this.pointsMat.uniforms.uRes.value as THREE.Vector2).set(w, h);
  }

  setQuality(q: 0 | 1 | 2): void {
    const n = q === 0 ? 256 : q === 1 ? 192 : 128;
    if (n !== this.n) {
      this.n = n;
      this.allocate();
      this.buildPoints();
    }
  }

  dispose(): void {
    this.posA.dispose();
    this.posB.dispose();
    this.velA.dispose();
    this.velB.dispose();
    this.velPass.dispose();
    this.posPass.dispose();
    this.seedPass.dispose();
    this.points.geometry.dispose();
    this.pointsMat.dispose();
  }
}
