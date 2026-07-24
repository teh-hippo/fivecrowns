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
function fiveCrownsDealerOrder(players, firstDealerIndex = 0, preferredOrder) {
  const ids = (Array.isArray(players) ? players : []).map((player) => player && player.id).filter((id) => typeof id === 'string'); const allowed = new Set(ids);
  const preferred = Array.isArray(preferredOrder)
    ? preferredOrder.filter((id, index) => allowed.has(id) && preferredOrder.indexOf(id) === index)
    : [];
  if (preferred.length) return preferred.concat(ids.filter((id) => preferred.indexOf(id) === -1));
  if (!ids.length) return []; const start = Math.max(0, Math.min(ids.length - 1, Math.floor(firstDealerIndex) || 0));
  return ids.slice(start).concat(ids.slice(0, start));
}
function fiveCrownsDealerRounds(order) {
  if (!Array.isArray(order) || !order.length) return [];
  return Array.from({ length: FIVE_CROWNS_ROUNDS }, (_, i) => order[i % order.length]);
}
function fiveCrownsDealerId(i, state) {
  if (!state || !state.dealerEnabled) return null; const players = Array.isArray(state.players) ? state.players : []; const allowed = new Set(players.map((player) => player.id));
  const scheduled = Array.isArray(state.dealerRounds) ? state.dealerRounds[i] : null; if (allowed.has(scheduled)) return scheduled;
  const order = fiveCrownsDealerOrder(players, 0, state.dealerOrder); return order.length ? order[i % order.length] : null;
}
function fiveCrownsDealerName(i, state) {
  const id = fiveCrownsDealerId(i, state); const player = id && Array.isArray(state.players) ? state.players.find((item) => item.id === id) : null;
  return player && typeof player.name === 'string' ? player.name : '';
}
function fiveCrownsRigCardOrder(baseOrder, dealerNames, settings) {
  const remaining = Array.isArray(baseOrder) ? baseOrder.slice() : []; const dealers = Array.isArray(dealerNames) ? dealerNames : []; const result = []; const rig = settings || {};
  for (let i = 0; i < dealers.length && remaining.length; i++) {
    const dealer = String(dealers[i] || '').trim().toLowerCase(); let index = 0;
    if (dealer === 'dad' && rig.dadLowCards) index = remaining.indexOf(Math.min(...remaining));
    else if (dealer === 'mum' && rig.mumHighCards) index = remaining.indexOf(Math.max(...remaining));
    result.push(remaining.splice(index, 1)[0]);
  }
  return result.concat(remaining);
}
function fiveCrownsWildsFromState(state) { return validOrder(state && state.wildOrder, FIVE_CROWNS_WILDS); }
function fiveCrownsCardsFromState(state) { return validOrder(state && state.cardOrder, FIVE_CROWNS_CARD_COUNTS); }
function fiveCrownsBaseCardsFromState(state) {
  return state && Array.isArray(state.cardOrderBase)
    ? validOrder(state.cardOrderBase, FIVE_CROWNS_CARD_COUNTS)
    : fiveCrownsCardsFromState(state);
}
function fiveCrownsCardCount(i, state) {
  if (state && state.variant === 'super-random') return fiveCrownsCardsFromState(state)[i]; const wild = fiveCrownsWildsFromState(state)[i];
  return FIVE_CROWNS_CARD_COUNTS[FIVE_CROWNS_WILDS.indexOf(wild)];
}
function fiveCrownsRevealedCount(state) {
  const raw = state && typeof state.revealedCount === 'number' && Number.isFinite(state.revealedCount) ? state.revealedCount : 0;
  return Math.max(0, Math.min(FIVE_CROWNS_ROUNDS, Math.floor(raw)));
}
function cardCountText(count) { return String(count) + ' cards'; }
function fiveCrownsApplyDealerRig(state, settings) {
  if (!state || state.variant !== 'super-random' || !state.dealerEnabled) return;
  const cards = fiveCrownsCardsFromState(state); const revealed = fiveCrownsRevealedCount(state); const used = new Set(cards.slice(0, revealed));
  const remaining = fiveCrownsBaseCardsFromState(state).filter((count) => !used.has(count));
  const dealers = remaining.map((_, offset) => fiveCrownsDealerName(revealed + offset, state));
  state.cardOrder = cards.slice(0, revealed).concat(fiveCrownsRigCardOrder(remaining, dealers, settings));
}
function fiveCrownsAddDealer(state, id, settings) {
  if (!state || !state.dealerEnabled || typeof id !== 'string') return;
  const players = Array.isArray(state.players) ? state.players : []; const existingIds = players.map((player) => player.id).filter((playerId) => playerId !== id);
  const preferred = Array.isArray(state.dealerOrder) ? state.dealerOrder.filter((playerId) => playerId !== id) : [];
  const oldOrder = fiveCrownsDealerOrder(existingIds.map((playerId) => ({ id: playerId })), 0, preferred);
  if (!oldOrder.length) {
    state.dealerOrder = [id]; state.dealerRounds = fiveCrownsDealerRounds(state.dealerOrder); state.dealerOrderStartsAt = 0;
    fiveCrownsApplyDealerRig(state, settings); return;
  }
  const currentRounds = Array.isArray(state.dealerRounds) && state.dealerRounds.length === FIVE_CROWNS_ROUNDS
    ? state.dealerRounds.slice() : fiveCrownsDealerRounds(oldOrder);
  const revealed = fiveCrownsRevealedCount(state); const pendingStart = Math.max(0, Math.floor(state.dealerOrderStartsAt) || 0); let boundary;
  if (revealed < pendingStart) {
    const order = oldOrder.concat(id); const rounds = currentRounds.slice(0, pendingStart);
    for (let i = pendingStart; i < FIVE_CROWNS_ROUNDS; i++) rounds[i] = order[(i - pendingStart) % order.length];
    state.dealerOrder = order; state.dealerRounds = rounds; fiveCrownsApplyDealerRig(state, settings); return;
  }
  if (revealed === 0) boundary = Math.min(FIVE_CROWNS_ROUNDS, oldOrder.length);
  else {
    const lastDealer = currentRounds[revealed - 1]; const lastIndex = Math.max(0, oldOrder.indexOf(lastDealer)); const nextIndex = (lastIndex + 1) % oldOrder.length;
    boundary = nextIndex === 0 ? revealed : Math.min(FIVE_CROWNS_ROUNDS, revealed + oldOrder.length - nextIndex);
  }
  const order = oldOrder.concat(id); const rounds = currentRounds.slice(0, boundary);
  for (let i = boundary; i < FIVE_CROWNS_ROUNDS; i++) rounds[i] = order[(i - boundary) % order.length];
  state.dealerOrder = order; state.dealerRounds = rounds; state.dealerOrderStartsAt = boundary; fiveCrownsApplyDealerRig(state, settings);
}
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
  dealerVariants: ['random', 'super-random'],
  progressiveFakeOut: true,
  stateFields: [
    'variant', 'wildOrder', 'cardOrder', 'cardOrderBase', 'revealedCount', 'fakeOutMisses',
    'dealerEnabled', 'dealerOrder', 'dealerRounds', 'dealerOrderStartsAt',
  ],
  initVariant(variant, random = Math.random, context = {}) {
    const known = this.variants.options.some((o) => o.value === variant); const v = known ? variant : this.variants.default;
    const players = Array.isArray(context.players) ? context.players : []; const dealerEnabled = fiveCrownsRevealVariant(v) && !!context.dealerEnabled && players.length > 0;
    const dealerOrder = dealerEnabled ? fiveCrownsDealerOrder(players, context.firstDealerIndex, context.dealerOrder) : [];
    const dealerRounds = dealerEnabled ? fiveCrownsDealerRounds(dealerOrder) : [];
    const extra = { variant: v, wildOrder: fiveCrownsWildOrder(v, random) };
    if (v === 'super-random') {
      const cards = fiveCrownsSuperRandomCardOrder(random); const names = dealerRounds.map((id) => {
        const player = players.find((item) => item.id === id); return player ? player.name : '';
      });
      extra.cardOrderBase = cards; extra.cardOrder = fiveCrownsRigCardOrder(cards, names, context.rig || {});
    }
    if (fiveCrownsRevealVariant(v)) {
      extra.revealedCount = 0; extra.fakeOutMisses = 0; extra.dealerEnabled = dealerEnabled;
      extra.dealerOrder = dealerOrder; extra.dealerRounds = dealerRounds; extra.dealerOrderStartsAt = 0;
    } return extra;
  },
  cardCount: fiveCrownsCardCount,
  dealerName: fiveCrownsDealerName,
  applyDealerRig: fiveCrownsApplyDealerRig,
  onPlayerAdded: fiveCrownsAddDealer,
  revealNoun(state) { return state && state.variant === 'super-random' ? 'round' : 'wild'; },
  revealItems(state) {
    const wilds = fiveCrownsWildsFromState(state); const superRandom = state && state.variant === 'super-random';
    return wilds.map((wild, i) => {
      if (!superRandom) return { reels: [{ label: 'Wild', value: wild }], result: wild + ' is wild!' };
      const cardCount = fiveCrownsCardCount(i, state); const cards = cardCountText(cardCount);
      return {
        reels: [{ label: 'Cards', value: String(cardCount), tone: 'cards' }, { label: 'Wild', value: wild }],
        result: cards + ' \u00b7 ' + wild + ' wild!',
      };
    });
  },
  roundLabel(i, state) {
    const wilds = fiveCrownsWildsFromState(state); const superRandom = state && state.variant === 'super-random';
    const label = { num: String(i + 1), sub: wilds[i], hideRoundNumber: true };
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
  fiveCrowns, fiveCrownsWildOrder, fiveCrownsDealerOrder, fiveCrownsDealerRounds,
  fiveCrownsDealerId, fiveCrownsRigCardOrder,
  FIVE_CROWNS_WILDS, FIVE_CROWNS_FIRST_HAND, FIVE_CROWNS_CARD_COUNTS, FIVE_CROWNS_ROUNDS,
};
