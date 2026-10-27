// Repos that must not be played on this server. File format: { "repos": ["user/repo", ...] }.

import { readFileSync } from 'node:fs';

/** Returns a Set of lowercase `user/repo` keys. A missing file blocks nothing; a broken one throws. */
export function loadBlocklist(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return new Set();
    throw new Error(`could not read blocklist ${path}: ${err.message}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`blocklist ${path} is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(data?.repos)) throw new Error(`blocklist ${path} needs a "repos" list`);
  return new Set(data.repos.filter((r) => typeof r === 'string').map((r) => r.trim().toLowerCase()).filter(Boolean));
}
