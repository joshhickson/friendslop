# To do

Open work for friendslop and friendslop.us, newest first. Tick an item off by deleting it.

## Next: the control points demo

Josh, 2026-10-27: once the site is pushed, return to the control points game, spruce it up, and
serve it as a working demo with bots that play. His hand checks (below) come after the demo works.

## One look everywhere

Josh, 2026-10-27, while watching a test match: the play app looks nothing like the website. The
website itself is down to the one style he likes, Blockout (warm grey grid, orange accent, dark
ink on light panels), as of the site commit a9bcf76.

- Restyle the play app (`client/css/style.css`, the lobby, the home screen, the match HUD and
  the unreviewed banner) to match Blockout, so going from the website to a room feels like one
  place.
- Games draw their own screens; the starter template's colours can follow later.

## Before showing friendslop to a real maker

- Push the site's `main` (merged locally on 2026-10-27; Josh approved the wording the same day).
  `play.friendslop.us` is live (Render, free plan, deploying `main` on every push; GoDaddy CNAME
  `play` to `friendslop-2c4h.onrender.com`).
- The Docs page on friendslop.us still says "Coming soon". The homepage's "Make your first game"
  section has the agent prompt and the steps meanwhile.
- Josh checks by hand, after the demo: pointer lock in a 3D game (Esc opens the menu), and the
  host's tab in the background mid-match.

## Known, not blocking

- Contact is GitHub issues (Josh, 2026-10-27). The site's "Talk to Josh" box and CONTRIBUTING.md
  both say so.
- The first load of a game at a new commit took about 10 seconds (jsDelivr fetching it for the
  first time, 2026-10-27). Later loads come from its cache.
- Render's free service sleeps after 15 minutes without traffic, so the first visitor after a
  quiet spell waits for it to wake.
- A game's `announce` lines look like friendslop's own system chat (Josh's call).
- `/api/health` counts virtual bots as players.
- Delete the local tag `backup/pre-strip-2026-10-27` once the pushed history looks right.
