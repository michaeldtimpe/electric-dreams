import type * as THREE from 'three';
import type { StyleManifest } from '@ed/shared';

export interface StyleContext {
  renderer: THREE.WebGLRenderer;
  /** render-target size in px (already includes renderScale + DPR cap) */
  width: number;
  height: number;
  /** shared video element + texture for the video layer style */
  video: HTMLVideoElement;
  videoTexture: THREE.Texture;
  /** 128-bin log spectrum, updated each frame and shared as a DataTexture */
  spectrumTexture: THREE.DataTexture;
}

export interface Style {
  readonly manifest: StyleManifest;
  init(ctx: StyleContext): void;
  /**
   * features: the 64-float FeatureFrame (indices from @ed/shared F).
   * params: this instance's resolved param values, in manifest order.
   * Rule for authors: time drives motion, features drive modulation —
   * a silent frame must still animate.
   */
  update(features: Float32Array, params: Float32Array, dt: number, time: number): void;
  /** Layers render into `target`; filters read `input` and render into `target`. */
  render(target: THREE.WebGLRenderTarget | null, input?: THREE.Texture): void;
  resize(w: number, h: number): void;
  setQuality(q: 0 | 1 | 2): void;
  dispose(): void;
}

export type StyleFactory = { manifest: StyleManifest; create: () => Style };
