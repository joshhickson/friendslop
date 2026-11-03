# Privacy note

What this session checked before leaving anything on the public branch `portfolio/nov4`, and how.
Checked 2026-11-02/03 by the session that made this branch.

## The rules applied

Josh's standing rules: no keys, tokens, IP addresses, health details or pay figures; no emails except
his public contact address on his own domain (his call, Nov 2); nothing specific about his relatives;
other people by role; describe the build only as "agents wrote the code under my direction"; never open, print or copy `.env`
or credential files. Plus his Nov 2 decision: delete the process notes in his name.

## How

- **Text search of every file on the branch** (outside `node_modules`) for: Windows and Linux folder
  paths, the git-ignored local tools folder, other people's GitHub handles, `@` handles, email
  addresses, IP-address patterns, the host service's address, the domain registrar, mail-provider
  notes, "How Josh works", his phone, and every mention of "Josh". Each hit was read and kept,
  reworded or removed.
- **Credential files:** none exist in the repo's tracked files, and none were opened. The session
  never read any `.env` file.
- **Screenshots:** each was looked at in full before saving. They show only the app, bot names, the
  player name "Josh" and a code for a local room that no longer exists. They were taken against a
  local server, never the live one, and saved with no metadata (checked).
- **Page text:** written with no quotes of what Josh typed to agents (that question is still open),
  no figures about pay, and no people other than Josh.

## What was removed or changed on this branch

- `TODO.md` rewritten: its "Working notes" (local Windows paths, the host service's address, the
  registrar, drive workarounds, "How Josh works", his commit identity), the contact-email testing
  notes (his mail provider and inbox), and two other developers' handles are gone.
- `docs/superpowers/` (the 26 Oct design spec and build plan) deleted: process notes in Josh's name,
  agent instructions, local paths and a word-for-word quote of Josh.
- `docs/research/2026-11-01-modded-games-direction.md`: the notes on conversations with Josh's
  friends, what his friends want to play, and an anecdote about his phone are gone; the research
  stays.
- Other research notes and `DONE.md`: local paths, a launcher author's handle and the local tools
  folder removed; "Josh said..." process lines made neutral.

## What is still public, and needs Josh to know

1. **Git history.** Everything removed above is still readable in the history of `main` and of every
   branch. Removing it for good means rewriting public history, which is Josh's call and was not done.
2. **Other public branches.** `reality-check-demo`, `reality-check-casino`, `spike/nes-lockstep`,
   `analysis/portfolio-2026-11` and `audit/2026-11` each still have files with local paths and
   process notes (older copies of `TODO.md` and others). Josh's call on the first two is "decide
   later, save them first". This session didn't touch any of them.
3. **Kept on purpose:** the contact address `contact@joshuahickson.org` (public by Josh's choice), the
   Render service name in `render.yaml` (the live server needs it to accept requests), and the font
   licences' project links.
4. **Commit metadata** on all branches uses GitHub's no-reply address, not a personal email (the
   November audit checked this; GitHub's email protection is on, per Josh).
