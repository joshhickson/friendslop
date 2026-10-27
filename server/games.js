import { readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Finds every games/<id>/server.js and imports its default export (a defineGame() result).
 * A broken game is logged and skipped so it can't stop the others from loading.
 */
export async function loadGames(gamesDir, log) {
  const games = new Map();
  let entries = [];
  try {
    entries = await readdir(gamesDir, { withFileTypes: true });
  } catch {
    log.warn(`no games directory at ${gamesDir}`);
    return games;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const file = join(gamesDir, entry.name, 'server.js');
    try {
      await access(file);
    } catch {
      continue;
    }
    try {
      const mod = await import(pathToFileURL(file).href);
      const def = mod.default;
      if (!def?.id || typeof def.create !== 'function') throw new Error('server.js must `export default defineGame({...})`');
      if (def.id !== entry.name) throw new Error(`game id "${def.id}" must match its folder name "${entry.name}"`);
      try {
        await access(join(gamesDir, entry.name, 'client', 'index.js'));
      } catch {
        throw new Error('missing client/index.js');
      }
      games.set(def.id, def);
    } catch (err) {
      log.error(`failed to load game "${entry.name}":`, err.message);
    }
  }
  return games;
}
