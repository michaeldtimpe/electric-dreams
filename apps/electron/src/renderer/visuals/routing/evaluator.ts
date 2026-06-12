import { FEATURE_INDEX, type Route } from '@ed/shared';

const CURVE = { linear: 0, pow: 1, exp: 2, smoothstep: 3, threshold: 4 } as const;

export interface RouteTarget {
  /** layer or filter instance id */
  id: string;
  params: Float32Array;
  paramOffset: number;
}

/**
 * Routes compiled to struct-of-arrays for a branch-light, zero-allocation
 * per-frame evaluation loop.
 */
export class RoutingEvaluator {
  private n = 0;
  private srcIdx = new Int32Array(0);
  private targets: Float32Array[] = [];
  private offsets = new Int32Array(0);
  private gain = new Float32Array(0);
  private bias = new Float32Array(0);
  private curveId = new Int32Array(0);
  private curveAmt = new Float32Array(0);
  private attack = new Float32Array(0);
  private release = new Float32Array(0);
  private lo = new Float32Array(0);
  private hi = new Float32Array(0);
  private env = new Float32Array(0);

  /** Recompile from scene routes. `resolve` maps a route target to a param slot. */
  compile(routes: Route[], resolve: (layerId: string, paramId: string) => RouteTarget | null): void {
    const active: { r: Route; t: RouteTarget }[] = [];
    for (const r of routes) {
      if (!r.enabled) continue;
      const idx = FEATURE_INDEX[r.source];
      if (idx === undefined) continue;
      const t = resolve(r.target.layerId, r.target.paramId);
      if (t) active.push({ r, t });
    }
    const n = (this.n = active.length);
    this.srcIdx = new Int32Array(n);
    this.targets = active.map((a) => a.t.params);
    this.offsets = new Int32Array(n);
    this.gain = new Float32Array(n);
    this.bias = new Float32Array(n);
    this.curveId = new Int32Array(n);
    this.curveAmt = new Float32Array(n);
    this.attack = new Float32Array(n);
    this.release = new Float32Array(n);
    this.lo = new Float32Array(n);
    this.hi = new Float32Array(n);
    this.env = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const { r, t } = active[i];
      this.srcIdx[i] = FEATURE_INDEX[r.source];
      this.offsets[i] = t.paramOffset;
      this.gain[i] = r.transform.gain;
      this.bias[i] = r.transform.bias;
      this.curveId[i] = CURVE[r.transform.curve];
      this.curveAmt[i] = r.transform.curveAmt;
      this.attack[i] = r.transform.attack;
      this.release[i] = r.transform.release;
      this.lo[i] = r.transform.min;
      this.hi[i] = r.transform.max;
      this.env[i] = r.transform.min;
    }
  }

  /** Apply all routes: read features, shape, smooth, write into param arrays. */
  evaluate(frame: Float32Array, dt: number): void {
    for (let i = 0; i < this.n; i++) {
      let v = frame[this.srcIdx[i]];
      switch (this.curveId[i]) {
        case 1:
          v = Math.pow(v < 0 ? 0 : v, this.curveAmt[i]);
          break;
        case 2: {
          const a = this.curveAmt[i];
          v = (Math.exp(a * v) - 1) / (Math.exp(a) - 1);
          break;
        }
        case 3:
          v = v * v * (3 - 2 * v);
          break;
        case 4:
          v = v >= this.curveAmt[i] ? 1 : 0;
          break;
      }
      v = v * this.gain[i] + this.bias[i];
      if (v < this.lo[i]) v = this.lo[i];
      else if (v > this.hi[i]) v = this.hi[i];
      const tau = v > this.env[i] ? this.attack[i] : this.release[i];
      this.env[i] += tau <= 0.001 ? v - this.env[i] : (v - this.env[i]) * (1 - Math.exp(-dt / tau));
      this.targets[i][this.offsets[i]] = this.env[i];
    }
  }
}
