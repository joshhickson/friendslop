# friendslop.us: text over the grid, a first critique

2026-10-28. Looked at the live home page and Docs page at 1366 px wide and at 375 px (a phone).
This used the frontend-design guidance only. The three design plugins in TODO.md aren't added yet,
so their audits are still to come. Nothing has been changed.

Josh, 2026-10-28: the text clashes with the grid background, but the grid stays.

## What's clashing

1. **Only body text clashes.** The Bungee headings, the buttons and everything on a card (the lobby
   mock-up, the prompt box, the four steps, the feature list, the FAQ) read cleanly. The heavy
   heading strokes and the card backgrounds win over the grid. The trouble is regular-weight running
   text sitting straight on the background.
2. **The orange lines are as thick as the letters.** Major lines are 2 px of orange at 55%
   (`--grid-major`), about the stroke width of Bricolage Grotesque at body size. Where a line crosses
   a line of text it reads as strikethrough or underline, and a vertical line splits words in half.
   The faint minor lines (`--grid-minor`, 10%) don't cause trouble.
3. **The grid is pinned to the page's corner, and the column is centred.** So where text sits
   against the lines changes with the window's width. At 1366 px the column starts 13 px before a
   major line, so an orange line runs down through the first letter or two of every line of text.
   It's most visible on the Docs page.
4. **Line spacing doesn't match the grid.** Body text is 1.125rem with a 1.55 line height (about
   28 px), and the grid is 32 px. So the horizontal lines drift through a different part of the
   letters on each line: through the middle on one line, under it on the next.
5. **The small grey notes are the weakest spot.** For example, the note under the hero buttons is
   1rem, regular weight, in `--ink-soft`. `--ink-soft` on the plain background is 5.55 to 1, but on an
   orange line it drops to 4.43 to 1, just under the 4.5 to 1 that WCAG AA asks of normal text. Main
   text (`--ink`) stays above 7.6 to 1 everywhere.
6. **The reading pages have it worst.** Docs, Privacy, Protocol and the other inner pages are long
   paragraphs straight on the grid, where the home page puts most of its text on cards.
7. **On a phone it's the same.** There's one column, so vertical lines cut through the middle of each
   line of text.

## Ways to fix it that keep the grid

Ranked by how much they help for how little they change:

1. **A quiet backing behind running text.** Give lede paragraphs, section ledes, notes and the inner
   pages' text a background of the page colour, slightly see-through, with a little padding, like a
   strip of paper laid on graph paper. The grid stays in the margins, between sections and behind
   the headings.
2. **Pin the grid to the column.** Position the background so a major line sits exactly at the
   column's edge, with the text a set distance inside it, like the margin line of a notebook. That
   ends the accidental slicing at every window width. The column is 1120 px wide, and 1152 (nine
   squares) would make both edges land on lines.
3. **Fainter major lines everywhere**, say 1 px or 35%. Simple, but it changes the look most, so
   it's last.
4. **Fit line spacing to the grid** (a 32 px line height for body text), so lines of text sit between
   grid lines. It looks like ruled paper, but it breaks as soon as anything has a different height,
   so it's fragile.

My suggestion: 1 and 2 together. They keep the grid at full strength where nothing is being read,
and make every page look deliberate at every width.

## Next

Josh picks a direction. After the plugins are in, their audits run over the same pages, and then the
edits get planned.
