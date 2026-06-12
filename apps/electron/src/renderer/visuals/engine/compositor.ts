import * as THREE from 'three';
import { SPECTRUM_OFFSET, SPECTRUM_SIZE, type Scene as SceneModel, type StyleManifest } from '@ed/shared';
import type { Style, StyleContext, StyleFactory } from './types';
import { QuadPass, makeRT } from './quad';
import { RoutingEvaluator, type RouteTarget } from '../routing/evaluator';

interface Instance {
  id: string;
  styleId: string;
  style: Style;
  manifest: StyleManifest;
  params: Float32Array;
  baseParams: Float32Array;
  paramIndex: Map<string, number>;
  enabled: boolean;
  opacity: number;
  blendMode: 'normal' | 'add' | 'screen' | 'multiply';
  rt: THREE.WebGLRenderTarget | null; // layers only
}

const BLEND_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uOpacity;
uniform int uMode; // 0 normal, 1 add, 2 screen, 3 multiply
void main() {
  vec4 c = texture(uTex, vUv);
  if (uMode == 0) {
    outColor = vec4(c.rgb, c.a * uOpacity);
  } else if (uMode == 3) {
    outColor = vec4(mix(vec3(1.0), c.rgb, uOpacity * c.a), 1.0);
  } else {
    outColor = vec4(c.rgb * uOpacity * c.a, 1.0);
  }
}
`;

const FINAL_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uBrightness;
uniform float uBlackout;
uniform float uTime;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture(uTex, vUv).rgb * uBrightness * (1.0 - uBlackout);
  c = clamp(c, 0.0, 1.0);
  c += (hash(vUv * 1037.0 + uTime) - 0.5) / 255.0; // blue-ish noise dither
  outColor = vec4(c, 1.0);
}
`;

export class Compositor {
  private layers: Instance[] = [];
  private filters: Instance[] = [];
  private compA: THREE.WebGLRenderTarget;
  private compB: THREE.WebGLRenderTarget;
  private blendPasses: Record<string, QuadPass>;
  private finalPass: QuadPass;
  private routing = new RoutingEvaluator();
  private w: number;
  private h: number;
  private quality: 0 | 1 | 2 = 0;
  blackout = 0;
  brightness = 1;

