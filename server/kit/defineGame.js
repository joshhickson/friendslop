// defineGame() validates a game definition and fills in defaults.
// See docs/making-a-game.md for the full contract.

import { cleanText } from '../../shared/protocol.js';
import { parseRef } from '../../shared/gameref.js';

const ID_RE =/^[a-z][a-z0-9-]{0,31}$/;

function fail(id, msg) {
  throw new Error(`Game "${id ?? '?'}": ${msg}`);
}

function normalizeSetting(gameId, key, s) {
  if (!s || typeof s !== 'object') fail(gameId, `setting "${key}" must be an object`);
  const type = s.type ?? (typeof s.default === 'boolean' ? 'boolean' : typeof s.default === 'number' ? 'number' : 'select');
  const out = { key, type, label: s.label ?? key, default: s.default };
  if (type === 'number') {
    out.min = s.min ?? -Infinity;
    out.max = s.max ?? Infinity;
    out.step = s.step ?? 1;
    if (typeof s.default !== 'number') fail(gameId, `number setting "${key}" needs a numeric default`);
  } else if (type === 'boolean') {
    out.default = Boolean(s.default);
  } else if (type === 'select') {
    if (!Array.isArray(s.options) || s.options.length === 0) fail(gameId, `select setting "${key}" needs options`);
    out.options = s.options.map((o) => (typeof o === 'object' ? { value: o.value, label: o.label ?? String(o.value) } : { value: o, label: String(o) }));
    if (!out.options.some((o) => o.value === s.default)) out.default = out.options[0].value;
  } else {
    fail(gameId, `setting "${key}" has unknown type "${type}"`);
  }
  if (s.unit) out.unit = s.unit;
  return out;
}

/** Coerce an untrusted settings object against a schema. Unknown keys are dropped. */
export function coerceSettings(schema, input = {}, base = null) {
  const out = {};
  for (const s of schema) {
    const prev = base && s.key in base ? base[s.key] : s.default;
    const raw = input && Object.prototype.hasOwnProperty.call(input, s.key) ? input[s.key] : prev;
    if (s.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) { out[s.key] = prev; continue; }
      const stepped = s.step ? Math.round(n / s.step) * s.step : n;
      out[s.key] = Math.min(s.max, Math.max(s.min, Number(stepped.toFixed(6))));
    } else if (s.type === 'boolean') {
      out[s.key] = typeof raw === 'boolean' ? raw : Boolean(prev);
    } else {
      out[s.key] = s.options.some((o) => o.value === raw) ? raw : prev;
    }
  }
  return out;
}

export function defineGame(def) {
  if (!def || typeof def !== 'object') throw new Error('defineGame() needs an object');
  const id = def.id;
  if (!ID_RE.test(id ?? '')) fail(id, 'id must be lowercase letters, digits or dashes (e.g. "tag")');
  if (typeof def.create !== 'function') fail(id, 'create(ctx) must be a function returning hooks');

  let teams = null;
  if (Array.isArray(def.teams) && def.teams.length > 0) {
    teams = def.teams.map((t, i) => {
      if (!t || !ID_RE.test(t.id ?? '')) fail(id, `team #${i} needs a lowercase id`);
      return { id: t.id, name: t.name ?? t.id, color: t.color ?? '#888888' };
    });
    if (new Set(teams.map((t) => t.id)).size !== teams.length) fail(id, 'team ids must be unique');
  }

  const settings = Object.entries(def.settings ?? {}).map(([k, s]) => normalizeSetting(id, k, s));
  const scoreboard = (def.scoreboard ?? []).map((c) => (typeof c === 'string' ? { key: c, label: c } : { key: c.key, label: c.label ?? c.key }));

  const minPlayers = Math.max(1, def.minPlayers ?? 1);
  const maxPlayers = Math.max(minPlayers, def.maxPlayers ?? 16);
  const tickRate = Math.min(120, Math.max(1, def.tickRate ?? 20));
  const resultsSeconds = Math.min(60, Math.max(0, Number(def.resultsSeconds) || 0));

  // Optional: top the teams up with bots when a match starts.
  // { perTeam: 10, setting?: '<boolean setting key>', difficultySetting?: '<select setting key>' }
  let autoFill = null;
  if (def.autoFill) {
    if (!teams) fail(id, 'autoFill needs teams');
    const perTeam = Math.floor(Number(def.autoFill.perTeam));
    if (!(perTeam >= 1)) fail(id, 'autoFill.perTeam must be at least 1');
    for (const key of ['setting', 'difficultySetting']) {
      const k = def.autoFill[key];
      if (k !== undefined && !settings.some((s) => s.key === k)) fail(id, `autoFill.${key} "${k}" is not one of the game's settings`);
    }
    autoFill = Object.freeze({ perTeam, setting: def.autoFill.setting ?? null, difficultySetting: def.autoFill.difficultySetting ?? null });
  }

  return Object.freeze({
    id,
    name: def.name ?? id,
    description: def.description ?? '',
    minPlayers,
    maxPlayers,
    teams,
    joinInProgress: def.joinInProgress ?? true,
    teamChangeInProgress: def.teamChangeInProgress ?? true,
    tickRate,
    resultsSeconds,
    settings,
    scoreboard,
    controls: def.controls ?? [],
    autoFill,
    create: def.create,
  });
}

