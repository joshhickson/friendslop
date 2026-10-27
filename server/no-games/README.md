# no-games

This folder must stay empty of games. `render.yaml` points the public server's `GAMES_DIR` here, so
that the public server runs no game code at all: every game on it comes from a GitHub link and runs
in the players' browsers.

A game folder added here would run on the public server, with the server's own access. Put your
games in `games/` instead (`npm run new-game -- my-game`), and run them on your own server.
