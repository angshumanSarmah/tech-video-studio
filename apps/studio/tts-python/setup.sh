#!/usr/bin/env bash
# Sets up the Kokoro TTS env in this folder: Python 3.12 + pinned packages (uv.lock) in .venv,
# and the pinned model files in models/. Installs nothing global: uv's managed Python goes to
# .uv-python/ here. Safe to rerun. Run via `pnpm tts:setup`.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

if ! command -v uv >/dev/null 2>&1; then
  cat >&2 <<'MSG'
uv is not installed. Install it, then rerun `pnpm tts:setup`:
  brew install uv
or
  curl -LsSf https://astral.sh/uv/install.sh | sh
See https://docs.astral.sh/uv/getting-started/installation/
MSG
  exit 1
fi

export UV_PYTHON_INSTALL_DIR="$HERE/.uv-python"
export UV_PYTHON_PREFERENCE=only-managed

echo "==> Python env (uv sync --frozen)"
uv sync --frozen

echo "==> Model files (models.lock.json)"
uv run --frozen python fetch_models.py

echo "==> Done. Check it with: pnpm tts:doctor"
