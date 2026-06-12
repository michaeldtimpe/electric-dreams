#!/usr/bin/env bash
# One-time setup for the Demucs stem-separation sidecar (~3GB incl. torch).
set -euo pipefail
cd "$(dirname "$0")/../python"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is not installed. Install it first:"
  echo "  curl -LsSf https://astral.sh/uv/install.sh | sh"
  echo "or: brew install uv"
  exit 1
fi

echo "Syncing Python 3.12 environment with demucs + torch (this downloads ~3GB)…"
uv sync
echo
echo "Done. Model weights (~80MB) download automatically on the first separation."
