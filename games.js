// Game registry and pure scoring rules. Hand-entry games receive injected DOM
// helpers, keeping the rules testable without a browser.

const TROPHY = '\u{1F3C6} ';
const DART = '\u{1F3AF} ';
const CELL_GAME = Object.freeze({
  unitLabel: 'players', loseAt: null, entry: 'cell', allowNegative: false, minPlayers: 2, maxPlayers: 8,
});
const OPEN_ROUNDS = Object.freeze({ kind: 'open' });

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function unitSingular(game) { return game.unitLabel === 'sides' ? 'side' : 'player'; }
function objectFromEntries(entries) {
  const object = {};
  entries.forEach(([key, value]) => { object[key] = value; });
  return object;
}

function sumScores(arr) {
  return Array.isArray(arr)
    ? arr.reduce((total, value) => total + (typeof value === 'number' && Number.isFinite(value) ? value : 0), 0)
    : 0;
}

function lastFilledIndex(arr) {
  if (!Array.isArray(arr)) return -1;
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return i;
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

function playerNames(players) { return objectFromEntries(players.map((player) => [player.id, player.name])); }
function joinNames(players, ids) {
  const names = playerNames(players);
  return ids.map((id) => names[id] || id).join(', ');
}

// Shared "X wins / Tie" banner text from a set of tied winners.
function winnerText(players, leaders, best) {
  const names = joinNames(players, leaders);
  return leaders.length === 1
    ? TROPHY + names + ' wins with ' + best + '!'
    : TROPHY + 'Tie at ' + best + ': ' + names;
}

const FIVE_CROWNS_WILDS = ['3s', '4s', '5s', '6s', '7s', '8s', '9s', '10s', 'Jacks', 'Queens', 'Kings'];
const FIVE_CROWNS_FIRST_HAND = 3;
const FIVE_CROWNS_CARD_COUNTS = FIVE_CROWNS_WILDS.map((_, i) => i + FIVE_CROWNS_FIRST_HAND);
const FIVE_CROWNS_ROUNDS = FIVE_CROWNS_WILDS.length; // 11
const FIVE_CROWNS_MASK = '\u2014'; // placeholder shown for a locked random detail
const FIVE_CROWNS_READY = '?';     // shown on the glowing round that is ready to spin

function shuffle(arr, random = Math.random) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function fiveCrownsWildOrder(variant, random = Math.random) {
  if (variant === 'down') return FIVE_CROWNS_WILDS.slice().reverse();
  if (variant === 'random' || variant === 'super-random') return shuffle(FIVE_CROWNS_WILDS, random);
  return FIVE_CROWNS_WILDS.slice();
}

function fiveCrownsSuperRandomCardOrder(random = Math.random) { return shuffle(FIVE_CROWNS_CARD_COUNTS, random); }
function fiveCrownsRevealVariant(variant) { return variant === 'random' || variant === 'super-random'; }

function validOrder(order, expected) {
  if (!Array.isArray(order) || order.length !== expected.length) return expected.slice();
  const allowed = new Set(expected);
  if (new Set(order).size !== expected.length || !order.every((v) => allowed.has(v))) return expected.slice();
  return order.slice();
}

function fiveCrownsWildsFromState(state) { return validOrder(state && state.wildOrder, FIVE_CROWNS_WILDS); }
function fiveCrownsCardsFromState(state) { return validOrder(state && state.cardOrder, FIVE_CROWNS_CARD_COUNTS); }

function fiveCrownsCardCount(i, state) {
  if (state && state.variant === 'super-random') return fiveCrownsCardsFromState(state)[i];
  const wild = fiveCrownsWildsFromState(state)[i];
  return FIVE_CROWNS_CARD_COUNTS[FIVE_CROWNS_WILDS.indexOf(wild)];
}

function fiveCrownsRevealedCount(state) {
  const raw = state && typeof state.revealedCount === 'number' && Number.isFinite(state.revealedCount)
    ? state.revealedCount
    : 0;
  return Math.max(0, Math.min(FIVE_CROWNS_ROUNDS, Math.floor(raw)));
}

function cardCountText(count) { return String(count) + ' cards'; }

function fiveCrownsPrevComplete(i, state) {
  if (i <= 0) return true;
  const players = (state && state.players) || [];
  return players.length > 0 && players.every((player) => {
    const scores = (state.scores && state.scores[player.id]) || [];
    return scores[i - 1] != null;
  });
}

const fiveCrowns = {
  ...CELL_GAME,
  id: 'fivecrowns', name: 'Five Crowns', storageKey: 'fivecrowns:v1',
  winDirection: 'low', target: null, onBoardMin: null,
  rounds: { kind: 'fixed', count: FIVE_CROWNS_ROUNDS },
  defaultNames() { return ['Player 1', 'Player 2', 'Player 3']; },
  variants: {
    field: 'variant',
    label: 'Round order',
    default: 'up',
    options: [
      { value: 'up', label: 'Up', hint: '3s \u2192 K' },
      { value: 'down', label: 'Down', hint: 'K \u2192 3s' },
      { value: 'random', label: 'Random', hint: 'cards follow wilds' },
      { value: 'super-random', label: 'Super Random', hint: 'cards + wilds' },
    ],
  },
  revealVariants: ['random', 'super-random'],
  stateFields: ['variant', 'wildOrder', 'cardOrder', 'revealedCount'],
  initVariant(variant, random = Math.random) {
    const known = this.variants.options.some((o) => o.value === variant);
    const v = known ? variant : this.variants.default;
    const extra = { variant: v, wildOrder: fiveCrownsWildOrder(v, random) };
    if (v === 'super-random') extra.cardOrder = fiveCrownsSuperRandomCardOrder(random);
    if (fiveCrownsRevealVariant(v)) extra.revealedCount = 0;
    return extra;
  },
  cardCount: fiveCrownsCardCount,
  revealNoun(state) { return state && state.variant === 'super-random' ? 'round' : 'wild'; },
  revealItems(state) {
    const wilds = fiveCrownsWildsFromState(state);
    const superRandom = state && state.variant === 'super-random';
    return wilds.map((wild, i) => {
      if (!superRandom) return { label: wild, result: wild + ' is wild!' };
      const cards = cardCountText(fiveCrownsCardCount(i, state));
      return { label: cards + ' \u00b7 ' + wild, result: cards + ' \u00b7 ' + wild + ' wild!' };
    });
  },
  roundLabel(i, state) {
    const wilds = fiveCrownsWildsFromState(state);
    const superRandom = state && state.variant === 'super-random';
    const label = { num: String(i + 1), sub: wilds[i] };
    if (superRandom) label.cards = cardCountText(fiveCrownsCardCount(i, state));
    if (!state || !fiveCrownsRevealVariant(state.variant) || i < fiveCrownsRevealedCount(state)) return label;
    const ready = i === fiveCrownsRevealedCount(state) && fiveCrownsPrevComplete(i, state);
    label.sub = ready ? FIVE_CROWNS_READY : FIVE_CROWNS_MASK;
    if (ready) label.ready = true;
    else label.masked = true;
    if (superRandom) {
      label.cards = ready ? '? cards' : FIVE_CROWNS_MASK;
      label[ready ? 'cardsReady' : 'cardsMasked'] = true;
    }
    return label;
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

const GREED_TARGET = 5000;
const GREED_ON_BOARD = 500;
const GREED_FINAL_ROUNDS_AFTER_TARGET = 1;

function greedRunningTotals(seed, scores) {
  const out = [];
  let onBoard = (seed || 0) > 0;
  let running = seed || 0;
  for (let i = 0; i < scores.length; i++) {
    const v = (typeof scores[i] === 'number' && Number.isFinite(scores[i])) ? scores[i] : 0;
    if (!onBoard && scores[i] != null && v >= GREED_ON_BOARD) onBoard = true;
    if (onBoard) running += v;
    out.push(running);
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
      const run = runs[player.id];
      const round = finalRound == null ? run.length - 1 : Math.min(finalRound, run.length - 1);
      return [player.id, round < 0 ? player.seed || 0 : run[round]];
    }));
    const { best, leaders, distinct } = leadersOf(totals, 'high');
    const highlight = distinct ? leaders : [];
    if (finalRound == null) return { totals, status: { phase: 'inProgress', best, leaders: highlight, text: '' } };
    const filledThrough = players.every((player) => {
      const scores = state.scores[player.id] || [];
      for (let round = 0; round <= finalRound; round++) if (scores[round] == null) return false;
      return true;
    });
    if (filledThrough) return {
      totals, status: { phase: 'complete', best, leaders: highlight, text: winnerText(players, leaders, best), finalRound },
    };
    return {
      totals, status: {
        phase: 'targetReached', best, leaders: highlight, finalRound,
        text: DART + joinNames(players, leaders) + ' reached ' + GREED_TARGET + ' \u2014 one final round, then highest wins',
      },
    };
  },
};

