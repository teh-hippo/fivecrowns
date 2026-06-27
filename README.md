# Five Crowns Scorer

A minimal, mobile-friendly scorekeeper for three card and dice games:
[Five Crowns](https://en.wikipedia.org/wiki/Five_Crowns_(card_game)), Greed and
the Australian trick-taking game [500](https://en.wikipedia.org/wiki/500_(card_game)).
It is a single static page with no build step and no dependencies, hosted on
GitHub Pages.

Live app: https://teh-hippo.github.io/fivecrowns/

## Games

- **Five Crowns** — 11 rounds, each with its own wild card (3s through Kings).
  Lowest total wins. Complete once the final round is entered for everyone. A
  reverse variant runs the same 11 rounds with the wild cards counting down from
  Kings to 3s.
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
- Customise the number of players (or sides, for 500) and their names; tap a
  name to select the whole thing so you can type a replacement straight over it.
  Drag the grip handle to reorder them on the setup screen (or focus it and use
  the arrow keys), and the names you used are kept as the defaults for the next
  game of that type.
- Quick numeric entry tuned for phones (the number pad shows automatically); a
  **Next player** button pinned top-right steps round the table even on touch
  keypads that have no Return key, and on iOS the keyboard's own Next arrow steps
  through the cells too. 500 uses a chip and stepper dialog so you never type a
  negative score by hand.
- Running totals with the leader highlighted, and a clear winner, target or
  out banner per game.
- Add a player part way through with a custom starting score, so a latecomer can
  be slotted in without restarting, or remove one on the setup screen.
- When a game ends, tap **Play again** to start a fresh game with the same
  players.
- Everything is saved on your device, so a refresh, an app switch or losing
  signal mid-game never loses your scores.
- Installable to your home screen, where it runs full screen like an app.

## How to play

1. Choose a game, then set the players (or sides) and their names.
2. For Five Crowns and Greed, tap any player's cell and type their score, then
   tap the **Next player** button (top-right) to move round the table from where
   you started. It wraps past the last seat and reads **Done** once everyone is
   in, so it never jumps ahead to the next round; a hardware Return or Enter key
   does the same. On iOS you can also use the keyboard's own Next arrow, which
   steps through every cell and carries straight on into the next round. For 500,
   tap **Score hand** and pick the bidder, contract and tricks; the dialog works
   out every side's score.
3. Totals update live and the leader is highlighted as you go.
4. Use **+ Player** / **+ Side** to add someone mid-game, or **Menu** to switch
   games or start a new one.
5. When the game is won, tap **Play again** for a rematch with the same players.

## Local development

Everything is plain HTML, CSS and JavaScript loaded as native ES modules, so
there is no build step and no bundler. The code is split into small modules:
`games.js` holds the game definitions and pure scoring helpers, `state.js` the
pure save and restore logic, and `app.js` the rendering and wiring. The page
loads `app.js`, which imports the other two.

Because browsers do not allow ES modules over `file://`, serve the folder with
any static server rather than opening `index.html` directly:

    python3 -m http.server

then open the printed `http://localhost:8000`.

### Tests

The scoring and save logic is pure (no DOM), so it is covered by a small suite
that runs on Node's built-in test runner with no dependencies:

    npm test

### Installing

The app ships a web manifest and icons, so it can be added to a phone's home
screen and run full screen. It deliberately has no service worker: scores live
in `localStorage` (which an installed app keeps), so the offline value a service
worker would add is small next to its upkeep and update risks.

## Deployment

GitHub Pages serves the site straight from the `main` branch root, so any commit
to `main` publishes automatically. There is no build or pipeline to maintain; a
small GitHub Actions workflow runs the unit tests on each push but does not gate
the deploy.
