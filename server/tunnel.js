// Cloudflare quick tunnel: gives the local server a public https://<random>.trycloudflare.com URL.
// No Cloudflare account needed. cloudflared only makes OUTBOUND connections to Cloudflare, so no
// ports are opened on this PC and the game server keeps listening on 127.0.0.1 only.
// Quick tunnels are meant for testing: the URL changes every time and there's no uptime guarantee.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, rename, chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';

const VERSION = '2026.10.3';
// SHA-256 of each release asset, from GitHub's release metadata. Update together with VERSION.
const ASSETS = {
  'win32-x64': { file: 'cloudflared-windows-amd64.exe', sha256: '76b2805253d0d6ffacb092a7acfbee99e7af6917835c0c5410e23f3ef5052da2' },
  'win32-arm64': { file: 'cloudflared-windows-amd64.exe', sha256: '76b2805253d0d6ffacb092a7acfbee99e7af6917835c0c5410e23f3ef5052da2' },
  'win32-ia32': { file: 'cloudflared-windows-386.exe', sha256: '84be6271133004dc103d71b1a2b6b80cf204685ebf277e2504082793507922cf' },
  'linux-x64': { file: 'cloudflared-linux-amd64', sha256: '053b80b0a23031a038fdbf3c073f59f82b8f1f152aa67971d7383ffafc0dbab0' },
  'linux-arm64': { file: 'cloudflared-linux-arm64', sha256: '89297ebfb9e8c99c0dc013a1140601453cf3798d8306c5591651f4a3f5210be8' },
  'darwin-x64': { file: 'cloudflared-darwin-amd64.tgz', sha256: '81b7b85f2376815c4f59b1aa323887b62e16ce8b67555c2e1577dc23f2a82000' },
  'darwin-arm64': { file: 'cloudflared-darwin-arm64.tgz', sha256: '1165d14b6f6360a3b8c283d7d1100024d6ec7cd9bc9e32519e96150645f3ec55' },
};

const READY_TIMEOUT_MS = 45_000;
const URL_RE = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/;

function works(bin) {
  try {
    return spawnSync(bin, ['--version'], { stdio: 'ignore', windowsHide: true }).status === 0;
  } catch {
    return false;
  }
}

/**
 * Finds cloudflared: $CLOUDFLARED, then your PATH, then a copy downloaded into .tools/
 * (verified against the pinned SHA-256 before it's ever run).
 */
export async function ensureCloudflared(root, log) {
  if (process.env.CLOUDFLARED) return process.env.CLOUDFLARED;
  if (works('cloudflared')) return 'cloudflared';

  const isWin = process.platform === 'win32';
  const dir = join(root, '.tools', 'cloudflared', VERSION);
  const bin = join(dir, isWin ? 'cloudflared.exe' : 'cloudflared');
  if (existsSync(bin)) return bin;

  const asset = ASSETS[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error(`No cloudflared download for ${process.platform}-${process.arch}. Install it yourself and set CLOUDFLARED=/path/to/cloudflared.`);

  const url = `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/${asset.file}`;
  log.info(`Downloading cloudflared ${VERSION} (one time, ~${isWin ? 55 : 40} MB)…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  const data = Buffer.from(await res.arrayBuffer());
  const digest = createHash('sha256').update(data).digest('hex');
  if (digest !== asset.sha256) throw new Error(`cloudflared download failed its checksum (got ${digest}). Not running it.`);

  await mkdir(dir, { recursive: true });
  if (asset.file.endsWith('.tgz')) {
    const archive = join(dir, asset.file);
    await writeFile(archive, data);
    const tar = spawnSync('tar', ['-xzf', archive, '-C', dir], { stdio: 'inherit' });
    await rm(archive, { force: true });
    if (tar.status !== 0) throw new Error('Could not extract cloudflared.');
  } else {
    const tmp = `${bin}.download`;
    await writeFile(tmp, data);
    await rename(tmp, bin);
  }
  if (!isWin) await chmod(bin, 0o755);
  log.info('cloudflared downloaded and verified.');
  return bin;
}

/**
 * Starts a quick tunnel to http://127.0.0.1:<port>. Resolves once Cloudflare has registered it.
 * Returns { url, hostname, stop() }. `onExit(code)` fires if cloudflared stops later on.
 */
export async function startTunnel({ port, root, log, onExit }) {
  const bin = await ensureCloudflared(root, log);
  const child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const recent = [];
  let ready = false;

  const url = await new Promise((resolve, reject) => {
    let found = null;
    let partial = '';
    const fail = (err) => {
      clearTimeout(timer);
      child.kill();
      reject(new Error(`${err.message}\n  Last cloudflared output:\n    ${recent.join('\n    ') || '(none)'}`));
    };
    const timer = setTimeout(() => fail(new Error('Timed out waiting for Cloudflare to create the tunnel.')), READY_TIMEOUT_MS);

    // Keep reading output for the tunnel's whole life, otherwise the pipe fills up and cloudflared stalls.
    const onData = (chunk) => {
      const lines = (partial + chunk).split(/\r?\n/);
      partial = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        log.debug(`[cloudflared] ${line}`);
        recent.push(line);
        if (recent.length > 8) recent.shift();
        if (ready) continue;
        found ??= line.match(URL_RE)?.[0] ?? null;
        if (found && /Registered tunnel connection/i.test(line)) {
          ready = true;
          clearTimeout(timer);
          resolve(found);
        }
      }
    };
    child.stdout.setEncoding('utf8').on('data', onData);
    child.stderr.setEncoding('utf8').on('data', onData);
    child.once('error', (err) => fail(err));
    child.once('exit', (code) => {
      if (!ready) fail(new Error(`cloudflared exited (code ${code}) before the tunnel was ready.`));
      else onExit?.(code);
    });
  });

  // Don't leave an orphaned cloudflared behind if this process exits.
  const kill = () => child.kill();
  process.once('exit', kill);

  return {
    url,
    hostname: new URL(url).hostname,
    stop() {
      process.off('exit', kill);
      child.kill();
    },
  };
}
