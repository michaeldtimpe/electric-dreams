import { create } from 'zustand';
import type {
  ClientMessage,
  ServerMessage,
  Scene,
  StyleManifest,
  TransportState,
  StemJobStatus,
} from '@ed/shared';

interface Toast {
  id: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

interface State {
  connected: boolean;
  scene: Scene | null;
  rev: number;
  styles: StyleManifest[];
  filters: StyleManifest[];
  transport: TransportState | null;
  meters: number[];
  fps: number;
  frameMs: number;
  stemStatus: StemJobStatus;
  presets: { id: string; name: string }[];
  devices: { deviceId: string; label: string }[];
  toasts: Toast[];
  send: (msg: ClientMessage) => void;
}

let ws: WebSocket | null = null;
let toastId = 0;

export const useStore = create<State>((set, get) => {
  const connect = (): void => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      set({ connected: true });
      get().send({ type: 'hello' });
    };
    ws.onclose = () => {
      set({ connected: false });
      setTimeout(connect, 1500);
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as ServerMessage;
      switch (msg.type) {
        case 'scene':
          set({ scene: msg.scene, rev: msg.rev });
          break;
        case 'manifests':
          set({ styles: msg.styles, filters: msg.filters });
          break;
        case 'transport':
          set({ transport: msg.transport });
          break;
        case 'meters':
          set({ meters: msg.frame, fps: msg.fps, frameMs: msg.frameMs });
          break;
        case 'stems/status':
          set({ stemStatus: msg.status });
          break;
        case 'presets':
          set({ presets: msg.presets });
          break;
        case 'devices':
          set({ devices: msg.inputs });
          break;
        case 'toast': {
          const t = { id: ++toastId, level: msg.level, message: msg.message };
          set((s) => ({ toasts: [...s.toasts.slice(-4), t] }));
          setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })), 5000);
          break;
        }
      }
    };
  };
  setTimeout(connect, 0);

  return {
    connected: false,
    scene: null,
    rev: 0,
    styles: [],
    filters: [],
    transport: null,
    meters: [],
    fps: 0,
    frameMs: 0,
    stemStatus: { state: 'idle', progress: 0 },
    presets: [],
    devices: [],
    toasts: [],
    send: (msg) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
  };
});
