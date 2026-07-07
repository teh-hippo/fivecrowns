/*
 * Game definitions for the multi-game scorer.
 *
 * Plain classic script (no module system): defines a top-level `const GAMES`
 * registry that `app.js` (loaded after it) reads directly. Each game is a plain
 * object implementing the shared engine contract:
 *
 *   id, name, storageKey, unitLabel
 *   winDirection 'low' | 'high', target | null, loseAt | null, onBoardMin | null
 *   rounds { kind:'fixed', count } | { kind:'open' }
 *   entry 'cell' | 'hand'
 *   allowNegative, minPlayers, maxPlayers, defaultNames()
 *   roundLabel(i, state) -> { num, sub, masked? }
 *   resolve(players, state) -> { totals, status }
 *   // optional per-game setup variants (see Five Crowns):
 *   variants { field, default, options:[{value,label,hint}] }
 *   stateFields []                    // extra state fields state.js persists
 *   initVariant(variant) -> extra     // extra state fields set when a game starts
 *       status = { phase:'inProgress'|'targetReached'|'complete'|'out',
 *                  best, leaders, text, finalRound? }
 *   // hand games only:
 *   scoreHand(input, players) -> { deltas, meta }
 *   handSummary(hand, players) -> string
 *   hand = { newDraft, draftFromRecord, build, validate, toRecord }   (DOM via injected ui)
 *
 * `resolve` returns totals and status together so they stay consistent: totals
 * are capped at the terminal point (Greed's final round, 500's deciding hand).
 * The scoring helpers are pure (no DOM) so they can be unit-tested in isolation;
 * the only DOM-touching code is `hand.build`, which receives UI helpers.
 */

const TROPHY = '\u{1F3C6} ';
const DART = '\u{1F3AF} ';

/* ---------- shared helpers ---------- */
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function unitSingular(game) { return game.unitLabel === 'sides' ? 'side' : 'player'; }

function sumScores(arr) {
  let total = 0;
  if (Array.isArray(arr)) {
    for (const v of arr) total += (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
  }
  return total;
}

function lastFilledIndex(arr) {
  if (!Array.isArray(arr)) return -1;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return i;
  }
  return -1;
}

// Best total in a direction; `leaders` are the ids tied at best, and `distinct`
// is false when every total is level (so an all-equal board highlights nobody).
function leadersOf(totals, winDirection) {
  const ids = Object.keys(totals);
  if (ids.length === 0) return { best: 0, leaders: [], distinct: false };
  const values = ids.map((id) => totals[id]);
  const best = winDirection === 'low' ? Math.min(...values) : Math.max(...values);
  const worst = winDirection === 'low' ? Math.max(...values) : Math.min(...values);
  const leaders = ids.filter((id) => totals[id] === best);
  return { best, leaders, distinct: best !== worst };
}

function joinNames(players, ids) {
  const byId = {};
  players.forEach((p) => { byId[p.id] = p.name; });
  return ids.map((id) => byId[id] || id).join(', ');
}

// Shared "X wins / Tie" banner text from a set of tied winners.
function winnerText(players, leaders, best) {
  const names = joinNames(players, leaders);
  return leaders.length === 1
    ? TROPHY + names + ' wins with ' + best + '!'
    : TROPHY + 'Tie at ' + best + ': ' + names;
}

/* ---------- Five Crowns ---------- */
const FIVE_CROWNS_WILDS = ['3s', '4s', '5s', '6s', '7s', '8s', '9s', '10s', 'Jacks', 'Queens', 'Kings'];
const FIVE_CROWNS_ROUNDS = FIVE_CROWNS_WILDS.length; // 11
const FIVE_CROWNS_MASK = '\u2014'; // placeholder shown for an unrevealed Random wild

function shuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The wild order for a variant: 'up' as printed, 'down' reversed, 'random' shuffled.
function fiveCrownsWildOrder(variant) {
  if (variant === 'down') return FIVE_CROWNS_WILDS.slice().reverse();
  if (variant === 'random') return shuffle(FIVE_CROWNS_WILDS);
  return FIVE_CROWNS_WILDS.slice();
}

// A Random round is known once the round above it is fully entered; round 0 is
// always known. Only consulted for the 'random' variant (up/down never mask).
function fiveCrownsRevealed(i, state) {
  if (i <= 0) return true;
  const players = (state && state.players) || [];
  if (players.length === 0) return false;
  return players.every((p) => {
    const a = (state.scores && state.scores[p.id]) || [];
    return a[i - 1] != null;
  });
}

const fiveCrowns = {
  id: 'fivecrowns',
  name: 'Five Crowns',
  storageKey: 'fivecrowns:v1',
  unitLabel: 'players',
  winDirection: 'low',
  target: null,
  loseAt: null,
  onBoardMin: null,
  rounds: { kind: 'fixed', count: FIVE_CROWNS_ROUNDS },
  entry: 'cell',
  allowNegative: false,
  minPlayers: 2,
  maxPlayers: 8,
  defaultNames() { return ['Player 1', 'Player 2', 'Player 3']; },
  variants: {
    field: 'variant',
    label: 'Wild order',
    default: 'up',
    options: [
      { value: 'up', label: 'Up', hint: '3s \u2192 K' },
      { value: 'down', label: 'Down', hint: 'K \u2192 3s' },
      { value: 'random', label: 'Random', hint: 'hidden' },
    ],
  },
  stateFields: ['variant', 'wildOrder'],
  initVariant(variant) {
    const known = this.variants.options.some((o) => o.value === variant);
    const v = known ? variant : this.variants.default;
    return { variant: v, wildOrder: fiveCrownsWildOrder(v) };
  },
  roundLabel(i, state) {
    const num = String(i + 1);
    if (state && state.variant === 'random' && !fiveCrownsRevealed(i, state)) {
      return { num, sub: FIVE_CROWNS_MASK, masked: true };
    }
    const order = (state && state.wildOrder) || FIVE_CROWNS_WILDS;
    return { num, sub: order[i] };
  },
  resolve(players, state) {
    const totals = {};
    players.forEach((p) => { totals[p.id] = (p.seed || 0) + sumScores(state.scores[p.id] || []); });
    const { best, leaders, distinct } = leadersOf(totals, 'low');
    const complete = players.length > 0 && players.every((p) => {
      const a = state.scores[p.id];
      return a && a[FIVE_CROWNS_ROUNDS - 1] != null;
    });
    const highlight = distinct ? leaders : [];
    if (complete) {
      return { totals, status: { phase: 'complete', best, leaders: highlight, text: winnerText(players, leaders, best) } };
    }
    return { totals, status: { phase: 'inProgress', best, leaders: highlight, text: '' } };
  },
};

/* ---------- Greed (dice) ---------- */
const GREED_TARGET = 5000;
const GREED_ON_BOARD = 500;

// Running total per round respecting "get on the board": with a positive seed the
// player is already on; otherwise nothing counts until their first turn >= 500.
function greedRunningTotals(seed, scores) {
  const out = [];
  let onBoard = (seed || 0) > 0;
  let running = seed || 0;
  for (let i = 0; i < scores.length; i++) {
    const v = (typeof scores[i] === 'number' && Number.isFinite(scores[i])) ? scores[i] : 0;
    if (!onBoard) {
      if (scores[i] != null && v >= GREED_ON_BOARD) { onBoard = true; running += v; }
    } else {
      running += v;
    }
    out.push(running);
  }
  return out;
}

