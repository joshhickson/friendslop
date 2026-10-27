// Wire protocol shared by the server (Node) and the browser client.
// Every message is a JSON object with a string `t` (type) field.
//
// Framework messages use the names below. Game-specific traffic is wrapped in
// { t: 'game', type: '<your type>', data: <anything JSON> } so games never collide
// with framework messages.

export const C2S = Object.freeze({
  CREATE: 'room:create',     // { name, game, password }
  JOIN: 'room:join',         // { roomId, password, name, bot? } or { roomId, token, resume: true } or { roomId, botTicket }
  LEAVE: 'room:leave',       // {}
  CONFIG: 'room:config',     // host only, lobby only: { game?, settings?, options?: { teamSwitch } }
  START: 'room:start',       // host only
  END: 'room:end',           // host only: abort the match (or skip the results period) and return to the lobby
  KICK: 'room:kick',         // host only: { playerId }
  BOTS: 'room:bots',         // host only: { add?: n, team?: '<teamId>'|'auto', difficulty?, remove?: playerId | 'all' }
  TEAM: 'team:pick',         // { team: '<teamId>' | 'auto' | 'spectate' }
  READY: 'match:ready',      // client finished loading the game module
  CHAT: 'chat',              // { text }
  PING: 'ping',              // { c: clientTime, rtt? }
  GAME: 'game',              // { type, data }
});

export const S2C = Object.freeze({
  HELLO: 'hello',            // { games: [...], defaultGame, serverTime }
  WELCOME: 'welcome',        // { you, token, room }
  ROOM: 'room',              // { room } full lobby/room state
  LEFT: 'left',              // { reason } you are no longer in a room
  ERROR: 'error',            // { code, message }
  CHAT: 'chat',              // { from, name, team, text, system? }
  MATCH_START: 'match:start',// { matchId, game, settings }
  MATCH_END: 'match:end',    // { result }; result.returnAt set = results period until that server time
  PONG: 'pong',              // { c, s }
  GAME: 'game',              // { type, data }
});

export const LIMITS = Object.freeze({
  NAME_MAX: 16,
  PASSWORD_MAX: 64,
  CHAT_MAX: 200,
  ROOM_ID_LEN: 6,
  MAX_MESSAGE_BYTES: 16 * 1024,
});

// No 0/O/1/I/L to keep codes easy to read out loud.
export const ROOM_ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function normalizeRoomId(raw) {
  if (typeof raw !== 'string') return null;
  const id = raw.trim().toUpperCase();
  if (id.length !== LIMITS.ROOM_ID_LEN) return null;
  for (const ch of id) if (!ROOM_ID_ALPHABET.includes(ch)) return null;
  return id;
}

// Strips control characters and collapses whitespace. Returns '' for unusable input.
export function cleanText(raw, max) {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function cleanName(raw) {
  return cleanText(raw, LIMITS.NAME_MAX);
}

export const ERRORS = Object.freeze({
  bad_request: 'That request was malformed.',
  room_not_found: 'No room with that code.',
  wrong_password: 'Wrong password.',
  room_full: 'That room is full.',
  in_progress: 'That match is in progress and does not allow joining mid-game.',
  not_host: 'Only the host can do that.',
  rate_limited: 'Slow down a little and try again.',
  locked_out: 'Too many wrong passwords. Wait a minute and try again.',
  unknown_game: 'Unknown game.',
  too_many_rooms: 'The server has too many rooms right now.',
  already_in_room: 'You are already in a room.',
  not_in_room: 'You are not in a room.',
  bad_phase: 'You cannot do that right now.',
  not_enough_players: 'Not enough players to start.',
  bad_team: 'That team does not exist.',
  no_bots: 'This game does not support bots.',
  bad_ticket: 'That bot ticket is invalid or expired.',
  team_locked: 'The host has turned off team switching for this match.',
  session_expired: 'Your previous session has expired.',
});