const FIVE00_RULES = Object.freeze({
  target: 500, loseAt: -500, minBid: 6, maxBid: 10, tricks: 10,
  levelStep: 100, baseBid: 40, suitStep: 20, misere: 250, openMisere: 500,
  slam: 250, defenderTrick: 10,
});
const SUITS = [
  { id: 'spades', sym: '\u2660', name: 'Spades', index: 0 },
  { id: 'clubs', sym: '\u2663', name: 'Clubs', index: 1 },
  { id: 'diamonds', sym: '\u2666', name: 'Diamonds', index: 2 },
  { id: 'hearts', sym: '\u2665', name: 'Hearts', index: 3 },
  { id: 'nt', sym: 'NT', name: 'No trumps', index: 4 },
];
const SUIT_BY_ID = objectFromEntries(SUITS.map((suit) => [suit.id, suit]));
const SPECIAL_BIDS = Object.freeze({
  misere: { label: 'Mis\u00e8re', value: FIVE00_RULES.misere, after: [7, 'nt'] },
  open: { label: 'Open mis\u00e8re', value: FIVE00_RULES.openMisere, after: [10, 'diamonds'] },
});

function suitContractValue(suitId, level) {
  const suit = SUIT_BY_ID[suitId];
  return suit
    ? (level - FIVE00_RULES.minBid) * FIVE00_RULES.levelStep
      + FIVE00_RULES.baseBid + suit.index * FIVE00_RULES.suitStep
    : 0;
}

