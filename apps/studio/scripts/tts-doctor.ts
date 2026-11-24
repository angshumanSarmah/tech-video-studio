/**
 * `pnpm tts:doctor`: checks the Kokoro TTS env end to end and prints how to fix what fails.
 * uv, the pinned Python and packages, model checksums, the espeak-ng fallback, a test synthesis
 * whose words must all be spoken and timed, and the real-time factor on CPU. Synthesises into a
 * temporary data dir, so it never touches the real cache. Exit code 1 on any failure.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { narrationWords } from '@explainer-studio/shared';
import { loadConfig, type AppConfig } from '#core/config.ts';
import { createKokoroTts, kokoroPaths, type KokoroPaths } from '#worker/tts/kokoro.ts';
import { ModelsLockSchema } from '#worker/tts/model-identity.ts';
import { wordTimingProblems } from '#worker/tts/word-checks.ts';

const run = promisify(execFile);

/** Out-of-dictionary word (needs espeak-ng), a dictionary word and a number. */
const TEST_TEXT = 'Zorblaxian clients hit Redis until the limiter answers 429.';
/** ~10 s of narration for the real-time factor, measured warm (after TEST_TEXT). */
const RTF_TEXT =
  'A token bucket refills at a steady rate. Each request spends one token, and when the ' +
  'bucket is empty the request waits or fails, so a burst cannot flood the servers behind it.';
const OOV_WORD = 'Zorblaxian';

type CheckResult = { ok: true; detail: string } | { ok: false; detail: string; fix: string };
const pass = (detail: string): CheckResult => ({ ok: true, detail });
const fail = (detail: string, fix: string): CheckResult => ({ ok: false, detail, fix });

const SETUP_FIX = 'Run `pnpm tts:setup`.';
const UV_FIX =
  'Install uv: `brew install uv` (or see https://docs.astral.sh/uv/), then `pnpm tts:setup`.';

function uvEnv(paths: KokoroPaths): NodeJS.ProcessEnv {
  return {
    ...process.env,
    UV_PYTHON_INSTALL_DIR: join(paths.dir, '.uv-python'),
    UV_PYTHON_PREFERENCE: 'only-managed',
  };
}

async function checkUv(): Promise<CheckResult> {
  try {
    const { stdout } = await run('uv', ['--version']);
    return pass(stdout.trim());
  } catch {
    return fail('uv is not installed', UV_FIX);
  }
}

async function checkPython(paths: KokoroPaths, root: string): Promise<CheckResult> {
  if (!existsSync(paths.python)) return fail(`no interpreter at ${paths.python}`, SETUP_FIX);
  const { stdout } = await run(paths.python, ['-c', 'import sys; print(sys.version.split()[0])']);
  const version = stdout.trim();
  const where = relative(root, paths.python);
  return version.startsWith('3.12.')
    ? pass(`Python ${version} (${where})`)
    : fail(`Python ${version} at ${where}; kokoro needs 3.12`, SETUP_FIX);
}

