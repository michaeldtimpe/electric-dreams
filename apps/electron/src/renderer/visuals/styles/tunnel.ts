import * as THREE from 'three';
import type { StyleManifest } from '@ed/shared';
import { GLSL_COMMON } from '../engine/quad';
import { FragStyle } from './fragStyle';

// params (manifest order)
const P = { speed: 0, hue: 1, glow: 2, kick: 3, twist: 4, fold: 5, detail: 6 } as const;

export const TUNNEL_MANIFEST: StyleManifest = {
  id: 'tunnel',
  name: 'Tunnel',
  kind: 'layer',
  description: 'Raymarched fractal tunnel — classic demoscene energy',
  costHint: 1,
  preferredBlend: 'normal',
  params: [
    { key: 'speed', label: 'Travel speed', min: 0, max: 3, default: 0.6, suggestedFeatures: ['audio.bass.rms', 'audio.mix.rms'] },
    { key: 'hue', label: 'Hue', min: 0, max: 1, default: 0.6, suggestedFeatures: ['audio.mix.centroid'] },
    { key: 'glow', label: 'Glow', min: 0, max: 2, default: 0.8, suggestedFeatures: ['audio.mix.rms', 'audio.vocals.rms'] },
    { key: 'kick', label: 'Kick flash', min: 0, max: 1, default: 0, suggestedFeatures: ['audio.drums.onset'] },
    { key: 'twist', label: 'Twist', min: -2, max: 2, default: 0.35, suggestedFeatures: ['lfo.slow'] },
    { key: 'fold', label: 'Kaleidoscope', min: 0, max: 12, default: 0, step: 1 },
    { key: 'detail', label: 'Wall detail', min: 0, max: 1, default: 0.6 },
  ],
};

const FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uRes;
uniform float uTime;
uniform float uPhase;
uniform float uHue;
uniform float uGlow;
uniform float uKick;
uniform float uTwist;
uniform float uFold;
uniform float uDetail;
${GLSL_COMMON}
#define PI 3.14159265

void main() {
  vec2 p = (vUv * 2.0 - 1.0);
  p.x *= uRes.x / uRes.y;
  float r = length(p);
  float a = atan(p.y, p.x);

  if (uFold > 0.5) {
    float seg = PI * 2.0 / max(1.0, floor(uFold));
    a = abs(mod(a, seg) - seg * 0.5);
  }

  float z = 0.5 / (r + 0.05);
  float ang = a + uTwist * z * 0.35 + uTime * 0.03;
  vec2 tuv = vec2(ang * 3.0 / PI, z + uPhase);

  // tube wall: rings + spokes + noise grain
  float rings = sin(tuv.y * PI * 2.0) * 0.5 + 0.5;
  float spokes = sin(tuv.x * PI * 6.0 + sin(tuv.y * PI) ) * 0.5 + 0.5;
  float grain = fbm(tuv * vec2(2.0, 1.0) * (2.0 + uDetail * 4.0));
  float wall = mix(rings * 0.6 + spokes * 0.4, grain, uDetail * 0.55);
  wall = pow(wall, 1.6);

  float fog = exp(-r * 0.18) * smoothstep(0.0, 0.25, r);
  float depthShade = clamp(z * 0.22, 0.0, 1.4);

  float hue = fract(uHue + z * 0.025 + wall * 0.06);
  vec3 col = hsv2rgb(vec3(hue, 0.75 - uKick * 0.35, wall * depthShade));
  col *= fog * (0.65 + uGlow);

  // beat flash: bright ring racing inward
  float ring = exp(-abs(z - fract(uPhase * 0.5) * 14.0) * 1.2) * uKick;
  col += hsv2rgb(vec3(fract(hue + 0.08), 0.4, 1.0)) * ring * 1.6;

  // core glow
  col += hsv2rgb(vec3(hue, 0.5, 1.0)) * exp(-r * 3.2) * (0.25 + uGlow * 0.5 + uKick * 0.8);

  outColor = vec4(col, 1.0);
}
`;

export class TunnelStyle extends FragStyle {
  readonly manifest = TUNNEL_MANIFEST;
  private phase = 0;

  protected frag(): string {
    return FRAG;
  }
  protected uniforms(): Record<string, THREE.IUniform> {
    return {
      uPhase: { value: 0 },
      uHue: { value: 0.6 },
      uGlow: { value: 0.8 },
      uKick: { value: 0 },
      uTwist: { value: 0.35 },
      uFold: { value: 0 },
      uDetail: { value: 0.6 },
    };
  }
  protected apply(_f: Float32Array, p: Float32Array, dt: number): void {
    this.phase += p[P.speed] * dt * 2.0;
    const u = this.pass.u;
    u.uPhase.value = this.phase;
    u.uHue.value = p[P.hue];
    u.uGlow.value = p[P.glow];
    u.uKick.value = p[P.kick];
    u.uTwist.value = p[P.twist];
    u.uFold.value = p[P.fold];
    u.uDetail.value = p[P.detail];
  }
}
