import { F, TOTAL_SIZE, SPECTRUM_OFFSET, SOURCE_MODE, STEM_BASE, STEM_OFFSET, IPC, type StemName } from '@ed/shared';
import type { AudioEngine, Stem } from './engine';

const STEMS: StemName[] = ['drums', 'bass', 'vocals', 'other'];

/** Assembles the FeatureFrame every tick and publishes it to the visuals port. */
export class FeatureBus {
  private frame = new Float32Array(TOTAL_SIZE);
  private spectrum = this.frame.subarray(SPECTRUM_OFFSET);
  private port: MessagePort | null = null;
  private lastTick = performance.now();
  private clock = 0;
  private loudness = 0;
  private fade = 0; // 0 = standalone fallback, 1 = real audio
  private metersAcc = 0;

  // standalone fallback state: 4 random walks + walk LFO
  private walkVal = new Float32Array(5);
  private walkTarget = new Float32Array(5);
  private walkTimer = 0;
  private synthBeatLast = 0;

  constructor(private engine: AudioEngine) {}

  setPort(port: MessagePort): void {
    this.port = port;
  }

  tick(): void {
    const now = performance.now();
    let dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (dt > 1 / 15) dt = 1 / 15;
    this.clock += dt;

    const e = this.engine;
    const f = this.frame;
    const live = e.source !== 'file';
    const fileActive = e.source === 'file' && e.isPlaying() && e.trackName !== null;
    const hasAudio = live || fileActive;

    // crossfade real <-> fallback over 1s
    this.fade += ((hasAudio ? 1 : 0) - this.fade) * (1 - Math.exp(-dt / 1.0));
    const fade = this.fade;

    e.mixAnalyzer.update(dt);
    const usingStems = e.usingStems();
    if (usingStems) for (const s of STEMS) e.stemAnalyzers[s as Stem]?.update(dt);

    // ---- header
    f[F.Time] = this.clock;
    f[F.Dt] = dt;
    const playhead = e.playheadTime();
    const drumOnset = usingStems ? (e.stemAnalyzers.drums?.onsetImpulse ?? 0) : e.mixAnalyzer.onsetImpulse;
    const grid = e.beatGrid.update(playhead, dt, drumOnset);
    let bpm = e.beatGrid.bpm;
    let beatPhase = grid.phase;
    let barPhase = grid.barPhase;
    let beat = e.beatGrid.beat;

    // synthetic 120 BPM grid for standalone / missing bpm
    const synthPhase = (this.clock * 2) % 1;
    if (synthPhase < this.synthBeatLast) this.synthBeatRamp = 1;
    this.synthBeatLast = synthPhase;
    this.synthBeatRamp *= Math.exp(-dt / 0.1);
    if (!hasAudio || bpm <= 0) {
      bpm = 120;
      beatPhase = synthPhase;
      barPhase = (this.clock / 2) % 1;
      beat = this.synthBeatRamp;
    }
    f[F.Bpm] = bpm;
    f[F.BeatPhase] = beatPhase;
    f[F.Beat] = beat;
    f[F.BarPhase] = barPhase;
    f[F.SourceMode] = hasAudio ? (usingStems ? SOURCE_MODE.stems : SOURCE_MODE.live) : SOURCE_MODE.standalone;

    this.loudness += (e.mixAnalyzer.rms - this.loudness) * (1 - Math.exp(-dt / 2));
    f[F.Loudness] = this.loudness * fade + 0.4 * (1 - fade);

    // ---- standalone random walks
    this.walkTimer -= dt;
    if (this.walkTimer <= 0) {
      this.walkTimer = 0.3 + Math.random() * 0.5;
      for (let i = 0; i < 5; i++) this.walkTarget[i] = Math.random();
    }
    for (let i = 0; i < 5; i++) this.walkVal[i] += (this.walkTarget[i] - this.walkVal[i]) * (1 - Math.exp(-dt / 0.8));

    // ---- stem blocks
    const mix = e.mixAnalyzer;
    for (let si = 0; si < STEMS.length; si++) {
      const name = STEMS[si];
      const base = STEM_BASE[name];
      let rms: number, peak: number, onset: number, flux: number, centroid: number, low: number, high: number, presence: number;
      if (usingStems && e.stemAnalyzers[name as Stem]) {
        const a = e.stemAnalyzers[name as Stem]!;
        rms = a.rmsEnv;
        peak = a.peak;
        onset = a.onset;
        flux = a.flux;
        centroid = a.centroid;
        low = a.band(20, 150);
        high = a.band(4000, 12000);
        presence = a.presence;
      } else {
        // pseudo-stems from the mix via band approximation
        const bandE =
          name === 'bass' ? mix.band(20, 150)
          : name === 'drums' ? Math.min(1, 0.5 * mix.band(4000, 12000) + 0.7 * mix.flux)
          : name === 'vocals' ? mix.band(200, 4000)
          : mix.band(150, 2000) * 0.8;
        rms = bandE;
        peak = Math.min(1, bandE * 1.3);
        onset = mix.onset * (name === 'drums' ? 1 : bandE);
        flux = mix.flux;
        centroid = mix.centroid;
        low = mix.band(20, 150);
        high = mix.band(4000, 12000);
        presence = name === 'vocals' ? mix.presence : bandE > 0.25 ? 1 : 0;
      }
      // fallback blend (random walk per stem, onset from synthetic beat for drums)
      const fb = this.walkVal[si] * 0.6 + 0.2;
      const fbOnset = name === 'drums' ? this.synthBeatRamp : 0;
      f[base + STEM_OFFSET.Rms] = rms * fade + fb * (1 - fade);
      f[base + STEM_OFFSET.Peak] = peak * fade + fb * (1 - fade);
      f[base + STEM_OFFSET.Onset] = onset * fade + fbOnset * (1 - fade);
      f[base + STEM_OFFSET.Flux] = flux * fade + fb * 0.5 * (1 - fade);
      f[base + STEM_OFFSET.Centroid] = centroid * fade + 0.5 * (1 - fade);
      f[base + STEM_OFFSET.LowEnergy] = low * fade + fb * (1 - fade);
      f[base + STEM_OFFSET.HighEnergy] = high * fade + fb * (1 - fade);
      f[base + STEM_OFFSET.Presence] = presence * fade + fb * (1 - fade);
    }

    // ---- mix block
    const fbMix = this.walkVal[4] * 0.6 + 0.2;
    f[F.MixRms] = mix.rmsEnv * fade + fbMix * (1 - fade);
    f[F.MixCentroid] = mix.centroid * fade + 0.5 * (1 - fade);
    f[F.MixFlux] = mix.flux * fade + fbMix * 0.5 * (1 - fade);
    f[F.MixOnset] = mix.onset * fade + this.synthBeatRamp * (1 - fade);
    f[F.MixBass] = mix.band(20, 150) * fade + this.walkVal[1] * (1 - fade);
    f[F.MixMid] = mix.band(150, 2000) * fade + this.walkVal[2] * (1 - fade);
    f[F.MixHigh] = mix.band(2000, 12000) * fade + this.walkVal[3] * (1 - fade);
    f[F.MixPeak] = mix.peak * fade + fbMix * (1 - fade);

    // ---- LFOs (always running)
    const t = this.clock;
    f[F.LfoSlow] = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 0.1);
    f[F.LfoMed] = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 0.25);
    f[F.LfoFast] = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 0.5);
    f[F.LfoBeat] = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
    f[F.BeatRamp] = beatPhase;
    f[F.BarRamp] = barPhase;
    const tri = (t * 0.2) % 1;
    f[F.LfoTri] = tri < 0.5 ? tri * 2 : 2 - tri * 2;
    f[F.Walk] = this.walkVal[4];

    mix.fillLogSpectrum(this.spectrum);
    this.port?.postMessage(f);

    // throttled meters for the dashboard (~15Hz, frame only — no spectrum)
    this.metersAcc += dt;
    if (this.metersAcc > 1 / 15) {
      this.metersAcc = 0;
      window.ed.send(IPC.audioMeters, Array.from(f.subarray(0, SPECTRUM_OFFSET)));
    }
  }

  private synthBeatRamp = 0;
}
