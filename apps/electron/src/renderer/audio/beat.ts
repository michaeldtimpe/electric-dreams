/**
 * Offline tempo estimation from a decoded AudioBuffer (run once at load,
 * preferably on the drums stem) and a runtime beat grid with gentle
 * onset-based phase correction.
 */

const HOP = 512;
const WIN = 1024;

export interface BeatInfo {
  bpm: number;
  firstBeatOffset: number; // seconds
}

export function detectBpm(buffer: AudioBuffer): BeatInfo | null {
  const sr = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const nFrames = Math.floor((data.length - WIN) / HOP);
  if (nFrames < 200) return null; // < ~2.5s, give up

  // energy envelope + half-wave rectified diff = onset strength
  const onset = new Float32Array(nFrames);
  let prevE = 0;
  for (let i = 0; i < nFrames; i++) {
    let e = 0;
    const base = i * HOP;
    for (let j = 0; j < WIN; j += 2) {
      const v = data[base + j];
      e += v * v;
    }
    e = Math.log(1 + 1000 * e);
    const d = e - prevE;
    onset[i] = d > 0 ? d : 0;
    prevE = e;
  }

  const envRate = sr / HOP; // frames per second
  const minLag = Math.floor((60 / 180) * envRate); // 180 BPM
  const maxLag = Math.ceil((60 / 60) * envRate); // 60 BPM

  // autocorrelation with a soft log-gaussian preference around 120 BPM
  let bestLag = 0;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = lag; i < nFrames; i++) acc += onset[i] * onset[i - lag];
    const bpm = (60 * envRate) / lag;
    const pref = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const score = (acc / (nFrames - lag)) * pref;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag === 0) return null;
  const bpm = (60 * envRate) / bestLag;

  // phase search: which grid offset catches the most onset energy
  let bestOff = 0;
  let bestSum = -Infinity;
  for (let off = 0; off < bestLag; off++) {
    let sum = 0;
    let count = 0;
    for (let i = off; i < nFrames; i += bestLag) {
      sum += onset[i] + 0.5 * (onset[i + 1] ?? 0);
      count++;
    }
    const avg = sum / Math.max(1, count);
    if (avg > bestSum) {
      bestSum = avg;
      bestOff = off;
    }
  }

  return { bpm: Math.round(bpm * 10) / 10, firstBeatOffset: (bestOff * HOP) / sr };
}

export class BeatGrid {
  bpm = 0;
  firstBeatOffset = 0;
  private lastPhase = 0;
  /** decaying beat impulse, 1.0 at each grid beat */
  beat = 0;

  set(info: BeatInfo | null): void {
    this.bpm = info?.bpm ?? 0;
    this.firstBeatOffset = info?.firstBeatOffset ?? 0;
  }

  /** Advance with the current playhead; returns beat phase 0..1 (0 if no bpm). */
  update(playhead: number, dt: number, drumOnsetImpulse: number): { phase: number; barPhase: number } {
    this.beat *= Math.exp(-dt / 0.1);
    if (this.bpm <= 0) return { phase: 0, barPhase: 0 };
    const beatLen = 60 / this.bpm;
    const t = playhead - this.firstBeatOffset;
    const phase = ((t / beatLen) % 1 + 1) % 1;
    const barPhase = ((t / (beatLen * 4)) % 1 + 1) % 1;

    if (this.lastPhase > 0.5 && phase < 0.5) this.beat = 1; // wrapped a beat

    // gentle phase correction: a drum onset within +-60ms of the grid nudges it
    if (drumOnsetImpulse > 0) {
      const distToGrid = phase < 0.5 ? phase * beatLen : (phase - 1) * beatLen;
      if (Math.abs(distToGrid) < 0.06) this.firstBeatOffset += distToGrid * 0.1;
    }
    this.lastPhase = phase;
    return { phase, barPhase };
  }
}
