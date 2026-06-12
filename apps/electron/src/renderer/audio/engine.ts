import type { AudioSource, TransportState } from '@ed/shared';
import { Analyzer } from './analysis';
import { detectBpm, BeatGrid, type BeatInfo } from './beat';

const STEMS = ['drums', 'bass', 'vocals', 'other'] as const;
export type Stem = (typeof STEMS)[number];

/**
 * Owns the AudioContext, playback (single file or 4 synced stems), live
 * capture, and the Analyzer graph. The FeatureBus reads analyzers + transport
 * from here every tick.
 */
export class AudioEngine {
  readonly ctx = new AudioContext({ latencyHint: 'playback' });
  readonly mixAnalyzer = new Analyzer(this.ctx, 2048);
  stemAnalyzers: Partial<Record<Stem, Analyzer>> = {};
  readonly beatGrid = new BeatGrid();

  private masterGain = this.ctx.createGain();
  private stemGains: Partial<Record<Stem, GainNode>> = {};
  private nullSink = this.ctx.createGain();

  private mixBuffer: AudioBuffer | null = null;
  private stemBuffers: Partial<Record<Stem, AudioBuffer>> | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private liveStream: MediaStream | null = null;
  private liveNode: MediaStreamAudioSourceNode | null = null;

  private playing = false;
  private pausedOffset = 0;
  private startedAtCtxTime = 0;
  private generation = 0; // invalidates stale onended callbacks

  trackName: string | null = null;
  source: AudioSource = 'file';
  stemMode = true;
  stemsLoaded = false;

  onState: (t: Partial<TransportState> & { detectedBpm?: number; firstBeatOffset?: number }) => void = () => {};

  constructor() {
    // masterGain -> mixAnalyzer -> destination (analyser is inline, passthrough)
    this.masterGain.connect(this.mixAnalyzer.node);
    this.mixAnalyzer.node.connect(this.ctx.destination);
    // silent sink keeps live-capture analysers pulled without audible output
    this.nullSink.gain.value = 0;
    this.nullSink.connect(this.ctx.destination);
  }

  get duration(): number {
    return this.mixBuffer?.duration ?? this.stemBuffers?.drums?.duration ?? 0;
  }

  playheadTime(): number {
    if (this.source !== 'file') return this.ctx.currentTime; // live: monotonic clock
    return this.pausedOffset + (this.playing ? this.ctx.currentTime - this.startedAtCtxTime : 0);
  }

  isPlaying(): boolean {
    return this.source !== 'file' ? true : this.playing;
  }

  usingStems(): boolean {
    return this.source === 'file' && this.stemMode && this.stemsLoaded;
  }

