/**
 * Per-signal feature extraction. One Analyzer wraps one AnalyserNode and
 * computes, each tick, into preallocated state: RMS, peak env, spectral
 * flux, onset (adaptive threshold), centroid, band energies, presence.
 * Zero allocation in the update path.
 */

const FLUX_RING = 43; // ~0.7s at 60Hz
const REFRACTORY_S = 0.08;

function dbNorm(db: number): number {
  const v = (db + 60) / 60;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export class Analyzer {
  readonly node: AnalyserNode;
  private timeData: Float32Array;
  private freqDb: Float32Array;
  private mags: Float32Array;
  private prevMags: Float32Array;
  private fluxRing = new Float32Array(FLUX_RING);
  private fluxScratch = new Float32Array(FLUX_RING);
  private fluxIdx = 0;
  private fluxCount = 0;
  private sinceOnset = 1;
  private binHz: number;

  // ---- outputs (read by FeatureBus)
  rms = 0; // normalized 0..1
  peak = 0; // fast envelope
  rmsEnv = 0; // smoothed
  flux = 0;
  onset = 0; // decaying impulse envelope
  onsetImpulse = 0; // 1 on the trigger frame, else 0
  centroid = 0;
  presence = 0;

  constructor(ctx: BaseAudioContext, fftSize: number) {
    this.node = ctx.createAnalyser();
    this.node.fftSize = fftSize;
    this.node.smoothingTimeConstant = 0;
    this.timeData = new Float32Array(this.node.fftSize);
    this.freqDb = new Float32Array(this.node.frequencyBinCount);
    this.mags = new Float32Array(this.node.frequencyBinCount);
    this.prevMags = new Float32Array(this.node.frequencyBinCount);
    this.binHz = ctx.sampleRate / this.node.fftSize;
  }

  /** Fill `target` with a log-spaced (30Hz..16kHz) normalized spectrum. */
  fillLogSpectrum(target: Float32Array): void {
    const n = target.length;
    const fLo = 30;
    const fHi = Math.min(16000, (this.mags.length - 1) * this.binHz);
    const ratio = Math.pow(fHi / fLo, 1 / n);
    let lo = fLo;
    for (let i = 0; i < n; i++) {
      const hi = lo * ratio;
      const b0 = Math.max(1, Math.floor(lo / this.binHz));
      const b1 = Math.max(b0 + 1, Math.ceil(hi / this.binHz));
      let sum = 0;
      for (let b = b0; b < b1 && b < this.mags.length; b++) sum += this.mags[b];
      const avg = sum / (b1 - b0);
      const v = dbNorm(20 * Math.log10(avg + 1e-10));
      // light temporal smoothing so bars don't strobe
      target[i] = target[i] * 0.6 + v * 0.4;
      lo = hi;
    }
  }

  /** Normalized energy of a band, computed from the current tick's mags. */
  band(loHz: number, hiHz: number): number {
    const lo = Math.max(1, Math.floor(loHz / this.binHz));
    const hi = Math.min(this.mags.length - 1, Math.ceil(hiHz / this.binHz));
    if (hi <= lo) return 0;
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += this.mags[i];
    const avg = sum / (hi - lo + 1);
    return dbNorm(20 * Math.log10(avg + 1e-10));
  }

  update(dt: number): void {
    const n = this.node;
    n.getFloatTimeDomainData(this.timeData);
    n.getFloatFrequencyData(this.freqDb);

    // RMS + peak
    let sq = 0;
    let pk = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const v = this.timeData[i];
      sq += v * v;
      const a = v < 0 ? -v : v;
      if (a > pk) pk = a;
    }
    const rmsLin = Math.sqrt(sq / this.timeData.length);
    this.rms = dbNorm(20 * Math.log10(rmsLin + 1e-10));
    const pkNorm = dbNorm(20 * Math.log10(pk + 1e-10));
    this.peak += (pkNorm - this.peak) * (1 - Math.exp(-dt / (pkNorm > this.peak ? 0.005 : 0.08)));
    this.rmsEnv += (this.rms - this.rmsEnv) * (1 - Math.exp(-dt / (this.rms > this.rmsEnv ? 0.015 : 0.25)));

    // linear mags + flux + centroid
    let flux = 0;
    let centNum = 0;
    let centDen = 0;
    const logLo = Math.log(20);
    const logHi = Math.log((this.mags.length - 1) * this.binHz);
    for (let i = 1; i < this.freqDb.length; i++) {
      const mag = Math.pow(10, this.freqDb[i] / 20);
      this.mags[i] = mag;
      const d = mag - this.prevMags[i];
      if (d > 0) flux += d;
      this.prevMags[i] = mag;
      const f = i * this.binHz;
      const w = mag;
      centNum += w * Math.log(f);
      centDen += w;
    }
    this.flux = Math.min(1, flux * 4);
    this.centroid = centDen > 1e-9 ? Math.min(1, Math.max(0, (centNum / centDen - logLo) / (logHi - logLo))) : 0;

    // onset: flux vs adaptive median + 1.5*MAD threshold
    this.fluxRing[this.fluxIdx] = this.flux;
    this.fluxIdx = (this.fluxIdx + 1) % FLUX_RING;
    if (this.fluxCount < FLUX_RING) this.fluxCount++;
    this.sinceOnset += dt;
    this.onsetImpulse = 0;
    if (this.fluxCount >= 12 && this.sinceOnset > REFRACTORY_S) {
      const c = this.fluxCount;
      this.fluxScratch.set(this.fluxRing.subarray(0, c));
      const s = this.fluxScratch.subarray(0, c).sort();
      const median = s[c >> 1];
      // MAD via scratch reuse
      for (let i = 0; i < c; i++) {
        const d = s[i] - median;
        this.fluxScratch[i] = d < 0 ? -d : d;
      }
      const s2 = this.fluxScratch.subarray(0, c).sort();
      const mad = s2[c >> 1];
      if (this.flux > median + 1.5 * mad + 0.01) {
        this.onsetImpulse = 1;
        this.onset = 1;
        this.sinceOnset = 0;
      }
    }
    this.onset *= Math.exp(-dt / 0.12);

    // presence: gated slow envelope
    const active = this.rms > 0.18 ? 1 : 0;
    this.presence += (active - this.presence) * (1 - Math.exp(-dt / (active > this.presence ? 0.2 : 0.6)));
  }
}
