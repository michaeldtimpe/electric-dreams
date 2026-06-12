import { IPC, type AudioCmd } from '@ed/shared';
import { AudioEngine } from './engine';
import { FeatureBus } from './featureBus';

const engine = new AudioEngine();
const bus = new FeatureBus(engine);

engine.onState = (t) => window.ed.send(IPC.audioState, t);

window.addEventListener('message', (ev) => {
  if (ev.data?.type === IPC.featurePort && ev.ports[0]) {
    bus.setPort(ev.ports[0]);
  }
});

window.ed.on(IPC.audioCmd, (payload) => {
  const cmd = payload as AudioCmd;
  void (async () => {
    switch (cmd.cmd) {
      case 'load':
        await engine.load(
          cmd.url,
          cmd.trackName,
          cmd.stems,
          cmd.bpm ? { bpm: cmd.bpm, firstBeatOffset: cmd.firstBeatOffset ?? 0 } : undefined,
        );
        break;
      case 'loadStems':
        await engine.loadStems(cmd.stems, cmd.bpm ? { bpm: cmd.bpm, firstBeatOffset: cmd.firstBeatOffset ?? 0 } : undefined);
        break;
      case 'play':
        await engine.play();
        break;
      case 'pause':
        engine.pause();
        break;
      case 'seek':
        await engine.seek(cmd.time);
        break;
      case 'setSource':
        await engine.setSource(cmd.source, cmd.deviceId);
        void refreshDevices();
        break;
      case 'stemMode':
        engine.setStemMode(cmd.enabled);
        break;
      case 'stemGain':
        engine.setStemGain(cmd.stem, cmd.gain);
        break;
    }
  })().catch((e) => console.error('[audio]', e));
});

async function refreshDevices(): Promise<void> {
  try {
    window.ed.send(IPC.audioDevices, await engine.enumerateInputs());
  } catch (e) {
    console.error('[audio] device enumeration failed', e);
  }
}

// feature ticks: rAF in a hidden window (backgroundThrottling disabled)
function loop(): void {
  bus.tick();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// transport time updates for the dashboard scrubber (4Hz)
setInterval(() => {
  if (engine.trackName) engine.pushState();
}, 250);

void refreshDevices();
navigator.mediaDevices.addEventListener('devicechange', () => void refreshDevices());
