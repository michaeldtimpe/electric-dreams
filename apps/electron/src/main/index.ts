import { app, dialog, ipcMain, powerSaveBlocker, session, type BrowserWindow } from 'electron';
import { basename, extname } from 'node:path';
import {
  IPC,
  type AudioCmd,
  type ClientMessage,
  type ServerMessage,
  type StemJobStatus,
  type StyleManifest,
  type TransportState,
} from '@ed/shared';
import { createAudioWindow, createVisualsWindow, connectFeaturePort } from './windows';
import { registerMediaScheme, handleMediaProtocol, mediaUrl } from './media-protocol';
import { SceneStore } from './scene-store';
import { startServer, type DashboardServer } from './server';
import { hashFile, lookupStems, writeMeta, readMeta, evictIfNeeded } from './stem-cache';
import { separate, isSeparating, killSidecar } from './demucs';
import { listPresets, savePreset, loadPreset, deletePreset } from './presets';

const AUDIO_EXT = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.aiff', '.aif']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.m4v']);
const PORT = Number(process.env.ED_PORT ?? 7777);
const MODEL_FAST = 'htdemucs';
const MODEL_BEST = 'htdemucs_ft';

registerMediaScheme();

let visuals: BrowserWindow;
let audio: BrowserWindow;
let server: DashboardServer;
const store = new SceneStore();

let styleManifests: StyleManifest[] = [];
let filterManifests: StyleManifest[] = [];
let transport: TransportState = {
  state: 'empty',
  time: 0,
  duration: 0,
  trackName: null,
  stemsAvailable: false,
  stemMode: true,
  source: 'file',
  bpm: null,
};
let stemStatus: StemJobStatus = { state: 'idle', progress: 0 };
let inputDevices: { deviceId: string; label: string }[] = [];
let visualsFps = 0;
let visualsFrameMs = 0;
let currentTrack: { path: string; hash: string; name: string } | null = null;

function broadcast(msg: ServerMessage): void {
  server?.broadcast(msg);
}

function toast(level: 'info' | 'warn' | 'error', message: string): void {
  broadcast({ type: 'toast', level, message });
  if (level === 'error') console.error('[ed]', message);
}

function sendAudio(cmd: AudioCmd): void {
  audio?.webContents.send(IPC.audioCmd, cmd);
}

function snapshot(): ServerMessage[] {
  const msgs: ServerMessage[] = [
    { type: 'manifests', styles: styleManifests, filters: filterManifests },
    { type: 'scene', scene: store.current, rev: store.revision },
    { type: 'transport', transport },
    { type: 'stems/status', status: stemStatus },
    { type: 'devices', inputs: inputDevices },
  ];
  return msgs;
}

async function loadAudioFile(path: string): Promise<void> {
  const name = basename(path);
  toast('info', `Loading ${name}…`);
  const hash = await hashFile(path);
  currentTrack = { path, hash, name };
  const cached = await lookupStems(hash, MODEL_FAST);
  const cmd: AudioCmd = {
    cmd: 'load',
    url: mediaUrl(path),
    trackName: name,
    stems: cached ? Object.fromEntries(Object.entries(cached.stems).map(([k, p]) => [k, mediaUrl(p)])) : undefined,
    bpm: cached?.meta?.bpm,
    firstBeatOffset: cached?.meta?.firstBeatOffset,
  };
  sendAudio(cmd);
  if (cached) toast('info', 'Stems found in cache — stem mode available.');
}