const greed = {
  id: 'greed',
  name: 'Greed',
  storageKey: 'greed:v1',
  unitLabel: 'players',
  winDirection: 'high',
  target: GREED_TARGET,
  loseAt: null,
  onBoardMin: GREED_ON_BOARD,
  rounds: { kind: 'open' },
  entry: 'cell',
  allowNegative: false,
  minPlayers: 2,
  maxPlayers: 8,
  defaultNames() { return ['Player 1', 'Player 2']; },
  roundLabel(i) { return { num: String(i + 1), sub: '' }; },
  resolve(players, state) {
    const runs = {};
    players.forEach((p) => { runs[p.id] = greedRunningTotals(p.seed || 0, state.scores[p.id] || []); });

    // R = first round at which any player's running total reaches the target.
    let triggerRound = -1;
    players.forEach((p) => {
      const r = runs[p.id].findIndex((v) => v >= GREED_TARGET);
      if (r !== -1 && (triggerRound === -1 || r < triggerRound)) triggerRound = r;
    });
    const finalRound = triggerRound === -1 ? null : triggerRound + 1;

    // Totals are capped at the final round so scores entered beyond it (possible
    // after editing an earlier cell) never affect the result.
    const totals = {};
    players.forEach((p) => {
      const run = runs[p.id];
      if (run.length === 0) { totals[p.id] = p.seed || 0; return; }
      const idx = finalRound == null ? run.length - 1 : Math.min(finalRound, run.length - 1);
      totals[p.id] = run[idx];
    });

    const { best, leaders, distinct } = leadersOf(totals, 'high');
    const highlight = distinct ? leaders : [];

    if (finalRound == null) {
      return { totals, status: { phase: 'inProgress', best, leaders: highlight, text: '' } };
    }
    // Complete only when every cell through the final round is filled (no gaps).
    const filledThrough = players.every((p) => {
      const a = state.scores[p.id] || [];
      for (let r = 0; r <= finalRound; r++) { if (a[r] == null) return false; }
      return true;
    });
    if (filledThrough) {
      return { totals, status: { phase: 'complete', best, leaders: highlight, text: winnerText(players, leaders, best), finalRound } };
    }
    return {
      totals,
      status: {
        phase: 'targetReached',
        best,
        leaders: highlight,
        text: DART + joinNames(players, leaders) + ' reached ' + GREED_TARGET + ' \u2014 one final round, then highest wins',
        finalRound,
      },
    };
  },
};

/* ---------- 500 (Australian trick-taking) ---------- */
const FIVE00_TARGET = 500;
const FIVE00_LOSE = -500;
const SUITS = [
  { id: 'spades', sym: '\u2660', name: 'Spades', index: 0 },
  { id: 'clubs', sym: '\u2663', name: 'Clubs', index: 1 },
  { id: 'diamonds', sym: '\u2666', name: 'Diamonds', index: 2 },
  { id: 'hearts', sym: '\u2665', name: 'Hearts', index: 3 },
  { id: 'nt', sym: 'NT', name: 'No trumps', index: 4 },
];
const SUIT_BY_ID = {};
SUITS.forEach((s) => { SUIT_BY_ID[s.id] = s; });

function suitContractValue(suitId, level) {
  const suit = SUIT_BY_ID[suitId];
  if (!suit) return 0;
  return (level - 6) * 100 + 40 + suit.index * 20;
}

function contractValue(bid) {
  if (!bid) return 0;
  if (bid.kind === 'misere') return 250;
  if (bid.kind === 'open') return 500;
  return suitContractValue(bid.suit, bid.level);
}

// Canonical rank order for the picker: misère above the 7-bids, open misère
// between 10 diamonds and 10 hearts.
function buildBidOrder() {
  const order = [];
  for (let level = 6; level <= 10; level++) {
    for (const suit of SUITS) {
      order.push({ kind: suit.id === 'nt' ? 'nt' : 'suit', suit: suit.id, level });
      if (level === 7 && suit.id === 'nt') order.push({ kind: 'misere' });
      if (level === 10 && suit.id === 'diamonds') order.push({ kind: 'open' });
    }
  }
  return order;
}
const FIVE00_BID_ORDER = buildBidOrder();