function contractValue(bid) {
  if (!bid) return 0;
  if (SPECIAL_BIDS[bid.kind]) return SPECIAL_BIDS[bid.kind].value;
  return suitContractValue(bid.suit, bid.level);
}

function buildBidOrder() {
  const order = [];
  for (let level = FIVE00_RULES.minBid; level <= FIVE00_RULES.maxBid; level++) {
    for (const suit of SUITS) {
      order.push({ kind: suit.id === 'nt' ? 'nt' : 'suit', suit: suit.id, level });
      Object.entries(SPECIAL_BIDS).forEach(([kind, special]) => {
        if (special.after[0] === level && special.after[1] === suit.id) order.push({ kind });
      });
    }
  }
  return order;
}
const FIVE00_BID_ORDER = buildBidOrder();

function bidLabel(bid) {
  if (!bid) return '';
  if (SPECIAL_BIDS[bid.kind]) return SPECIAL_BIDS[bid.kind].label;
  const suit = SUIT_BY_ID[bid.suit];
  return String(bid.level) + (suit ? suit.sym : '');
}

const five00 = {
  id: 'five00', name: '500', storageKey: 'five00:v1', unitLabel: 'sides',
  winDirection: 'high', target: FIVE00_RULES.target, loseAt: FIVE00_RULES.loseAt, onBoardMin: null,
  rounds: OPEN_ROUNDS, entry: 'hand', allowNegative: true, minPlayers: 2, maxPlayers: 6,
  defaultNames() { return ['Us', 'Them']; },
  suits: SUITS, bidOrder: FIVE00_BID_ORDER, bidLabel, contractValue,
  roundLabel(i) { return { num: 'Hand ' + (i + 1), sub: '' }; },

  scoreHand(input, players) {
    const bid = input.bid;
    const value = contractValue(bid);
    const bidderId = input.bidderId;
    const tricks = input.tricks || {};
    const bidderTricks = tricks[bidderId] || 0;
    const deltas = objectFromEntries(players.map((player) => [player.id, 0]));
    let made;
    if (SPECIAL_BIDS[bid.kind]) {
      made = bidderTricks === 0;
      deltas[bidderId] = made ? value : -value;
    } else {
      made = bidderTricks >= bid.level;
      const slam = bidderTricks === FIVE00_RULES.tricks && value < FIVE00_RULES.slam;
      deltas[bidderId] = made ? (slam ? FIVE00_RULES.slam : value) : -value;
      players.forEach((player) => {
        if (player.id !== bidderId) deltas[player.id] = FIVE00_RULES.defenderTrick * (tricks[player.id] || 0);
      });
    }
    return { deltas, meta: { bidderId, bid, bidValue: value, made, tricks } };
  },

  handSummary(hand, players) {
    const names = playerNames(players);
    const who = names[hand.bidderId] || hand.bidderId;
    return who + ' ' + bidLabel(hand.bid) + (hand.made ? ' \u2713' : ' \u2717');
  },

  resolve(players, state) {
    const hands = Array.isArray(state.hands) ? state.hands : [];
    const running = objectFromEntries(players.map((player) => [player.id, player.seed || 0]));
    let terminal = null;
    for (const hand of hands) {
      players.forEach((player) => { running[player.id] += (hand.deltas && hand.deltas[player.id]) || 0; });
      if (hand.made && running[hand.bidderId] >= FIVE00_RULES.target) {
        terminal = { type: 'win', winnerId: hand.bidderId };
      } else {
        const outs = players.filter((player) => running[player.id] <= FIVE00_RULES.loseAt).map((player) => player.id);
        if (outs.length) terminal = { type: 'out', outIds: outs };
      }
      if (terminal) break;
    }
    const totals = { ...running };
    const { best, leaders, distinct } = leadersOf(totals, 'high');
    if (terminal && terminal.type === 'win') return {
      totals,
      status: {
        phase: 'complete', best, leaders: [terminal.winnerId],
        text: winnerText(players, [terminal.winnerId], totals[terminal.winnerId]),
      },
    };
    if (terminal && terminal.type === 'out') {
      const survivors = players.filter((player) => !terminal.outIds.includes(player.id)).map((player) => player.id);
      const winners = survivors.length ? survivors : leaders;
      const outText = terminal.outIds.map((id) => joinNames(players, [id]) + ' out at ' + totals[id]).join(', ');
      return {
        totals,
        status: { phase: 'out', best, leaders: winners, text: TROPHY + joinNames(players, winners) + ' win \u2014 ' + outText },
      };
    }
    return { totals, status: { phase: 'inProgress', best, leaders: distinct ? leaders : [], text: '' } };
  },
};