async function runSeparation(quality: 'fast' | 'best'): Promise<void> {
  if (!currentTrack) {
    toast('warn', 'Load an audio file first.');
    return;
  }
  if (isSeparating()) {
    toast('warn', 'A separation job is already running.');
    return;
  }
  const model = quality === 'best' ? MODEL_BEST : MODEL_FAST;
  const { path, hash, name } = currentTrack;
  try {
    const onProgress = (status: StemJobStatus) => {
      stemStatus = status;
      broadcast({ type: 'stems/status', status });
    };
    await separate(path, hash, model, onProgress);
    const existingMeta = await readMeta(hash, model);
    await writeMeta(hash, model, { sourceName: name, model, ...existingMeta });
    const cached = await lookupStems(hash, model);
    if (cached && currentTrack?.hash === hash) {
      sendAudio({
        cmd: 'loadStems',
        stems: Object.fromEntries(Object.entries(cached.stems).map(([k, p]) => [k, mediaUrl(p)])),
        bpm: cached.meta?.bpm,
        firstBeatOffset: cached.meta?.firstBeatOffset,
      });
      toast('info', 'Stems ready — switched to stem mode.');
    }
    void evictIfNeeded();
  } catch (e) {
    toast('error', `Stem separation failed: ${(e as Error).message}`);
  }
}

async function openFileDialog(kind: 'audio' | 'video'): Promise<void> {
  const result = await dialog.showOpenDialog(visuals, {
    properties: ['openFile'],
    filters:
      kind === 'audio'
        ? [{ name: 'Audio', extensions: [...AUDIO_EXT].map((e) => e.slice(1)) }]
        : [{ name: 'Video', extensions: [...VIDEO_EXT].map((e) => e.slice(1)) }],
  });
  if (result.canceled || !result.filePaths[0]) return;
  if (kind === 'audio') await loadAudioFile(result.filePaths[0]);
  else visuals.webContents.send(IPC.video, mediaUrl(result.filePaths[0]));
}

async function refreshPresets(): Promise<void> {
  broadcast({ type: 'presets', presets: await listPresets() });
}

function handleClient(msg: ClientMessage): void {
  void (async () => {
    switch (msg.type) {
      case 'hello':
        break;
      case 'transport/play':
        sendAudio({ cmd: 'play' });
        break;
      case 'transport/pause':
        sendAudio({ cmd: 'pause' });
        break;
      case 'transport/seek':
        sendAudio({ cmd: 'seek', time: msg.time });
        break;
      case 'transport/loadFile':
        await openFileDialog('audio');
        break;
      case 'video/load':
        await openFileDialog('video');
        break;
      case 'video/clear':
        visuals.webContents.send(IPC.video, '');
        break;
      case 'stems/separate':
        void runSeparation(msg.quality ?? 'fast');
        break;
      case 'audio/stemGain':
        sendAudio({ cmd: 'stemGain', stem: msg.stem, gain: msg.gain });
        break;
      case 'preset/save': {
        await savePreset(msg.name, store.current);
        await refreshPresets();
        toast('info', `Saved preset “${msg.name}”.`);
        break;
      }
      case 'preset/load': {
        const scene = await loadPreset(msg.id);
        if (scene) store.replace(scene);
        else toast('error', 'Preset not found or corrupt.');
        break;
      }
      case 'preset/delete':
        await deletePreset(msg.id);
        await refreshPresets();
        break;
      case 'debug/capture': {
        const img = await visuals.webContents.capturePage();
        const { writeFile } = await import('node:fs/promises');
        await writeFile(msg.path, img.toPNG());
        break;
      }
      case 'visuals/fullscreen':
        visuals.setFullScreen(!visuals.isFullScreen());
        break;
      case 'visuals/blackout':
        visuals.webContents.send(IPC.blackout, msg.on);
        break;
      case 'layer/param':
      case 'filter/param': {
        if (msg.ephemeral) {
          // fast path: straight to the visuals window, no store commit
          visuals.webContents.send(IPC.paramEphemeral, msg);
          return;
        }
        store.apply(msg);
        break;
      }
      case 'audio/setSource': {
        store.apply(msg);
        sendAudio({ cmd: 'setSource', source: msg.source, deviceId: msg.deviceId });
        break;
      }
      case 'audio/stemMode': {
        store.apply(msg);
        sendAudio({ cmd: 'stemMode', enabled: msg.enabled });
        break;
      }
      default:
        store.apply(msg);
    }
  })().catch((e) => toast('error', `${(e as Error).message}`));
}

