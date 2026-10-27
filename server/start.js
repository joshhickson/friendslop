#!/usr/bin/env node
// Entry point: `npm start`, `npm run play` (also opens the browser), or `npm run tunnel` (public URL).
// Installs dependencies on first run so a fresh checkout is a single command.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(join(ROOT, 'node_modules', 'ws')) || !existsSync(join(ROOT, 'node_modules', 'three'))) {
  console.log('First run: installing dependencies (npm install)…');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const res = spawnSync(npm, ['install', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.status !== 0) {
    console.error('npm install failed. Run it manually, then try again.');
    process.exit(1);
  }
}

const { loadConfig } = await import('./config.js');
const { createLogger } = await import('./log.js');
const { createGameServer } = await import('./server.js');
const { startTunnel } = await import('./tunnel.js');

const config = loadConfig();
const log = createLogger(config.logLevel);
const gameArg = process.argv.find((a) => a.startsWith('--game='))?.slice('--game='.length);

if (!config.isLoopbackOnly) {
  log.warn('='.repeat(72));
  log.warn(`HOST=${config.host}: the server is reachable from OTHER machines on your network.`);
  log.warn('Only do this on purpose. Unset HOST to go back to local-only (127.0.0.1).');
  log.warn('='.repeat(72));
}

let server;
try {
  server = await createGameServer(config, { log });
  await server.listen();
} catch (err) {
  if (err.code === 'EADDRINUSE') {
    log.error(`Port ${config.port} is already in use. Is the server already running? Try another port: npm start -- --port 8081`);
  } else {
    log.error('failed to start:', err);
  }
  process.exit(1);
}

const query = gameArg ? `?game=${encodeURIComponent(gameArg)}` : '';
const shownHost = config.isLoopbackOnly ? 'localhost' : config.host;
const localUrl = `http://${shownHost}:${config.port}/${query}`;

let tunnel = null;
if (config.tunnel) {
  if (!config.isLoopbackOnly) log.warn('Using a tunnel: you can keep HOST at 127.0.0.1, the tunnel connects locally.');
  log.info('Opening a Cloudflare quick tunnel…');
  try {
    tunnel = await startTunnel({
      port: config.port,
      root: ROOT,
      log,
      onExit: (code) => log.error(`cloudflared stopped (code ${code}). The public URL no longer works; restart to get a new one.`),
    });
    // The hostname is random per run, so it's allowed at runtime rather than in config.
    config.allowedHosts.push(tunnel.hostname);
  } catch (err) {
    log.error(`Could not start the tunnel: ${err.message}`);
    log.error('The server is still running locally.');
  }
}

const line = (s) => console.log(`  │  ${s.padEnd(64)}│`);
console.log('');
console.log(`  ┌${'─'.repeat(66)}┐`);
line('Friendslop server running');
line(`Local:   ${localUrl}`);
if (tunnel) {
  line(`Public:  ${tunnel.url}/${query}`);
  line('Share the public URL + room password with friends.');
  line('Your PC opens no ports: the tunnel only connects out to Cloudflare.');
  line('The URL changes every run and dies when you press Ctrl+C.');
} else {
  line(config.isLoopbackOnly ? 'Local-only: other computers cannot connect.' : 'WARNING: listening on the network!');
  line('Tip: open it in two browser windows to test multiplayer.');
  line('For friends on other networks: npm run tunnel');
}
line('Ctrl+C to stop.');
console.log(`  └${'─'.repeat(66)}┘`);
console.log('');

if (config.open) openBrowser(tunnel ? `${tunnel.url}/${query}` : localUrl);

function openBrowser(target) {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', `"${target}"`] : [target];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: true }).unref();
  } catch {
    /* opening a browser is best-effort */
  }
}

let stopping = false;
async function shutdown() {
  if (stopping) process.exit(1);
  stopping = true;
  log.info('shutting down…');
  tunnel?.stop();
  await server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
