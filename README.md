# Five Crowns Scorer

A minimal, mobile-friendly scorekeeper for three card and dice games:
[Five Crowns](https://en.wikipedia.org/wiki/Five_Crowns_(card_game)), Greed and
the Australian trick-taking game [500](https://en.wikipedia.org/wiki/500_(card_game)).
It is a single static page with no build step and no dependencies, hosted on
GitHub Pages.

Live app: https://teh-hippo.github.io/fivecrowns/

## Games

- **Five Crowns** — 11 rounds, each with its own wild card (3s through Kings).
  Lowest total wins. Complete once the final round is entered for everyone.
- **Greed** (dice) — open-ended rounds where each player banks a turn total.
  You need 500 in a single turn to get on the board; a bust scores 0. Highest
  total wins, racing to 5000. When a player reaches 5000 there is exactly one
  more round, then the highest total wins.
- **500** (Australian trick-taking) — open-ended hands scored through a guided
  bid dialog (bidder, suit and level or misère, tricks won). Made bids add their
  value, set bids subtract it, and opponents score 10 per trick. First side to
  500 on its own made bid wins; a side that drops to -500 is out.

## Features

- Pick the game on the setup screen. Each game keeps its own saved progress, so
  switching between them never loses a game in play.
- Customise the number of players (or sides, for 500) and their names.
- Quick numeric entry tuned for phones (the number pad shows automatically); 500
  uses a chip and stepper dialog so you never type a negative score by hand.
- Running totals with the leader highlighted, and a clear winner, target or
  out banner per game.
- Add a player part way through with a custom starting score, so a latecomer can
  be slotted in without restarting.
- Everything is saved in your browser, so a refresh never loses your scores.

## How to play

1. Choose a game, then set the players (or sides) and their names.
2. For Five Crowns and Greed, tap a cell and type each score. For 500, tap
   **Score hand** and pick the bidder, contract and tricks; the dialog works out
   every side's score.
3. Totals update live and the leader is highlighted as you go.
4. Use **+ Player** / **+ Side** to add someone mid-game, or **Menu** to switch
   games or start a new one.

## Local development

Everything is plain HTML, CSS and JavaScript using classic `<script>` tags, so
there is no build step and no bundler. Open `index.html` directly in a browser,
or serve the folder with any static server.

## Deployment

GitHub Pages serves the site straight from the `main` branch root, so any commit
to `main` publishes automatically. There is no build or pipeline to maintain.
