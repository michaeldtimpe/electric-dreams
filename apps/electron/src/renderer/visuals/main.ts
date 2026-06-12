import * as THREE from 'three';
import { F, IPC, TOTAL_SIZE, SOURCE_MODE, type Scene as SceneModel } from '@ed/shared';
import { Compositor } from './engine/compositor';
import { FACTORIES, STYLE_MANIFESTS, FILTER_MANIFESTS } from './engine/registry';
import { Hud } from './engine/hud';
import { Governor } from './engine/governor';

const DPR_CAP = 1.5;

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: false,
  powerPreference: 'high-performance',
  stencil: false,
  depth: false,
});
renderer.autoClear = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// shared video element for the video layer style (muted: audio comes from the audio engine)
const video = document.createElement('video');
video.muted = true;
video.loop = true;
video.playsInline = true;

let renderScale = 1;
function renderSize(): { w: number; h: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
  return {
    w: Math.max(8, Math.round(window.innerWidth * dpr * renderScale)),
    h: Math.max(8, Math.round(window.innerHeight * dpr * renderScale)),
  };
}

const { w: w0, h: h0 } = renderSize();
renderer.setSize(w0, h0, false);
const compositor = new Compositor(renderer, FACTORIES, w0, h0, video);
const hud = new Hud();
const governor = new Governor();

// ---- feature frame mailbox
let latestFrame = new Float32Array(TOTAL_SIZE);
let lastFrameAt = 0;
window.addEventListener('message', (ev) => {
  if (ev.data?.type === IPC.featurePort && ev.ports[0]) {
    const port = ev.ports[0];
    port.onmessage = (m: MessageEvent) => {
      latestFrame = m.data as Float32Array;
      lastFrameAt = performance.now();
    };
  }
});

// local fallback so visuals animate even before the audio engine connects
function synthesizeFallback(frame: Float32Array, time: number, dt: number): void {
  frame[F.Time] = time;
  frame[F.Dt] = dt;
  frame[F.Bpm] = 120;
  frame[F.BeatPhase] = (time * 2) % 1;
  frame[F.SourceMode] = SOURCE_MODE.standalone;
  frame[F.LfoSlow] = 0.5 + 0.5 * Math.sin(time * Math.PI * 0.2);
  frame[F.LfoMed] = 0.5 + 0.5 * Math.sin(time * Math.PI * 0.5);
  frame[F.LfoFast] = 0.5 + 0.5 * Math.sin(time * Math.PI);
  frame[F.LfoBeat] = 0.5 + 0.5 * Math.sin(time * Math.PI * 2);
  frame[F.BeatRamp] = frame[F.BeatPhase];
}

// ---- IPC
window.ed.send(IPC.manifests, { styles: STYLE_MANIFESTS, filters: FILTER_MANIFESTS });

window.ed.on(IPC.scene, (payload) => {
  const { scene } = payload as { scene: SceneModel; rev: number };
  if (scene.master.renderScale !== renderScale) {
    renderScale = scene.master.renderScale;
    onResize();
  }
  compositor.syncScene(scene);
});

window.ed.on(IPC.paramEphemeral, (payload) => {
  const msg = payload as { type: string; layerId?: string; instanceId?: string; paramId: string; value: number };
  compositor.setEphemeralParam(msg.layerId ?? msg.instanceId ?? '', msg.paramId, msg.value);
});

window.ed.on(IPC.video, (payload) => {
  const url = payload as string;
  if (url) {
    video.src = url;
    void video.play();
  } else {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
});

window.ed.on(IPC.blackout, (payload) => {
  compositor.blackout = payload ? 1 : 0;
});

// ---- input
window.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') window.ed.send(IPC.fullscreenToggle, null);
  if (e.key === 'd' || e.key === 'D') hud.toggle();
  if (e.key === 'b' || e.key === 'B') compositor.blackout = compositor.blackout ? 0 : 1;
});

const drophint = document.getElementById('drophint')!;
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  drophint.style.opacity = '1';
});
window.addEventListener('dragleave', () => {
  drophint.style.opacity = '0';
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  drophint.style.opacity = '0';
  const file = e.dataTransfer?.files?.[0];
  if (file) window.ed.send(IPC.fileDropped, window.ed.getPathForFile(file));
});

function onResize(): void {
  const { w, h } = renderSize();
  renderer.setSize(w, h, false);
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  compositor.resize(w, h);
}
window.addEventListener('resize', onResize);

// ---- main loop
let last = performance.now();
let fpsAcc = 0;
let fpsFrames = 0;
let fps = 60;
let statsAcc = 0;
const MODE_NAMES = ['stems', 'live', 'solo'];

function loop(now: number): void {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  const time = now / 1000;

  const stale = now - lastFrameAt > 500;
  if (stale) synthesizeFallback(latestFrame, time, dt);

  const t0 = performance.now();
  compositor.render(latestFrame, dt, time);
  const frameMs = performance.now() - t0;

  // fps
  fpsAcc += dt;
  fpsFrames++;
  if (fpsAcc >= 0.5) {
    fps = fpsFrames / fpsAcc;
    fpsAcc = 0;
    fpsFrames = 0;
  }

  const q = governor.push(frameMs, time);
  if (q !== null) compositor.setQuality(q);

  hud.push(frameMs, fps, {
    calls: renderer.info.render.calls,
    quality: governor.quality,
    mode: stale ? 'solo' : MODE_NAMES[latestFrame[F.SourceMode] | 0] ?? '?',
  });

  statsAcc += dt;
  if (statsAcc > 0.5) {
    statsAcc = 0;
    window.ed.send(IPC.stats, { fps: Math.round(fps), frameMs: Math.round(frameMs * 10) / 10 });
  }
}
requestAnimationFrame(loop);
