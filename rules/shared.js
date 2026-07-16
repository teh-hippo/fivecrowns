const TROPHY = '\u{1F3C6} '; const DART = '\u{1F3AF} ';
const CELL_GAME = Object.freeze({
  unitLabel: 'players', loseAt: null, entry: 'cell', allowNegative: false, minPlayers: 2, maxPlayers: 8,
}); const OPEN_ROUNDS = Object.freeze({ kind: 'open' });

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function unitSingular(game) { return game.unitLabel === 'sides' ? 'side' : 'player'; }
function objectFromEntries(entries) {
  const object = {}; entries.forEach(([key, value]) => { object[key] = value; }); return object;
}
function sumScores(arr) {
  return Array.isArray(arr)
    ? arr.reduce((total, value) => total + (typeof value === 'number' && Number.isFinite(value) ? value : 0), 0)
    : 0;
}
function lastFilledIndex(arr) { if (!Array.isArray(arr)) return -1; for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return i; return -1; }
function leadersOf(totals, winDirection) {
  const ids = Object.keys(totals); if (ids.length === 0) return { best: 0, leaders: [], distinct: false }; const values = ids.map((id) => totals[id]);
  const best = winDirection === 'low' ? Math.min(...values) : Math.max(...values); const worst = winDirection === 'low' ? Math.max(...values) : Math.min(...values);
  return { best, leaders: ids.filter((id) => totals[id] === best), distinct: best !== worst };
}
function playerNames(players) { return objectFromEntries(players.map((player) => [player.id, player.name])); }
function joinNames(players, ids) { const names = playerNames(players); return ids.map((id) => names[id] || id).join(', '); }
function winnerText(players, leaders, best) {
  const names = joinNames(players, leaders);
  return leaders.length === 1
    ? TROPHY + names + ' wins with ' + best + '!'
    : TROPHY + 'Tie at ' + best + ': ' + names;
}

export {
  TROPHY, DART, CELL_GAME, OPEN_ROUNDS,
  cap, unitSingular, objectFromEntries, sumScores, lastFilledIndex,
  leadersOf, playerNames, joinNames, winnerText,
};
