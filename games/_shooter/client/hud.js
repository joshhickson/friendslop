// Shared shooter HUD: crosshair, health, ammo, timer, kill feed, announcements, death screen and
// spectator bar. Modes add their objective display into `hud.objective` (a positioned container
// under the team scores) and can use `hud.banner(text, color)` for a persistent hint line.

import { h, replace } from '/client/kit/index.js';
import { WEAPON, PLAYER } from '../shared/constants.js';

// friendslop's Blockout look: light panels with ink edges and hard offset shadows, an orange accent,
// Bungee for numbers and headlines (the frame loads friendslop's fonts for every game).
const INK = '#22201c';
const PANEL = '#f3f1ea';
const ACCENT = '#f28c28';
const GOOD = '#2f8f4e';
const BAD = '#d93a2b';
const DISPLAY = 'Bungee,system-ui,sans-serif';
const CHIP = `background:${PANEL}; color:${INK}; border:3px solid ${INK}; border-radius:10px; box-shadow:3px 3px 0 ${INK}; text-shadow:none;`;

const CSS = `
.sh-hud { position:absolute; inset:0; pointer-events:none; font-family:"Bricolage Grotesque",system-ui,sans-serif; color:#fff; }
.sh-cross { position:absolute; left:50%; top:50%; width:22px; height:22px; transform:translate(-50%,-50%); }
.sh-cross::before,.sh-cross::after { content:''; position:absolute; background:#fff; box-shadow:0 0 0 1px ${INK}; }
.sh-cross::before { left:10px; top:2px; width:2px; height:18px; }
.sh-cross::after { top:10px; left:2px; height:2px; width:18px; }
.sh-cross .dot { position:absolute; left:9px; top:9px; width:4px; height:4px; background:transparent; }
.sh-hitmark { position:absolute; left:50%; top:50%; width:30px; height:30px; transform:translate(-50%,-50%) rotate(45deg); opacity:0; transition:opacity .15s; }
.sh-hitmark::before,.sh-hitmark::after { content:''; position:absolute; background:#fff; }
.sh-hitmark::before { left:14px; top:0; width:2px; height:30px; }
.sh-hitmark::after { top:14px; left:0; height:2px; width:30px; }
.sh-hitmark.show { opacity:1; transition:none; }
.sh-hitmark.head::before,.sh-hitmark.head::after { background:${ACCENT}; }
.sh-hitmark.kill::before,.sh-hitmark.kill::after { background:${BAD}; }
.sh-bottom { position:absolute; bottom:18px; left:50%; transform:translateX(-50%); display:flex; gap:16px; align-items:stretch; }
.sh-hp { ${CHIP} width:250px; padding:6px 12px 10px; }
.sh-hp .bar { height:14px; background:#e6e3d9; border:2px solid ${INK}; border-radius:6px; overflow:hidden; }
.sh-hp .fill { height:100%; background:${GOOD}; transition:width .1s; }
.sh-hp .num { font:400 26px/1.1 ${DISPLAY}; }
.sh-ammo { ${CHIP} font:400 26px/1.1 ${DISPLAY}; text-align:right; min-width:130px; padding:6px 12px; display:flex; align-items:center; justify-content:flex-end; gap:4px; }
.sh-ammo small { font:800 14px "Bricolage Grotesque",system-ui,sans-serif; opacity:.7; }
.sh-objective { position:absolute; top:62px; left:50%; transform:translateX(-50%); display:flex; gap:10px; font-size:13px; font-weight:800; align-items:center; }
.sh-timer { ${CHIP} position:absolute; top:12px; right:16px; font:400 22px/1 ${DISPLAY}; padding:7px 12px; }
.sh-bonus { ${CHIP} position:absolute; top:56px; right:16px; font:400 16px/1 ${DISPLAY}; padding:5px 9px; background:${ACCENT}; opacity:0; transform:translateY(-6px); transition:opacity .6s, transform .6s; }
.sh-bonus.show { opacity:1; transform:none; transition:opacity .15s, transform .15s; }
.sh-feed { position:absolute; top:12px; left:16px; display:flex; flex-direction:column; align-items:flex-start; gap:5px; font-size:14px; font-weight:800; }
.sh-feed div { ${CHIP} border-width:2px; box-shadow:2px 2px 0 ${INK}; padding:2px 9px; border-radius:8px; transition:opacity .5s; }
.sh-center { position:absolute; left:50%; top:28%; transform:translateX(-50%); text-align:center; font-size:22px; font-weight:800; text-shadow:2px 2px 0 ${INK}; }
.sh-center .big { font:400 44px/1.05 ${DISPLAY}; text-shadow:3px 3px 0 ${INK}; }
.sh-dmg { position:absolute; inset:0; box-shadow:inset 0 0 120px 30px rgba(217,58,43,.55); opacity:0; transition:opacity .4s; }
.sh-dmg.show { opacity:1; transition:none; }
.sh-dead { position:absolute; inset:0; background:rgba(34,32,28,.35); display:none; }
.sh-banner { ${CHIP} position:absolute; left:50%; bottom:100px; transform:translateX(-50%); font-weight:800; font-size:17px; padding:5px 14px; display:none; }
.sh-click { ${CHIP} position:absolute; left:50%; top:58%; transform:translateX(-50%); font-size:15px; font-weight:800; padding:6px 14px; display:none; }
.sh-spec { position:absolute; left:50%; bottom:22px; transform:translateX(-50%); display:none; flex-direction:column; align-items:center; gap:8px; text-align:center; }
.sh-spec .who { ${CHIP} font:400 18px/1.2 ${DISPLAY}; padding:5px 14px; }
.sh-spec .keys { font-size:13px; font-weight:600; text-shadow:0 1px 2px ${INK}; }
.sh-spec .keys b { display:inline-block; padding:0 6px; border:1.5px solid ${INK}; border-radius:5px; background:${PANEL}; color:${INK}; font-weight:800; text-shadow:none; box-shadow:1px 1px 0 ${INK}; }
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
  const bonus = h('div.sh-bonus');
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
    timer, bonus, feed, objective, center, banner, clickHint, spec,
    h('div.sh-bottom', h('div.sh-hp', hpNum, h('div.bar', hpFill)), ammo));
  const key = (k) => h('b', k);
  api.hud.append(root);

  let hitTimer = 0;
  let dmgTimer = 0;
  let centerTimer = 0;
  let bonusTimer = 0;

  const nameOf = (id) => api.player(id)?.name ?? '???';
  const colorOf = (id) => api.teamColor(api.player(id)?.team);
  const teamName = (t) => api.team(t)?.name ?? t;

  return {
    setHealth(hp) {
      const pct = Math.max(0, Math.min(100, (hp / PLAYER.maxHealth) * 100));
      hpFill.style.width = `${pct}%`;
      hpFill.style.background = pct > 50 ? GOOD : pct > 25 ? ACCENT : BAD;
      hpNum.textContent = String(Math.max(0, Math.round(hp)));
    },
    setAmmo(n, reloading) {
      replace(ammo, reloading ? h('span', 'RELOADING') : `${n}`, h('small', ` / ${WEAPON.magSize}`));
    },
    setTime(seconds) {
      timer.textContent = fmtTime(seconds);
      timer.style.color = seconds <= 30 ? BAD : INK;
    },
    /** Shows "+1:00" under the timer for a moment, so time added to the clock doesn't look like a glitch. */
    timeBonus(seconds) {
      bonus.textContent = `+${fmtTime(seconds)}`;
      bonus.classList.add('show');
      clearTimeout(bonusTimer);
      bonusTimer = setTimeout(() => bonus.classList.remove('show'), 2500);
    },
    /** Persistent hint line above the health bar (e.g. "You have the flag!"). Pass null to hide. */
    banner(text, color = INK) {
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
