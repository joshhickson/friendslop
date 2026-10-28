# games

Each game is a folder here. The server loads every one it finds when it starts.

It holds two demos: Control Points (`cp/`) with the shooter core it is built on (`_shooter/`; folders
starting with `_` hold shared code and aren't listed as games), and Reality Check (`reality-check/`), a
turn-based board game that shows the slow-game pattern: no `tick` simulation, a full `state` broadcast
after every change, and bots that read the same state. Make your own game with:

```sh
npm run new-game -- my-game "My Game"
```

That copies `templates/starter/` to `games/my-game/`. See [docs/making-a-game.md](../docs/making-a-game.md).
