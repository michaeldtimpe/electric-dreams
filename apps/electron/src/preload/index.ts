import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC } from '@ed/shared';

const SEND_CHANNELS = new Set<string>([
  IPC.audioState,
  IPC.audioMeters,
  IPC.audioDevices,
  IPC.manifests,
  IPC.stats,
  IPC.fileDropped,
  IPC.fullscreenToggle,
]);

const ON_CHANNELS = new Set<string>([IPC.audioCmd, IPC.scene, IPC.paramEphemeral, IPC.video, IPC.blackout]);

// Forward the renderer-to-renderer MessagePort into the page context.
ipcRenderer.on(IPC.featurePort, (event, data: { role: string }) => {
  window.postMessage({ type: IPC.featurePort, role: data.role }, '*', event.ports);
});

contextBridge.exposeInMainWorld('ed', {
  send(channel: string, payload: unknown): void {
    if (!SEND_CHANNELS.has(channel)) throw new Error(`Blocked send channel: ${channel}`);
    ipcRenderer.send(channel, payload);
  },
  on(channel: string, cb: (payload: unknown) => void): void {
    if (!ON_CHANNELS.has(channel)) throw new Error(`Blocked on channel: ${channel}`);
    ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },
  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file);
  },
});
