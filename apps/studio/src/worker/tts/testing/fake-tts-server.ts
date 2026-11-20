/**
 * A stand-in for `kokoro_server.py` in tests: same JSON-lines protocol, no Python. Run with
 * `node` (type stripping). Behaviour comes from env:
 *   FAKE_TTS_MODE   ok | crash-once | crash-always | hang | fatal | garbage
 *   FAKE_TTS_STATE  a directory: `starts` gets one line per start, `crashed` marks crash-once
 *   FAKE_TTS_INFO   JSON merged into the ready info
 * Per request: the text "server-error" gets an ok:false response; a word "drop" is not spoken
 * (empty phonemes, no times), as Kokoro does for a word it cannot read.
 */
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const mode = process.env.FAKE_TTS_MODE ?? 'ok';
const state = process.env.FAKE_TTS_STATE ?? '';
const WORD_SEC = 0.3;
const SAMPLE_RATE = 24000;
/** Like the real server, which rounds token times to 0.1 ms. */
const round = (sec: number) => Math.round(sec * 1e4) / 1e4;

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function synthesize(text: string, outPath: string) {
  const tokens = text.split(' ').map((word, i) => {
    const dropped = word === 'drop';
    return {
      text: word,
      whitespace: ' ',
      phonemes: dropped ? '' : 'x',
      startSec: dropped ? null : round(i * WORD_SEC),
      endSec: dropped ? null : round(i * WORD_SEC + 0.25),
    };
  });
  const durationSec = tokens.length * WORD_SEC;
  writeFileSync(outPath, toneWav(durationSec));
  return { tokens, durationSec, sampleRate: SAMPLE_RATE, synthSec: 0.01 };
}

/** 16-bit mono PCM: a steady tone with no silences, so trimming to speech changes nothing. */
function toneWav(durationSec: number): Buffer {
  const samples = Math.round(durationSec * SAMPLE_RATE);
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    wav.writeInt16LE(
      Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE)),
      44 + i * 2,
    );
  }
  return wav;
}

function crash(): never {
  process.stderr.write('fake engine: boom\n');
  process.exit(3);
}

function handle(line: string): void {
  const request = JSON.parse(line) as { id: number; op: string; text?: string; outPath?: string };
  if (mode === 'hang') return;
  if (mode === 'garbage') return void process.stdout.write('not json\n');
  if (mode === 'crash-always') crash();
  if (mode === 'crash-once' && !existsSync(join(state, 'crashed'))) {
    writeFileSync(join(state, 'crashed'), '');
    crash();
  }
  if (request.op === 'ping') return send({ id: request.id, ok: true, result: {} });
  if (request.text === 'server-error') {
    return send({ id: request.id, ok: false, error: 'ValueError: bad request' });
  }
  send({ id: request.id, ok: true, result: synthesize(request.text ?? '', request.outPath ?? '') });
}

if (state) appendFileSync(join(state, 'starts'), 'start\n');
if (mode === 'fatal') {
  process.stderr.write('fake engine: cannot load espeak-ng\n');
  send({ type: 'fatal', error: 'RuntimeError: espeak-ng fallback failed to load' });
  process.exit(1);
}
const info = {
  python: '3.12.0',
  packages: {},
  revision: 'fake',
  files: {},
  espeakLibrary: '/fake/libespeak-ng.dylib',
  sampleRate: 24000,
  device: 'cpu',
  ...(JSON.parse(process.env.FAKE_TTS_INFO ?? '{}') as object),
};
send({ type: 'ready', info });
createInterface({ input: process.stdin }).on('line', handle);