async function checkEnvLocked(paths: KokoroPaths): Promise<CheckResult> {
  try {
    await run('uv', ['sync', '--locked', '--check'], { cwd: paths.dir, env: uvEnv(paths) });
    return pass('packages match uv.lock');
  } catch (error) {
    const output = (error as { stderr?: string }).stderr?.trim() ?? String(error);
    return fail(`packages differ from uv.lock:\n${output}`, SETUP_FIX);
  }
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

async function checkModelFiles(paths: KokoroPaths): Promise<CheckResult> {
  const lock = ModelsLockSchema.parse(JSON.parse(readFileSync(paths.modelsLock, 'utf8')));
  const bad: string[] = [];
  for (const [file, expected] of Object.entries(lock.files)) {
    const path = join(paths.dir, 'models', file);
    if (!existsSync(path)) bad.push(`${file} missing`);
    else if ((await sha256File(path)) !== expected) bad.push(`${file} checksum differs`);
  }
  const count = Object.keys(lock.files).length;
  return bad.length
    ? fail(bad.join('; '), SETUP_FIX)
    : pass(`${count} model files match models.lock.json @ ${lock.revision.slice(0, 7)}`);
}

/** Loads espeak-ng exactly as misaki does and reads a word missing from its dictionary. */
const ESPEAK_PROBE = `
import espeakng_loader
from phonemizer.backend.espeak.wrapper import EspeakWrapper
EspeakWrapper.set_library(espeakng_loader.get_library_path())
EspeakWrapper.set_data_path(espeakng_loader.get_data_path())
from phonemizer.backend import EspeakBackend
backend = EspeakBackend("en-us", preserve_punctuation=True, with_stress=True)
print(".".join(map(str, backend.version())))
print(espeakng_loader.get_library_path())
print(backend.phonemize(["${OOV_WORD}"])[0].strip())
`;

async function checkEspeak(paths: KokoroPaths, root: string): Promise<CheckResult> {
  const fix =
    'espeak-ng comes from the pinned espeakng-loader wheel; run `pnpm tts:setup`. If it still ' +
    'fails to load, check the library path above (macOS may block an unsigned dylib).';
  try {
    const { stdout } = await run(paths.python, ['-c', ESPEAK_PROBE], { cwd: paths.dir });
    const [version, library = '', phonemes] = stdout.trim().split('\n');
    if (!phonemes) return fail(`espeak-ng ${version} read "${OOV_WORD}" as nothing`, fix);
    return pass(
      `espeak-ng ${version} (bundled: ${relative(root, library)}): "${OOV_WORD}" -> ${phonemes}`,
    );
  } catch (error) {
    return fail(`espeak-ng failed to load: ${(error as Error).message.split('\n')[0]}`, fix);
  }
}

interface SynthesisChecks {
  readonly startup: CheckResult;
  readonly words: CheckResult;
  readonly realTime: CheckResult;
}

async function checkSynthesis(config: AppConfig): Promise<SynthesisChecks> {
  const dataDir = mkdtempSync(join(tmpdir(), 'tts-doctor-'));
  const tts = createKokoroTts({
    workspaceRoot: config.workspaceRoot,
    dataDir,
    python: config.tts.binaryPath,
  });
  const { voice, speed } = config.tts;
  try {
    const started = performance.now();
    const info = await tts.client.info();
    const startup = pass(
      `server ready in ${((performance.now() - started) / 1000).toFixed(1)} s ` +
        `(kokoro ${info.packages.kokoro}, torch ${info.packages.torch}, ${info.device})`,
    );
    const test = await tts.provider.synthesize(TEST_TEXT, voice, speed);
    const problems = wordTimingProblems(TEST_TEXT, test.words, test.durationSec);
    const expected = narrationWords(TEST_TEXT).length;
    const words = problems.length
      ? fail(problems.join('; '), 'See the problems above.')
      : pass(
          `test synthesis: ${expected}/${expected} words spoken and timed, monotonic (${voice}, speed ${speed})`,
        );
    const warm = performance.now();
    const long = await tts.provider.synthesize(RTF_TEXT, voice, speed);
    const synthSec = (performance.now() - warm) / 1000;
    const realTime = pass(
      `real-time factor ${(long.durationSec / synthSec).toFixed(1)}x on CPU ` +
        `(${long.durationSec.toFixed(1)} s of audio in ${synthSec.toFixed(2)} s)`,
    );
    return { startup, words, realTime };
  } catch (error) {
    const failed = fail((error as Error).message, 'Fix the error above, then rerun.');
    return { startup: failed, words: failed, realTime: failed };
  } finally {
    await tts.provider.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

function report(label: string, result: CheckResult): boolean {
  const mark = result.ok ? '✓' : '✗';
  console.log(`  ${mark} ${label.padEnd(10)} ${result.detail}`);
  if (!result.ok) console.log(`    -> ${result.fix}`);
  return result.ok;
}

async function main(): Promise<number> {
  const config = loadConfig();
  const root = config.workspaceRoot;
  const paths = kokoroPaths(root, config.tts.binaryPath);
  console.log('TTS doctor (Kokoro-82M)');
  const results: boolean[] = [report('uv', await checkUv())];
  const python = await checkPython(paths, root);
  results.push(report('python', python));
  if (!python.ok) return 1;
  results.push(report('packages', await checkEnvLocked(paths)));
  results.push(report('models', await checkModelFiles(paths)));
  results.push(report('espeak-ng', await checkEspeak(paths, root)));
  if (results.includes(false)) return 1;
  const synthesis = await checkSynthesis(config);
  if (!report('server', synthesis.startup)) return 1;
  const words = report('words', synthesis.words);
  const speed = words && report('speed', synthesis.realTime);
  return words && speed ? 0 : 1;
}

process.exitCode = await main();
