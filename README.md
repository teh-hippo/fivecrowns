# Five Crowns Scorer

A dependency-free, mobile-first scorekeeper for Five Crowns, Greed and Australian 500.

Live app: https://teh-hippo.github.io/fivecrowns/

## Games

- **Five Crowns**: lowest total wins across 11 rounds. Random shuffles wilds; Super Random independently shuffles card counts and wilds, then reveals them on opposite, staggered reels. Random modes nominate a first dealer and rotate the deal each round unless that is turned off at setup, in which case every reveal asks who deals before it will spin, and naming someone other than the rotation reseats the table from that round on. A spin runs its course once it starts.
- **Greed**: get on the board with 500 in one turn and race to 5000, followed by one final round. Rounds played past that final one stay on the sheet, struck through, so correcting an earlier score never looks like it swallowed them.
- **500**: record each contract and tricks. Reach 500 on a made bid to win; falling to -500 puts a side out. Sides are fixed once the game starts, so nobody joins part-way.

Games save separately in local storage. The interface supports remembered player names, iOS numeric entry, live totals, mid-game additions and installed home-screen use.

A game can be called early from the menu, which settles it on the scores as they stand, and picked back up from the same place. However a game ends, the winner is revealed on a podium counted down from third place to first, with a replay and a way back to it from the menu.

Anyone joining part-way is scored on the sheet rather than through a hidden offset: they take a 0 for every round already played, and any starting score they are given lands on the most recent of those rounds. Each game's player limit applies to those additions as well as to setup.

A service worker caches the whole app on first visit, so once it has loaded it keeps working with no signal at all. Pages serves the branch directly, with no build step to fingerprint filenames, so nothing can be told apart by its URL between one deploy and the next: the code and markup are read from the network first and the cache only answers when the network cannot be reached. Images alone are served straight from the cache.

## Development

The repository is a static site with no build step and no runtime dependencies. `app.js` is a bootstrap; `app/main.js` holds the browser UI behind a side-effect-free `createApp()`, so it can be built more than once and tested. `reel.js` drives the reveal reel and its landing effects, `sw.js` the offline cache, and `state.js`, `games.js` and `rules/*.js` the pure rules and state logic, with shared helpers in `lib/*.js` and styles split across `css/*.css`.

The rules layer is deliberately free of any UI or personal configuration: `lib/dealer-rig.js` owns which dealers get a helping hand and passes the rules a resolver, so adding a preference never means touching how a game is played. Each rig rule carries its own default, so a stored setting only ever records a deliberate change rather than standing in for one that was never made.

The Node tests in `test/` cover the rules, the state contracts and, through the [jsdom](https://github.com/jsdom/jsdom) harness in `test/helpers/`, the browser behaviour.

```sh
npm install     # dev tooling only, nothing ships to the browser
python3 -m http.server
npm test
npm run lint    # ESLint, Stylelint and Prettier
```

Prettier owns formatting. Stylelint autofix strips `-webkit-` prefixes that iOS before 15.4 still needs, so `property-no-vendor-prefix` is off deliberately.

GitHub Pages deploys the root of `main`; GitHub Actions runs the linters, the tests and a coverage report.
