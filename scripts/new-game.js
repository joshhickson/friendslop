#!/usr/bin/env node
// Scaffold a new game from the starter template:  npm run new-game -- my-game "My Game"

import { cp, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [id, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(' ') || id?.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

if (!id || !/^[a-z][a-z0-9-]{0,31}$/.test(id)) {
  console.error('Usage: npm run new-game -- <id> ["Display Name"]');
  console.error('  <id> must be lowercase letters, digits and dashes, e.g. "tag" or "bomb-pass".');
  process.exit(1);
}

const dest = join(ROOT, 'games', id);
if (existsSync(dest)) {
  console.error(`games/${id} already exists.`);
  process.exit(1);
}

await cp(join(ROOT, 'templates', 'starter'), dest, { recursive: true });

async function rewrite(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await rewrite(p);
    else if (entry.name.endsWith('.js')) {
      const src = await readFile(p, 'utf8');
      await writeFile(p, src
        .replace(/id: 'starter'/g, `id: '${id}'`)
        .replace(/name: 'Starter'/g, `name: '${name.replace(/'/g, "\\'")}'`)
        .replace(/^\/\/ Starter\b/m, `// ${name}`)
        .replace(/^\/\/ `npm run new-game -- <id>` copies this folder.*\n/m, ''));
    }
  }
}
await rewrite(dest);

console.log(`Created games/${id}/ from the starter template.`);
console.log('  server.js         game rules (runs on the server, authoritative)');
console.log('  client/index.js   rendering + input (runs in the browser)');
console.log('  bot.js            what bots do (delete it to turn bots off)');
console.log('Run `npm run play` (or restart the server) and pick it on the home screen.');
