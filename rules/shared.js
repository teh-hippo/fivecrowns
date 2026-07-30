const TROPHY = '\u{1F3C6} ';
const DART = '\u{1F3AF} ';
// A reveal that counted every player down would outlast the moment, so it stops
// at the podium.
const PODIUM_PLACES = 3;
const CELL_GAME = Object.freeze({
  unitLabel: 'players',
  loseAt: null,
  entry: 'cell',
  allowNegative: false,
  allowMidGameJoin: true,
  minPlayers: 2,
  maxPlayers: 8,
});
const OPEN_ROUNDS = Object.freeze({ kind: 'open' });

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function unitSingular(game) {
  return game.unitLabel === 'sides' ? 'side' : 'player';
}
// Auto-numbered names count up from the size of the roster, so a gap in the
// numbering would otherwise hand out a name someone already has. Two columns
// sharing a name read identically to a screen reader.
function nextUnitName(game, takenNames, from = takenNames.length + 1) {
  const base = cap(unitSingular(game));
  const taken = new Set(
    takenNames.map((name) =>
      String(name == null ? '' : name)
        .trim()
        .toLowerCase(),
    ),
  );
  let n = Math.max(1, from);
  while (taken.has((base + ' ' + n).toLowerCase())) n++;
  return base + ' ' + n;
}
function objectFromEntries(entries) {
  const object = {};
  entries.forEach(([key, value]) => {
    object[key] = value;
  });
  return object;
}
function sumScores(arr) {
  return Array.isArray(arr)
    ? arr.reduce(
        (total, value) => total + (typeof value === 'number' && Number.isFinite(value) ? value : 0),
        0,
      )
    : 0;
}
function lastFilledIndex(arr) {
  if (!Array.isArray(arr)) return -1;
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return i;
  return -1;
}
function leadersOf(totals, winDirection) {
  const ids = Object.keys(totals);
  if (ids.length === 0) return { best: 0, leaders: [], distinct: false };
  const values = ids.map((id) => totals[id]);
  const best = winDirection === 'low' ? Math.min(...values) : Math.max(...values);
  const worst = winDirection === 'low' ? Math.max(...values) : Math.min(...values);
  return { best, leaders: ids.filter((id) => totals[id] === best), distinct: best !== worst };
}
function playerNames(players) {
  return objectFromEntries(players.map((player) => [player.id, player.name]));
}
function joinNames(players, ids) {
  const names = playerNames(players);
  return ids.map((id) => names[id] || id).join(', ');
}
function winnerText(players, leaders, best) {
  const names = joinNames(players, leaders);
  return leaders.length === 1
    ? TROPHY + names + ' wins with ' + best + '!'
    : TROPHY + 'Tie at ' + best + ': ' + names;
}
// Ending a game early settles it on the scores as they stand, so whoever leads
// has won and a tie at the top is still a tie.
function endedEarlyStatus(players, totals, winDirection) {
  const { best, leaders, distinct } = leadersOf(totals, winDirection);
  return {
    phase: 'complete',
    endedEarly: true,
    best,
    leaders: distinct ? leaders : [],
    text: winnerText(players, leaders, best),
  };
}
function ordinal(n) {
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return n + 'th';
  return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
}
// Ranks the table for the end-of-game reveal. Whoever the rules call a winner
// leads, however they scored: 500 gives the game to the side that made its bid
// or to whoever is left standing, and neither is always the highest total.
// Everyone else follows on score, with an equal score sharing a place and the
// next place skipping past the players sharing it.
function standings(players, totals, winDirection, leaders = [], maxPlaces = PODIUM_PLACES) {
  const roster = (Array.isArray(players) ? players : []).filter(
    (player) => player && typeof player.id === 'string',
  );
  const won = new Set(Array.isArray(leaders) ? leaders : []);
  const groups = [];
  const rank = (group) => {
    const sorted = group
      .map((player) => {
        const value = totals ? totals[player.id] : 0;
        return {
          name: player.name,
          score: typeof value === 'number' && Number.isFinite(value) ? value : 0,
        };
      })
      .sort((a, b) => (winDirection === 'low' ? a.score - b.score : b.score - a.score));
    for (let i = 0; i < sorted.length;) {
      let j = i;
      while (j < sorted.length && sorted[j].score === sorted[i].score) j++;
      groups.push(sorted.slice(i, j));
      i = j;
    }
  };
  rank(roster.filter((player) => won.has(player.id)));
  rank(roster.filter((player) => !won.has(player.id)));
  const places = [];
  let place = 1;
  for (const group of groups) {
    if (place > maxPlaces) break;
    places.push({
      place,
      label: ordinal(place),
      names: group.map((entry) => entry.name),
      score: group[0].score,
    });
    place += group.length;
  }
  return places;
}

export {
  TROPHY,
  DART,
  CELL_GAME,
  OPEN_ROUNDS,
  PODIUM_PLACES,
  cap,
  unitSingular,
  nextUnitName,
  objectFromEntries,
  sumScores,
  lastFilledIndex,
  leadersOf,
  playerNames,
  joinNames,
  winnerText,
  endedEarlyStatus,
  ordinal,
  standings,
};