  readonly ctx: StyleContext;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private factories: Record<string, StyleFactory>,
    width: number,
    height: number,
    video: HTMLVideoElement,
  ) {
    this.w = width;
    this.h = height;
    this.compA = makeRT(width, height);
    this.compB = makeRT(width, height);

    const spectrumData = new Float32Array(SPECTRUM_SIZE);
    const spectrumTexture = new THREE.DataTexture(spectrumData, SPECTRUM_SIZE, 1, THREE.RedFormat, THREE.FloatType);
    spectrumTexture.minFilter = THREE.NearestFilter;
    spectrumTexture.magFilter = THREE.NearestFilter;
    spectrumTexture.needsUpdate = true;

    const videoTexture = new THREE.VideoTexture(video);
    videoTexture.colorSpace = THREE.SRGBColorSpace;

    this.ctx = { renderer, width, height, video, videoTexture, spectrumTexture };

    const mk = (mode: number, blending: Partial<THREE.RawShaderMaterial>) =>
      new QuadPass(
        BLEND_FRAG,
        { uTex: { value: null }, uOpacity: { value: 1 }, uMode: { value: mode } },
        { blending: { transparent: true, ...blending } },
      );
    this.blendPasses = {
      normal: mk(0, {
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      }),
      add: mk(1, { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor }),
      screen: mk(2, {
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcColorFactor,
      }),
      multiply: mk(3, { blending: THREE.CustomBlending, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor }),
    };

    this.finalPass = new QuadPass(FINAL_FRAG, {
      uTex: { value: null },
      uBrightness: { value: 1 },
      uBlackout: { value: 0 },
      uTime: { value: 0 },
    });
  }

  /** Reconcile instances with the scene model. Returns true if routing must recompile. */
  syncScene(scene: SceneModel): void {
    this.brightness = scene.master.brightness;
    this.layers = this.reconcile(this.layers, scene.layers.map((l) => ({
      id: l.id,
      styleId: l.styleId,
      enabled: l.enabled,
      opacity: l.opacity,
      blendMode: l.blendMode,
      params: l.params,
    })), true);
    this.filters = this.reconcile(this.filters, scene.filters.map((f) => ({
      id: f.id,
      styleId: f.filterId,
      enabled: f.enabled,
      opacity: 1,
      blendMode: 'normal' as const,
      params: f.params,
    })), false);

    this.routing.compile(scene.routing, (layerId, paramId) => this.resolveTarget(layerId, paramId));
  }

  private resolveTarget(id: string, paramId: string): RouteTarget | null {
    const inst = this.layers.find((l) => l.id === id) ?? this.filters.find((f) => f.id === id);
    if (!inst) return null;
    const off = inst.paramIndex.get(paramId);
    if (off === undefined) return null;
    return { id, params: inst.params, paramOffset: off };
  }

  private reconcile(
    current: Instance[],
    wanted: { id: string; styleId: string; enabled: boolean; opacity: number; blendMode: Instance['blendMode']; params: Record<string, number> }[],
    isLayer: boolean,
  ): Instance[] {
    const byId = new Map(current.map((i) => [i.id, i]));
    const next: Instance[] = [];
    for (const w of wanted) {
      let inst = byId.get(w.id);
      if (inst && inst.styleId !== w.styleId) {
        this.disposeInstance(inst);
        byId.delete(w.id);
        inst = undefined;
      }
      if (!inst) {
        const factory = this.factories[w.styleId];
        if (!factory) continue;
        const style = factory.create();
        style.init(this.ctx);
        style.setQuality(this.quality);
        const paramIndex = new Map<string, number>();
        factory.manifest.params.forEach((p, i) => paramIndex.set(p.key, i));
        inst = {
          id: w.id,
          styleId: w.styleId,
          style,
          manifest: factory.manifest,
          params: new Float32Array(factory.manifest.params.length),
          baseParams: new Float32Array(factory.manifest.params.length),
          paramIndex,
          enabled: w.enabled,
          opacity: w.opacity,
          blendMode: w.blendMode,
          rt: isLayer ? makeRT(this.w, this.h) : null,
        };
      } else {
        byId.delete(w.id);
      }
      inst.enabled = w.enabled;
      inst.opacity = w.opacity;
      inst.blendMode = w.blendMode;
      // base params from manifest defaults overlaid with scene values
      inst.manifest.params.forEach((p, i) => {
        inst!.baseParams[i] = w.params[p.key] ?? p.default;
      });
      next.push(inst);
    }
    for (const orphan of byId.values()) this.disposeInstance(orphan);
    return next;
  }

  private disposeInstance(inst: Instance): void {
    inst.style.dispose();
    inst.rt?.dispose();
  }

  setEphemeralParam(id: string, paramId: string, value: number): void {
    const t = this.resolveTarget(id, paramId);
    if (t) {
      const inst = this.layers.find((l) => l.id === id) ?? this.filters.find((f) => f.id === id);
      if (inst) inst.baseParams[t.paramOffset] = value;
    }
  }

  setQuality(q: 0 | 1 | 2): void {
    this.quality = q;
    for (const i of [...this.layers, ...this.filters]) i.style.setQuality(q);
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.ctx.width = w;
    this.ctx.height = h;
    this.compA.setSize(w, h);
    this.compB.setSize(w, h);
    for (const l of this.layers) l.rt?.setSize(w, h);
    for (const i of [...this.layers, ...this.filters]) i.style.resize(w, h);
  }

  render(message: Float32Array, dt: number, time: number): void {
    const frame = message; // first 64 floats are the feature frame
    // spectrum -> shared texture
    const spec = this.ctx.spectrumTexture.image.data as Float32Array;
    if (message.length >= SPECTRUM_OFFSET + SPECTRUM_SIZE) {
      spec.set(message.subarray(SPECTRUM_OFFSET, SPECTRUM_OFFSET + SPECTRUM_SIZE));
      this.ctx.spectrumTexture.needsUpdate = true;
    }

    // params: base then routed overrides
    for (const i of this.layers) i.params.set(i.baseParams);
    for (const i of this.filters) i.params.set(i.baseParams);
    this.routing.evaluate(frame, dt);

    const r = this.renderer;

    // 1. each layer into its own RT
    for (const l of this.layers) {
      if (!l.enabled) continue;
      l.style.update(frame, l.params, dt, time);
      l.style.render(l.rt);
    }

    // 2. composite
    r.setRenderTarget(this.compA);
    r.setClearColor(0x000000, 1);
    r.clear();
    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    for (const l of this.layers) {
      if (!l.enabled || !l.rt) continue;
      const pass = this.blendPasses[l.blendMode];
      pass.u.uTex.value = l.rt.texture;
      pass.u.uOpacity.value = l.opacity;
      pass.render(r, this.compA);
    }
    r.autoClear = prevAutoClear;

    // 3. filter chain (ping-pong)
    let src = this.compA;
    let dst = this.compB;
    for (const f of this.filters) {
      if (!f.enabled) continue;
      f.style.update(frame, f.params, dt, time);
      f.style.render(dst, src.texture);
      [src, dst] = [dst, src];
    }

    // 4. final to screen
    this.finalPass.u.uTex.value = src.texture;
    this.finalPass.u.uBrightness.value = this.brightness;
    this.finalPass.u.uBlackout.value = this.blackout;
    this.finalPass.u.uTime.value = time % 64;
    this.finalPass.render(r, null);
  }
}
