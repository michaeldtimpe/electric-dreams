import { BrowserWindow, MessageChannelMain, shell } from 'electron';
import { join } from 'node:path';
import { IPC } from '@ed/shared';

const preload = join(__dirname, '../preload/index.js');

function load(win: BrowserWindow, page: 'visuals' | 'audio'): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}/index.html`);
  } else {
    void win.loadFile(join(__dirname, `../renderer/${page}/index.html`));
  }
}

export function createVisualsWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      preload,
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  load(win, 'visuals');
  return win;
}

export function createAudioWindow(): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload,
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  load(win, 'audio');
  return win;
}

/**
 * Hand a direct MessagePort pair to the two renderers so 60Hz feature frames
 * flow audio -> visuals without touching the main process.
 */
export function connectFeaturePort(audio: BrowserWindow, visuals: BrowserWindow): void {
  const ready = Promise.all([
    new Promise<void>((res) => audio.webContents.once('did-finish-load', () => res())),
    new Promise<void>((res) => visuals.webContents.once('did-finish-load', () => res())),
  ]);
  void ready.then(() => {
    const { port1, port2 } = new MessageChannelMain();
    audio.webContents.postMessage(IPC.featurePort, { role: 'producer' }, [port1]);
    visuals.webContents.postMessage(IPC.featurePort, { role: 'consumer' }, [port2]);
  });
}
