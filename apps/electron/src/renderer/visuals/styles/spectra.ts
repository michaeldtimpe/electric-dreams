import * as THREE from 'three';
import { F, type StyleManifest } from '@ed/shared';
import { GLSL_COMMON } from '../engine/quad';
import { FragStyle } from './fragStyle';

const P = { radius: 0, height: 1, hue: 2, hueSpan: 3, thickness: 4, spin: 5, pulse: 6, mirror: 7 } as const;

export const SPECTRA_MANIFEST: StyleManifest = {
  id: 'spectra',
  name: 'Spectra',
  kind: 'layer',
  description: 'Circular spectrum analyzer — the music, literally',
  costHint: 1,
  preferredBlend: 'add',
  params: [
    { key: 'radius', label: 'Ring radius', min: 0.05, max: 0.6, default: 0.22 },
    { key: 'height', label: 'Bar height', min: 0.05, max: 1, default: 0.45, suggestedFeatures: ['audio.mix.rms'] },
    { key: 'hue', label: 'Hue', min: 0, max: 1, default: 0.55 },
    { key: 'hueSpan', label: 'Hue span', min: 0, max: 1, default: 0.5 },
    { key: 'thickness', label: 'Bar fill', min: 0.1, max: 1, default: 0.7 },
    { key: 'spin', label: 'Spin speed', min: -1, max: 1, default: 0.05 },
    { key: 'pulse', label: 'Core pulse', min: 0, max: 1, default: 0.3, suggestedFeatures: ['audio.bass.rms'] },
    { key: 'mirror', label: 'Mirror', min: 0, max: 1, default: 1, step: 1 },
  ],
};

const FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uRes;
uniform float uTime;
uniform sampler2D uSpectrum;
uniform float uRadius, uHeight, uHue, uHueSpan, uThick, uSpin, uPulse, uMirror;
${GLSL_COMMON}
#define PI 3.14159265

void main() {
  vec2 p = (vUv * 2.0 - 1.0);
  p.x *= uRes.x / uRes.y;
  float r = length(p);
  float a = atan(p.y, p.x) + uTime * uSpin * 2.0;
  float t = fract(a / (2.0 * PI) + 0.5);
  if (uMirror > 0.5) t = abs(t * 2.0 - 1.0); // low freqs at both poles

  float mag = texture(uSpectrum, vec2(t, 0.5)).r;
  float inner = uRadius * (1.0 + uPulse * 0.35);
  float outer = inner + mag * uHeight;

  // radial bar with soft edges
  float bar = smoothstep(inner - 0.006, inner, r) * (1.0 - smoothstep(outer, outer + 0.012, r));

  // angular bar slicing (128 bars)
  float cells = 128.0;
  float cell = fract(t * cells);
  float slice = smoothstep(0.0, 0.08, cell) * (1.0 - smoothstep(uThick, uThick + 0.08, cell));
  bar *= mix(1.0, slice, 0.85);

  float hue = fract(uHue + t * uHueSpan);
  vec3 col = hsv2rgb(vec3(hue, 0.8, 1.0)) * bar * (0.45 + mag * 1.2);

  // inner glow ring
  col += hsv2rgb(vec3(uHue, 0.6, 1.0)) * exp(-abs(r - inner) * 60.0) * (0.25 + uPulse * 0.9);
  // faint waveform halo outside
  col += hsv2rgb(vec3(fract(uHue + 0.5), 0.5, 1.0)) * exp(-abs(r - outer) * 38.0) * mag * 0.7;

  outColor = vec4(col, clamp(bar + exp(-abs(r - inner) * 50.0), 0.0, 1.0));
}
`;

export class SpectraStyle extends FragStyle {
  readonly manifest = SPECTRA_MANIFEST;

  protected frag(): string {
    return FRAG;
  }
  protected uniforms(): Record<string, THREE.IUniform> {
    return {
      uSpectrum: { value: null },
      uRadius: { value: 0.22 },
      uHeight: { value: 0.45 },
      uHue: { value: 0.55 },
      uHueSpan: { value: 0.5 },
      uThick: { value: 0.7 },
      uSpin: { value: 0.05 },
      uPulse: { value: 0.3 },
      uMirror: { value: 1 },
    };
  }
  protected apply(f: Float32Array, p: Float32Array): void {
    const u = this.pass.u;
    u.uSpectrum.value = this.ctx.spectrumTexture;
    u.uRadius.value = p[P.radius];
    u.uHeight.value = p[P.height];
    u.uHue.value = p[P.hue];
    u.uHueSpan.value = p[P.hueSpan];
    u.uThick.value = p[P.thickness];
    u.uSpin.value = p[P.spin];
    u.uPulse.value = p[P.pulse] * (0.4 + f[F.MixRms]);
    u.uMirror.value = p[P.mirror];
  }
}
