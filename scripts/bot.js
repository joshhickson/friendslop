#!/usr/bin/env node
// Run a bot from OUTSIDE the server process: it joins a room over WebSocket with the room code
// and password, exactly like a person would, and plays using the game's bot.js.
//
//   npm run bot -- --room ABC123 --password pizza
//   npm run bot -- --url https://xyz.trycloudflare.com --room ABC123 --password pizza --count 3 --difficulty hard
//
// This is also the template for driving a player from any other program: connect to /ws,
// send { t: 'room:join', roomId, password, name, bot: true }, then follow shared/protocol.js.

import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BotClient } from '../server/bots/client.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:8080' },
    room: { type: 'string' },
    password: { type: 'string', default: '' },
    name: { type: 'string', default: 'Remote' },
    count: { type: 'string', default: '1' },
    difficulty: { type: 'string', default: 'normal' },
    team: { type: 'string' },
  },
});

if (!values.room) {
  console.error('Usage: npm run bot -- --room <CODE> [--password <pw>] [--url http://localhost:8080] [--count 1] [--difficulty easy|normal|hard] [--team red|blue]');
  process.exit(1);
}

const page = new URL(values.url);
const wsUrl = `${page.protocol === 'https:' ? 'wss' : 'ws'}://${page.host}/ws`;
const log = {
  info: (...a) => console.log(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
  debug: () => {},
};

async function loadBrain(gameId) {
  const file = join(process.env.GAMES_DIR ?? join(ROOT, 'games'), gameId, 'bot.js');
  if (!existsSync(file)) {
    log.warn(`No bot for game "${gameId}". Waiting in the lobby.`);
    return null;
  }
  return (await import(pathToFileURL(file).href)).default;
}

const count = Math.max(1, Math.min(16, Number(values.count) || 1));
const bots = [];
for (let i = 0; i < count; i++) {
  const bot = new BotClient({
    url: wsUrl,
    origin: page.origin,
    join: { roomId: values.room, password: values.password, name: count > 1 ? `${values.name} ${i + 1}` : values.name, bot: true },
    loadBrain,
    options: { difficulty: values.difficulty },
    log,
  });
  try {
    const welcome = await bot.start();
    if (values.team) bot.send('team:pick', { team: values.team });
    const me = welcome.room.players.find((p) => p.id === welcome.you);
    log.info(`${me.name} joined room ${welcome.room.id} (${welcome.room.game.name}).`);
    bot.onClose = () => {
      log.info(`${me.name} disconnected.`);
      if (bots.every((b) => b.ws.readyState > 1)) process.exit(0);
    };
    bots.push(bot);
  } catch (err) {
    log.error(`Could not join: ${err.message}`);
    process.exit(1);
  }
}
log.info('Bots are in. The host starts the match from the lobby. Ctrl+C to remove them.');

process.on('SIGINT', () => {
  for (const b of bots) b.send('room:leave');
  setTimeout(() => process.exit(0), 200);
});