  private async fetchDecode(url: string): Promise<AudioBuffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed: ${url}`);
    return this.ctx.decodeAudioData(await res.arrayBuffer());
  }

  async load(url: string, trackName: string, stems?: Record<string, string>, beat?: BeatInfo): Promise<void> {
    this.stopSources();
    this.playing = false;
    this.pausedOffset = 0;
    this.trackName = trackName;
    this.mixBuffer = await this.fetchDecode(url);
    this.stemBuffers = null;
    this.stemsLoaded = false;
    if (stems) await this.decodeStems(stems);
    this.setupStemGraph();
    this.beatGrid.set(beat ?? null);
    this.pushState();
    if (!beat) this.detectBeatAsync();
    await this.play();
  }

  /** Hot-swap to stems after separation finishes — keeps the playhead. */
  async loadStems(stems: Record<string, string>, beat?: BeatInfo): Promise<void> {
    const wasPlaying = this.playing;
    const at = this.playheadTime();
    await this.decodeStems(stems);
    this.setupStemGraph();
    if (beat) this.beatGrid.set(beat);
    else this.detectBeatAsync();
    if (wasPlaying && this.source === 'file') {
      this.stopSources();
      this.pausedOffset = at;
      this.playing = false;
      await this.play();
    }
    this.pushState();
  }

  private async decodeStems(stems: Record<string, string>): Promise<void> {
    const bufs: Partial<Record<Stem, AudioBuffer>> = {};
    await Promise.all(
      STEMS.map(async (s) => {
        if (stems[s]) bufs[s] = await this.fetchDecode(stems[s]);
      }),
    );
    if (STEMS.every((s) => bufs[s])) {
      this.stemBuffers = bufs;
      this.stemsLoaded = true;
    }
  }

  private setupStemGraph(): void {
    for (const s of STEMS) {
      if (!this.stemGains[s]) {
        const g = this.ctx.createGain();
        const a = new Analyzer(this.ctx, s === 'drums' ? 1024 : 2048);
        g.connect(a.node);
        a.node.connect(this.masterGain);
        this.stemGains[s] = g;
        this.stemAnalyzers[s] = a;
      }
    }
  }

  private detectBeatAsync(): void {
    const buf = this.stemBuffers?.drums ?? this.mixBuffer;
    if (!buf) return;
    setTimeout(() => {
      const info = detectBpm(buf);
      if (info) {
        this.beatGrid.set(info);
        this.onState({ bpm: info.bpm, detectedBpm: info.bpm, firstBeatOffset: info.firstBeatOffset });
      }
    }, 50);
  }

  async play(): Promise<void> {
    if (this.source !== 'file' || this.playing) return;
    if (!this.mixBuffer && !this.stemsLoaded) return;
    await this.ctx.resume();
    const when = this.ctx.currentTime + 0.08;
    const offset = Math.min(this.pausedOffset, this.duration);
    this.sources = [];
    const gen = ++this.generation;

    if (this.usingStems() && this.stemBuffers) {
      for (const s of STEMS) {
        const node = this.ctx.createBufferSource();
        node.buffer = this.stemBuffers[s]!;
        node.connect(this.stemGains[s]!);
        node.start(when, offset);
        this.sources.push(node);
      }
    } else if (this.mixBuffer) {
      const node = this.ctx.createBufferSource();
      node.buffer = this.mixBuffer;
      node.connect(this.masterGain);
      node.start(when, offset);
      this.sources.push(node);
    }
    this.sources[0].onended = () => {
      if (gen !== this.generation) return;
      this.playing = false;
      this.pausedOffset = this.duration;
      this.pushState();
    };
    this.startedAtCtxTime = when;
    this.pausedOffset = offset;
    this.playing = true;
    this.pushState();
  }

  pause(): void {
    if (!this.playing) return;
    this.pausedOffset = this.playheadTime();
    this.stopSources();
    this.playing = false;
    this.pushState();
  }

  async seek(time: number): Promise<void> {
    const wasPlaying = this.playing;
    this.stopSources();
    this.playing = false;
    this.pausedOffset = Math.max(0, Math.min(time, this.duration));
    if (wasPlaying) await this.play();
    else this.pushState();
  }

  setStemMode(enabled: boolean): void {
    this.stemMode = enabled;
    if (this.playing) {
      const at = this.playheadTime();
      this.stopSources();
      this.playing = false;
      this.pausedOffset = at;
      void this.play();
    }
    this.pushState();
  }

  setStemGain(stem: string, gain: number): void {
    const g = this.stemGains[stem as Stem];
    if (g) g.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.02);
  }

  async setSource(source: AudioSource, deviceId?: string): Promise<void> {
    this.source = source;
    if (source === 'file') {
      this.teardownLive();
      this.pushState();
      return;
    }
    // live capture (mic or BlackHole-style loopback device)
    this.stopSources();
    this.playing = false;
    this.teardownLive();
    await this.ctx.resume();
    this.liveStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    this.liveNode = this.ctx.createMediaStreamSource(this.liveStream);
    // analyse only — never route capture to speakers (feedback)
    this.liveNode.connect(this.mixAnalyzer.node);
    this.mixAnalyzer.node.disconnect();
    this.mixAnalyzer.node.connect(this.nullSink);
    this.pushState();
  }

  private teardownLive(): void {
    if (this.liveNode) {
      this.liveNode.disconnect();
      this.liveNode = null;
    }
    if (this.liveStream) {
      for (const t of this.liveStream.getTracks()) t.stop();
      this.liveStream = null;
    }
    // restore playback topology
    this.mixAnalyzer.node.disconnect();
    this.mixAnalyzer.node.connect(this.ctx.destination);
  }

  private stopSources(): void {
    this.generation++;
    for (const s of this.sources) {
      try {
        s.onended = null;
        s.stop();
        s.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
  }

  pushState(): void {
    this.onState({
      state: this.trackName === null && this.source === 'file' ? 'empty' : this.playing || this.source !== 'file' ? 'playing' : 'paused',
      time: this.source === 'file' ? this.playheadTime() : 0,
      duration: this.duration,
      trackName: this.trackName,
      stemsAvailable: this.stemsLoaded,
      stemMode: this.stemMode,
      source: this.source,
      bpm: this.beatGrid.bpm || null,
    });
  }

  async enumerateInputs(): Promise<{ deviceId: string; label: string }[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d) => ({ deviceId: d.deviceId, label: d.label || `Input ${d.deviceId.slice(0, 6)}` }));
  }
}
