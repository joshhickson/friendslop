// Games from GitHub that Josh has played and signed off on. A game on this list plays without the
// "Nobody at friendslop has played this yet" banner. The one-time first-look warning still shows.
// Each entry is a repo (user/repo, any case) and the game's folder in it. Add one only on Josh's yes.

export const SIGNED_OFF = Object.freeze([
  // The Control Points demo behind the "Play the demo" button.
  Object.freeze({ repo: 'joshhickson/friendslop', path: 'games/cp' }),
]);

/**
 * True when the game a ref names is on SIGNED_OFF.
 * @param {{ user: string, repo: string, path: string } | null} ref  from parseRef
 */
export function isSignedOff(ref) {
  if (!ref) return false;
  const repo = `${ref.user}/${ref.repo}`.toLowerCase();
  return SIGNED_OFF.some((g) => g.repo.toLowerCase() === repo && g.path === ref.path);
}