// ---- games that live in a GitHub repo ---------------------------------------------------------
// The server never loads such a game's code. The host's browser loads it, calls describeGame(),
// and sends the result here. Everything in it is untrusted JSON: rebuild it, don't trust it.

const REMOTE_MAX = Object.freeze({ name: 40, description: 200, teams: 8, settings: 32, scoreboard: 8, controls: 16, controlKey: 24, controlText: 40, options: 32, optionValue: 40, players: 64 });
const SETTING_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/;
const STAT_KEY_RE = /^[A-Za-z0-9_]{1,32}$/;
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

function remoteFail(msg) {
  throw new Error(msg);
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function remoteText(v, what, max) {
  if (typeof v !== 'string') remoteFail(`${what} must be text`);
  return cleanText(v, max);
}

function remoteList(v, what, max) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) remoteFail(`${what} must be a list`);
  if (v.length > max) remoteFail(`at most ${max} ${what} are allowed (got ${v.length})`);
  return v;
}

function remoteNumber(v, what, { min = -Infinity, max = Infinity, fallback } = {}) {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) remoteFail(`${what} must be a number`);
  return Math.min(max, Math.max(min, v));
}

/** One setting in its normalized (array) form, as the [key, object] pair normalizeSetting reads. */
function remoteSetting(s, i) {
  if (!isPlain(s)) remoteFail(`setting #${i} must be an object`);
  if (typeof s.key !== 'string' || !SETTING_KEY_RE.test(s.key)) remoteFail(`setting #${i} needs a key of letters, digits, dashes or underscores`);
  const key = s.key;
  const what = `setting "${key}"`;
  if (s.type !== 'number' && s.type !== 'boolean' && s.type !== 'select') remoteFail(`${what} has an unknown type`);
  const out = { type: s.type, default: s.default };
  if (s.label !== undefined && s.label !== null) out.label = remoteText(s.label, `${what} label`, REMOTE_MAX.name) || key;
  if (s.unit !== undefined && s.unit !== null) out.unit = remoteText(s.unit, `${what} unit`, 12);
  if (s.type === 'number') {
    if (typeof s.default !== 'number' || !Number.isFinite(s.default)) remoteFail(`number ${what} needs a numeric default`);
    // null means unbounded (JSON cannot carry Infinity).
    for (const edge of ['min', 'max', 'step']) {
      const v = s[edge];
      if (v === undefined || v === null) continue;
      if (typeof v !== 'number' || !Number.isFinite(v)) remoteFail(`${what} ${edge} must be a number or null`);
      out[edge] = v;
    }
    if (out.step !== undefined && !(out.step > 0)) remoteFail(`${what} step must be above zero`);
    if ((out.min ?? -Infinity) > (out.max ?? Infinity)) remoteFail(`${what} has a min above its max`);
  } else if (s.type === 'select') {
    const options = remoteList(s.options, `options of ${what}`, REMOTE_MAX.options);
    out.options = options.map((o, j) => {
      const raw = isPlain(o) ? o : { value: o };
      if (!['string', 'number', 'boolean'].includes(typeof raw.value)) remoteFail(`${what} option #${j} needs a text, number or boolean value`);
      if (typeof raw.value === 'string' && raw.value.length > REMOTE_MAX.optionValue) remoteFail(`${what} option #${j} is longer than ${REMOTE_MAX.optionValue} characters`);
      const label = cleanText(raw.label === undefined || raw.label === null ? String(raw.value) : remoteText(raw.label, `${what} option label`, 1000), REMOTE_MAX.name) || String(raw.value).slice(0, REMOTE_MAX.name);
      return { value: raw.value, label };
    });
  }
  return [key, out];
}

/**
 * Rebuilds a game definition that arrived as JSON (what describeGame() makes in the host's
 * browser) through the same checks as defineGame. `source` is the game's ref string.
 * Returns the same frozen shape as defineGame, plus `source` and `hasBot`, with create: null.
 * Throws an Error with a readable message on anything it does not accept.
 */
