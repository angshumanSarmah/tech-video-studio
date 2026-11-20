/**
 * GitHub repo and file URLs are read as raw markdown instead of the rendered HTML page:
 * - `github.com/<o>/<r>`: the repo's README, through the API (any README file name);
 * - `github.com/<o>/<r>/tree/<ref>[/<dir>]`: that directory's README at `<ref>`;
 * - `github.com/<o>/<r>/blob|raw/<ref>/<path>`: the file from raw.githubusercontent.com;
 * - `raw.githubusercontent.com/...`: as given.
 * Other GitHub pages (issues, pull requests, wikis, gists) are ordinary HTML pages.
 *
 * In `tree` URLs the ref is taken to be the first segment after `tree` (a branch name with a `/`
 * is read as branch + directory).
 */

export interface SourceRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  /** A file name for format detection when the content type does not decide it. */
  readonly name: string;
}

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);
const RAW_HOST = 'raw.githubusercontent.com';
const API_HEADERS = {
  accept: 'application/vnd.github.raw',
  'x-github-api-version': '2022-11-28',
} as const;

/** The raw request for a GitHub repo or file URL; null for every other URL. */
export function githubRawRequest(url: URL): SourceRequest | null {
  if (url.hostname === RAW_HOST) {
    return { url: url.href, headers: {}, name: lastSegment(url.pathname) };
  }
  if (!GITHUB_HOSTS.has(url.hostname)) return null;
  const [owner, rawRepo, kind, ...rest] = url.pathname.split('/').filter(Boolean).map(decode);
  if (!owner || !rawRepo) return null;
  const repo = rawRepo.replace(/\.git$/, '');
  const repoPath = `${encode(owner)}/${encode(repo)}`;

  if (kind === undefined) return readmeRequest(repoPath, [], null);
  if (kind === 'tree' && rest.length > 0) return readmeRequest(repoPath, rest.slice(1), rest[0]!);
  if ((kind === 'blob' || kind === 'raw') && rest.length >= 2) {
    return {
      url: `https://${RAW_HOST}/${repoPath}/${rest.map(encode).join('/')}`,
      headers: {},
      name: rest.at(-1)!,
    };
  }
  return null;
}

function readmeRequest(
  repoPath: string,
  dir: readonly string[],
  ref: string | null,
): SourceRequest {
  const dirPath = dir.length > 0 ? `/${dir.map(encode).join('/')}` : '';
  const query = ref === null ? '' : `?ref=${encodeURIComponent(ref)}`;
  return {
    url: `https://api.github.com/repos/${repoPath}/readme${dirPath}${query}`,
    headers: API_HEADERS,
    name: 'README.md',
  };
}

function lastSegment(pathname: string): string {
  return decode(pathname.split('/').filter(Boolean).at(-1) ?? '');
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function encode(segment: string): string {
  return encodeURIComponent(segment);
}
