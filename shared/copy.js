// Every sentence a player reads that friendslop itself writes (not a game's own text).
// Rewrite the jokes here. Each message must keep saying what happened and what to do.
// House rule: hyphens only, never an em or en dash, and no sentence that depends on a dash.

const BAD_LINK = Object.freeze({
  not_github: "That doesn't look like a GitHub link, and GitHub is the only place friendslop knows how to shop. Paste the address of a game folder on github.com.",
  no_game_path: "That link stops at the front door. Open the game's folder inside games/ or templates/ on GitHub, then paste that address.",
  not_found: "GitHub has never heard of that one. Check the spelling, make sure the repo is public, and paste the link again.",
  rate_limited: 'GitHub is sick of our questions and has told us to wait outside. Give it a few minutes and try again.',
  network: "We couldn't reach GitHub. Either your internet or GitHub is having a moment. Check your connection and try again.",
  timeout: 'GitHub took so long to answer that we gave up and ate lunch. Try again in a moment.',
});

export const COPY = Object.freeze({
  unreviewedBanner: (maker, repo) => `Nobody at friendslop has played this yet. It could be a masterpiece. It could be three cubes and a dream. Made by ${maker} (${repo}). Report it`,
  firstLook: 'Heads up: nobody has checked this game. Like any website, it can see your IP address. It probably just wants to show you some cubes. Play anyway?',
  firstLookPlay: 'Play anyway',
  leaveTheRoom: 'Leave the room',
  reportGame: 'Report this game',
  hostCanCheat: "The host's computer runs the game, so the host could change the score. Choose your friends carefully.",
  hostLeft: 'The host left and took the whole game with them. Bold move. Back to the lobby.',
  dataBudget: "friendslop has used up today's internet. New games can start after midnight UTC. Matches already running can finish.",
  dataBudgetEnded: "friendslop has used up today's internet and then some, so this match has to stop here. New games can start after midnight UTC.",
  idleClosed: 'Everyone went quiet, so we closed the room. No hard feelings.',
  forkTooOld: 'This game was built with an older friendslop, and they no longer speak the same language. Ask its maker to update their fork.',
  blocked: 'This game has been retired from friendslop.',
  gameCrashed: (msg) => `The game crashed: ${msg}. It took the match down with it, so you are back in the lobby. Tell its maker, who will want that message.`,
  gameTooChatty: 'The game sent far too many messages, so friendslop hung up on it. Ask its maker to send fewer, or to send them less often.',
  // Filled into gameCrashed and gameWontLoad when the game's frame never said it was ready.
  frameNeverStarted: 'the game frame never started',
  gameWontLoad: (msg) => `The game wouldn't load: ${msg}. Leave the room and try again, or tell its maker, who will want that message.`,
  gameLeftFriendslop: 'The game tried to wander off to some other website, and friendslop caught it at the door. Ask its maker to keep it inside the page.',
  badLink: (reason) => BAD_LINK[reason] ?? "Something went wrong with that link and we're not sure what. Check it and try again.",

  // The "Host a game from GitHub" form on the home screen.
  noGamesYet: 'No games are installed on this server yet. Paste the link to one from GitHub in the box below, or make one with npm run new-game -- my-game and restart the server.',
  hostTitle: 'Host a game from GitHub',
  hostHint: 'Paste the link to a game folder on GitHub. Your computer runs the game for everyone in the room.',
  hostPlaceholder: 'https://github.com/you/your-fork/tree/main/games/your-game',
  hostButton: 'Host this game',
  hostChecking: 'Looking at the game...',
  hostStarter: 'Try the starter game',
  hostLinkLabel: 'Link to the game folder',
  passwordLabel: 'Password (optional)',
  noPasswordPlaceholder: 'Leave empty for no password',
  hostLoadFailed: "That game wouldn't load, so no room was made. Check that the link points at a game folder in a friendslop fork, then try again.",
  inspectTitle: 'Checking the game folder',
  firstLookNotNow: 'Not this one',
  gameTooBigToHost: "This game describes itself at such length that friendslop can't carry it, so no room was made. Ask its maker to trim its settings, teams and text.",

  // Server error texts that have no spec line of their own.
  badSource: "That game's address didn't make sense to friendslop. Paste the link to the game folder again.",
  notRunner: 'Only the player running the game can do that.',
  relayTooBig: 'The game tried to send one message so big that friendslop refused to carry it. Ask its maker to send smaller ones.',
});