app.whenReady().then(async () => {
  handleMediaProtocol();
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media');
  });

  powerSaveBlocker.start('prevent-display-sleep');

  visuals = createVisualsWindow();
  audio = createAudioWindow();
  connectFeaturePort(audio, visuals);

  // ---- IPC from renderers
  ipcMain.on(IPC.manifests, (_e, payload: { styles: StyleManifest[]; filters: StyleManifest[] }) => {
    styleManifests = payload.styles;
    filterManifests = payload.filters;
    store.setManifests([...payload.styles, ...payload.filters]);
    broadcast({ type: 'manifests', styles: styleManifests, filters: filterManifests });
    // (re)send the scene after a visuals reload so it can rebuild its layer stack
    visuals.webContents.send(IPC.scene, { scene: store.current, rev: store.revision });
  });

  ipcMain.on(IPC.stats, (_e, s: { fps: number; frameMs: number }) => {
    visualsFps = s.fps;
    visualsFrameMs = s.frameMs;
  });

  ipcMain.on(IPC.audioState, (_e, t: Partial<TransportState> & { detectedBpm?: number; firstBeatOffset?: number }) => {
    const { detectedBpm, firstBeatOffset, ...rest } = t;
    transport = { ...transport, ...rest };
    broadcast({ type: 'transport', transport });
    if (detectedBpm && currentTrack) {
      const track = currentTrack;
      void (async () => {
        for (const model of [MODEL_FAST, MODEL_BEST]) {
          const cached = await lookupStems(track.hash, model);
          if (cached) {
            await writeMeta(track.hash, model, {
              sourceName: track.name,
              model,
              ...cached.meta,
              bpm: detectedBpm,
              firstBeatOffset,
            });
          }
        }
      })();
    }
  });

  ipcMain.on(IPC.audioMeters, (_e, frame: number[]) => {
    broadcast({ type: 'meters', frame, fps: visualsFps, frameMs: visualsFrameMs });
  });

  ipcMain.on(IPC.audioDevices, (_e, inputs: { deviceId: string; label: string }[]) => {
    inputDevices = inputs;
    broadcast({ type: 'devices', inputs });
  });

  ipcMain.on(IPC.fileDropped, (_e, path: string) => {
    const ext = extname(path).toLowerCase();
    if (AUDIO_EXT.has(ext)) void loadAudioFile(path);
    else if (VIDEO_EXT.has(ext)) visuals.webContents.send(IPC.video, mediaUrl(path));
    else toast('warn', `Unsupported file type: ${ext}`);
  });

  ipcMain.on(IPC.fullscreenToggle, () => visuals.setFullScreen(!visuals.isFullScreen()));

  // ---- scene changes -> visuals + dashboard
  store.onChange((scene, rev) => {
    visuals.webContents.send(IPC.scene, { scene, rev });
    broadcast({ type: 'scene', scene, rev });
  });

  // dev hook: ED_CAPTURE=/path.png captures the visuals window after 8s
  if (process.env.ED_CAPTURE) {
    setTimeout(async () => {
      const img = await visuals.webContents.capturePage();
      const { writeFile } = await import('node:fs/promises');
      await writeFile(process.env.ED_CAPTURE!, img.toPNG());
      console.log(`[ed] captured visuals to ${process.env.ED_CAPTURE}`);
    }, 8000);
  }

  // ---- dashboard server
  server = await startServer({ port: PORT, onMessage: handleClient, snapshot });
  void refreshPresets();
  console.log(`\n  Electric Dreams dashboard:\n${server.urls.map((u) => `    ${u}`).join('\n')}\n`);

  app.on('activate', () => {
    if (visuals.isDestroyed()) visuals = createVisualsWindow();
  });
});

app.on('window-all-closed', () => {
  killSidecar();
  app.quit();
});
app.on('before-quit', () => killSidecar());
