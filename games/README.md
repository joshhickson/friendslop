# games

Each game is a folder here. The server loads every one it finds when it starts.

It holds one demo, Control Points (`cp/`), and the shooter core it is built on (`_shooter/`; folders
starting with `_` hold shared code and aren't listed as games). Make your own game with:

```sh
npm run new-game -- my-game "My Game"
```

That copies `templates/starter/` to `games/my-game/`. See [docs/making-a-game.md](../docs/making-a-game.md).
