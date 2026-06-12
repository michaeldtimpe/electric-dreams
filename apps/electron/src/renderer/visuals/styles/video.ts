import * as THREE from 'three';
import type { StyleManifest } from '@ed/shared';
import { FragStyle } from './fragStyle';

const P = { dim: 0, zoom: 1, saturation: 2 } as const;

export const VIDEO_MANIFEST: StyleManifest = {
  id: 'video',
  name: 'Video',
  kind: 'layer',
  description: 'Plays the loaded video file (use as bottom layer)',
  costHint: 2,
  preferredBlend: 'normal',
  params: [
    { key: 'dim', label: 'Brightness', min: 0, max: 1.5, default: 1, suggestedFeatures: ['audio.mix.rms'] },
    { key: 'zoom', label: 'Zoom', min: 1, max: 2, default: 1, suggestedFeatures: ['audio.bass.rms'] },
    { key: 'saturation', label: 'Saturation', min: 0, max: 2, default: 1 },
  ],
};

const FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uRes;
uniform float uTime;
uniform sampler2D uVideo;
uniform vec2 uVideoSize;
uniform float uDim, uZoom, uSat;

void main() {
  if (uVideoSize.x < 1.0) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  // cover fit
  float screenA = uRes.x / uRes.y;
  float videoA = uVideoSize.x / uVideoSize.y;
  vec2 uv = vUv - 0.5;
  if (screenA > videoA) uv.y *= videoA / screenA;
  else uv.x *= screenA / videoA;
  uv /= uZoom;
  uv += 0.5;
  vec3 c = texture(uVideo, clamp(uv, 0.0, 1.0)).rgb * uDim;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(lum), c, uSat);
  outColor = vec4(c, 1.0);
}
`;

export class VideoStyle extends FragStyle {
  readonly manifest = VIDEO_MANIFEST;
  protected frag(): string {
    return FRAG;
  }
  protected uniforms(): Record<string, THREE.IUniform> {
    return {
      uVideo: { value: null },
      uVideoSize: { value: new THREE.Vector2(0, 0) },
      uDim: { value: 1 },
      uZoom: { value: 1 },
      uSat: { value: 1 },
    };
  }
  protected apply(_f: Float32Array, p: Float32Array): void {
    const u = this.pass.u;
    const video = this.ctx.video;
    u.uVideo.value = this.ctx.videoTexture;
    (u.uVideoSize.value as THREE.Vector2).set(
      video.readyState >= 2 ? video.videoWidth : 0,
      video.readyState >= 2 ? video.videoHeight : 1,
    );
    u.uDim.value = p[P.dim];
    u.uZoom.value = p[P.zoom];
    u.uSat.value = p[P.saturation];
  }
}
