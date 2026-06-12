import type { Scene, Layer, FilterInstance, Route, AudioSource, BlendMode } from './scene';
import type { StyleManifest } from './styles';

/** ---- Dashboard (browser) -> main, over WebSocket ---- */
export type ClientMessage =
  | { type: 'hello' }
  | { type: 'transport/play' }
  | { type: 'transport/pause' }
  | { type: 'transport/seek'; time: number }
  | { type: 'transport/loadFile' } // main opens a native dialog
  | { type: 'layer/add'; styleId: string; atBottom?: boolean }
  | { type: 'layer/remove'; layerId: string }
  | { type: 'layer/move'; layerId: string; dir: 'up' | 'down' }
  | { type: 'layer/update'; layerId: string; patch: Partial<Pick<Layer, 'enabled' | 'opacity' | 'blendMode'>> }
  | { type: 'layer/param'; layerId: string; paramId: string; value: number; ephemeral?: boolean }
  | { type: 'filter/add'; filterId: string }
  | { type: 'filter/remove'; instanceId: string }
  | { type: 'filter/move'; instanceId: string; dir: 'up' | 'down' }
  | { type: 'filter/update'; instanceId: string; patch: Partial<Pick<FilterInstance, 'enabled'>> }
  | { type: 'filter/param'; instanceId: string; paramId: string; value: number; ephemeral?: boolean }
  | { type: 'route/add'; route: Route }
  | { type: 'route/remove'; routeId: string }
  | { type: 'route/update'; routeId: string; patch: Partial<Route> }
  | { type: 'master/update'; patch: Partial<{ brightness: number; renderScale: number }> }
  | { type: 'audio/setSource'; source: AudioSource; deviceId?: string }
  | { type: 'audio/stemMode'; enabled: boolean }
  | { type: 'audio/stemGain'; stem: string; gain: number }
  | { type: 'stems/separate'; quality?: 'fast' | 'best' }
  | { type: 'preset/save'; name: string }
  | { type: 'preset/load'; id: string }
  | { type: 'preset/delete'; id: string }
  | { type: 'video/load' }
  | { type: 'video/clear' }
  | { type: 'visuals/fullscreen' }
  | { type: 'visuals/blackout'; on: boolean }
  /** dev tool: capture the visuals window to a PNG on disk */
  | { type: 'debug/capture'; path: string };

/** ---- main -> dashboard, over WebSocket ---- */
export interface TransportState {
  state: 'empty' | 'playing' | 'paused';
  time: number;
  duration: number;
  trackName: string | null;
  stemsAvailable: boolean;
  stemMode: boolean;
  source: AudioSource;
  bpm: number | null;
}

export interface StemJobStatus {
  state: 'idle' | 'running' | 'done' | 'error';
  progress: number; // 0..1
  message?: string;
}

export type ServerMessage =
  | { type: 'scene'; scene: Scene; rev: number }
  | { type: 'manifests'; styles: StyleManifest[]; filters: StyleManifest[] }
  | { type: 'transport'; transport: TransportState }
  | { type: 'meters'; frame: number[]; fps: number; frameMs: number }
  | { type: 'stems/status'; status: StemJobStatus }
  | { type: 'presets'; presets: { id: string; name: string }[] }
  | { type: 'devices'; inputs: { deviceId: string; label: string }[] }
  | { type: 'toast'; level: 'info' | 'warn' | 'error'; message: string };

/** ---- IPC channel names (main <-> renderers) ---- */
export const IPC = {
  /** main -> renderer: delivers the renderer-to-renderer MessagePort */
  featurePort: 'feature-port',
  /** main -> audio renderer: commands */
  audioCmd: 'audio/cmd',
  /** audio renderer -> main: transport/state updates */
  audioState: 'audio/state',
  /** audio renderer -> main: throttled meter frames for the dashboard */
  audioMeters: 'audio/meters',
  /** audio renderer -> main: input device list */
  audioDevices: 'audio/devices',
  /** main -> visuals renderer: full scene */
  scene: 'scene',
  /** main -> visuals renderer: ephemeral param (no store commit) */
  paramEphemeral: 'param/ephemeral',
  /** visuals renderer -> main: style manifests on startup */
  manifests: 'manifests',
  /** visuals renderer -> main: perf stats (throttled) */
  stats: 'stats',
  /** main -> visuals renderer: video file url ('' to clear) */
  video: 'video',
  /** main -> visuals: blackout toggle */
  blackout: 'blackout',
  /** visuals renderer -> main: a file was dropped on the window */
  fileDropped: 'file-dropped',
  /** visuals renderer -> main: toggle fullscreen for this window */
  fullscreenToggle: 'fullscreen-toggle',
} as const;

/** Commands main sends to the audio renderer. */
export type AudioCmd =
  | { cmd: 'load'; url: string; trackName: string; stems?: Record<string, string>; bpm?: number; firstBeatOffset?: number }
  | { cmd: 'loadStems'; stems: Record<string, string>; bpm?: number; firstBeatOffset?: number } // hot-swap after separation
  | { cmd: 'play' }
  | { cmd: 'pause' }
  | { cmd: 'seek'; time: number }
  | { cmd: 'setSource'; source: AudioSource; deviceId?: string }
  | { cmd: 'stemMode'; enabled: boolean }
  | { cmd: 'stemGain'; stem: string; gain: number };
