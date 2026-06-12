# Electric Dreams

Music-reactive programmatic visuals, VJ-style. Visuals run at display refresh in their own chromeless window (drag it to a projector, hit `F` for fullscreen); everything is controlled live from a web dashboard, including from a phone on the same network.

- **Layered styles** — tunnel, spectra (circular analyzer), swarm (GPU particles), trails (feedback plasma), smoke (fluid sim), modernist shapes, video underlay — stacked with blend modes and per-layer opacity, plus pop-art post filters (posterize, halftone, duotone, chroma, pixelate).
- **True stem reactivity** — load a song, run Demucs separation (cached per file), and route *actual* drums/bass/vocals/harmony to any visual parameter with gain, curve, and attack/release shaping. Without stems you still get a solid frequency-band approximation, and with no audio at all every style self-animates.
- **Beat-aware** — offline BPM detection per track with a phase-corrected beat grid feeding `beat`, `beatPhase`, `barPhase` features.

## Run it

```bash
npm install
npm run dev
```

The visuals window opens; the dashboard prints its URL (default `http://localhost:7777`). Drop an audio file on the visuals window or use **Load file…** in the dashboard.

Visuals window keys: `F` fullscreen · `D` perf stats · `B` blackout.

## Stem separation (one-time setup)

Requires [uv](https://docs.astral.sh/uv) (`brew install uv`), then:

```bash
./scripts/setup-python.sh   # ~3GB (PyTorch); model weights (~80MB) download on first use
```

Then load a track and hit **Separate stems** in the dashboard. ~30–90s per song on Apple Silicon; results are cached, and the song keeps playing in band-approximation mode until the stems hot-swap in.

## Reacting to Spotify / Apple Music (system audio)

macOS needs a loopback device:

1. Install [BlackHole 2ch](https://existential.audio/blackhole/) (`brew install blackhole-2ch`).
2. In **Audio MIDI Setup**, create a **Multi-Output Device** containing your speakers + BlackHole, and set it as the system output.
3. In the dashboard, set **Source → System / loopback** and pick **BlackHole 2ch** as the input.

Live instruments work the same way via **Mic / line-in**.

## Workspace layout

`packages/shared` — feature-frame + scene contracts · `apps/electron` — main process, audio engine, visuals renderer · `apps/dashboard` — web UI · `python/` — Demucs sidecar.
