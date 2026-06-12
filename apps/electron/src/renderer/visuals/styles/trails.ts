import * as THREE from 'three';
import { F, type StyleManifest } from '@ed/shared';
import type { Style, StyleContext } from '../engine/types';
import { QuadPass, makeRT, GLSL_COMMON } from '../engine/quad';

const P = { zoom: 0, rotate: 1, decay: 2, hue: 3, stamp: 4, vocal: 5, wobble: 6 } as const;

export const TRAILS_MANIFEST: StyleManifest = {
  id: 'trails',
  name: 'Trails',
  kind: 'layer',
  description: 'Feedback plasma — Milkdrop-feel zooming trails',
  costHint: 2,
  preferredBlend: 'normal',
  params: [
    { key: 'zoom', label: 'Zoom', min: -0.5, max: 0.5, default: 0.12, suggestedFeatures: ['audio.bass.rms'] },
    { key: 'rotate', label: 'Rotation', min: -1, max: 1, default: 0.08, suggestedFeatures: ['lfo.slow'] },
    { key: 'decay', label: 'Persistence', min: 0.7, max: 0.995, default: 0.96 },
    { key: 'hue', label: 'Hue', min: 0, max: 1, default: 0.8, suggestedFeatures: ['audio.mix.centroid'] },
    { key: 'stamp', label: 'Stamp energy', min: 0, max: 1, default: 0.5, suggestedFeatures: ['audio.drums.onset'] },
    { key: 'vocal', label: 'Bloom energy', min: 0, max: 1, default: 0.3, suggestedFeatures: ['audio.vocals.presence'] },
    { key: 'wobble', label: 'Warp', min: 0, max: 1, default: 0.3 },
  ],
};

const FEEDBACK_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uRes;
uniform sampler2D uPrev;
uniform float uTime, uZoom, uRot, uDecay, uHue, uStamp, uVocal, uWobble, uBeatPhase;
${GLSL_COMMON}
#define PI 3.14159265

void main() {
  vec2 c = vUv - 0.5;
  c.x *= uRes.x / uRes.y;

  // transform previous frame: zoom + rotate + noise warp
  float ang = uRot * 0.03;
  float ca = cos(ang), sa = sin(ang);
  vec2 pc = mat2(ca, -sa, sa, ca) * c;
  pc *= 1.0 - uZoom * 0.05;
  pc += (vec2(fbm(c * 3.0 + uTime * 0.1), fbm(c * 3.0 - uTime * 0.13)) - 0.5) * uWobble * 0.01;
  vec2 puv = pc;
  puv.x /= uRes.x / uRes.y;
  puv += 0.5;
  vec3 prev = texture(uPrev, clamp(puv, 0.0, 1.0)).rgb * uDecay;
  // slight hue drift on the feedback keeps colors moving
  prev = mix(prev, prev.gbr, 0.015);

  // stamps: drum onsets fire shapes orbiting the center
  vec3 add = vec3(0.0);
  float orbA = uTime * 0.7;
  vec2 stampPos = vec2(cos(orbA), sin(orbA)) * (0.18 + 0.12 * sin(uTime * 0.23));
  float d1 = length(c - stampPos);
  add += hsv2rgb(vec3(fract(uHue + uTime * 0.01), 0.85, 1.0)) * exp(-d1 * 28.0) * uStamp * 2.2;
  // mirrored twin
  float d2 = length(c + stampPos);
  add += hsv2rgb(vec3(fract(uHue + 0.33), 0.85, 1.0)) * exp(-d2 * 28.0) * uStamp * 2.2;

  // vocal bloom: soft center wash
  add += hsv2rgb(vec3(fract(uHue + 0.55), 0.5, 1.0)) * exp(-length(c) * 5.0) * uVocal * 0.5;

  // faint base so standalone never goes black
  add += hsv2rgb(vec3(fract(uHue + uBeatPhase * 0.1), 0.7, 1.0)) * exp(-length(c - vec2(sin(uTime*0.4)*0.3, cos(uTime*0.31)*0.2)) * 30.0) * 0.12;

  outColor = vec4(prev + add, 1.0);
}
`;

const COPY_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  outColor = vec4(c, clamp(max(max(c.r, c.g), c.b) * 2.0, 0.0, 1.0));
}
`;

export class TrailsStyle implements Style {
  readonly manifest = TRAILS_MANIFEST;
  private ctx!: StyleContext;
  private a!: THREE.WebGLRenderTarget;
  private b!: THREE.WebGLRenderTarget;
  private feedback!: QuadPass;
  private copy!: QuadPass;
  private scale = 1;

  init(ctx: StyleContext): void {
    this.ctx = ctx;
    this.allocate();
    this.feedback = new QuadPass(FEEDBACK_FRAG, {
      uRes: { value: new THREE.Vector2(ctx.width, ctx.height) },
      uPrev: { value: null },
      uTime: { value: 0 },
      uZoom: { value: 0.12 },
      uRot: { value: 0.08 },
      uDecay: { value: 0.96 },
      uHue: { value: 0.8 },
      uStamp: { value: 0 },
      uVocal: { value: 0 },
      uWobble: { value: 0.3 },
      uBeatPhase: { value: 0 },
    });
    this.copy = new QuadPass(COPY_FRAG, { uTex: { value: null } });
  }

  private allocate(): void {
    const w = Math.max(8, Math.round(this.ctx.width * this.scale));
    const h = Math.max(8, Math.round(this.ctx.height * this.scale));
    this.a?.dispose();
    this.b?.dispose();
    this.a = makeRT(w, h);
    this.b = makeRT(w, h);
  }

  update(f: Float32Array, p: Float32Array, _dt: number, time: number): void {
    const u = this.feedback.u;
    u.uTime.value = time;
    u.uZoom.value = p[P.zoom] * 4;
    u.uRot.value = p[P.rotate] * 4;
    u.uDecay.value = p[P.decay];
    u.uHue.value = p[P.hue];
    u.uStamp.value = p[P.stamp];
    u.uVocal.value = p[P.vocal];
    u.uWobble.value = p[P.wobble];
    u.uBeatPhase.value = f[F.BeatPhase];
  }

  render(target: THREE.WebGLRenderTarget | null): void {
    const r = this.ctx.renderer;
    this.feedback.u.uPrev.value = this.a.texture;
    this.feedback.render(r, this.b);
    [this.a, this.b] = [this.b, this.a];
    this.copy.u.uTex.value = this.a.texture;
    this.copy.render(r, target);
  }

  resize(w: number, h: number): void {
    (this.feedback.u.uRes.value as THREE.Vector2).set(w, h);
    this.allocate();
  }

  setQuality(q: 0 | 1 | 2): void {
    const s = q === 0 ? 1 : q === 1 ? 0.75 : 0.5;
    if (s !== this.scale) {
      this.scale = s;
      this.allocate();
    }
  }

  dispose(): void {
    this.a.dispose();
    this.b.dispose();
    this.feedback.dispose();
    this.copy.dispose();
  }
}