function bidLabel(bid) {
  if (!bid) return '';
  if (bid.kind === 'misere') return 'Mis\u00e8re';
  if (bid.kind === 'open') return 'Open mis\u00e8re';
  const suit = SUIT_BY_ID[bid.suit];
  return String(bid.level) + (suit ? suit.sym : '');
}

const five00 = {
  id: 'five00',
  name: '500',
  storageKey: 'five00:v1',
  unitLabel: 'sides',
  winDirection: 'high',
  target: FIVE00_TARGET,
  loseAt: FIVE00_LOSE,
  onBoardMin: null,
  rounds: { kind: 'open' },
  entry: 'hand',
  allowNegative: true,
  minPlayers: 2,
  maxPlayers: 6,
  defaultNames() { return ['Us', 'Them']; },
  suits: SUITS,
  bidOrder: FIVE00_BID_ORDER,
  bidLabel,
  contractValue,
  roundLabel(i) { return { num: 'Hand ' + (i + 1), sub: '' }; },

  // input = { bidderId, bid, tricks:{ pid } } where tricks sums to 10 for suit/NT.
  scoreHand(input, players) {
    const bid = input.bid;
    const value = contractValue(bid);
    const bidderId = input.bidderId;
    const tricks = input.tricks || {};
    const bidderTricks = tricks[bidderId] || 0;
    const deltas = {};
    let made;
    if (bid.kind === 'misere' || bid.kind === 'open') {
      made = bidderTricks === 0;
      deltas[bidderId] = made ? value : -value;
      players.forEach((p) => { if (p.id !== bidderId) deltas[p.id] = 0; });
    } else {
      made = bidderTricks >= bid.level;
      const slam = bidderTricks === 10 && value < 250;
      deltas[bidderId] = made ? (slam ? 250 : value) : -value;
      players.forEach((p) => { if (p.id !== bidderId) deltas[p.id] = 10 * (tricks[p.id] || 0); });
    }
    return { deltas, meta: { bidderId, bid, bidValue: value, made, tricks } };
  },

  handSummary(hand, players) {
    const byId = {};
    players.forEach((p) => { byId[p.id] = p.name; });
    const who = byId[hand.bidderId] || hand.bidderId;
    return who + ' ' + bidLabel(hand.bid) + (hand.made ? ' \u2713' : ' \u2717');
  },

  resolve(players, state) {
    const hands = Array.isArray(state.hands) ? state.hands : [];
    const running = {};
    players.forEach((p) => { running[p.id] = p.seed || 0; });
    const totals = {};
    players.forEach((p) => { totals[p.id] = p.seed || 0; });

    // Scan hands in order and stop at the first terminal event (a made bid that
    // reaches +500 wins; otherwise a side at or below -500 is out). Hands after
    // the deciding hand are ignored, so edits/deletes always recompute safely.
    let terminal = null;
    for (let i = 0; i < hands.length; i++) {
      const h = hands[i];
      players.forEach((p) => { running[p.id] += (h.deltas && h.deltas[p.id]) || 0; });
      if (h.made && running[h.bidderId] >= FIVE00_TARGET) {
        terminal = { type: 'win', winnerId: h.bidderId };
      } else {
        const outs = players.filter((p) => running[p.id] <= FIVE00_LOSE).map((p) => p.id);
        if (outs.length) terminal = { type: 'out', outIds: outs };
      }
      if (terminal) { players.forEach((p) => { totals[p.id] = running[p.id]; }); break; }
    }
    if (!terminal) players.forEach((p) => { totals[p.id] = running[p.id]; });

    const { best, leaders, distinct } = leadersOf(totals, 'high');
    if (terminal && terminal.type === 'win') {
      return { totals, status: { phase: 'complete', best, leaders: [terminal.winnerId], text: winnerText(players, [terminal.winnerId], totals[terminal.winnerId]) } };
    }
    if (terminal && terminal.type === 'out') {
      const survivors = players.filter((p) => terminal.outIds.indexOf(p.id) === -1).map((p) => p.id);
      const winners = survivors.length ? survivors : leaders;
      // Report each out side's actual total, not the -500 threshold (a side can
      // overshoot it), matching the "with <total>" style of the other banners.
      const outText = terminal.outIds.map((id) => joinNames(players, [id]) + ' out at ' + totals[id]).join(', ');
      return { totals, status: { phase: 'out', best, leaders: winners, text: TROPHY + joinNames(players, winners) + ' win \u2014 ' + outText } };
    }
    return { totals, status: { phase: 'inProgress', best, leaders: distinct ? leaders : [], text: '' } };
  },
};

