import {
  TROPHY, OPEN_ROUNDS, objectFromEntries, leadersOf, playerNames, joinNames, winnerText,
} from './shared.js';

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
]; const SUIT_BY_ID = objectFromEntries(SUITS.map((suit) => [suit.id, suit]));
const SPECIAL_BIDS = Object.freeze({
  misere: { label: 'Mis\u00e8re', value: FIVE00_RULES.misere, after: [7, 'nt'] },
  open: { label: 'Open mis\u00e8re', value: FIVE00_RULES.openMisere, after: [10, 'diamonds'] },
});

function suitContractValue(suitId, level) {
  const suit = SUIT_BY_ID[suitId];
  return suit
    ? (level - FIVE00_RULES.minBid) * FIVE00_RULES.levelStep + FIVE00_RULES.baseBid + suit.index * FIVE00_RULES.suitStep
    : 0;
}
function contractValue(bid) { if (!bid) return 0; if (SPECIAL_BIDS[bid.kind]) return SPECIAL_BIDS[bid.kind].value; return suitContractValue(bid.suit, bid.level); }
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
  if (!bid) return ''; if (SPECIAL_BIDS[bid.kind]) return SPECIAL_BIDS[bid.kind].label; const suit = SUIT_BY_ID[bid.suit]; return String(bid.level) + (suit ? suit.sym : '');
}

