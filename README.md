# Five Crowns Scorer

A dependency-free, mobile-first scorekeeper for [Five Crowns](https://en.wikipedia.org/wiki/Five_Crowns_(card_game)), Greed and Australian [500](https://en.wikipedia.org/wiki/500_(card_game)). It is a static GitHub Pages app with no build step.

Live app: https://teh-hippo.github.io/fivecrowns/

## Games

- **Five Crowns**: 11 rounds, lowest total wins. Play 3s to Kings, Kings to 3s, shuffle the wilds with Random, or independently shuffle card counts and wilds with Super Random. Random uses one wild reel. Super Random uses separate card-count and wild reels that are staggered and spin in opposite directions. Scores remain locked until the round is revealed.
- **Greed**: bank turn totals, score at least 500 in one turn to get on the board, and race to 5000. Reaching 5000 starts one final round.
- **500**: record the bidder, contract and tricks. Made bids add their value, set bids subtract it, and opponents score 10 per trick. A side wins by reaching 500 on its own bid; dropping to -500 puts it out.

## Features

- Separate saved games for each ruleset.
- Remembered, reorderable player or side names.
- Phone-friendly numeric entry with iOS Previous and Next controls.
- Live totals, leader highlighting and winner messages.
- Mid-game player additions with a starting score.
- Guided hand scoring for 500.
- Installable dark interface with local progress storage.

## Use

1. Choose a game, variant and players.
2. Enter each round's scores, or use **Score hand** in 500.
3. Use **Menu** to switch games or start again.
4. Use **Play again** after the game ends.

## Development

The app is plain HTML, CSS and native JavaScript modules. `app.js` composes the game registry, state helpers, browser utilities and rule modules. Serve the repository over HTTP because browsers block modules loaded through `file://`:

```sh
python3 -m http.server
```

Run the pure scoring and state tests with:

```sh
npm test
```

## Deployment

GitHub Pages serves `main` from the repository root. Pushing to `main` deploys the static files, while GitHub Actions runs the Node test suite.