// 500 hand-entry dialog. Lives on the game object so the engine stays
// game-agnostic; receives DOM helpers (`ui`) rather than touching the DOM here.
five00.hand = {
  _initTricks(draft, players, kind, level) {
    const tricks = {};
    players.forEach((p) => { tricks[p.id] = 0; });
    if (kind === 'suit' || kind === 'nt') {
      tricks[draft.bidderId] = level;
      const opp = players.find((p) => p.id !== draft.bidderId);
      if (opp) tricks[opp.id] = 10 - level;
    }
    draft.tricks = tricks;
  },
  newDraft(players) {
    const tricks = {};
    players.forEach((p) => { tricks[p.id] = 0; });
    return { bidderId: players[0].id, bid: null, tricks };
  },
  draftFromRecord(h) {
    return { bidderId: h.bidderId, bid: h.bid ? Object.assign({}, h.bid) : null, tricks: Object.assign({}, h.tricks) };
  },
  _sum(draft, players) {
    let s = 0;
    players.forEach((p) => { s += draft.tricks[p.id] || 0; });
    return s;
  },
  build(container, draft, players, ui, onChange) {
    const el = ui.el, chip = ui.chip, labeledStepper = ui.labeledStepper;
    const nameOf = (id) => { const p = players.find((x) => x.id === id); return p ? p.name : id; };

    container.appendChild(el('h3', { class: 'hand-section' }, 'Bidder'));
    const bidderChips = el('div', { class: 'chips' });
    players.forEach((p) => {
      bidderChips.appendChild(chip(p.name, draft.bidderId === p.id, () => {
        draft.bidderId = p.id;
        if (draft.bid) five00.hand._initTricks(draft, players, draft.bid.kind, draft.bid.level);
        onChange();
      }, 'Bidder ' + p.name));
    });
    container.appendChild(bidderChips);

    container.appendChild(el('h3', { class: 'hand-section' }, 'Contract'));
    const suitChips = el('div', { class: 'chips' });
    SUITS.forEach((s) => {
      const sel = draft.bid && (draft.bid.kind === 'suit' || draft.bid.kind === 'nt') && draft.bid.suit === s.id;
      suitChips.appendChild(chip(s.sym, sel, () => {
        const kind = s.id === 'nt' ? 'nt' : 'suit';
        const level = (draft.bid && draft.bid.level) || 6;
        draft.bid = { kind, suit: s.id, level };
        five00.hand._initTricks(draft, players, kind, level);
        onChange();
      }, s.name));
    });
    container.appendChild(suitChips);
    const special = el('div', { class: 'chips' });
    special.appendChild(chip('Mis\u00e8re', draft.bid && draft.bid.kind === 'misere', () => {
      draft.bid = { kind: 'misere' };
      five00.hand._initTricks(draft, players, 'misere');
      onChange();
    }, 'Mis\u00e8re'));
    special.appendChild(chip('Open mis\u00e8re', draft.bid && draft.bid.kind === 'open', () => {
      draft.bid = { kind: 'open' };
      five00.hand._initTricks(draft, players, 'open');
      onChange();
    }, 'Open mis\u00e8re'));
    container.appendChild(special);

    if (draft.bid && (draft.bid.kind === 'suit' || draft.bid.kind === 'nt')) {
      container.appendChild(labeledStepper('Tricks bid', draft.bid.level, 6, 10, (v) => {
        draft.bid.level = v;
        five00.hand._initTricks(draft, players, draft.bid.kind, v);
        onChange();
      }));
    }

    if (draft.bid) {
      container.appendChild(el('h3', { class: 'hand-section' }, 'Tricks won'));
      const kind = draft.bid.kind;
      if (kind === 'misere' || kind === 'open') {
        const bt = draft.tricks[draft.bidderId] || 0;
        container.appendChild(labeledStepper('By ' + nameOf(draft.bidderId), bt, 0, 10, (v) => {
          draft.tricks[draft.bidderId] = v;
          onChange();
        }));
        container.appendChild(el('p', { class: 'hand-hint' }, 'Make it by taking no tricks.'));
      } else if (players.length === 2) {
        const opp = players.find((p) => p.id !== draft.bidderId);
        const bt = draft.tricks[draft.bidderId] || 0;
        container.appendChild(labeledStepper('By ' + nameOf(draft.bidderId), bt, 0, 10, (v) => {
          draft.tricks[draft.bidderId] = v;
          draft.tricks[opp.id] = 10 - v;
          onChange();
        }));
        container.appendChild(el('p', { class: 'hand-hint' }, nameOf(opp.id) + ': ' + (10 - bt) + ' trick' + ((10 - bt) === 1 ? '' : 's')));
      } else {
        players.forEach((p) => {
          const tv = draft.tricks[p.id] || 0;
          container.appendChild(labeledStepper(nameOf(p.id), tv, 0, 10, (v) => {
            draft.tricks[p.id] = v;
            onChange();
          }));
        });
      }
    }
  },
  validate(draft, players) {
    if (!draft.bidderId || !draft.bid) return { valid: false, message: 'Choose a bidder and contract.' };
    const kind = draft.bid.kind;
    if (kind === 'suit' || kind === 'nt') {
      if (!(draft.bid.level >= 6 && draft.bid.level <= 10)) return { valid: false, message: 'Choose a trick level.' };
      const sum = five00.hand._sum(draft, players);
      if (sum !== 10) return { valid: false, message: 'Tricks must total 10 (currently ' + sum + ').' };
    }
    const result = five00.scoreHand({ bidderId: draft.bidderId, bid: draft.bid, tricks: draft.tricks }, players);
    const parts = players.map((p) => {
      const d = result.deltas[p.id] || 0;
      return p.name + ' ' + (d > 0 ? '+' : '') + d;
    });
    return { valid: true, message: (result.meta.made ? 'Made' : 'Set') + ' \u00b7 ' + parts.join(' \u00b7 ') };
  },
  toRecord(draft, players, id) {
    const result = five00.scoreHand({ bidderId: draft.bidderId, bid: draft.bid, tricks: draft.tricks }, players);
    return {
      id: id || ('h' + Date.now()),
      bidderId: draft.bidderId,
      bid: draft.bid,
      bidValue: result.meta.bidValue,
      made: result.meta.made,
      tricks: result.meta.tricks,
      deltas: result.deltas,
    };
  },
};

/* ---------- registry ---------- */
const GAMES = {
  fivecrowns: fiveCrowns,
  greed: greed,
  five00: five00,
};
const GAME_ORDER = ['fivecrowns', 'greed', 'five00'];

export {
  GAMES,
  GAME_ORDER,
  cap,
  unitSingular,
  lastFilledIndex,
  sumScores,
  leadersOf,
  joinNames,
  winnerText,
  greedRunningTotals,
  contractValue,
  suitContractValue,
  bidLabel,
  buildBidOrder,
  fiveCrowns,
  fiveCrownsWildOrder,
  greed,
  five00,
  FIVE_CROWNS_WILDS,
  FIVE_CROWNS_ROUNDS,
};
