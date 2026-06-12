import type * as THREE from 'three';
import type { StyleManifest } from '@ed/shared';
import { GLSL_COMMON } from '../engine/quad';
import { FragStyle } from '../styles/fragStyle';

/** All filters read uInput (the composited stack) and write their pass output. */

// ---------- Posterize ----------
export const POSTERIZE_MANIFEST: StyleManifest = {
  id: 'posterize',
  name: 'Posterize',
  kind: 'filter',
  description: 'Pop-art color quantization',
  params: [
    { key: 'levels', label: 'Levels', min: 2, max: 16, default: 5, step: 1, suggestedFeatures: ['audio.mix.rms'] },
    { key: 'saturate', label: 'Saturation boost', min: 0.5, max: 2, default: 1.3 },
    { key: 'amount', label: 'Mix', min: 0, max: 1, default: 1 },
  ],
};

export class PosterizeFilter extends FragStyle {
  readonly manifest = POSTERIZE_MANIFEST;
  protected frag(): string {
    return /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform vec2 uRes; uniform float uTime;
uniform sampler2D uInput;
uniform float uLevels, uSat, uAmount;
void main() {
  vec3 c = texture(uInput, vUv).rgb;
  float n = max(2.0, floor(uLevels));
  vec3 q = floor(c * n + 0.5) / n;
  float lum = dot(q, vec3(0.299, 0.587, 0.114));
  q = clamp(mix(vec3(lum), q, uSat), 0.0, 1.0);
  outColor = vec4(mix(c, q, uAmount), 1.0);
}`;
  }
  protected uniforms(): Record<string, THREE.IUniform> {
    return { uLevels: { value: 5 }, uSat: { value: 1.3 }, uAmount: { value: 1 } };
  }
  protected apply(_f: Float32Array, p: Float32Array): void {
    this.pass.u.uLevels.value = p[0];
    this.pass.u.uSat.value = p[1];
    this.pass.u.uAmount.value = p[2];
  }
}

// ---------- Halftone ----------
export const HALFTONE_MANIFEST: StyleManifest = {
  id: 'halftone',
  name: 'Halftone',
  kind: 'filter',
  description: 'Comic-print dot screen',
  params: [
    { key: 'scale', label: 'Dot size', min: 2, max: 24, default: 7, suggestedFeatures: ['audio.drums.onset'] },
    { key: 'angle', label: 'Screen angle', min: 0, max: 3.14, default: 0.6 },
    { key: 'amount', label: 'Mix', min: 0, max: 1, default: 0.85 },
  ],
};

export class HalftoneFilter extends FragStyle {
  readonly manifest = HALFTONE_MANIFEST;
  protected frag(): string {
    return /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform vec2 uRes; uniform float uTime;
uniform sampler2D uInput;
uniform float uScale, uAngle, uAmount;
void main() {
  vec3 c = texture(uInput, vUv).rgb;
  float ca = cos(uAngle), sa = sin(uAngle);
  vec2 px = vUv * uRes;
  vec2 g = mat2(ca, -sa, sa, ca) * px / max(2.0, uScale);
  vec2 cell = fract(g) - 0.5;
  vec2 cellId = floor(g);
  vec2 cellCenterPx = mat2(ca, sa, -sa, ca) * ((cellId + 0.5) * max(2.0, uScale));
  vec3 cc = texture(uInput, clamp(cellCenterPx / uRes, 0.0, 1.0)).rgb;
  float lum = dot(cc, vec3(0.299, 0.587, 0.114));
  float radius = sqrt(lum) * 0.62;
  float dot_ = 1.0 - smoothstep(radius - 0.08, radius + 0.08, length(cell));
  vec3 ht = cc * dot_ / max(0.2, lum + 0.15);
  outColor = vec4(mix(c, clamp(ht, 0.0, 1.0), uAmount), 1.0);
}`;
  }
  protected uniforms(): Record<string, THREE.IUniform> {
    return { uScale: { value: 7 }, uAngle: { value: 0.6 }, uAmount: { value: 0.85 } };
  }
  protected apply(_f: Float32Array, p: Float32Array): void {
    this.pass.u.uScale.value = p[0];
    this.pass.u.uAngle.value = p[1];
    this.pass.u.uAmount.value = p[2];
  }
}

