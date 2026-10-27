// What the host form needs from outside friendslop: the commit a pasted link stands for, and what
// a game says about itself. No other part of the page talks to GitHub.
//
// This file imports only by relative path, so the resolver can be tested in Node.

import { COPY } from '../../shared/copy.js';

const COMMIT_RE = /^[0-9a-f]{40}$/;
const GITHUB_MS = 10_000;
const INSPECT_MS = 15_000;

/**
 * Finds the commit a pasted link points at. A 40-hex revision is the commit already and costs no
 * request. Otherwise GitHub names the commit of the branch or tag.
 * @param {{ user: string, repo: string, rev: string }} link  from parseGithubUrl
 * @param {{ api: string, fetch?: typeof fetch }} opts       api is hello.remote.githubApi
 * @returns {Promise<{ commit: string } | { error: 'not_found' | 'rate_limited' | 'network' | 'timeout' }>}
 */
export async function resolveCommit({ user, repo, rev }, { api, fetch = globalThis.fetch } = {}) {
  if (COMMIT_RE.test(rev)) return { commit: rev };
  const url = `${api}/repos/${user}/${repo}/commits/${encodeURIComponent(rev)}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github.sha' },
      signal: AbortSignal.timeout(GITHUB_MS),
    });
    if (res.status === 404 || res.status === 422) return { error: 'not_found' };
    if (res.status === 403 || res.status === 429) return { error: 'rate_limited' };
    if (!res.ok) return { error: 'network' };
    const commit = (await res.text()).trim();
    return COMMIT_RE.test(commit) ? { commit } : { error: 'network' };
  } catch (err) {
    return { error: err?.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
}

/**
 * Runs the game's server.js in a hidden inspect frame and reads what it says about itself (the
 * description a room is made from). Gives up after 15 s.
 * @param {string} src                      the game's gh: ref
 * @param {object} o
 * @param {HTMLElement} o.container         where the hidden frame goes
 * @param {import('./net.js').Net} o.net    the frame host reads its clock
 * @param {object} o.store                  client/js/state.js's store
 * @param {AbortSignal} [o.signal]          abort to tear the frame down (the screen went away)
 * @param {number} [o.timeoutMs]
 * @returns {Promise<{ meta: object, kitVersion: number | null } | { error: string }>}  error is player-facing text
 */
export async function inspectGame(src, { container, net, store, signal, timeoutMs = INSPECT_MS }) {
  if (signal?.aborted) return { error: COPY.badLink('timeout') };
  const { mountGameFrame } = await import('./frame-host.js');
  return new Promise((resolve) => {
    let frame = null;
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      frame?.destroy();
      resolve(result);
    };
    const onAbort = () => finish({ error: COPY.badLink('timeout') });
    const timer = setTimeout(() => finish({ error: COPY.badLink('timeout') }), timeoutMs);
    signal?.addEventListener('abort', onAbort);
    try {
      frame = mountGameFrame({
        net,
        store,
        role: 'inspect',
        src,
        container,
        title: COPY.inspectTitle,
        overlay: {
          onMeta: (meta, kitVersion) => finish({ meta, kitVersion }),
          onError: (text) => {
            // The frame's own words can carry raw module addresses: they go to the console for the
            // maker, and the form shows a plain sentence. A fork that is too old keeps its own advice.
            console.warn('game check failed:', text);
            finish({ error: text === COPY.forkTooOld ? text : COPY.hostLoadFailed });
          },
        },
      });
    } catch (err) {
      // finish() clears the timer and the abort listener, so nothing is left running.
      console.error('could not start the game check', err);
      return finish({ error: COPY.hostLoadFailed });
    }
    // The frame may have failed while it was being mounted.
    if (done) frame.destroy();
  });
}
