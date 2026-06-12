"""Demucs stem-separation wrapper (targets demucs 4.0.1, the last PyPI release).

Reads one audio file, writes {drums,bass,vocals,other}.wav into --out.
Emits newline-delimited JSON progress on stdout:
  {"type":"status","message":"..."}
  {"type":"progress","value":0.42}
  {"type":"done","stems":{"drums":"/abs/drums.wav",...}}
  {"type":"error","message":"..."}
"""

import argparse
import json
import sys
import traceback
from pathlib import Path


def emit(obj):
    print(json.dumps(obj), flush=True)


def hook_progress():
    """demucs.apply uses tqdm when progress=True; subclass it to emit JSON."""
    try:
        import demucs.apply as da

        orig = da.tqdm.tqdm

        class JsonTqdm(orig):
            def update(self, n=1):
                super().update(n)
                try:
                    if self.total:
                        emit({"type": "progress", "value": round(min(0.99, self.n / self.total), 4)})
                except Exception:
                    pass

        da.tqdm.tqdm = JsonTqdm
    except Exception:
        pass  # no granular progress, separation still works


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--model", default="htdemucs")
    args = parser.parse_args()

    emit({"type": "status", "message": "Loading model (first run downloads weights)…"})

    import soundfile as sf
    import torch
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    from demucs.audio import AudioFile

    if torch.backends.mps.is_available():
        device = "mps"
    elif torch.cuda.is_available():
        device = "cuda"
    else:
        device = "cpu"

    hook_progress()

    try:
        model = get_model(args.model)
        model.eval()

        wav = AudioFile(Path(args.input)).read(
            streams=0, samplerate=model.samplerate, channels=model.audio_channels
        )
        ref = wav.mean(0)
        wav_norm = (wav - ref.mean()) / (ref.std() + 1e-8)

        emit({"type": "status", "message": f"Separating on {device}…"})

        def run(dev):
            return apply_model(
                model, wav_norm[None], device=dev, split=True, overlap=0.25, progress=True
            )[0]

        try:
            sources = run(device)
        except Exception:
            if device != "cpu":
                emit({"type": "status", "message": f"{device} failed, retrying on CPU…"})
                sources = run("cpu")
            else:
                raise

        sources = sources * (ref.std() + 1e-8) + ref.mean()

        out_dir = Path(args.out)
        out_dir.mkdir(parents=True, exist_ok=True)
        paths = {}
        for name, src in zip(model.sources, sources):
            p = out_dir / f"{name}.wav"
            # (channels, time) -> (time, channels); float32 WAV needs no clip handling
            sf.write(str(p), src.cpu().numpy().T, model.samplerate, subtype="FLOAT")
            paths[name] = str(p.resolve())
        emit({"type": "done", "stems": paths})
    except Exception as e:
        emit({"type": "error", "message": f"{e.__class__.__name__}: {e}"})
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