five00.hand = {
  _blankTricks(players) { return objectFromEntries(players.map((player) => [player.id, 0])); },
  _initTricks(draft, players, kind, level) {
    const tricks = this._blankTricks(players);
    if (kind === 'suit' || kind === 'nt') {
      tricks[draft.bidderId] = level;
      const opponent = players.find((player) => player.id !== draft.bidderId);
      if (opponent) tricks[opponent.id] = FIVE00_RULES.tricks - level;
    }
    draft.tricks = tricks;
  },
  newDraft(players) { return { bidderId: players[0].id, bid: null, tricks: this._blankTricks(players) }; },
  draftFromRecord(hand) {
    return { bidderId: hand.bidderId, bid: hand.bid ? { ...hand.bid } : null, tricks: { ...hand.tricks } };
  },
  _sum(draft, players) { return players.reduce((sum, player) => sum + (draft.tricks[player.id] || 0), 0); },
  build(container, draft, players, ui, onChange) {
    const { el, chip, labeledStepper } = ui;
    const names = playerNames(players);
    const append = (node) => container.appendChild(node);
    const section = (text) => append(el('h3', { class: 'hand-section' }, text));
    const chips = (items) => {
      const row = el('div', { class: 'chips' });
      items.forEach((item) => row.appendChild(item));
      append(row);
    };
    const setBid = (bid) => {
      draft.bid = bid;
      five00.hand._initTricks(draft, players, bid.kind, bid.level);
      onChange();
    };
    const step = (label, value, onStep) => append(
      labeledStepper(label, value, 0, FIVE00_RULES.tricks, (next) => { onStep(next); onChange(); }),
    );

    section('Bidder');
    chips(players.map((player) => chip(player.name, draft.bidderId === player.id, () => {
      draft.bidderId = player.id;
      if (draft.bid) five00.hand._initTricks(draft, players, draft.bid.kind, draft.bid.level);
      onChange();
    }, 'Bidder ' + player.name)));

    section('Contract');
    chips(SUITS.map((suit) => {
      const selected = draft.bid && !SPECIAL_BIDS[draft.bid.kind] && draft.bid.suit === suit.id;
      return chip(suit.sym, selected, () => {
        const kind = suit.id === 'nt' ? 'nt' : 'suit';
        setBid({ kind, suit: suit.id, level: (draft.bid && draft.bid.level) || FIVE00_RULES.minBid });
      }, suit.name);
    }));
    chips(Object.entries(SPECIAL_BIDS).map(([kind, special]) => chip(
      special.label, draft.bid && draft.bid.kind === kind, () => setBid({ kind }), special.label,
    )));

    if (draft.bid && !SPECIAL_BIDS[draft.bid.kind]) append(labeledStepper(
      'Tricks bid', draft.bid.level, FIVE00_RULES.minBid, FIVE00_RULES.maxBid, (level) => {
        draft.bid.level = level;
        five00.hand._initTricks(draft, players, draft.bid.kind, level);
        onChange();
      },
    ));
    if (!draft.bid) return;

    section('Tricks won');
    const bidderTricks = draft.tricks[draft.bidderId] || 0;
    if (SPECIAL_BIDS[draft.bid.kind]) {
      step('By ' + names[draft.bidderId], bidderTricks, (value) => { draft.tricks[draft.bidderId] = value; });
      append(el('p', { class: 'hand-hint' }, 'Make it by taking no tricks.'));
    } else if (players.length === 2) {
      const opponent = players.find((player) => player.id !== draft.bidderId);
      step('By ' + names[draft.bidderId], bidderTricks, (value) => {
        draft.tricks[draft.bidderId] = value;
        draft.tricks[opponent.id] = FIVE00_RULES.tricks - value;
      });
      const otherTricks = FIVE00_RULES.tricks - bidderTricks;
      append(el('p', { class: 'hand-hint' }, names[opponent.id] + ': ' + otherTricks + ' trick' + (otherTricks === 1 ? '' : 's')));
    } else players.forEach((player) => step(
      names[player.id], draft.tricks[player.id] || 0, (value) => { draft.tricks[player.id] = value; },
    ));
  },
  validate(draft, players) {
    if (!draft.bidderId || !draft.bid) return { valid: false, message: 'Choose a bidder and contract.' };
    const kind = draft.bid.kind;
    if (!SPECIAL_BIDS[kind]) {
      if (!(draft.bid.level >= FIVE00_RULES.minBid && draft.bid.level <= FIVE00_RULES.maxBid)) {
        return { valid: false, message: 'Choose a trick level.' };
      }
      const sum = five00.hand._sum(draft, players);
      if (sum !== FIVE00_RULES.tricks) {
        return { valid: false, message: 'Tricks must total ' + FIVE00_RULES.tricks + ' (currently ' + sum + ').' };
      }
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
    return { id: id || ('h' + Date.now()), ...result.meta, deltas: result.deltas };
  },
};

const GAME_LIST = [fiveCrowns, greed, five00];
const GAMES = objectFromEntries(GAME_LIST.map((game) => [game.id, game]));
const GAME_ORDER = GAME_LIST.map((game) => game.id);

export {
  GAMES,
  GAME_ORDER,
  cap,
  unitSingular,
  objectFromEntries,
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
  FIVE_CROWNS_CARD_COUNTS,
  FIVE_CROWNS_ROUNDS,
};
