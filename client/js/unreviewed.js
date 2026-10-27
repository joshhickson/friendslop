// What players see around a game from GitHub that nobody at friendslop has reviewed: the banner
// across the top of the match screen, and the one-time "first look" screen before it loads.

import { h } from './dom.js';
import { COPY } from '/shared/copy.js';

const FIRST_LOOK_PREFIX = 'fs.firstLook.';
// The banner's last words are its Report link (COPY.unreviewedBanner ends "Report it").
const REPORT_TAIL = /report it\.?\s*$/i;
const MAKER_MARK = '\u0001';
const REPO_MARK = '\u0002';

function accepted(key) {
  try {
    return localStorage.getItem(FIRST_LOOK_PREFIX + key) === '1';
  } catch {
    return false;
  }
}

function remember(key) {
  try {
    localStorage.setItem(FIRST_LOOK_PREFIX + key, '1');
  } catch {
    // No storage (private mode, blocked): they will be asked again next time.
  }
}

/**
 * Shows COPY.firstLook once per repo key (repoKey(ref), lowercase user/repo). Resolves true at
 * once if this browser already said yes to that repo, and remembers a new yes. Resolves false on
 * a no, or when `signal` aborts (the screen that asked went away). The caller decides what a no
 * means.
 * @param {string} repo
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<boolean>}
 */
export function confirmFirstLook(repo, { signal } = {}) {
  if (accepted(repo)) return Promise.resolve(true);
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    let box = null;
    const done = (yes) => {
      signal?.removeEventListener('abort', onAbort);
      box.remove();
      if (yes) remember(repo);
      resolve(yes);
    };
    const onAbort = () => done(false);
    const play = h('button.btn.primary', { onclick: () => done(true) }, COPY.firstLookPlay);
    box = h('div.first-look', h('div.panel.modal.stack',
      h('p', COPY.firstLook),
      h('div.row.wrap', play, h('div.grow'), h('button.btn', { onclick: () => done(false) }, COPY.leaveTheRoom))));
    signal?.addEventListener('abort', onAbort);
    document.body.append(box);
    play.focus();
  });
}

/** The link to a game folder on GitHub at its pinned commit. */
function treeUrl(repo, commit, path) {
  return commit && path ? `https://github.com/${repo}/tree/${commit}/${path}` : `https://github.com/${repo}`;
}

/** The prefilled GitHub issue link, or null when there is no usable report address. */
function reportLink(reportUrl, title, body) {
  if (!reportUrl) return null;
  let url;
  try {
    url = new URL(reportUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  url.searchParams.set('title', title);
  url.searchParams.set('body', body);
  return url.href;
}

/**
 * The strip across the top of an unreviewed game: COPY.unreviewedBanner with the repo as a link
 * to GitHub and its "Report it" as a link to a prefilled GitHub issue, then COPY.hostCanCheat.
 * Every link opens in a new tab.
 * @param {{ repo: string, maker: string, reportUrl: string, commit?: string, path?: string }} p
 *   repo is `user/repo` as GitHub spells it; commit and path name the game's folder
 */
export function unreviewedBanner({ repo, maker, reportUrl, commit = '', path = '' }) {
  const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
  const report = reportLink(reportUrl, `Report: ${repo}@${commit.slice(0, 7)}`, `${treeUrl(repo, commit, path)}\n\n`);

  // Build the sentence from the copy with markers, so Josh can move the maker and repo around.
  let text = COPY.unreviewedBanner(MAKER_MARK, REPO_MARK);
  let tail = null;
  const m = REPORT_TAIL.exec(text);
  if (m) {
    // With nowhere to report to, the "Report it" ending is dropped rather than left dead.
    if (report) tail = link(report, m[0].trim());
    text = text.slice(0, m.index);
  }
  const parts = [];
  for (const piece of text.split(/([\u0001\u0002])/)) {
    if (piece === MAKER_MARK) parts.push(maker);
    else if (piece === REPO_MARK) parts.push(link(`https://github.com/${repo}`, repo));
    else if (piece) parts.push(piece);
  }
  // If a rewrite drops the "Report it" ending, the report link still has to be there.
  if (!tail && report) tail = link(report, COPY.reportGame);
  return h('div.unreviewed', h('div.unreviewed-main', parts, tail), h('div.unreviewed-sub', COPY.hostCanCheat));
}
