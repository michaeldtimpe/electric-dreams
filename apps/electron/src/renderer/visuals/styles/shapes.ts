import * as THREE from 'three';
import type { StyleManifest } from '@ed/shared';
import { GLSL_COMMON } from '../engine/quad';
import { FragStyle } from './fragStyle';

const P = { density: 0, hue: 1, pulse: 2, drift: 3, fill: 4, paper: 5, jitter: 6 } as const;

export const SHAPES_MANIFEST: StyleManifest = {
  id: 'shapes',
  name: 'Modernist',
  kind: 'layer',
  description: 'Bauhaus-flavored geometric composition',
  costHint: 1,
  preferredBlend: 'normal',
  params: [
    { key: 'density', label: 'Grid density', min: 2, max: 14, default: 6, step: 1 },
    { key: 'hue', label: 'Palette hue', min: 0, max: 1, default: 0.02 },
    { key: 'pulse', label: 'Pulse', min: 0, max: 1, default: 0.2, suggestedFeatures: ['audio.drums.onset', 'audio.mix.rms'] },
    { key: 'drift', label: 'Drift speed', min: 0, max: 1, default: 0.25 },
    { key: 'fill', label: 'Shape size', min: 0.2, max: 1, default: 0.62, suggestedFeatures: ['audio.mix.rms'] },
    { key: 'paper', label: 'Paper bg', min: 0, max: 1, default: 1, step: 1 },
    { key: 'jitter', label: 'Composition shuffle', min: 0, max: 20, default: 0, step: 1 },
  ],
};

const FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uRes;
uniform float uTime;
uniform float uDensity, uHue, uPulse, uDrift, uFill, uPaper, uJitter;
${GLSL_COMMON}
#define PI 3.14159265

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float sdTri(vec2 p, float r) {
  const float k = sqrt(3.0);
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

vec3 palette(float idx) {
  // Bauhaus-ish: warm red, deep blue, mustard, near-black, off-white accents
  float h = fract(uHue + idx * 0.31);
  if (idx < 0.2) return hsv2rgb(vec3(fract(uHue + 0.0), 0.85, 0.85));      // red
  if (idx < 0.4) return hsv2rgb(vec3(fract(uHue + 0.6), 0.8, 0.65));       // blue
  if (idx < 0.6) return hsv2rgb(vec3(fract(uHue + 0.12), 0.85, 0.9));      // mustard
  if (idx < 0.8) return vec3(0.12, 0.11, 0.1);                              // ink
  return hsv2rgb(vec3(h, 0.6, 0.8));
}

void main() {
  vec2 uv = vUv;
  uv.x *= uRes.x / uRes.y;
  float d = floor(uDensity);
  vec2 g = uv * d;
  vec2 cell = floor(g + vec2(uJitter * 7.0));
  vec2 lp = fract(g) - 0.5;

  float rnd = hash12(cell);
  vec2 rnd2 = hash22(cell + 13.7);

  // slow per-cell rotation + size pulse
  float ang = (rnd - 0.5) * PI + uTime * uDrift * (rnd2.x - 0.5) * 2.0;
  float ca = cos(ang), sa = sin(ang);
  lp = mat2(ca, -sa, sa, ca) * lp;

  float size = uFill * 0.5 * (0.55 + 0.45 * sin(uTime * uDrift * 2.0 + rnd * 6.28));
  size *= 1.0 + uPulse * 0.6;

  float dist;
  if (rnd2.y < 0.3) dist = length(lp) - size * 0.8;
  else if (rnd2.y < 0.55) dist = sdBox(lp, vec2(size * 0.75));
  else if (rnd2.y < 0.75) dist = sdTri(lp, size * 0.8);
  else if (rnd2.y < 0.9) dist = sdBox(lp, vec2(size * 1.2, size * 0.18)); // bar
  else dist = abs(length(lp) - size * 0.7) - size * 0.12;                  // ring

  float aa = 2.0 / (uRes.y / d);
  float shape = 1.0 - smoothstep(-aa, aa, dist);

  vec3 paper = vec3(0.93, 0.9, 0.84);
  vec3 bg = mix(vec3(0.0), paper, uPaper);
  vec3 col = mix(bg, palette(rnd), shape);

  // sparse cells stay empty for breathing room
  float keep = step(0.25, rnd);
  col = mix(bg, col, keep);
  float alpha = mix(uPaper, 1.0, shape * keep);
  outColor = vec4(col, alpha);
}
`;

export class ShapesStyle extends FragStyle {
  readonly manifest = SHAPES_MANIFEST;
  protected frag(): string {
    return FRAG;
  }
  protected uniforms(): Record<string, THREE.IUniform> {
    return {
      uDensity: { value: 6 },
      uHue: { value: 0.02 },
      uPulse: { value: 0.2 },
      uDrift: { value: 0.25 },
      uFill: { value: 0.62 },
      uPaper: { value: 1 },
      uJitter: { value: 0 },
    };
  }
  protected apply(_f: Float32Array, p: Float32Array): void {
    const u = this.pass.u;
    u.uDensity.value = p[P.density];
    u.uHue.value = p[P.hue];
    u.uPulse.value = p[P.pulse];
    u.uDrift.value = p[P.drift];
    u.uFill.value = p[P.fill];
    u.uPaper.value = p[P.paper];
    u.uJitter.value = p[P.jitter];
  }
}
