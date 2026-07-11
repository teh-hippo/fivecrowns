import { lastFilledIndex, cap, unitSingular } from './games.js';

/*
 * Pure game-state helpers: build a fresh state, normalise a loaded (and possibly
 * corrupt) save into the shape the engine expects, and serialise only the fields
 * a game needs. No DOM or storage access, so these can be unit-tested directly.
 */

function defaultState(game) {
  return { gameId: game.id, started: false, players: [], nextId: 1, scores: {}, hands: [] };
}

function normalizeState(game, s) {
  const base = defaultState(game);
  if (!s || typeof s !== 'object') return base;

  const seen = new Set();
  const players = [];
  let maxId = 0;
  (Array.isArray(s.players) ? s.players : []).forEach((p) => {
    if (!p || typeof p.id !== 'string' || seen.has(p.id)) return;
    seen.add(p.id);
    const seed = (typeof p.seed === 'number' && Number.isFinite(p.seed)) ? p.seed : 0;
    const name = (typeof p.name === 'string' && p.name.trim()) ? p.name : cap(unitSingular(game)) + ' ' + (players.length + 1);
    players.push({ id: p.id, name, seed });
    const m = /^p(\d+)$/.exec(p.id);
    if (m) maxId = Math.max(maxId, parseInt(m[1], 10));
  });
  base.players = players;
  base.started = !!s.started;
  base.nextId = Math.max(maxId + 1, (typeof s.nextId === 'number' ? s.nextId : 0), players.length + 1);

  // Copy any extra per-game state fields the game declares (e.g. Five Crowns'
  // variant, wildOrder, cardOrder and revealedCount), tolerating only strings,
  // finite numbers and arrays from a save.
  (game.stateFields || []).forEach((f) => {
    const v = s[f];
    if (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) base[f] = v;
    else if (Array.isArray(v)) base[f] = v.slice();
  });

  if (game.entry === 'cell') {
    const src = (s.scores && typeof s.scores === 'object') ? s.scores : {};
    const fixed = game.rounds.kind === 'fixed' ? game.rounds.count : null;
    players.forEach((p) => {
      let a = Array.isArray(src[p.id])
        ? src[p.id].map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null))
        : [];
      if (fixed) {
        a = a.slice(0, fixed);
        while (a.length < fixed) a.push(null);
      } else {
        a = a.slice(0, lastFilledIndex(a) + 1); // trim trailing blanks
      }
      base.scores[p.id] = a;
    });
  } else {
    const hands = Array.isArray(s.hands) ? s.hands : [];
    base.hands = hands
      .filter((h) => h && typeof h === 'object' && typeof h.bidderId === 'string' && h.deltas && typeof h.deltas === 'object')
      .map((h, i) => ({
        id: typeof h.id === 'string' ? h.id : 'h' + i,
        bidderId: h.bidderId,
        bid: h.bid,
        bidValue: h.bidValue,
        made: !!h.made,
        tricks: (h.tricks && typeof h.tricks === 'object') ? h.tricks : {},
        deltas: h.deltas,
      }));
  }
  return base;
}

// Serialize only the fields a game needs, so Five Crowns keeps its original
// `fivecrowns:v1` shape and open cell games never persist a trailing blank row.
function serializeState(game, st) {
  const out = {
    started: st.started,
    players: st.players.map((p) => ({ id: p.id, name: p.name, seed: p.seed })),
    nextId: st.nextId,
  };
  if (game.entry === 'cell') {
    const scores = {};
    const fixed = game.rounds.kind === 'fixed';
    st.players.forEach((p) => {
      let a = (st.scores[p.id] || []).slice();
      if (!fixed) a = a.slice(0, lastFilledIndex(a) + 1);
      scores[p.id] = a;
    });
    out.scores = scores;
  } else {
    out.hands = st.hands || [];
  }
  // Persist any extra per-game state fields the game declares.
  (game.stateFields || []).forEach((f) => {
    if (st[f] !== undefined) out[f] = Array.isArray(st[f]) ? st[f].slice() : st[f];
  });
  return out;
}

export { defaultState, normalizeState, serializeState };