// ---------- Duotone ----------
export const DUOTONE_MANIFEST: StyleManifest = {
  id: 'duotone',
  name: 'Duotone',
  kind: 'filter',
  description: 'Two-color poster map',
  params: [
    { key: 'hueA', label: 'Shadow hue', min: 0, max: 1, default: 0.66, suggestedFeatures: ['audio.mix.centroid'] },
    { key: 'hueB', label: 'Highlight hue', min: 0, max: 1, default: 0.08 },
    { key: 'amount', label: 'Mix', min: 0, max: 1, default: 1 },
  ],
};

export class DuotoneFilter extends FragStyle {
  readonly manifest = DUOTONE_MANIFEST;
  protected frag(): string {
    return /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform vec2 uRes; uniform float uTime;
uniform sampler2D uInput;
uniform float uHueA, uHueB, uAmount;
${GLSL_COMMON}
void main() {
  vec3 c = texture(uInput, vUv).rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 a = hsv2rgb(vec3(uHueA, 0.85, 0.25));
  vec3 b = hsv2rgb(vec3(uHueB, 0.7, 1.0));
  vec3 duo = mix(a, b, smoothstep(0.05, 0.95, lum));
  outColor = vec4(mix(c, duo, uAmount), 1.0);
}`;
  }
  protected uniforms(): Record<string, THREE.IUniform> {
    return { uHueA: { value: 0.66 }, uHueB: { value: 0.08 }, uAmount: { value: 1 } };
  }
  protected apply(_f: Float32Array, p: Float32Array): void {
    this.pass.u.uHueA.value = p[0];
    this.pass.u.uHueB.value = p[1];
    this.pass.u.uAmount.value = p[2];
  }
}

// ---------- Chromatic aberration ----------
export const CHROMA_MANIFEST: StyleManifest = {
  id: 'chroma',
  name: 'Chroma',
  kind: 'filter',
  description: 'Chromatic aberration + barrel warp',
  params: [
    { key: 'amount', label: 'Aberration', min: 0, max: 1, default: 0.25, suggestedFeatures: ['audio.drums.onset', 'audio.mix.flux'] },
    { key: 'barrel', label: 'Barrel', min: -0.5, max: 0.5, default: 0.06 },
  ],
};

export class ChromaFilter extends FragStyle {
  readonly manifest = CHROMA_MANIFEST;
  protected frag(): string {
    return /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform vec2 uRes; uniform float uTime;
uniform sampler2D uInput;
uniform float uAmount, uBarrel;
void main() {
  vec2 c = vUv - 0.5;
  float r2 = dot(c, c);
  vec2 uv = vUv + c * r2 * uBarrel;
  vec2 off = c * r2 * uAmount * 0.12;
  float cr = texture(uInput, uv + off).r;
  float cg = texture(uInput, uv).g;
  float cb = texture(uInput, uv - off).b;
  outColor = vec4(cr, cg, cb, 1.0);
}`;
  }
  protected uniforms(): Record<string, THREE.IUniform> {
    return { uAmount: { value: 0.25 }, uBarrel: { value: 0.06 } };
  }
  protected apply(_f: Float32Array, p: Float32Array): void {
    this.pass.u.uAmount.value = p[0];
    this.pass.u.uBarrel.value = p[1];
  }
}

// ---------- Pixelate ----------
export const PIXELATE_MANIFEST: StyleManifest = {
  id: 'pixelate',
  name: 'Pixelate',
  kind: 'filter',
  description: 'Chunky mosaic cells',
  params: [
    { key: 'cells', label: 'Cell size', min: 2, max: 80, default: 12, suggestedFeatures: ['audio.bass.rms'] },
    { key: 'amount', label: 'Mix', min: 0, max: 1, default: 1 },
  ],
};

export class PixelateFilter extends FragStyle {
  readonly manifest = PIXELATE_MANIFEST;
  protected frag(): string {
    return /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform vec2 uRes; uniform float uTime;
uniform sampler2D uInput;
uniform float uCells, uAmount;
void main() {
  vec2 cellPx = vec2(max(2.0, uCells));
  vec2 uv = (floor(vUv * uRes / cellPx) + 0.5) * cellPx / uRes;
  vec3 c = texture(uInput, uv).rgb;
  vec3 orig = texture(uInput, vUv).rgb;
  outColor = vec4(mix(orig, c, uAmount), 1.0);
}`;
  }
  protected uniforms(): Record<string, THREE.IUniform> {
    return { uCells: { value: 12 }, uAmount: { value: 1 } };
  }
  protected apply(_f: Float32Array, p: Float32Array): void {
    this.pass.u.uCells.value = p[0];
    this.pass.u.uAmount.value = p[1];
  }
}
