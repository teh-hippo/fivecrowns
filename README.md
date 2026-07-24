# Five Crowns Scorer

A dependency-free, mobile-first scorekeeper for Five Crowns, Greed and Australian 500.

Live app: https://teh-hippo.github.io/fivecrowns/

## Games

- **Five Crowns**: lowest total wins across 11 rounds. Random shuffles wilds; Super Random independently shuffles card counts and wilds, then reveals them on opposite, staggered reels. Random modes can optionally nominate a first dealer and rotate the deal each round.
- **Greed**: get on the board with 500 in one turn and race to 5000, followed by one final round.
- **500**: record each contract and tricks. Reach 500 on a made bid to win; falling to -500 puts a side out.

Games save separately in local storage. The interface supports remembered player names, iOS numeric entry, live totals, mid-game additions and installed home-screen use.

## Development

The repository is a static site with no build step or runtime dependencies. `app.js` holds the browser UI, `reel.js` the reveal reel and its landing effects, and `state.js`, `games.js` and `rules/*.js` the pure rules and state logic, with shared helpers in `lib/*.js` and styles split across `css/*.css`. The Node tests in `test/` cover the rules and state contracts.

```sh
python3 -m http.server
npm test
```

GitHub Pages deploys the root of `main`; GitHub Actions runs the Node tests.
