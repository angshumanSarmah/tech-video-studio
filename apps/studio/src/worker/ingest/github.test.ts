import { describe, expect, it } from 'vitest';
import { githubRawRequest } from './github.ts';

const map = (url: string) => githubRawRequest(new URL(url));

describe('githubRawRequest', () => {
  it('reads a repo root as its README through the API', () => {
    expect(map('https://github.com/example-org/tidewater.git?tab=readme#install')).toEqual({
      url: 'https://api.github.com/repos/example-org/tidewater/readme',
      headers: { accept: 'application/vnd.github.raw', 'x-github-api-version': '2022-11-28' },
      name: 'README.md',
    });
  });

  it('reads a tree URL as that directory’s README at the ref', () => {
    expect(map('https://github.com/example-org/tidewater/tree/v2.1/docs/design')?.url).toBe(
      'https://api.github.com/repos/example-org/tidewater/readme/docs/design?ref=v2.1',
    );
    expect(map('https://www.github.com/example-org/tidewater/tree/main')?.url).toBe(
      'https://api.github.com/repos/example-org/tidewater/readme?ref=main',
    );
  });

  it('reads blob and raw file URLs from raw.githubusercontent.com', () => {
    expect(map('https://github.com/example-org/tidewater/blob/main/docs/claiming.md')).toEqual({
      url: 'https://raw.githubusercontent.com/example-org/tidewater/main/docs/claiming.md',
      headers: {},
      name: 'claiming.md',
    });
    expect(map('https://github.com/example-org/tidewater/raw/main/notes%20v2.md')?.url).toBe(
      'https://raw.githubusercontent.com/example-org/tidewater/main/notes%20v2.md',
    );
  });

  it('passes raw URLs through', () => {
    const raw = 'https://raw.githubusercontent.com/example-org/tidewater/main/README.md';
    expect(map(raw)).toEqual({ url: raw, headers: {}, name: 'README.md' });
  });

  it('leaves other GitHub pages and other hosts to HTML extraction', () => {
    expect(map('https://github.com/example-org/tidewater/issues/12')).toBeNull();
    expect(map('https://github.com/example-org')).toBeNull();
    expect(map('https://gist.github.com/example-user/abc123')).toBeNull();
    expect(map('https://notes.example.com/github.com/a/b')).toBeNull();
  });
});
