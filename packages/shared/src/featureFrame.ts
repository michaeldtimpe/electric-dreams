/**
 * The FeatureFrame is the single contract between the audio engine and the
 * visuals renderer. One Float32Array(FRAME_SIZE) is published per tick
 * (~60Hz). Stem mode, live-band mode, and standalone mode all fill the SAME
 * layout — consumers never branch on the audio source.
 *
 * All values are pre-normalized to 0..1 except Time (s), Dt (s), Bpm.
 */

export const FRAME_SIZE = 64;

/**
 * The published message is one Float32Array(TOTAL_SIZE): the 64-float frame
 * followed by a 128-bin log-spaced spectrum of the mix (0..1 normalized),
 * used by spectrum-driven styles as a DataTexture.
 */
export const SPECTRUM_OFFSET = 64;
export const SPECTRUM_SIZE = 128;
export const TOTAL_SIZE = SPECTRUM_OFFSET + SPECTRUM_SIZE;

/** Source mode values stored at F.SourceMode. */
export const SOURCE_MODE = { stems: 0, live: 1, standalone: 2 } as const;

/** Per-stem block offsets (stride 8). */
export const STEM_OFFSET = {
  Rms: 0,
  Peak: 1, // fast envelope
  Onset: 2, // decaying impulse envelope
  Flux: 3,
  Centroid: 4,
  LowEnergy: 5,
  HighEnergy: 6,
  Presence: 7,
} as const;

export const STEM_BASE = { drums: 8, bass: 16, vocals: 24, other: 32 } as const;
export type StemName = keyof typeof STEM_BASE;
export const STEM_NAMES: StemName[] = ['drums', 'bass', 'vocals', 'other'];

/** Flat frame indices. */
export const F = {
  // ---- header 0..7
  Time: 0,
  Dt: 1,
  Bpm: 2,
  BeatPhase: 3,
  Beat: 4, // decaying impulse, 1.0 on the beat
  BarPhase: 5,
  SourceMode: 6,
  Loudness: 7, // slow overall loudness envelope

  // ---- per-stem blocks (stride 8): drums@8 bass@16 vocals@24 other@32
  DrumsRms: 8,
  DrumsPeak: 9,
  DrumsOnset: 10,
  DrumsFlux: 11,
  DrumsCentroid: 12,
  DrumsLow: 13,
  DrumsHigh: 14,
  DrumsPresence: 15,

  BassRms: 16,
  BassPeak: 17,
  BassOnset: 18,
  BassFlux: 19,
  BassCentroid: 20,
  BassLow: 21,
  BassHigh: 22,
  BassPresence: 23,

  VocalsRms: 24,
  VocalsPeak: 25,
  VocalsOnset: 26,
  VocalsFlux: 27,
  VocalsCentroid: 28,
  VocalsLow: 29,
  VocalsHigh: 30,
  VocalsPresence: 31,

  OtherRms: 32,
  OtherPeak: 33,
  OtherOnset: 34,
  OtherFlux: 35,
  OtherCentroid: 36,
  OtherLow: 37,
  OtherHigh: 38,
  OtherPresence: 39,

  // ---- mix block 40..47
  MixRms: 40,
  MixCentroid: 41,
  MixFlux: 42,
  MixOnset: 43,
  MixBass: 44, // band energies of the full mix (always filled, even in stem mode)
  MixMid: 45,
  MixHigh: 46,
  MixPeak: 47,

  // ---- built-in LFOs 48..55 (always running, routable like any feature)
  LfoSlow: 48, // sin 0.1 Hz
  LfoMed: 49, // sin 0.25 Hz
  LfoFast: 50, // sin 0.5 Hz
  LfoBeat: 51, // sin 1.0 Hz
  BeatRamp: 52, // == beatPhase (sawtooth per beat)
  BarRamp: 53, // sawtooth per 4-beat bar
  LfoTri: 54, // triangle 0.2 Hz
  Walk: 55, // smoothed random walk, tau ~2s

  // 56..63 reserved (midi.*, derived)
} as const;

export type FrameIndex = (typeof F)[keyof typeof F];

export interface FeatureDef {
  id: string; // namespaced routing id, e.g. 'audio.drums.onset'
  index: number;
  label: string;
  group: string; // dashboard dropdown grouping
}

const stemFeature = (stem: StemName, key: keyof typeof STEM_OFFSET, label: string): FeatureDef => ({
  id: `audio.${stem}.${key.toLowerCase()}`,
  index: STEM_BASE[stem] + STEM_OFFSET[key],
  label: `${stem[0].toUpperCase()}${stem.slice(1)} ${label}`,
  group: stem[0].toUpperCase() + stem.slice(1),
});

/** Catalog of routable features — drives dashboard dropdowns and routing compile. */
export const FEATURES: FeatureDef[] = [
  { id: 'audio.beat', index: F.Beat, label: 'Beat impulse', group: 'Rhythm' },
  { id: 'audio.beat.phase', index: F.BeatPhase, label: 'Beat phase', group: 'Rhythm' },
  { id: 'audio.bar.phase', index: F.BarPhase, label: 'Bar phase', group: 'Rhythm' },
  { id: 'audio.loudness', index: F.Loudness, label: 'Loudness', group: 'Mix' },
  { id: 'audio.mix.rms', index: F.MixRms, label: 'Mix energy', group: 'Mix' },
  { id: 'audio.mix.peak', index: F.MixPeak, label: 'Mix peak', group: 'Mix' },
  { id: 'audio.mix.onset', index: F.MixOnset, label: 'Mix onset', group: 'Mix' },
  { id: 'audio.mix.flux', index: F.MixFlux, label: 'Mix flux', group: 'Mix' },
  { id: 'audio.mix.centroid', index: F.MixCentroid, label: 'Brightness', group: 'Mix' },
  { id: 'audio.mix.bass', index: F.MixBass, label: 'Mix bass band', group: 'Mix' },
  { id: 'audio.mix.mid', index: F.MixMid, label: 'Mix mid band', group: 'Mix' },
  { id: 'audio.mix.high', index: F.MixHigh, label: 'Mix high band', group: 'Mix' },
  ...STEM_NAMES.flatMap((s) => [
    stemFeature(s, 'Rms', 'energy'),
    stemFeature(s, 'Peak', 'peak'),
    stemFeature(s, 'Onset', 'onset'),
    stemFeature(s, 'Flux', 'flux'),
    stemFeature(s, 'Centroid', 'brightness'),
    stemFeature(s, 'Presence', 'presence'),
  ]),
  { id: 'lfo.slow', index: F.LfoSlow, label: 'LFO slow (0.1Hz)', group: 'LFO' },
  { id: 'lfo.med', index: F.LfoMed, label: 'LFO med (0.25Hz)', group: 'LFO' },
  { id: 'lfo.fast', index: F.LfoFast, label: 'LFO fast (0.5Hz)', group: 'LFO' },
  { id: 'lfo.beat', index: F.LfoBeat, label: 'LFO 1Hz', group: 'LFO' },
  { id: 'lfo.tri', index: F.LfoTri, label: 'LFO triangle', group: 'LFO' },
  { id: 'lfo.walk', index: F.Walk, label: 'Random walk', group: 'LFO' },
];

export const FEATURE_INDEX: Record<string, number> = Object.fromEntries(
  FEATURES.map((f) => [f.id, f.index]),
);
