import { CELL_GAME, sumScores, leadersOf, winnerText } from './shared.js';

const FIVE_CROWNS_WILDS = ['3s', '4s', '5s', '6s', '7s', '8s', '9s', '10s', 'Jacks', 'Queens', 'Kings']; const FIVE_CROWNS_FIRST_HAND = 3;
const FIVE_CROWNS_CARD_COUNTS = FIVE_CROWNS_WILDS.map((_, i) => i + FIVE_CROWNS_FIRST_HAND); const FIVE_CROWNS_ROUNDS = FIVE_CROWNS_WILDS.length; const FIVE_CROWNS_MASK = '\u2014';
const FIVE_CROWNS_READY = '?';

function shuffle(arr, random = Math.random) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
function fiveCrownsWildOrder(variant, random = Math.random) {
  if (variant === 'down') return FIVE_CROWNS_WILDS.slice().reverse(); if (variant === 'random' || variant === 'super-random') return shuffle(FIVE_CROWNS_WILDS, random);
  return FIVE_CROWNS_WILDS.slice();
}
function fiveCrownsSuperRandomCardOrder(random = Math.random) { return shuffle(FIVE_CROWNS_CARD_COUNTS, random); }
function fiveCrownsRevealVariant(variant) { return variant === 'random' || variant === 'super-random'; }
function validOrder(order, expected) {
  if (!Array.isArray(order) || order.length !== expected.length) return expected.slice(); const allowed = new Set(expected);
  if (new Set(order).size !== expected.length || !order.every((v) => allowed.has(v))) return expected.slice(); return order.slice();
}
function fiveCrownsWildsFromState(state) { return validOrder(state && state.wildOrder, FIVE_CROWNS_WILDS); }
function fiveCrownsCardsFromState(state) { return validOrder(state && state.cardOrder, FIVE_CROWNS_CARD_COUNTS); }
function fiveCrownsCardCount(i, state) {
  if (state && state.variant === 'super-random') return fiveCrownsCardsFromState(state)[i]; const wild = fiveCrownsWildsFromState(state)[i];
  return FIVE_CROWNS_CARD_COUNTS[FIVE_CROWNS_WILDS.indexOf(wild)];
}
function fiveCrownsRevealedCount(state) {
  const raw = state && typeof state.revealedCount === 'number' && Number.isFinite(state.revealedCount) ? state.revealedCount : 0;
  return Math.max(0, Math.min(FIVE_CROWNS_ROUNDS, Math.floor(raw)));
}
function cardCountText(count) { return String(count) + ' cards'; }
function fiveCrownsPrevComplete(i, state) {
  if (i <= 0) return true; const players = (state && state.players) || [];
  return players.length > 0 && players.every((player) => {
    const scores = (state.scores && state.scores[player.id]) || []; return scores[i - 1] != null;
  });
}

const fiveCrowns = {
  ...CELL_GAME,
  id: 'fivecrowns', name: 'Five Crowns', storageKey: 'fivecrowns:v1',
  winDirection: 'low', target: null, onBoardMin: null,
  rounds: { kind: 'fixed', count: FIVE_CROWNS_ROUNDS },
  defaultNames() { return ['Player 1', 'Player 2', 'Player 3']; },
  variants: {
    field: 'variant', label: 'Round order', default: 'up',
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
    const known = this.variants.options.some((o) => o.value === variant); const v = known ? variant : this.variants.default;
    const extra = { variant: v, wildOrder: fiveCrownsWildOrder(v, random) }; if (v === 'super-random') extra.cardOrder = fiveCrownsSuperRandomCardOrder(random);
    if (fiveCrownsRevealVariant(v)) extra.revealedCount = 0; return extra;
  },
  cardCount: fiveCrownsCardCount,
  revealNoun(state) { return state && state.variant === 'super-random' ? 'round' : 'wild'; },
  revealItems(state) {
    const wilds = fiveCrownsWildsFromState(state); const superRandom = state && state.variant === 'super-random';
    return wilds.map((wild, i) => {
      if (!superRandom) return { label: wild, result: wild + ' is wild!' }; const cards = cardCountText(fiveCrownsCardCount(i, state));
      return { label: cards + ' \u00b7 ' + wild, result: cards + ' \u00b7 ' + wild + ' wild!' };
    });
  },
  roundLabel(i, state) {
    const wilds = fiveCrownsWildsFromState(state); const superRandom = state && state.variant === 'super-random'; const label = { num: String(i + 1), sub: wilds[i] };
    if (superRandom) label.cards = cardCountText(fiveCrownsCardCount(i, state));
    if (!state || !fiveCrownsRevealVariant(state.variant) || i < fiveCrownsRevealedCount(state)) return label;
    const ready = i === fiveCrownsRevealedCount(state) && fiveCrownsPrevComplete(i, state); label.sub = ready ? FIVE_CROWNS_READY : FIVE_CROWNS_MASK; if (ready) label.ready = true;
    else label.masked = true;
    if (superRandom) { label.cards = ready ? '? cards' : FIVE_CROWNS_MASK; label[ready ? 'cardsReady' : 'cardsMasked'] = true; }
    return label;
  },
  resolve(players, state) {
    const totals = {}; players.forEach((p) => { totals[p.id] = (p.seed || 0) + sumScores(state.scores[p.id] || []); });
    const { best, leaders, distinct } = leadersOf(totals, 'low');
    const complete = players.length > 0 && players.every((p) => {
      const a = state.scores[p.id]; return a && a[FIVE_CROWNS_ROUNDS - 1] != null;
    }); const highlight = distinct ? leaders : [];
    if (complete) return { totals, status: { phase: 'complete', best, leaders: highlight, text: winnerText(players, leaders, best) } };
    return { totals, status: { phase: 'inProgress', best, leaders: highlight, text: '' } };
  },
};

export {
  fiveCrowns, fiveCrownsWildOrder,
  FIVE_CROWNS_WILDS, FIVE_CROWNS_FIRST_HAND, FIVE_CROWNS_CARD_COUNTS, FIVE_CROWNS_ROUNDS,
};
