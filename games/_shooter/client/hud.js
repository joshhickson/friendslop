// Shared shooter HUD: crosshair, health, ammo, timer, kill feed, announcements, death screen and
// spectator bar. Modes add their objective display into `hud.objective` (a positioned container
// under the team scores) and can use `hud.banner(text, color)` for a persistent hint line.

import { h, replace } from '/client/kit/index.js';
import { WEAPON, PLAYER } from '../shared/constants.js';

const CSS = `
.sh-hud { position:absolute; inset:0; pointer-events:none; font-family:system-ui,sans-serif; color:#fff; text-shadow:0 1px 2px #000,0 0 3px #000; }
.sh-cross { position:absolute; left:50%; top:50%; width:22px; height:22px; transform:translate(-50%,-50%); }
.sh-cross::before,.sh-cross::after { content:''; position:absolute; background:#fff; box-shadow:0 0 2px #000; }
.sh-cross::before { left:10px; top:2px; width:2px; height:18px; }
.sh-cross::after { top:10px; left:2px; height:2px; width:18px; }
.sh-cross .dot { position:absolute; left:9px; top:9px; width:4px; height:4px; background:transparent; }
.sh-hitmark { position:absolute; left:50%; top:50%; width:30px; height:30px; transform:translate(-50%,-50%) rotate(45deg); opacity:0; transition:opacity .15s; }
.sh-hitmark::before,.sh-hitmark::after { content:''; position:absolute; background:#fff; }
.sh-hitmark::before { left:14px; top:0; width:2px; height:30px; }
.sh-hitmark::after { top:14px; left:0; height:2px; width:30px; }
.sh-hitmark.show { opacity:1; transition:none; }
.sh-hitmark.head::before,.sh-hitmark.head::after { background:#ffd23f; }
.sh-hitmark.kill::before,.sh-hitmark.kill::after { background:#ff4040; }
.sh-bottom { position:absolute; bottom:18px; left:50%; transform:translateX(-50%); display:flex; gap:24px; align-items:flex-end; }
.sh-hp { width:240px; }
.sh-hp .bar { height:14px; background:rgba(0,0,0,.5); border:1px solid rgba(255,255,255,.4); border-radius:4px; overflow:hidden; }
.sh-hp .fill { height:100%; background:#4cd97b; transition:width .1s; }
.sh-hp .num { font-size:28px; font-weight:900; }
.sh-ammo { font-size:28px; font-weight:900; text-align:right; min-width:120px; }
.sh-ammo small { font-size:14px; opacity:.8; font-weight:600; }
.sh-objective { position:absolute; top:62px; left:50%; transform:translateX(-50%); display:flex; gap:10px; font-size:13px; font-weight:700; align-items:center; }
.sh-timer { position:absolute; top:14px; right:16px; font-size:22px; font-weight:900; }
.sh-feed { position:absolute; top:14px; left:16px; display:flex; flex-direction:column; gap:4px; font-size:14px; }
.sh-feed div { background:rgba(0,0,0,.4); padding:3px 8px; border-radius:5px; transition:opacity .5s; }
.sh-center { position:absolute; left:50%; top:30%; transform:translateX(-50%); text-align:center; font-size:22px; font-weight:800; }
.sh-center .big { font-size:40px; font-weight:900; }
.sh-dmg { position:absolute; inset:0; box-shadow:inset 0 0 120px 30px rgba(255,0,0,.55); opacity:0; transition:opacity .4s; }
.sh-dmg.show { opacity:1; transition:none; }
.sh-dead { position:absolute; inset:0; background:rgba(60,0,0,.35); display:none; }
.sh-banner { position:absolute; left:50%; bottom:90px; transform:translateX(-50%); font-weight:900; font-size:18px; padding:4px 12px; border-radius:6px; background:rgba(0,0,0,.5); display:none; }
.sh-click { position:absolute; left:50%; top:58%; transform:translateX(-50%); font-size:15px; background:rgba(0,0,0,.5); padding:6px 12px; border-radius:6px; display:none; }
.sh-spec { position:absolute; left:50%; bottom:22px; transform:translateX(-50%); display:none; flex-direction:column; align-items:center; gap:6px; text-align:center; }
.sh-spec .who { font-size:20px; font-weight:900; padding:4px 14px; border-radius:6px; background:rgba(0,0,0,.5); }
.sh-spec .keys { font-size:13px; opacity:.9; }
.sh-spec .keys b { display:inline-block; padding:0 5px; border:1px solid #aab; border-radius:4px; background:rgba(0,0,0,.35); font-weight:600; }
.sh-hud.spectating .sh-bottom, .sh-hud.spectating .sh-cross { display:none; }
.sh-hud.spectating .sh-spec { display:flex; }
.sh-hud.following .sh-cross { display:block; opacity:.5; }
`;

function fmtTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function createHud(api) {
  const style = h('style', CSS);
  const hitmark = h('div.sh-hitmark');
  const hpFill = h('div.fill');
  const hpNum = h('div.num', '100');
  const ammo = h('div.sh-ammo');
  const objective = h('div.sh-objective');
  const timer = h('div.sh-timer');
  const feed = h('div.sh-feed');
  const center = h('div.sh-center');
  const dmg = h('div.sh-dmg');
  const dead = h('div.sh-dead');
  const banner = h('div.sh-banner');
  const clickHint = h('div.sh-click', 'Click to play');
  const specWho = h('div.who');
  const specKeys = h('div.keys');
  const spec = h('div.sh-spec', specWho, specKeys);
  const root = h('div.sh-hud',
    style, dead, dmg,
    h('div.sh-cross', h('div.dot')), hitmark,
    timer, feed, objective, center, banner, clickHint, spec,
    h('div.sh-bottom', h('div.sh-hp', hpNum, h('div.bar', hpFill)), ammo));
  const key = (k) => h('b', k);
  api.hud.append(root);

  let hitTimer = 0;
  let dmgTimer = 0;
  let centerTimer = 0;

  const nameOf = (id) => api.player(id)?.name ?? '???';
  const colorOf = (id) => api.teamColor(api.player(id)?.team);
  const teamName = (t) => api.team(t)?.name ?? t;

  return {
    setHealth(hp) {
      const pct = Math.max(0, Math.min(100, (hp / PLAYER.maxHealth) * 100));
      hpFill.style.width = `${pct}%`;
      hpFill.style.background = pct > 50 ? '#4cd97b' : pct > 25 ? '#f5c542' : '#ff5a5f';
      hpNum.textContent = String(Math.max(0, Math.round(hp)));
    },
    setAmmo(n, reloading) {
      replace(ammo, reloading ? h('span', 'RELOADING') : `${n}`, h('small', ` / ${WEAPON.magSize}`));
    },
    setTime(seconds) {
      timer.textContent = fmtTime(seconds);
      timer.style.color = seconds <= 30 ? '#ff6b6b' : '#fff';
    },
    /** Persistent hint line above the health bar (e.g. "You have the flag!"). Pass null to hide. */
    banner(text, color = '#fff') {
      banner.style.display = text ? 'block' : 'none';
      if (!text) return;
      banner.style.color = color;
      banner.textContent = text;
    },
    hit(kind) {
      hitmark.className = `sh-hitmark show ${kind ?? ''}`;
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmark.classList.remove('show'), 90);
    },
    hurt() {
      dmg.classList.add('show');
      clearTimeout(dmgTimer);
      dmgTimer = setTimeout(() => dmg.classList.remove('show'), 120);
    },
    /**
     * Death screen. The red tint only shows for the first moments; after that the player is
     * spectating (see setSpectate) and just needs the countdown.
     */
    setDead(isDead, respawnIn = 0, killer = null, { tint = true } = {}) {
      dead.style.display = isDead && tint ? 'block' : 'none';
      if (isDead) {
        replace(center,
          tint ? h('div.big', 'You died') : null,
          killer && tint ? h('div', 'Killed by ', h('span', { style: { color: colorOf(killer) } }, nameOf(killer))) : null,
          h('div', respawnIn > 0 ? `Respawning in ${Math.ceil(respawnIn)}…` : 'Respawning…'));
      } else if (!centerTimer) {
        replace(center);
      }
    },
    /**
     * Spectator bar. mode: null (playing), 'follow' (watching `target` through their eyes), 'free' (noclip).
     * `dead`: watching while waiting to respawn (vs. having chosen to spectate).
     */
    setSpectate(mode, { target = null, dead: isDeadSpec = false, canPick = true } = {}) {
      root.classList.toggle('spectating', Boolean(mode));
      root.classList.toggle('following', mode === 'follow');
      if (!mode) return;
      replace(specWho, mode === 'follow' && target
        ? h('span', 'Watching ', h('span', { style: { color: colorOf(target) } }, nameOf(target)))
        : h('span', 'Free camera'));
      replace(specKeys,
        key('Click'), ' / ', key('Q'), key('E'), ' next / prev player   ',
        key('F'), mode === 'follow' ? ' free camera' : ' follow a player',
        mode === 'free' ? h('span', '   ', key('WASD'), ' fly  ', key('Space'), key('Ctrl'), ' up/down  ', key('Shift'), ' fast') : null,
        h('br'),
        canPick ? h('span', key('T'), isDeadSpec ? ' switch team' : ' join a team   ') : null,
        isDeadSpec ? null : h('span', '   ', key('Esc'), ' menu'));
    },
    announce(text, color = '#fff', ms = 2500) {
      replace(center, h('div.big', { style: { color } }, text));
      clearTimeout(centerTimer);
      centerTimer = setTimeout(() => {
        centerTimer = 0;
        replace(center);
      }, ms);
    },
    feed(parts) {
      const line = h('div', parts);
      feed.append(line);
      while (feed.children.length > 6) feed.firstChild.remove();
      setTimeout(() => { line.style.opacity = '0'; }, 5000);
      setTimeout(() => line.remove(), 5600);
    },
    killFeed(killer, victim, headshot, cause) {
      const v = h('span', { style: { color: colorOf(victim) } }, nameOf(victim));
      if (cause === 'switch') return;
      const how = { fall: ' fell out of the world', zone: ' wandered into the enemy spawn' };
      if (!killer || how[cause]) this.feed([v, how[cause] ?? ' died']);
      else this.feed([h('span', { style: { color: colorOf(killer) } }, nameOf(killer)), headshot ? ' ⌖ ' : ' → ', v]);
    },
    showClickHint(show) {
      clickHint.style.display = show ? 'block' : 'none';
    },
    objective,
    nameOf,
    colorOf,
    teamName,
    destroy() {
      clearTimeout(hitTimer);
      clearTimeout(dmgTimer);
      clearTimeout(centerTimer);
      root.remove();
    },
  };
}
