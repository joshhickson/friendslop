// Names a game that lives in a GitHub repo, pinned to one commit:
//   gh:<user>/<repo>@<40 hex commit>/<path to the game folder>
// Used by the server (to check what a host asks for) and by the browser (to build file URLs).

const USER_RE = /^[A-Za-z0-9-]{1,39}$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const SEGMENT_RE = /^[a-z0-9_-]+$/;
const REF_RE = /^gh:([^/@\s]+)\/([^/@\s]+)@([^/\s]+)\/(.+)$/;

function validRepo(repo) {
  return REPO_RE.test(repo) && repo !== '.' && repo !== '..';
}

/** Parses a ref string. Returns { user, repo, commit, path } or null. */
export function parseRef(str) {
  if (typeof str !== 'string') return null;
  const m = REF_RE.exec(str);
  if (!m) return null;
  const [, user, repo, commit, path] = m;
  if (!USER_RE.test(user) || !validRepo(repo) || !COMMIT_RE.test(commit)) return null;
  if (!path.split('/').every((seg) => SEGMENT_RE.test(seg))) return null;
  return { user, repo, commit, path };
}

export function formatRef({ user, repo, commit, path }) {
  return `gh:${user}/${repo}@${commit}/${path}`;
}

function asRef(ref) {
  const parsed = typeof ref === 'string' ? parseRef(ref) : parseRef(formatRef(ref ?? {}));
  if (!parsed) throw new TypeError('not a valid game ref');
  return parsed;
}

/** The CDN folder holding the whole repo at that commit, ending in a slash. */
export function refBase(cdnBase, ref) {
  const { user, repo, commit } = asRef(ref);
  return `${cdnBase}${user}/${repo}@${commit}/`;
}

/** Lowercase `user/repo`, the key the blocklist uses. */
export function repoKey(ref) {
  const { user, repo } = asRef(ref);
  return `${user}/${repo}`.toLowerCase();
}

/**
 * Reads a link a maker pasted, such as https://github.com/a/b/tree/main/games/tag.
 * Returns { user, repo, rev, path } or { error: 'not_github' | 'no_game_path' }.
 * `path` starts at the first folder named games or templates, and everything between
 * `tree/` and there is the revision, so branch names with slashes survive.
 */
export function parseGithubUrl(url) {
  let u;
  try {
    u = new URL(String(url).trim());
  } catch {
    return { error: 'not_github' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'not_github' };
  if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') return { error: 'not_github' };

  let segments;
  try {
    segments = u.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  } catch {
    return { error: 'not_github' };
  }
  const [user, repo, kind, ...rest] = segments;
  if (user && (!USER_RE.test(user) || (repo && !validRepo(repo)))) return { error: 'not_github' };
  if (!user || !repo) return { error: 'no_game_path' };
  if (kind !== 'tree' && kind !== 'blob') return { error: 'no_game_path' };

  const at = rest.findIndex((seg) => seg === 'games' || seg === 'templates');
  if (at < 1) return { error: 'no_game_path' }; // no games folder, or no revision before it
  return { user, repo, rev: rest.slice(0, at).join('/'), path: rest.slice(at).join('/') };
}
