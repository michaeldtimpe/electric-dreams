import * as THREE from 'three';
import type { StyleManifest } from '@ed/shared';
import type { Style, StyleContext } from '../engine/types';
import { QuadPass } from '../engine/quad';

/** Base for single-fragment-shader styles and filters. */
export abstract class FragStyle implements Style {
  abstract readonly manifest: StyleManifest;
  protected pass!: QuadPass;
  protected ctx!: StyleContext;

  protected abstract frag(): string;
  protected abstract uniforms(): Record<string, THREE.IUniform>;
  protected abstract apply(features: Float32Array, params: Float32Array, dt: number, time: number): void;

  init(ctx: StyleContext): void {
    this.ctx = ctx;
    this.pass = new QuadPass(this.frag(), {
      uRes: { value: new THREE.Vector2(ctx.width, ctx.height) },
      uTime: { value: 0 },
      uInput: { value: null },
      ...this.uniforms(),
    });
  }

  update(features: Float32Array, params: Float32Array, dt: number, time: number): void {
    this.pass.u.uTime.value = time;
    this.apply(features, params, dt, time);
  }

  render(target: THREE.WebGLRenderTarget | null, input?: THREE.Texture): void {
    if (input) this.pass.u.uInput.value = input;
    this.pass.render(this.ctx.renderer, target);
  }

  resize(w: number, h: number): void {
    (this.pass.u.uRes.value as THREE.Vector2).set(w, h);
  }

  setQuality(_q: 0 | 1 | 2): void {}

  dispose(): void {
    this.pass.dispose();
  }
}
