# Contributing to friendslop

Pull requests are welcome. So far friendslop is one person and a lot of bots, and it gets better every
time somebody sends something in.

## What to send

- **Fixes.** A bug, a confusing error message, a line in the docs that's wrong.
- **Docs.** Anything that would have saved you an hour.
- **Kit features.** Something every game needs and the kit doesn't do yet. For anything big, open an
  issue first so we can agree on the shape before you write it.
- **Templates.** A starting point for a kind of game, next to `templates/starter`.
- **Your game.** Games live in your own fork and play from a link, so they don't need to be merged
  here. [Open an issue](https://github.com/joshhickson/friendslop/issues/new?title=My%20game%3A%20)
  with the link to your game's folder and it can go on the [games page](https://friendslop.us/games/).

## How to send a pull request

1. Fork the repo and make a branch.
2. Make your change. Keep each pull request to one idea.
3. Run the tests. They start real servers and drive them, so they take about half a minute:

   ```sh
   npm test
   ```

4. Push the branch to your fork and open a pull request against `main`. Say what it changes and why.

One human reads every pull request, and that human has a day job and opinions, so give it a few days.

## Questions

[Open an issue](https://github.com/joshhickson/friendslop/issues/new). Questions, ideas and "is this a
bug or am I holding it wrong" are all fine. For anything you'd rather not post in public, email
[contact@joshuahickson.org](mailto:contact@joshuahickson.org).

## License

By sending a pull request you agree that your change is released under the project's
[Apache-2.0](LICENSE) license.
