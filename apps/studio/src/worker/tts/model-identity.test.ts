import { describe, expect, it } from 'vitest';
import { identityMismatches, parseUvLockVersions, voiceHash } from './model-identity.ts';

const identity = {
  packages: { kokoro: '0.9.4', misaki: '0.9.4' },
  revision: 'rev1',
  files: { 'kokoro-v1_0.pth': 'w1', 'voices/af_heart.pt': 'v1', 'voices/bm_george.pt': 'v2' },
};

describe('parseUvLockVersions', () => {
  it('reads the versions of the named packages only', () => {
    const lock = [
      '[[package]]\nname = "kokoro"\nversion = "0.9.4"\nsource = { registry = "x" }',
      '[[package]]\nname = "kokoro-extra"\nversion = "1.0.0"',
      '[[package]]\nname = "torch"\nversion = "2.15.0"',
    ].join('\n\n');
    expect(parseUvLockVersions(lock, ['kokoro', 'torch', 'misaki'])).toEqual({
      kokoro: '0.9.4',
      torch: '2.15.0',
    });
  });
});

describe('voiceHash', () => {
  it('returns the pinned hash of an installed voice', () => {
    expect(voiceHash(identity, 'bm_george')).toBe('v2');
  });

  it('lists the installed voices for an unknown one', () => {
    expect(() => voiceHash(identity, 'af_sky')).toThrow(
      /"af_sky" is not installed\. Installed voices: af_heart, bm_george/,
    );
  });
});

describe('identityMismatches', () => {
  it('is empty when the server reports the lock files', () => {
    expect(identityMismatches(identity, identity)).toEqual([]);
  });

  it('names each package, revision and file that differs', () => {
    const reported = {
      packages: { kokoro: '0.9.2' },
      revision: 'rev2',
      files: { ...identity.files, 'voices/af_heart.pt': 'other' },
    };
    expect(identityMismatches(identity, reported)).toEqual([
      'kokoro 0.9.2 (uv.lock: 0.9.4)',
      'misaki missing (uv.lock: 0.9.4)',
      'models.lock.json revision',
      'model file voices/af_heart.pt',
    ]);
  });
});
