"""Kokoro-82M TTS server: JSON lines over stdin/stdout, started once by the Node worker.

Protocol (one JSON object per line):
  startup  -> {"type": "ready", "info": {...}}  or  {"type": "fatal", "error": "..."} then exit 1
  request  <- {"id": 1, "op": "synthesize", "text": "...", "voice": "af_heart", "speed": 1.0,
               "outPath": "/abs/file.wav"}
  response -> {"id": 1, "ok": true, "result": {"tokens": [...], "durationSec": ..., ...}}
           -> {"id": 1, "ok": false, "error": "..."}
  request  <- {"id": 2, "op": "ping"}   response -> {"id": 2, "ok": true, "result": {}}
Stdin EOF ends the process.

Each token is {"text", "whitespace", "phonemes", "startSec", "endSec"} as Kokoro's English
pipeline reports it (misaki tokens, timestamps from the duration predictor), with times offset
onto the whole WAV when Kokoro splits the text into several chunks. Times are null for tokens
Kokoro did not time. Mapping tokens back to narration words happens in Node.

Only local files are loaded (./models, pinned by models.lock.json); the Hugging Face hub is
forced offline.
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Any

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

# Protocol channel: a private copy of stdout. fd 1 then points at stderr, so prints from Python
# or C libraries can never corrupt the protocol stream.
PROTOCOL = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr

import warnings  # noqa: E402

warnings.filterwarnings("ignore")

HERE = Path(__file__).resolve().parent
MODELS = HERE / "models"
LOCK_PATH = HERE / "models.lock.json"
SAMPLE_RATE = 24_000
# Kokoro picks the G2P from the voice id's first letter.
ENGLISH_LANGS = {"a": "American English", "b": "British English"}
REPORTED_PACKAGES = ("kokoro", "misaki", "torch", "espeakng-loader", "spacy")


def send(message: dict[str, Any]) -> None:
    PROTOCOL.write(json.dumps(message) + "\n")
    PROTOCOL.flush()


class Engine:
    def __init__(self) -> None:
        from kokoro import KModel

        self.lock = json.loads(LOCK_PATH.read_text())
        self.model = (
            KModel(
                repo_id=self.lock["repoId"],
                config=str(MODELS / "config.json"),
                model=str(MODELS / "kokoro-v1_0.pth"),
            )
            .to("cpu")
            .eval()
        )
        self.pipelines: dict[str, Any] = {}
        self.pipeline("a")  # load G2P and check the espeak-ng fallback before reporting ready

    def pipeline(self, lang: str) -> Any:
        if lang not in self.pipelines:
            from kokoro import KPipeline

            pipeline = KPipeline(lang_code=lang, repo_id=self.lock["repoId"], model=self.model)
            # KPipeline swallows a failed espeak-ng load and then silently drops every word
            # missing from misaki's dictionary. Refuse to run like that.
            if getattr(pipeline.g2p, "fallback", None) is None:
                raise RuntimeError(
                    "espeak-ng fallback failed to load: words missing from the G2P dictionary "
                    "would be dropped. Run `pnpm tts:doctor`."
                )
            self.pipelines[lang] = pipeline
        return self.pipelines[lang]

    def info(self) -> dict[str, Any]:
        from importlib.metadata import version

        import espeakng_loader

        return {
            "python": sys.version.split()[0],
            "packages": {name: version(name) for name in REPORTED_PACKAGES},
            "repoId": self.lock["repoId"],
            "revision": self.lock["revision"],
            "files": self.lock["files"],
            "espeakLibrary": espeakng_loader.get_library_path(),
            "sampleRate": SAMPLE_RATE,
            "device": "cpu",
        }

    def synthesize(self, text: str, voice: str, speed: float, out_path: str) -> dict[str, Any]:
        import numpy as np
        import soundfile as sf

        lang = voice[:1]
        if lang not in ENGLISH_LANGS:
            raise ValueError(f"Voice {voice!r} is not English (a*/b*); word timestamps need one.")
        voice_file = MODELS / "voices" / f"{voice}.pt"
        if not voice_file.exists():
            raise ValueError(
                f"Voice {voice!r} is not downloaded: add voices/{voice}.pt to models.lock.json "
                "and run `pnpm tts:setup`."
            )
        started = time.perf_counter()
        chunks: list[Any] = []
        tokens: list[dict[str, Any]] = []
        offset = 0.0
        for result in self.pipeline(lang)(text, voice=str(voice_file), speed=speed):
            if result.audio is None:
                continue
            samples = result.audio.detach().cpu().numpy()
            tokens.extend(token_json(token, offset) for token in result.tokens or [])
            chunks.append(samples)
            offset += len(samples) / SAMPLE_RATE
        if not chunks:
            raise ValueError("Kokoro produced no audio for this text.")
        sf.write(out_path, np.concatenate(chunks), SAMPLE_RATE, subtype="PCM_16", format="WAV")
        return {
            "tokens": tokens,
            "durationSec": offset,
            "sampleRate": SAMPLE_RATE,
            "synthSec": time.perf_counter() - started,
        }


def token_json(token: Any, offset: float) -> dict[str, Any]:
    def shifted(value: float | None) -> float | None:
        return None if value is None else round(offset + float(value), 4)

    return {
        "text": token.text,
        "whitespace": token.whitespace or "",
        "phonemes": token.phonemes or "",
        "startSec": shifted(token.start_ts),
        "endSec": shifted(token.end_ts),
    }


def handle(engine: Engine, request: dict[str, Any]) -> dict[str, Any]:
    op = request.get("op")
    if op == "ping":
        return {}
    if op == "synthesize":
        return engine.synthesize(
            str(request["text"]),
            str(request["voice"]),
            float(request["speed"]),
            str(request["outPath"]),
        )
    raise ValueError(f"Unknown op {op!r}.")


def serve(engine: Engine) -> None:
    for line in sys.stdin:
        if not line.strip():
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            send({"id": request_id, "ok": True, "result": handle(engine, request)})
        except Exception as error:  # report every failure on the protocol, keep serving
            traceback.print_exc(file=sys.stderr)
            send({"id": request_id, "ok": False, "error": f"{type(error).__name__}: {error}"})


def main() -> int:
    try:
        engine = Engine()
        send({"type": "ready", "info": engine.info()})
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        send({"type": "fatal", "error": f"{type(error).__name__}: {error}"})
        return 1
    serve(engine)
    return 0


if __name__ == "__main__":
    sys.exit(main())
