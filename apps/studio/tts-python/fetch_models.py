"""Downloads the Kokoro-82M weights and voices into ./models at a pinned revision.

Every file is checked against the sha256 in models.lock.json. Files already present with the
right checksum are skipped, so this is safe to rerun. The TTS server only ever loads these local
files (HF_HUB_OFFLINE=1); nothing is fetched at synthesis time.

Usage: uv run python fetch_models.py [--write-lock]
  --write-lock  record the sha256 of the downloaded files in models.lock.json (maintainers only,
                after changing the revision or the voice list).
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODELS_DIR = HERE / "models"
LOCK_PATH = HERE / "models.lock.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def download(repo_id: str, revision: str, filename: str) -> None:
    """Writes straight into ./models (no shared Hugging Face cache outside this folder)."""
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    from huggingface_hub import hf_hub_download

    hf_hub_download(repo_id=repo_id, filename=filename, revision=revision, local_dir=MODELS_DIR)


def main() -> int:
    write_lock = "--write-lock" in sys.argv[1:]
    lock = json.loads(LOCK_PATH.read_text())
    repo_id, revision, files = lock["repoId"], lock["revision"], lock["files"]
    problems: list[str] = []
    for filename, expected in files.items():
        target = MODELS_DIR / filename
        if target.exists() and expected and sha256(target) == expected:
            print(f"ok       {filename}")
            continue
        print(f"download {filename} @ {revision[:7]}")
        download(repo_id, revision, filename)
        actual = sha256(target)
        if write_lock:
            files[filename] = actual
        elif actual != expected:
            problems.append(f"{filename}: sha256 {actual} != expected {expected}")
    if write_lock:
        LOCK_PATH.write_text(json.dumps(lock, indent=2) + "\n")
        print(f"wrote {LOCK_PATH.name}")
    for problem in problems:
        print(f"CHECKSUM MISMATCH {problem}", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
