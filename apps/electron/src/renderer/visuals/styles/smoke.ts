import * as THREE from 'three';
import { F, type StyleManifest } from '@ed/shared';
import type { Style, StyleContext } from '../engine/types';
import { QuadPass } from '../engine/quad';

const P = { hue: 0, force: 1, kick: 2, bass: 3, dissipation: 4, swirl: 5, rise: 6 } as const;

export const SMOKE_MANIFEST: StyleManifest = {
  id: 'smoke',
  name: 'Smoke',
  kind: 'layer',
  description: 'Fluid-dynamics ink/smoke (Stam stable fluids)',
  costHint: 3,
  preferredBlend: 'screen',
  params: [
    { key: 'hue', label: 'Hue', min: 0, max: 1, default: 0.55, suggestedFeatures: ['audio.mix.centroid'] },
    { key: 'force', label: 'Emitter force', min: 0, max: 2, default: 0.8, suggestedFeatures: ['audio.mix.rms'] },
    { key: 'kick', label: 'Kick splat', min: 0, max: 1, default: 0.4, suggestedFeatures: ['audio.drums.onset'] },
    { key: 'bass', label: 'Buoyancy', min: 0, max: 1, default: 0.4, suggestedFeatures: ['audio.bass.rms'] },
    { key: 'dissipation', label: 'Persistence', min: 0.9, max: 1, default: 0.985 },
    { key: 'swirl', label: 'Swirl', min: 0, max: 1, default: 0.4, suggestedFeatures: ['lfo.med'] },
    { key: 'rise', label: 'Updraft', min: 0, max: 1, default: 0.3 },
  ],
};

