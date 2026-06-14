# Five Crowns Scorer

A minimal, mobile-friendly scorekeeper for the card game
[Five Crowns](https://en.wikipedia.org/wiki/Five_Crowns_(card_game)). It is a
single static page with no build step and no dependencies, hosted on GitHub
Pages.

Live app: https://teh-hippo.github.io/fivecrowns/

## Features

- Pick the number of players and their names, then start scoring.
- All 11 rounds laid out at a glance, each labelled with its wild card
  (3s through Kings).
- Quick numeric entry tuned for phones (the number pad shows automatically).
- Running totals with the current leader highlighted; the lowest total wins.
- Add a player part way through a game with a custom starting score, so a
  latecomer can be slotted in without restarting.
- The game is saved in your browser, so a refresh never loses your scores.

## How to play

1. Choose how many players are in the game and give them names.
2. Tap a cell and type each player's score for the round.
3. Totals update live and the leader is highlighted as you go.
4. When the final round is entered for everyone, the winner is announced
   (lowest total wins).

Use **+ Player** to add someone mid-game with a starting score, or **New game**
to clear the sheet and start again.

## Local development

Everything is plain HTML, CSS and JavaScript, so just open `index.html`, or
serve the folder with any static server:

```sh
bunx serve .
```

## Deployment

GitHub Pages serves the site straight from the `main` branch root, so any commit
to `main` publishes automatically. There is no build or pipeline to maintain.
