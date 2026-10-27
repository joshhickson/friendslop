// defineGame() validates a game definition and fills in defaults.
// See docs/making-a-game.md for the full contract.

const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

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