const HEADER = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uTexel;
`;

const ADVECT = `${HEADER}
uniform sampler2D uVel;
uniform sampler2D uSrc;
uniform float uDt;
uniform float uDiss;
void main() {
  vec2 vel = texture(uVel, vUv).xy;
  vec2 coord = vUv - vel * uDt;
  outColor = texture(uSrc, coord) * uDiss;
}
`;

const SPLAT = `${HEADER}
uniform sampler2D uBase;
uniform vec2 uPoint;
uniform vec3 uValue;
uniform float uRadius;
uniform float uAspect;
void main() {
  vec2 d = vUv - uPoint;
  d.x *= uAspect;
  vec3 base = texture(uBase, vUv).xyz;
  outColor = vec4(base + uValue * exp(-dot(d, d) / uRadius), 1.0);
}
`;

const DIVERGENCE = `${HEADER}
uniform sampler2D uVel;
void main() {
  float l = texture(uVel, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uVel, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uVel, vUv - vec2(0.0, uTexel.y)).y;
  float t = texture(uVel, vUv + vec2(0.0, uTexel.y)).y;
  outColor = vec4(0.5 * (r - l + t - b), 0.0, 0.0, 1.0);
}
`;

const JACOBI = `${HEADER}
uniform sampler2D uPressure;
uniform sampler2D uDiv;
void main() {
  float l = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float t = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  float div = texture(uDiv, vUv).x;
  outColor = vec4((l + r + b + t - div) * 0.25, 0.0, 0.0, 1.0);
}
`;

const GRADIENT = `${HEADER}
uniform sampler2D uPressure;
uniform sampler2D uVel;
void main() {
  float l = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float t = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  vec2 vel = texture(uVel, vUv).xy;
  outColor = vec4(vel - 0.5 * vec2(r - l, t - b), 0.0, 1.0);
}
`;

const BUOYANCY = `${HEADER}
uniform sampler2D uVel;
uniform sampler2D uDye;
uniform float uDt;
uniform float uBuoy;
void main() {
  vec2 vel = texture(uVel, vUv).xy;
  vec3 dye = texture(uDye, vUv).rgb;
  float lum = dot(dye, vec3(0.33));
  vel.y += lum * uBuoy * uDt;
  outColor = vec4(vel, 0.0, 1.0);
}
`;

const DISPLAY = `${HEADER}
uniform sampler2D uDye;
void main() {
  vec3 c = texture(uDye, vUv).rgb;
  float a = clamp(dot(c, vec3(0.5)), 0.0, 1.0);
  outColor = vec4(c, a);
}
`;

function simRT(w: number, h: number, filter: THREE.MagnificationTextureFilter): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: filter,
    magFilter: filter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

export class SmokeStyle implements Style {
  readonly manifest = SMOKE_MANIFEST;
  private ctx!: StyleContext;
  private quality: 0 | 1 | 2 = 0;
  private simW = 0;
  private simH = 0;
  private dyeW = 0;
  private dyeH = 0;
  private velA!: THREE.WebGLRenderTarget;
  private velB!: THREE.WebGLRenderTarget;
  private prsA!: THREE.WebGLRenderTarget;
  private prsB!: THREE.WebGLRenderTarget;
  private div!: THREE.WebGLRenderTarget;
  private dyeA!: THREE.WebGLRenderTarget;
  private dyeB!: THREE.WebGLRenderTarget;
  private advect!: QuadPass;
  private splat!: QuadPass;
  private divergence!: QuadPass;
  private jacobi!: QuadPass;
  private gradient!: QuadPass;
  private buoyancy!: QuadPass;
  private display!: QuadPass;
  private dt = 1 / 60;
  private time = 0;
  private hue = 0.55;
  private force = 0.8;
  private kick = 0;
  private bass = 0;
  private diss = 0.985;
  private swirl = 0.4;
  private rise = 0.3;
  private color = new THREE.Color();

  init(ctx: StyleContext): void {
    this.ctx = ctx;
    const mk = (frag: string) => new QuadPass(frag, this.baseUniforms(frag));
    this.advect = mk(ADVECT);
    this.splat = mk(SPLAT);
    this.divergence = mk(DIVERGENCE);
    this.jacobi = mk(JACOBI);
    this.gradient = mk(GRADIENT);
    this.buoyancy = mk(BUOYANCY);
    this.display = mk(DISPLAY);
    this.allocate();
  }

  private baseUniforms(frag: string): Record<string, THREE.IUniform> {
    const u: Record<string, THREE.IUniform> = { uTexel: { value: new THREE.Vector2() } };
    for (const name of frag.matchAll(/uniform\s+\w+\s+(\w+);/g)) {
      const n = name[1];
      if (n === 'uTexel') continue;
      u[n] = { value: n === 'uPoint' ? new THREE.Vector2() : n === 'uValue' ? new THREE.Vector3() : n.startsWith('uDiss') || n === 'uDt' ? 1 : null };
      if (['uDt', 'uDiss', 'uRadius', 'uAspect', 'uBuoy'].includes(n)) u[n].value = 0;
    }
    return u;
  }

  private allocate(): void {
    const q = this.quality;
    const baseSim = q === 0 ? 160 : q === 1 ? 120 : 88;
    const aspect = this.ctx.width / Math.max(1, this.ctx.height);
    this.simH = baseSim;
    this.simW = Math.round(baseSim * aspect);
    const dyeBase = q === 0 ? 512 : q === 1 ? 384 : 256;
    this.dyeH = dyeBase;
    this.dyeW = Math.round(dyeBase * aspect);
    for (const rt of [this.velA, this.velB, this.prsA, this.prsB, this.div, this.dyeA, this.dyeB]) rt?.dispose();
    this.velA = simRT(this.simW, this.simH, THREE.LinearFilter);
    this.velB = simRT(this.simW, this.simH, THREE.LinearFilter);
    this.prsA = simRT(this.simW, this.simH, THREE.NearestFilter);
    this.prsB = simRT(this.simW, this.simH, THREE.NearestFilter);
    this.div = simRT(this.simW, this.simH, THREE.NearestFilter);
    this.dyeA = simRT(this.dyeW, this.dyeH, THREE.LinearFilter);
    this.dyeB = simRT(this.dyeW, this.dyeH, THREE.LinearFilter);
  }

  update(f: Float32Array, p: Float32Array, dt: number, time: number): void {
    this.dt = Math.min(dt, 1 / 30);
    this.time = time;
    this.hue = p[P.hue];
    this.force = p[P.force];
    this.kick = p[P.kick];
    this.bass = p[P.bass];
    this.diss = p[P.dissipation];
    this.swirl = p[P.swirl];
    this.rise = p[P.rise];
    void f;
  }

  private doSplat(r: THREE.WebGLRenderer, targetPair: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget], x: number, y: number, vx: number, vy: number, vz: number, radius: number): [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] {
    const [a, b] = targetPair;
    const u = this.splat.u;
    u.uBase.value = a.texture;
    (u.uPoint.value as THREE.Vector2).set(x, y);
    (u.uValue.value as THREE.Vector3).set(vx, vy, vz);
    u.uRadius.value = radius;
    u.uAspect.value = this.ctx.width / Math.max(1, this.ctx.height);
    this.splat.render(r, b);
    return [b, a];
  }

  render(target: THREE.WebGLRenderTarget | null): void {
    const r = this.ctx.renderer;
    const simTexel = this.advect.u.uTexel.value as THREE.Vector2;
    simTexel.set(1 / this.simW, 1 / this.simH);
    for (const pass of [this.divergence, this.jacobi, this.gradient, this.buoyancy]) {
      (pass.u.uTexel.value as THREE.Vector2).set(1 / this.simW, 1 / this.simH);
    }

    // 1. advect velocity
    this.advect.u.uVel.value = this.velA.texture;
    this.advect.u.uSrc.value = this.velA.texture;
    this.advect.u.uDt.value = this.dt;
    this.advect.u.uDiss.value = 0.999;
    this.advect.render(r, this.velB);
    [this.velA, this.velB] = [this.velB, this.velA];

    // 2. emitters -> velocity + dye splats
    const t = this.time;
    const emX = 0.5 + Math.sin(t * 0.31) * 0.25;
    const baseAngle = Math.sin(t * 0.7) * this.swirl * 1.5;
    const fx = Math.sin(baseAngle) * this.force * 0.18;
    const fy = (0.12 + this.rise * 0.25) * this.force;
    let vel: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] = [this.velA, this.velB];
    vel = this.doSplat(r, vel, emX, 0.12, fx, fy, 0, 0.002);
    let dye: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] = [this.dyeA, this.dyeB];
    this.color.setHSL((this.hue + t * 0.01) % 1, 0.85, 0.5);
    dye = this.doSplat(r, dye, emX, 0.12, this.color.r * this.force * 0.35, this.color.g * this.force * 0.35, this.color.b * this.force * 0.35, 0.0015);

    // kick splats: random position, random direction
    if (this.kick > 0.05) {
      const kx = 0.25 + Math.random() * 0.5;
      const ky = 0.25 + Math.random() * 0.4;
      const ka = Math.random() * Math.PI * 2;
      vel = this.doSplat(r, vel, kx, ky, Math.cos(ka) * this.kick * 0.5, Math.sin(ka) * this.kick * 0.5, 0, 0.003);
      this.color.setHSL((this.hue + 0.4 + Math.random() * 0.15) % 1, 0.9, 0.55);
      dye = this.doSplat(r, dye, kx, ky, this.color.r * this.kick, this.color.g * this.kick, this.color.b * this.kick, 0.002);
    }
    [this.velA, this.velB] = vel;
    [this.dyeA, this.dyeB] = dye;

    // 3. buoyancy from bass
    this.buoyancy.u.uVel.value = this.velA.texture;
    this.buoyancy.u.uDye.value = this.dyeA.texture;
    this.buoyancy.u.uDt.value = this.dt;
    this.buoyancy.u.uBuoy.value = this.bass * 1.2;
    this.buoyancy.render(r, this.velB);
    [this.velA, this.velB] = [this.velB, this.velA];

    // 4. pressure projection
    this.divergence.u.uVel.value = this.velA.texture;
    this.divergence.render(r, this.div);
    r.setRenderTarget(this.prsA);
    r.setClearColor(0x000000, 1);
    r.clear();
    const iters = this.quality === 0 ? 20 : this.quality === 1 ? 14 : 10;
    for (let i = 0; i < iters; i++) {
      this.jacobi.u.uPressure.value = this.prsA.texture;
      this.jacobi.u.uDiv.value = this.div.texture;
      this.jacobi.render(r, this.prsB);
      [this.prsA, this.prsB] = [this.prsB, this.prsA];
    }
    this.gradient.u.uPressure.value = this.prsA.texture;
    this.gradient.u.uVel.value = this.velA.texture;
    this.gradient.render(r, this.velB);
    [this.velA, this.velB] = [this.velB, this.velA];

    // 5. advect dye
    (this.advect.u.uTexel.value as THREE.Vector2).set(1 / this.dyeW, 1 / this.dyeH);
    this.advect.u.uVel.value = this.velA.texture;
    this.advect.u.uSrc.value = this.dyeA.texture;
    this.advect.u.uDiss.value = this.diss;
    this.advect.render(r, this.dyeB);
    [this.dyeA, this.dyeB] = [this.dyeB, this.dyeA];

    // 6. display
    this.display.u.uDye.value = this.dyeA.texture;
    this.display.render(r, target);
  }

  resize(): void {
    this.allocate();
  }

  setQuality(q: 0 | 1 | 2): void {
    if (q !== this.quality) {
      this.quality = q;
      this.allocate();
    }
  }

  dispose(): void {
    for (const rt of [this.velA, this.velB, this.prsA, this.prsB, this.div, this.dyeA, this.dyeB]) rt.dispose();
    for (const p of [this.advect, this.splat, this.divergence, this.jacobi, this.gradient, this.buoyancy, this.display]) p.dispose();
  }
}