const five00 = {
  id: 'five00', name: '500', storageKey: 'five00:v1', unitLabel: 'sides',
  winDirection: 'high', target: FIVE00_RULES.target, loseAt: FIVE00_RULES.loseAt, onBoardMin: null,
  rounds: OPEN_ROUNDS, entry: 'hand', allowNegative: true, minPlayers: 2, maxPlayers: 6,
  defaultNames() { return ['Us', 'Them']; },
  suits: SUITS, bidOrder: FIVE00_BID_ORDER, bidLabel, contractValue,
  roundLabel(i) { return { num: 'Hand ' + (i + 1), sub: '' }; },
  scoreHand(input, players) {
    const bid = input.bid; const value = contractValue(bid); const bidderId = input.bidderId; const tricks = input.tricks || {}; const bidderTricks = tricks[bidderId] || 0;
    const deltas = objectFromEntries(players.map((player) => [player.id, 0])); let made;
    if (SPECIAL_BIDS[bid.kind]) {
      made = bidderTricks === 0; deltas[bidderId] = made ? value : -value;
    } else {
      made = bidderTricks >= bid.level; const slam = bidderTricks === FIVE00_RULES.tricks && value < FIVE00_RULES.slam;
      deltas[bidderId] = made ? (slam ? FIVE00_RULES.slam : value) : -value;
      players.forEach((player) => {
        if (player.id !== bidderId) deltas[player.id] = FIVE00_RULES.defenderTrick * (tricks[player.id] || 0);
      });
    }
    return { deltas, meta: { bidderId, bid, bidValue: value, made, tricks } };
  },
  handSummary(hand, players) {
    const names = playerNames(players); const who = names[hand.bidderId] || hand.bidderId; return who + ' ' + bidLabel(hand.bid) + (hand.made ? ' \u2713' : ' \u2717');
  },
  resolve(players, state) {
    const hands = Array.isArray(state.hands) ? state.hands : []; const running = objectFromEntries(players.map((player) => [player.id, player.seed || 0])); let terminal = null;
    for (const hand of hands) {
      players.forEach((player) => { running[player.id] += (hand.deltas && hand.deltas[player.id]) || 0; });
      if (hand.made && running[hand.bidderId] >= FIVE00_RULES.target) terminal = { type: 'win', winnerId: hand.bidderId };
      else {
        const outs = players.filter((player) => running[player.id] <= FIVE00_RULES.loseAt).map((player) => player.id); if (outs.length) terminal = { type: 'out', outIds: outs };
      }
      if (terminal) break;
    }
    const totals = { ...running }; const { best, leaders, distinct } = leadersOf(totals, 'high');
    if (terminal && terminal.type === 'win') return {
      totals,
      status: {
        phase: 'complete', best, leaders: [terminal.winnerId],
        text: winnerText(players, [terminal.winnerId], totals[terminal.winnerId]),
      },
    };
    if (terminal && terminal.type === 'out') {
      const survivors = players.filter((player) => !terminal.outIds.includes(player.id)).map((player) => player.id); const winners = survivors.length ? survivors : leaders;
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
      tricks[draft.bidderId] = level; const opponent = players.find((player) => player.id !== draft.bidderId); if (opponent) tricks[opponent.id] = FIVE00_RULES.tricks - level;
    }
    draft.tricks = tricks;
  },
  newDraft(players) { return { bidderId: players[0].id, bid: null, tricks: this._blankTricks(players) }; },
  draftFromRecord(hand) {
    return { bidderId: hand.bidderId, bid: hand.bid ? { ...hand.bid } : null, tricks: { ...hand.tricks } };
  },
  _sum(draft, players) { return players.reduce((sum, player) => sum + (draft.tricks[player.id] || 0), 0); },
  build(container, draft, players, ui, onChange) {
    const { el, chip, labeledStepper } = ui; const names = playerNames(players); const append = (node) => container.appendChild(node);
    const section = (text) => append(el('h3', { class: 'hand-section' }, text));
    const chips = (items) => {
      const row = el('div', { class: 'chips' }); items.forEach((item) => row.appendChild(item)); append(row);
    };
    const setBid = (bid) => {
      draft.bid = bid; five00.hand._initTricks(draft, players, bid.kind, bid.level); onChange();
    };
    const step = (label, value, onStep) => append(
      labeledStepper(label, value, 0, FIVE00_RULES.tricks, (next) => { onStep(next); onChange(); }),
    );

    section('Bidder');
    chips(players.map((player) => chip(player.name, draft.bidderId === player.id, () => {
      draft.bidderId = player.id; if (draft.bid) five00.hand._initTricks(draft, players, draft.bid.kind, draft.bid.level); onChange();
    }, 'Bidder ' + player.name)));

    section('Contract');
    chips(SUITS.map((suit) => {
      const selected = draft.bid && !SPECIAL_BIDS[draft.bid.kind] && draft.bid.suit === suit.id;
      return chip(suit.sym, selected, () => {
        const kind = suit.id === 'nt' ? 'nt' : 'suit'; setBid({ kind, suit: suit.id, level: (draft.bid && draft.bid.level) || FIVE00_RULES.minBid });
      }, suit.name);
    }));
    chips(Object.entries(SPECIAL_BIDS).map(([kind, special]) => chip(
      special.label, draft.bid && draft.bid.kind === kind, () => setBid({ kind }), special.label,
    )));

    if (draft.bid && !SPECIAL_BIDS[draft.bid.kind]) append(labeledStepper(
      'Tricks bid', draft.bid.level, FIVE00_RULES.minBid, FIVE00_RULES.maxBid, (level) => {
        draft.bid.level = level; five00.hand._initTricks(draft, players, draft.bid.kind, level); onChange();
      },
    )); if (!draft.bid) return;

    section('Tricks won'); const bidderTricks = draft.tricks[draft.bidderId] || 0;
    if (SPECIAL_BIDS[draft.bid.kind]) {
      step('By ' + names[draft.bidderId], bidderTricks, (value) => { draft.tricks[draft.bidderId] = value; });
      append(el('p', { class: 'hand-hint' }, 'Make it by taking no tricks.'));
    } else if (players.length === 2) {
      const opponent = players.find((player) => player.id !== draft.bidderId);
      step('By ' + names[draft.bidderId], bidderTricks, (value) => {
        draft.tricks[draft.bidderId] = value; draft.tricks[opponent.id] = FIVE00_RULES.tricks - value;
      }); const otherTricks = FIVE00_RULES.tricks - bidderTricks;
      append(el('p', { class: 'hand-hint' }, names[opponent.id] + ': ' + otherTricks + ' trick' + (otherTricks === 1 ? '' : 's')));
    } else players.forEach((player) => step(
      names[player.id], draft.tricks[player.id] || 0, (value) => { draft.tricks[player.id] = value; },
    ));
  },
  validate(draft, players) {
    if (!draft.bidderId || !draft.bid) return { valid: false, message: 'Choose a bidder and contract.' }; const kind = draft.bid.kind;
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
      const d = result.deltas[p.id] || 0; return p.name + ' ' + (d > 0 ? '+' : '') + d;
    }); return { valid: true, message: (result.meta.made ? 'Made' : 'Set') + ' \u00b7 ' + parts.join(' \u00b7 ') };
  },
  toRecord(draft, players, id) {
    const result = five00.scoreHand({ bidderId: draft.bidderId, bid: draft.bid, tricks: draft.tricks }, players);
    return { id: id || ('h' + Date.now()), ...result.meta, deltas: result.deltas };
  },
};

export {
  five00, contractValue, suitContractValue, bidLabel, buildBidOrder,
  FIVE00_RULES, SUITS, SPECIAL_BIDS,
};
