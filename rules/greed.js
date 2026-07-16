import { CELL_GAME, OPEN_ROUNDS, DART, objectFromEntries, leadersOf, joinNames, winnerText } from './shared.js';

const GREED_TARGET = 5000; const GREED_ON_BOARD = 500; const GREED_FINAL_ROUNDS_AFTER_TARGET = 1;

function greedRunningTotals(seed, scores) {
  const out = []; let onBoard = (seed || 0) > 0; let running = seed || 0;
  for (let i = 0; i < scores.length; i++) {
    const v = (typeof scores[i] === 'number' && Number.isFinite(scores[i])) ? scores[i] : 0; if (!onBoard && scores[i] != null && v >= GREED_ON_BOARD) onBoard = true;
    if (onBoard) running += v; out.push(running);
  }
  return out;
}

const greed = {
  ...CELL_GAME,
  id: 'greed', name: 'Greed', storageKey: 'greed:v1',
  winDirection: 'high', target: GREED_TARGET, onBoardMin: GREED_ON_BOARD, rounds: OPEN_ROUNDS,
  defaultNames() { return ['Player 1', 'Player 2']; },
  roundLabel(i) { return { num: String(i + 1), sub: '' }; },
  resolve(players, state) {
    const runs = objectFromEntries(players.map((player) => [
      player.id, greedRunningTotals(player.seed || 0, state.scores[player.id] || []),
    ]));
    const reached = players.map((player) => runs[player.id].findIndex((value) => value >= GREED_TARGET))
      .filter((round) => round >= 0);
    const finalRound = reached.length ? Math.min(...reached) + GREED_FINAL_ROUNDS_AFTER_TARGET : null;
    const totals = objectFromEntries(players.map((player) => {
      const run = runs[player.id]; const round = finalRound == null ? run.length - 1 : Math.min(finalRound, run.length - 1);
      return [player.id, round < 0 ? player.seed || 0 : run[round]];
    })); const { best, leaders, distinct } = leadersOf(totals, 'high'); const highlight = distinct ? leaders : [];
    if (finalRound == null) return { totals, status: { phase: 'inProgress', best, leaders: highlight, text: '' } };
    const filledThrough = players.every((player) => {
      const scores = state.scores[player.id] || []; for (let round = 0; round <= finalRound; round++) if (scores[round] == null) return false; return true;
    });
    if (filledThrough) return {
      totals, status: { phase: 'complete', best, leaders: highlight, text: winnerText(players, leaders, best), finalRound },
    };
    return {
      totals,
      status: {
        phase: 'targetReached', best, leaders: highlight, finalRound,
        text: DART + joinNames(players, leaders) + ' reached ' + GREED_TARGET + ' \u2014 one final round, then highest wins',
      },
    };
  },
};

export { greed, greedRunningTotals, GREED_TARGET, GREED_ON_BOARD, GREED_FINAL_ROUNDS_AFTER_TARGET };
