"""Demucs stem-separation wrapper.

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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--model", default="htdemucs")
    args = parser.parse_args()

    emit({"type": "status", "message": "Loading model (first run downloads weights)…"})

    import torch
    from demucs.api import Separator, save_audio

    if torch.backends.mps.is_available():
        device = "mps"
    elif torch.cuda.is_available():
        device = "cuda"
    else:
        device = "cpu"

    def progress(data):
        # demucs api callback: segment_offset/audio_length per model in the bag
        try:
            total = data.get("audio_length") or 0
            offset = data.get("segment_offset") or 0
            models = data.get("models") or 1
            model_idx = data.get("model_idx_in_bag") or 0
            if total > 0:
                frac = (model_idx + min(1.0, offset / total)) / models
                emit({"type": "progress", "value": round(min(0.99, frac), 4)})
        except Exception:
            pass

    def run(dev):
        sep = Separator(model=args.model, device=dev, callback=progress, callback_arg={})
        return sep, sep.separate_audio_file(Path(args.input))

    try:
        try:
            sep, (_, stems) = run(device)
        except Exception:
            if device != "cpu":
                emit({"type": "status", "message": f"{device} failed, retrying on CPU…"})
                sep, (_, stems) = run("cpu")
            else:
                raise

        out_dir = Path(args.out)
        out_dir.mkdir(parents=True, exist_ok=True)
        paths = {}
        for name, tensor in stems.items():
            p = out_dir / f"{name}.wav"
            save_audio(tensor, str(p), samplerate=sep.samplerate)
            paths[name] = str(p.resolve())
        emit({"type": "done", "stems": paths})
    except Exception as e:
        emit({"type": "error", "message": f"{e.__class__.__name__}: {e}"})
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
