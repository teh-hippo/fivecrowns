import { lastFilledIndex, cap, unitSingular, objectFromEntries } from './rules/shared.js';

function defaultState(game) {
  return { gameId: game.id, started: false, players: [], nextId: 1, scores: {}, hands: [] };
}

function copyGameFields(game, source, target) {
  (game.stateFields || []).forEach((field) => {
    const value = source[field]; if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) target[field] = value;
    else if (Array.isArray(value)) target[field] = value.slice();
  });
}

function normalizeState(game, source) {
  const base = defaultState(game); if (!source || typeof source !== 'object') return base; const seen = new Set(); let maxId = 0;
  for (const player of Array.isArray(source.players) ? source.players : []) {
    if (!player || typeof player.id !== 'string' || seen.has(player.id)) continue; seen.add(player.id);
    const seed = typeof player.seed === 'number' && Number.isFinite(player.seed) ? player.seed : 0;
    const name = typeof player.name === 'string' && player.name.trim()
      ? player.name : cap(unitSingular(game)) + ' ' + (base.players.length + 1);
    base.players.push({ id: player.id, name, seed }); const match = /^p(\d+)$/.exec(player.id); if (match) maxId = Math.max(maxId, parseInt(match[1], 10));
  }
  base.started = !!source.started; base.nextId = Math.max(maxId + 1, typeof source.nextId === 'number' ? source.nextId : 0, base.players.length + 1);
  copyGameFields(game, source, base);

  if (game.entry === 'hand') {
    base.hands = (Array.isArray(source.hands) ? source.hands : [])
      .filter((hand) => hand && typeof hand === 'object' && typeof hand.bidderId === 'string'
        && hand.deltas && typeof hand.deltas === 'object')
      .map((hand, i) => ({
        id: typeof hand.id === 'string' ? hand.id : 'h' + i,
        bidderId: hand.bidderId, bid: hand.bid, bidValue: hand.bidValue, made: !!hand.made,
        tricks: hand.tricks && typeof hand.tricks === 'object' ? hand.tricks : {}, deltas: hand.deltas,
      }));
    return base;
  }

  const scores = source.scores && typeof source.scores === 'object' ? source.scores : {}; const fixed = game.rounds.kind === 'fixed' ? game.rounds.count : null;
  base.players.forEach((player) => {
    let values = Array.isArray(scores[player.id])
      ? scores[player.id].map((value) => typeof value === 'number' && Number.isFinite(value) ? value : null)
      : [];
    if (fixed != null) {
      values = values.slice(0, fixed); while (values.length < fixed) values.push(null);
    } else values = values.slice(0, lastFilledIndex(values) + 1); base.scores[player.id] = values;
  }); return base;
}

function serializeState(game, state) {
  const out = {
    started: state.started,
    players: state.players.map(({ id, name, seed }) => ({ id, name, seed })),
    nextId: state.nextId,
  }; if (game.entry === 'hand') out.hands = state.hands || [];
  else {
    const fixed = game.rounds.kind === 'fixed';
    out.scores = objectFromEntries(state.players.map((player) => {
      let values = (state.scores[player.id] || []).slice(); if (!fixed) values = values.slice(0, lastFilledIndex(values) + 1); return [player.id, values];
    }));
  }
  copyGameFields(game, state, out); return out;
}

export { defaultState, normalizeState, serializeState };