export function defineRemoteGame(meta, source) {
  if (!parseRef(source)) remoteFail('the game source is not a valid gh: reference');
  if (!isPlain(meta)) remoteFail('the game definition must be an object');
  if (typeof meta.id !== 'string' || !ID_RE.test(meta.id)) remoteFail('id must be lowercase letters, digits or dashes (e.g. "tag")');
  const id = meta.id;

  const teams = remoteList(meta.teams, 'teams', REMOTE_MAX.teams).map((t, i) => {
    if (!isPlain(t) || typeof t.id !== 'string' || !ID_RE.test(t.id)) remoteFail(`team #${i} needs a lowercase id`);
    if (t.color !== undefined && t.color !== null && (typeof t.color !== 'string' || !COLOR_RE.test(t.color))) remoteFail(`team "${t.id}" needs a color like #3e8ef7`);
    const name = t.name === undefined || t.name === null ? t.id : remoteText(t.name, `team "${t.id}" name`, REMOTE_MAX.name) || t.id;
    return { id: t.id, name, ...(t.color ? { color: t.color } : {}) };
  });

  const settingEntries = remoteList(meta.settings, 'settings', REMOTE_MAX.settings).map(remoteSetting);
  if (new Set(settingEntries.map(([k]) => k)).size !== settingEntries.length) remoteFail('setting keys must be unique');
  const settings = Object.fromEntries(settingEntries);

  const scoreboard = remoteList(meta.scoreboard, 'scoreboard columns', REMOTE_MAX.scoreboard).map((c, i) => {
    if (!isPlain(c) || typeof c.key !== 'string' || !STAT_KEY_RE.test(c.key)) remoteFail(`scoreboard column #${i} needs a key of 1 to 32 letters, digits or underscores`);
    const label = c.label === undefined || c.label === null ? c.key : remoteText(c.label, 'scoreboard label', 1000);
    return { key: c.key, label: cleanText(label, 24) || c.key.slice(0, 24) };
  });
  if (new Set(scoreboard.map((c) => c.key)).size !== scoreboard.length) remoteFail('scoreboard keys must be unique');

  const controls = remoteList(meta.controls, 'controls', REMOTE_MAX.controls).map((pair, i) => {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') {
      remoteFail(`controls entry #${i} must be a [key, what] pair of text`);
    }
    const key = cleanText(pair[0], 1000);
    const what = cleanText(pair[1], 1000);
    if (key.length > REMOTE_MAX.controlKey) remoteFail(`controls key "${key.slice(0, 12)}..." is longer than ${REMOTE_MAX.controlKey} characters`);
    if (what.length > REMOTE_MAX.controlText) remoteFail(`controls text for "${key}" is longer than ${REMOTE_MAX.controlText} characters`);
    return [key, what];
  });

  let autoFill;
  if (meta.autoFill !== undefined && meta.autoFill !== null) {
    if (!isPlain(meta.autoFill)) remoteFail('autoFill must be an object');
    autoFill = { perTeam: remoteNumber(meta.autoFill.perTeam, 'autoFill.perTeam', { min: 0, max: REMOTE_MAX.players }) };
    for (const k of ['setting', 'difficultySetting']) {
      const v = meta.autoFill[k];
      if (v === undefined || v === null) continue;
      if (typeof v !== 'string') remoteFail(`autoFill.${k} must be text`);
      autoFill[k] = v;
    }
  }

  const def = defineGame({
    id,
    name: (typeof meta.name === 'string' ? cleanText(meta.name, REMOTE_MAX.name) : '') || id,
    description: typeof meta.description === 'string' ? cleanText(meta.description, REMOTE_MAX.description) : '',
    minPlayers: Math.floor(remoteNumber(meta.minPlayers, 'minPlayers', { min: 1, max: REMOTE_MAX.players, fallback: 1 })),
    maxPlayers: Math.floor(remoteNumber(meta.maxPlayers, 'maxPlayers', { min: 1, max: REMOTE_MAX.players, fallback: 16 })),
    tickRate: remoteNumber(meta.tickRate, 'tickRate', { fallback: 20 }),
    resultsSeconds: remoteNumber(meta.resultsSeconds, 'resultsSeconds', { fallback: 0 }),
    joinInProgress: typeof meta.joinInProgress === 'boolean' ? meta.joinInProgress : true,
    teamChangeInProgress: typeof meta.teamChangeInProgress === 'boolean' ? meta.teamChangeInProgress : true,
    teams,
    settings,
    scoreboard,
    controls,
    autoFill,
    create() {},
  });
  return Object.freeze({ ...def, create: null, source, hasBot: meta.hasBot === true });
}
