# To do

Open work for friendslop and friendslop.us, newest first. Tick an item off by deleting it.

## One look everywhere

Josh, 2026-10-27, while watching a test match: the play app looks nothing like the website,
and the website still has three styles. He likes only the first.

- Keep only the website's first style, Blockout (`data-theme="blockout"`: warm grey grid,
  orange accent, dark ink on light panels). Remove the 2am LAN and Missing texture themes and
  the theme switcher from friendslop.us (`style.css`, `site.js`, the buttons on every page).
- Restyle the play app (`client/css/style.css`, the lobby, the home screen, the match HUD and
  the unreviewed banner) to match Blockout, so going from the website to a room feels like one
  place.
- Games draw their own screens; the starter template's colours can follow later.

## Before showing friendslop to a real maker

- GoDaddy CNAME: `play.friendslop.us` to `friendslop-2c4h.onrender.com`, then check Render shows
  the domain as verified. (The Render service has been live since 2026-10-27, deploying `main` on
  every push.)
- Merge the site's `instant-game-links` branch and push it, only once `play.friendslop.us` answers.
- Docs page on friendslop.us with a copy-paste agent setup command (design in progress).
- Josh's wording review: `.superpowers/sdd/2026-10-26-instant-game-links/wording-for-josh.md`,
  including "Matches already running can finish" and the site's "it isn't out yet. Soon." line.
- Josh checks by hand: pointer lock in a 3D game (Esc opens the menu), and the host's tab in the
  background mid-match.

## Known, not blocking

- The first load of a game at a new commit took about 10 seconds (jsDelivr fetching it for the
  first time, 2026-10-27). Later loads come from its cache.
- Render's free service sleeps after 15 minutes without traffic, so the first visitor after a
  quiet spell waits for it to wake.
- A game's `announce` lines look like friendslop's own system chat (Josh's call).
- `/api/health` counts virtual bots as players.
- Delete the local tag `backup/pre-strip-2026-10-27` once the pushed history looks right.
