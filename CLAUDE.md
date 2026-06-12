# Electric Dreams

Music-reactive VJ visuals app. Electron + TypeScript + three.js (WebGL2), web dashboard, Demucs stem separation.

## Architecture (read this first)

Four processes + sidecar:

- **Electron main** (`apps/electron/src/main/`) — the hub. SceneStore (single source of truth, zod-validated intents), Fastify+WS dashboard server on :7777, Demucs sidecar spawn (`uv run`), SHA-256 stem cache in userData, presets, `media://` protocol for local file streaming, MessageChannelMain plumbing.
- **Audio engine** — hidden BrowserWindow (`src/renderer/audio/`). Web Audio playback (single file or 4 sample-synced stems), per-stem AnalyserNodes, feature extraction (RMS/flux/onset/centroid/presence), offline BPM autocorrelation (`beat.ts`), FeatureBus publishes a `Float32Array(192)` (64-float FeatureFrame + 128-bin log spectrum) at display rate over a **direct MessagePort to the visuals window** (never through main).
- **Visuals** — chromeless BrowserWindow (`src/renderer/visuals/`). One rAF loop: routing evaluator (compiled struct-of-arrays) maps features→params, each layer style renders to its own half-float RT, compositor blends (normal/add/screen/multiply), filter chain ping-pongs, final pass to screen. Governor steps quality 0/1/2 down when mean frame time >15ms.
- **Dashboard** (`apps/dashboard/`) — React+zustand, built to dist/, served by Fastify, talks WS. Auto-generates controls from style manifests.
- **Sidecar** (`python/separate.py`) — demucs 4.0.1 (`pretrained.get_model` + `apply.apply_model`; `demucs.api` does NOT exist in 4.0.1). Writes float32 WAVs via soundfile (torchaudio save needs torchcodec — don't use it). JSON-lines progress on stdout.

**The FeatureFrame layout in `packages/shared/src/featureFrame.ts` is the contract everything depends on.** Stem mode, live-band approximation, and standalone fallback all fill the same indices; styles never branch on source.

## Conventions

- Style = `Style` interface (`engine/types.ts`) + `StyleManifest` with param specs; register in `engine/registry.ts`. Rule: **time drives motion, features drive modulation** — silent frame must still animate. No allocation in update/render paths.
- Feedback/sim styles must be frame-rate independent (display may run 120Hz ProMotion): scale injection by `dt*60`, decay by `pow(decay, dt*60)`. See trails.ts.
- Dashboard slider drags send `param/ephemeral` (forwarded straight to visuals, no store commit); commit on release.
- Dev/test hooks over WS: `debug/load {path}` loads an audio file without a dialog; `debug/capture {path}` PNGs the visuals window. `ED_CAPTURE=/path.png` env captures once at startup. Use these to verify visual changes.

## Commands

- `npm run dev` — build dashboard, then electron-vite dev (HMR).
- `npm run build` / `npm run typecheck` — all workspaces.
- `scripts/setup-python.sh` — one-time uv sync for Demucs (~3GB). Pinned Python 3.12 (torch has no 3.14 wheels).
- App startup can take 10–25s before the dashboard URL prints; don't assume a hang.
- Electron binary: if `npm install` leaves a broken `node_modules/electron/dist`, extract manually: `ditto -x -k ~/Library/Caches/electron/*/electron-*.zip node_modules/electron/dist/` and write `path.txt` containing `Electron.app/Contents/MacOS/Electron`.

## Status / roadmap

Done: file playback, band + true-stem analysis, BPM grid, 7 layer styles (tunnel, spectra, swarm, trails, smoke, shapes, video), 5 filters, layering+blend modes, routing matrix, presets, Demucs pipeline w/ cache + hot-swap, standalone mode, governor, perf HUD (`D`), keys: `F` fullscreen, `B` blackout.
Not yet verified by hand: live input (mic/BlackHole) — code path exists (`audio/setSource`), needs a human with devices/permissions. MIDI: feature-ID namespace reserved (`midi.*`), not implemented.
