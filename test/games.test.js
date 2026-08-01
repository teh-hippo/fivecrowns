import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dealerPreferenceResolver } from '../lib/dealer-rig.js';
import {
  contractValue,
  suitContractValue,
  bidLabel,
  buildBidOrder,
  five00,
  greed,
  greedRunningTotals,
  fiveCrowns,
  fiveCrownsWildOrder,
  fiveCrownsDealerOrder,
  fiveCrownsDealerRounds,
  fiveCrownsDealerId,
  fiveCrownsSetDealer,
  fiveCrownsRigCardOrder,
  standings,
  endedEarlyStatus,
  FIVE_CROWNS_WILDS,
  FIVE_CROWNS_CARD_COUNTS,
  FIVE_CROWNS_ROUNDS,
  leadersOf,
  sumScores,
  lastFilledIndex,
  joinNames,
  winnerText,
} from '../games.js';

const sides = [
  { id: 'p1', name: 'Us' },
  { id: 'p2', name: 'Them' },
];

/* ---------- shared helpers ---------- */
test('sumScores ignores nulls and non-numbers', () => {
  assert.equal(sumScores([5, null, 3]), 8);
  assert.equal(sumScores([1, 'x', 2, NaN]), 3);
  assert.equal(sumScores(null), 0);
  assert.equal(sumScores([]), 0);
});

test('lastFilledIndex finds the last non-null', () => {
  assert.equal(lastFilledIndex([1, null, 2, null]), 2);
  assert.equal(lastFilledIndex([null, null]), -1);
  assert.equal(lastFilledIndex([]), -1);
  assert.equal(lastFilledIndex(null), -1);
});

test('leadersOf reports best, ties and distinctness', () => {
  assert.deepEqual(leadersOf({ p1: 10, p2: 20 }, 'low'), {
    best: 10,
    leaders: ['p1'],
    distinct: true,
  });
  assert.deepEqual(leadersOf({ p1: 20, p2: 10 }, 'high'), {
    best: 20,
    leaders: ['p1'],
    distinct: true,
  });
  const tie = leadersOf({ p1: 10, p2: 10 }, 'low');
  assert.equal(tie.best, 10);
  assert.deepEqual(tie.leaders.sort(), ['p1', 'p2']);
  assert.equal(tie.distinct, false);
  assert.deepEqual(leadersOf({}, 'low'), { best: 0, leaders: [], distinct: false });
});

test('joinNames maps ids to names and falls back to the id', () => {
  assert.equal(joinNames(sides, ['p1', 'p2']), 'Us, Them');
  assert.equal(joinNames(sides, ['pX']), 'pX');
});

test('winnerText announces a winner or a tie', () => {
  assert.ok(winnerText(sides, ['p1'], 100).includes('Us wins with 100!'));
  assert.ok(winnerText(sides, ['p1', 'p2'], 50).includes('Tie at 50: Us, Them'));
});

/* ---------- 500 contracts ---------- */
test('contractValue covers suits, no-trumps and the special bids', () => {
  assert.equal(contractValue({ kind: 'suit', suit: 'spades', level: 6 }), 40);
  assert.equal(contractValue({ kind: 'suit', suit: 'clubs', level: 6 }), 60);
  assert.equal(contractValue({ kind: 'suit', suit: 'diamonds', level: 6 }), 80);
  assert.equal(contractValue({ kind: 'suit', suit: 'hearts', level: 6 }), 100);
  assert.equal(contractValue({ kind: 'nt', suit: 'nt', level: 6 }), 120);
  assert.equal(contractValue({ kind: 'suit', suit: 'spades', level: 7 }), 140);
  assert.equal(contractValue({ kind: 'nt', suit: 'nt', level: 10 }), 520);
  assert.equal(contractValue({ kind: 'misere' }), 250);
  assert.equal(contractValue({ kind: 'open' }), 500);
  assert.equal(contractValue(null), 0);
  assert.equal(suitContractValue('hearts', 8), 300);
});

test('bidLabel renders a readable contract', () => {
  assert.equal(bidLabel({ kind: 'misere' }), 'Mis\u00e8re');
  assert.equal(bidLabel({ kind: 'open' }), 'Open mis\u00e8re');
  assert.equal(bidLabel({ kind: 'suit', suit: 'spades', level: 7 }), '7\u2660');
  assert.equal(bidLabel(null), '');
});

test('buildBidOrder lists every contract in rank order', () => {
  const order = buildBidOrder();
  assert.equal(order.length, 27); // 5 levels x 5 suits + misere + open
  assert.equal(order.filter((b) => b.kind === 'misere').length, 1);
  assert.equal(order.filter((b) => b.kind === 'open').length, 1);
  assert.deepEqual(order[0], { kind: 'suit', suit: 'spades', level: 6 });
});

/* ---------- 500 scoring ---------- */
test('scoreHand: a made suit bid scores its value plus opponent tricks', () => {
  const r = five00.scoreHand(
    { bidderId: 'p1', bid: { kind: 'suit', suit: 'spades', level: 7 }, tricks: { p1: 7, p2: 3 } },
    sides,
  );
  assert.equal(r.meta.made, true);
  assert.deepEqual(r.deltas, { p1: 140, p2: 30 });
});

test('scoreHand: a set bid loses its value, opponents still score tricks', () => {
  const r = five00.scoreHand(
    { bidderId: 'p1', bid: { kind: 'suit', suit: 'spades', level: 7 }, tricks: { p1: 6, p2: 4 } },
    sides,
  );
  assert.equal(r.meta.made, false);
  assert.deepEqual(r.deltas, { p1: -140, p2: 40 });
});

test('scoreHand: a slam on a low bid is worth 250', () => {
  const r = five00.scoreHand(
    { bidderId: 'p1', bid: { kind: 'suit', suit: 'spades', level: 6 }, tricks: { p1: 10, p2: 0 } },
    sides,
  );
  assert.deepEqual(r.deltas, { p1: 250, p2: 0 });
});

test('scoreHand: a high bid taken with all tricks scores its own value (no slam bonus)', () => {
  const r = five00.scoreHand(
    { bidderId: 'p1', bid: { kind: 'nt', suit: 'nt', level: 8 }, tricks: { p1: 10, p2: 0 } },
    sides,
  );
  assert.equal(r.deltas.p1, 320);
});

test('scoreHand: misere made and set', () => {
  const made = five00.scoreHand(
    { bidderId: 'p1', bid: { kind: 'misere' }, tricks: { p1: 0, p2: 0 } },
    sides,
  );
  assert.deepEqual(made.deltas, { p1: 250, p2: 0 });
  const set = five00.scoreHand(
    { bidderId: 'p1', bid: { kind: 'misere' }, tricks: { p1: 1, p2: 0 } },
    sides,
  );
  assert.deepEqual(set.deltas, { p1: -250, p2: 0 });
});

test('scoreHand: open misere made and set', () => {
  const made = five00.scoreHand(
    { bidderId: 'p1', bid: { kind: 'open' }, tricks: { p1: 0, p2: 0 } },
    sides,
  );
  assert.deepEqual(made.deltas, { p1: 500, p2: 0 });
  const set = five00.scoreHand(
    { bidderId: 'p1', bid: { kind: 'open' }, tricks: { p1: 2, p2: 0 } },
    sides,
  );
  assert.deepEqual(set.deltas, { p1: -500, p2: 0 });
});

/* ---------- 500 resolve ---------- */
function handFor(input) {
  const r = five00.scoreHand(input, sides);
  return {
    id: 'h',
    bidderId: input.bidderId,
    bid: input.bid,
    bidValue: r.meta.bidValue,
    made: r.meta.made,
    tricks: r.meta.tricks,
    deltas: r.deltas,
  };
}

test('500 resolve: in progress until a side reaches the target', () => {
  const state = {
    hands: [
      handFor({
        bidderId: 'p1',
        bid: { kind: 'suit', suit: 'spades', level: 7 },
        tricks: { p1: 7, p2: 3 },
      }),
    ],
  };
  const { status } = five00.resolve(sides, state);
  assert.equal(status.phase, 'inProgress');
});

test('500 resolve: a made bid reaching 500 wins', () => {
  const state = {
    hands: [handFor({ bidderId: 'p1', bid: { kind: 'open' }, tricks: { p1: 0, p2: 0 } })],
  };
  const { totals, status } = five00.resolve(sides, state);
  assert.equal(status.phase, 'complete');
  assert.deepEqual(status.leaders, ['p1']);
  assert.equal(totals.p1, 500);
});

test('500 resolve: dropping to -500 puts a side out and the other wins', () => {
  const state = {
    hands: [handFor({ bidderId: 'p1', bid: { kind: 'open' }, tricks: { p1: 3, p2: 0 } })],
  };
  const { status } = five00.resolve(sides, state);
  assert.equal(status.phase, 'out');
  assert.deepEqual(status.leaders, ['p2']);
});

test('500 resolve: hands after the deciding hand are ignored', () => {
  const win = handFor({ bidderId: 'p1', bid: { kind: 'open' }, tricks: { p1: 0, p2: 0 } }); // p1 -> +500, wins
  const extra = handFor({
    bidderId: 'p2',
    bid: { kind: 'suit', suit: 'hearts', level: 6 },
    tricks: { p2: 6, p1: 4 },
  });
  const { totals, status } = five00.resolve(sides, { hands: [win, extra] });
  assert.equal(status.phase, 'complete');
  assert.deepEqual(status.leaders, ['p1']);
  assert.equal(totals.p2, 0); // the extra hand never counted
});

test('500 resolve: a winning banner reports the actual total, not the 500 target', () => {
  const lead = handFor({
    bidderId: 'p1',
    bid: { kind: 'suit', suit: 'spades', level: 7 },
    tricks: { p1: 7, p2: 3 },
  }); // p1 +140
  const clinch = handFor({ bidderId: 'p1', bid: { kind: 'open' }, tricks: { p1: 0, p2: 0 } }); // p1 +500 -> 640, wins
  const { totals, status } = five00.resolve(sides, { hands: [lead, clinch] });
  assert.equal(status.phase, 'complete');
  assert.equal(totals.p1, 640);
  assert.match(status.text, /wins with 640/);
  assert.doesNotMatch(status.text, /500/);
});

test('500 resolve: an out banner reports the actual total, not the -500 threshold', () => {
  const drop = handFor({
    bidderId: 'p1',
    bid: { kind: 'suit', suit: 'spades', level: 7 },
    tricks: { p1: 6, p2: 4 },
  }); // p1 -140, p2 +40
  const bust = handFor({ bidderId: 'p1', bid: { kind: 'open' }, tricks: { p1: 3, p2: 0 } }); // p1 -500 -> -640, out
  const { totals, status } = five00.resolve(sides, { hands: [drop, bust] });
  assert.equal(status.phase, 'out');
  assert.equal(totals.p1, -640);
  assert.deepEqual(status.leaders, ['p2']);
  assert.match(status.text, /out at -640/);
});

/* ---------- Greed ---------- */
test('greedRunningTotals respects getting on the board', () => {
  assert.deepEqual(greedRunningTotals([300, 600, 100]), [0, 600, 700]);
  assert.deepEqual(greedRunningTotals([400]), [0]);
  assert.deepEqual(greedRunningTotals([500]), [500]);
  // A joiner's backfilled 0s cost nothing and leave them off the board.
  assert.deepEqual(greedRunningTotals([0, 0, 1200]), [0, 0, 1200]);
});

test('Greed resolve: in progress below the target', () => {
  const { status } = greed.resolve(sides, { scores: { p1: [600], p2: [700] } });
  assert.equal(status.phase, 'inProgress');
});

test('Greed resolve: reaching the target triggers one final round', () => {
  const { status } = greed.resolve(sides, { scores: { p1: [5000], p2: [] } });
  assert.equal(status.phase, 'targetReached');
  assert.ok(status.text.includes('reached 5000'));
  assert.equal(status.finalRound, 1);
});

test('Greed resolve: complete once the final round is filled, highest wins', () => {
  const { totals, status } = greed.resolve(sides, { scores: { p1: [5000, 100], p2: [6000, 200] } });
  assert.equal(status.phase, 'complete');
  assert.deepEqual(status.leaders, ['p2']);
  assert.equal(totals.p2, 6200);
  assert.equal(totals.p1, 5100);
});

/* ---------- Five Crowns ---------- */
test('Five Crowns shows only the key round note outside Super Random', () => {
  assert.equal(FIVE_CROWNS_ROUNDS, 11);
  assert.deepEqual(fiveCrowns.roundLabel(0), { num: '1', sub: '3s', hideRoundNumber: true });
  assert.deepEqual(fiveCrowns.roundLabel(10), { num: '11', sub: 'Kings', hideRoundNumber: true });
  assert.equal(fiveCrowns.cardCount(0), 3);
  assert.equal(fiveCrowns.cardCount(10), 13);
  assert.equal(FIVE_CROWNS_WILDS.length, 11);
  assert.deepEqual(FIVE_CROWNS_CARD_COUNTS, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
});

test('Five Crowns orders: fixed modes stay aligned and random is a full shuffle', () => {
  assert.deepEqual(fiveCrownsWildOrder('up'), FIVE_CROWNS_WILDS);
  assert.deepEqual(fiveCrownsWildOrder('down'), [...FIVE_CROWNS_WILDS].reverse());

  const up = fiveCrowns.initVariant('up');
  assert.equal(up.variant, 'up');
  assert.equal(up.wildOrder[0], '3s');
  assert.equal(fiveCrowns.cardCount(0, up), 3);

  const down = fiveCrowns.initVariant('down');
  assert.equal(down.wildOrder[0], 'Kings');
  assert.equal(down.wildOrder[10], '3s');
  assert.equal(fiveCrowns.cardCount(0, down), 13);
  assert.deepEqual(fiveCrowns.roundLabel(0, down), {
    num: '1',
    sub: 'Kings',
    hideRoundNumber: true,
  });

  const random = fiveCrowns.initVariant('random');
  assert.equal(random.variant, 'random');
  assert.equal(random.revealedCount, 0);
  assert.equal(random.fakeOutMisses, 0);
  assert.equal(random.wildOrder.length, 11);
  assert.deepEqual([...random.wildOrder].sort(), [...FIVE_CROWNS_WILDS].sort());

  // Up/Down are never masked, so they carry no revealedCount.
  assert.equal(up.revealedCount, undefined);
  assert.equal(down.revealedCount, undefined);
  assert.equal(up.fakeOutMisses, undefined);
  assert.equal(down.fakeOutMisses, undefined);
  assert.equal(random.cardOrder, undefined);

  // An unknown variant falls back to the default.
  assert.equal(fiveCrowns.initVariant('nope').variant, 'up');
});

test('Random keeps each wild paired with its usual card count', () => {
  const wildOrder = ['10s', ...FIVE_CROWNS_WILDS.filter((wild) => wild !== '10s')];
  const st = { variant: 'random', wildOrder, revealedCount: 1 };
  assert.equal(fiveCrowns.cardCount(0, st), 10);
  assert.deepEqual(fiveCrowns.roundLabel(0, st), { num: '1', sub: '10s', hideRoundNumber: true });
});

test('Super Random deterministically shuffles every card count and wild exactly once', () => {
  const superRandom = fiveCrowns.initVariant('super-random', () => 0);
  assert.equal(superRandom.variant, 'super-random');
  assert.equal(superRandom.revealedCount, 0);
  assert.equal(superRandom.fakeOutMisses, 0);
  assert.deepEqual(superRandom.wildOrder, [...FIVE_CROWNS_WILDS.slice(1), FIVE_CROWNS_WILDS[0]]);
  assert.deepEqual(superRandom.cardOrder, [
    ...FIVE_CROWNS_CARD_COUNTS.slice(1),
    FIVE_CROWNS_CARD_COUNTS[0],
  ]);
  assert.equal(new Set(superRandom.wildOrder).size, FIVE_CROWNS_ROUNDS);
  assert.equal(new Set(superRandom.cardOrder).size, FIVE_CROWNS_ROUNDS);
  assert.deepEqual([...superRandom.wildOrder].sort(), [...FIVE_CROWNS_WILDS].sort());
  assert.deepEqual(
    [...superRandom.cardOrder].sort((a, b) => a - b),
    FIVE_CROWNS_CARD_COUNTS,
  );
});

test('Dealer nomination rotates from the selected first dealer', () => {
  const players = [
    { id: 'p1', name: 'Dad' },
    { id: 'p2', name: 'Mum' },
    { id: 'p3', name: 'Sam' },
  ];
  const order = fiveCrownsDealerOrder(players, 1);
  assert.deepEqual(order, ['p2', 'p3', 'p1']);
  assert.deepEqual(fiveCrownsDealerRounds(order).slice(0, 5), ['p2', 'p3', 'p1', 'p2', 'p3']);

  const state = {
    variant: 'random',
    dealerOrder: order,
    dealerRounds: fiveCrownsDealerRounds(order),
    players,
  };
  assert.equal(fiveCrownsDealerId(0, state), 'p2');
  assert.equal(fiveCrownsDealerId(2, state), 'p1');
});

test('Dealer rigging gives Dad the lowest and Mum the highest remaining count', () => {
  const base = [8, 3, 12, 4, 13, 5, 11, 6, 10, 7, 9];
  const dealers = ['Dad', 'Sam', 'Mum', 'Dad', 'Sam', 'Mum', 'Dad', 'Sam', 'Mum', 'Dad', 'Sam'];
  const order = fiveCrownsRigCardOrder(
    base,
    dealers,
    dealerPreferenceResolver({ dadLowCards: true, mumHighCards: true }),
  );
  assert.deepEqual(order.slice(0, 3), [3, 8, 13]);
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    FIVE_CROWNS_CARD_COUNTS,
  );
});

test('Super Random applies dealer rigging without constraining wilds', () => {
  const players = [
    { id: 'p1', name: 'Dad' },
    { id: 'p2', name: 'Mum' },
    { id: 'p3', name: 'Sam' },
  ];
  const state = fiveCrowns.initVariant('super-random', () => 0, {
    players,
    firstDealerIndex: 0,
    preferenceFor: dealerPreferenceResolver({ dadLowCards: true, mumHighCards: true }),
  });
  assert.deepEqual(state.dealerOrder, ['p1', 'p2', 'p3']);
  assert.deepEqual(state.dealerRounds.slice(0, 4), ['p1', 'p2', 'p3', 'p1']);
  assert.deepEqual(state.cardOrder.slice(0, 3), [3, 13, 4]);
  assert.deepEqual(state.cardOrderBase, [
    ...FIVE_CROWNS_CARD_COUNTS.slice(1),
    FIVE_CROWNS_CARD_COUNTS[0],
  ]);
  assert.deepEqual(state.wildOrder, [...FIVE_CROWNS_WILDS.slice(1), FIVE_CROWNS_WILDS[0]]);

  fiveCrowns.applyDealerRig(state, dealerPreferenceResolver({}));
  assert.deepEqual(state.cardOrder, state.cardOrderBase);
});

test('Overriding a round dealer reseats the table from that round', () => {
  const players = [
    { id: 'p1', name: 'A' },
    { id: 'p2', name: 'B' },
    { id: 'p3', name: 'C' },
    { id: 'p4', name: 'D' },
  ];
  const order = ['p1', 'p2', 'p3', 'p4'];
  const state = {
    variant: 'random',
    dealerOrder: order,
    dealerRounds: fiveCrownsDealerRounds(order),
    dealerOrderStartsAt: 0,
    revealedCount: 1,
    players,
  };

  // B was down to deal round two; D takes that seat and the rest shuffle down.
  assert.equal(fiveCrownsSetDealer(state, 1, 'p4'), true);
  assert.deepEqual(
    state.players.map((player) => player.id),
    ['p1', 'p4', 'p2', 'p3'],
  );
  assert.deepEqual(state.dealerOrder, ['p4', 'p2', 'p3', 'p1']);
  assert.equal(state.dealerOrderStartsAt, 1);
  assert.deepEqual(state.dealerRounds.slice(0, 6), ['p1', 'p4', 'p2', 'p3', 'p1', 'p4']);
  assert.equal(state.dealerRounds[0], 'p1', 'the round already dealt keeps its dealer');
});

test('Overriding a round dealer refuses picks that change nothing', () => {
  const players = [
    { id: 'p1', name: 'Dad' },
    { id: 'p2', name: 'Mum' },
    { id: 'p3', name: 'Sam' },
  ];
  const order = ['p1', 'p2', 'p3'];
  const state = {
    variant: 'random',
    dealerOrder: order,
    dealerRounds: fiveCrownsDealerRounds(order),
    dealerOrderStartsAt: 0,
    revealedCount: 2,
    players,
  };

  assert.equal(fiveCrownsSetDealer(state, 2, 'p3'), false, 'the current dealer is not a change');
  assert.equal(fiveCrownsSetDealer(state, 2, 'p9'), false, 'a stranger cannot deal');
  assert.equal(fiveCrownsSetDealer(state, 11, 'p1'), false, 'there is no round twelve');
  assert.deepEqual(state.dealerOrder, order, 'a refused pick leaves the table alone');

  assert.equal(fiveCrownsSetDealer(state, 2, 'p2'), true);
  assert.deepEqual(state.dealerRounds.slice(0, 6), ['p1', 'p2', 'p2', 'p3', 'p1', 'p2']);
  assert.equal(fiveCrownsDealerId(2, state), 'p2');
});

test('Overriding the dealer re-rigs the rounds still to come', () => {
  const state = {
    variant: 'super-random',
    dealerOrder: ['p3', 'p1', 'p2'],
    dealerRounds: fiveCrownsDealerRounds(['p3', 'p1', 'p2']),
    dealerOrderStartsAt: 0,
    revealedCount: 0,
    cardOrderBase: [8, 3, 12, 4, 13, 5, 11, 6, 10, 7, 9],
    cardOrder: [8, 3, 12, 4, 13, 5, 11, 6, 10, 7, 9],
    players: [
      { id: 'p1', name: 'Dad' },
      { id: 'p2', name: 'Mum' },
      { id: 'p3', name: 'Sam' },
    ],
  };
  const prefer = dealerPreferenceResolver({ dadLowCards: true, mumHighCards: true });

  assert.equal(state.cardOrder[0], 8, 'Sam deals first and gets no help');
  assert.equal(fiveCrownsSetDealer(state, 0, 'p1', prefer), true);
  assert.deepEqual(
    state.players.map((player) => player.id),
    ['p2', 'p1', 'p3'],
    'Dad takes the seat Sam was dealing from',
  );
  assert.equal(state.cardOrder[0], 3, 'Dad now deals round one and gets the lowest count');
  assert.equal(state.cardOrder[2], 13, 'Mum deals round three and gets the highest');
  assert.deepEqual(
    [...state.cardOrder].sort((a, b) => a - b),
    FIVE_CROWNS_CARD_COUNTS,
  );
});

test('A mid-game player joins the dealer rotation after the current cycle', () => {
  const state = {
    variant: 'random',
    dealerOrder: ['p2', 'p3', 'p1'],
    dealerRounds: fiveCrownsDealerRounds(['p2', 'p3', 'p1']),
    revealedCount: 4,
    players: [
      { id: 'p1', name: 'A' },
      { id: 'p2', name: 'B' },
      { id: 'p3', name: 'C' },
      { id: 'p4', name: 'D' },
    ],
  };
  fiveCrowns.onPlayerAdded(state, 'p4', {});
  assert.deepEqual(state.dealerOrder, ['p2', 'p3', 'p1', 'p4']);
  assert.deepEqual(state.dealerRounds.slice(4, 10), ['p3', 'p1', 'p2', 'p3', 'p1', 'p4']);
});

test('Repeated mid-game additions share the same pending dealer cycle', () => {
  const state = {
    variant: 'random',
    dealerOrder: ['p1', 'p2', 'p3'],
    dealerRounds: fiveCrownsDealerRounds(['p1', 'p2', 'p3']),
    dealerOrderStartsAt: 0,
    revealedCount: 1,
    players: [
      { id: 'p1', name: 'A' },
      { id: 'p2', name: 'B' },
      { id: 'p3', name: 'C' },
      { id: 'p4', name: 'D' },
    ],
  };
  fiveCrowns.onPlayerAdded(state, 'p4', {});
  state.players.push({ id: 'p5', name: 'E' });
  fiveCrowns.onPlayerAdded(state, 'p5', {});
  assert.equal(state.dealerOrderStartsAt, 3);
  assert.deepEqual(state.dealerRounds.slice(0, 9), [
    'p1',
    'p2',
    'p3',
    'p1',
    'p2',
    'p3',
    'p4',
    'p5',
    'p1',
  ]);
});

test('Random wilds are gated by a spin: locked, then ready, then revealed', () => {
  const order = FIVE_CROWNS_WILDS;
  const st = {
    variant: 'random',
    wildOrder: order,
    revealedCount: 0,
    players: sides,
    scores: { p1: [], p2: [] },
  };

  assert.deepEqual(fiveCrowns.revealItems(st)[0], {
    reels: [{ label: 'Wild', value: '3s' }],
    result: '3s is wild!',
  });

  // Round 0 starts ready (glowing, tappable), not yet revealed; round 1 is locked.
  assert.deepEqual(fiveCrowns.roundLabel(0, st), {
    num: '1',
    sub: '?',
    hideRoundNumber: true,
    ready: true,
  });
  assert.deepEqual(fiveCrowns.roundLabel(1, st), {
    num: '2',
    sub: '\u2014',
    hideRoundNumber: true,
    masked: true,
  });

  // Opening round 0 (spin done) reveals its wild; round 1 stays locked until
  // round 0 is fully entered.
  st.revealedCount = 1;
  assert.deepEqual(fiveCrowns.roundLabel(0, st), {
    num: '1',
    sub: order[0],
    hideRoundNumber: true,
  });
  assert.deepEqual(fiveCrowns.roundLabel(1, st), {
    num: '2',
    sub: '\u2014',
    hideRoundNumber: true,
    masked: true,
  });

  st.scores.p1[0] = 5; // only one player scored round 0
  assert.deepEqual(fiveCrowns.roundLabel(1, st), {
    num: '2',
    sub: '\u2014',
    hideRoundNumber: true,
    masked: true,
  });

  st.scores.p2[0] = 3; // round 0 now complete -> round 1 becomes ready (not auto-revealed)
  assert.deepEqual(fiveCrowns.roundLabel(1, st), {
    num: '2',
    sub: '?',
    hideRoundNumber: true,
    ready: true,
  });
  assert.deepEqual(fiveCrowns.roundLabel(2, st), {
    num: '3',
    sub: '\u2014',
    hideRoundNumber: true,
    masked: true,
  });

  // Spinning round 1 open reveals it.
  st.revealedCount = 2;
  assert.deepEqual(fiveCrowns.roundLabel(1, st), {
    num: '2',
    sub: order[1],
    hideRoundNumber: true,
  });
});

test('Super Random hides and reveals the paired card count and wild', () => {
  const st = {
    variant: 'super-random',
    wildOrder: [...FIVE_CROWNS_WILDS].reverse(),
    cardOrder: [...FIVE_CROWNS_CARD_COUNTS].reverse(),
    revealedCount: 0,
    players: sides,
    scores: { p1: [], p2: [] },
  };

  assert.deepEqual(fiveCrowns.roundLabel(0, st), {
    num: '1',
    cards: '? cards',
    cardsReady: true,
    sub: '?',
    hideRoundNumber: true,
    ready: true,
  });
  assert.deepEqual(fiveCrowns.roundLabel(1, st), {
    num: '2',
    cards: '\u2014',
    cardsMasked: true,
    sub: '\u2014',
    hideRoundNumber: true,
    masked: true,
  });

  st.revealedCount = 1;
  assert.deepEqual(fiveCrowns.roundLabel(0, st), {
    num: '1',
    cards: '13 cards',
    sub: 'Kings',
    hideRoundNumber: true,
  });
  assert.deepEqual(fiveCrowns.revealItems(st)[0], {
    reels: [
      { label: 'Cards', value: '13', tone: 'cards' },
      { label: 'Wild', value: 'Kings' },
    ],
    result: '13 cards \u00b7 Kings wild!',
  });

  st.scores.p1[0] = 4;
  st.scores.p2[0] = 8;
  assert.deepEqual(fiveCrowns.roundLabel(1, st), {
    num: '2',
    cards: '? cards',
    cardsReady: true,
    sub: '?',
    hideRoundNumber: true,
    ready: true,
  });
});

test('Super Random falls back to valid only-once orders for malformed saved data', () => {
  const st = {
    variant: 'super-random',
    wildOrder: ['Kings'],
    cardOrder: [13, 13],
    revealedCount: -3,
  };
  assert.deepEqual(fiveCrowns.roundLabel(0, st), {
    num: '1',
    cards: '? cards',
    cardsReady: true,
    sub: '?',
    hideRoundNumber: true,
    ready: true,
  });
  st.revealedCount = 1;
  assert.deepEqual(fiveCrowns.roundLabel(0, st), {
    num: '1',
    cards: '3 cards',
    sub: '3s',
    hideRoundNumber: true,
  });
  assert.deepEqual(fiveCrowns.revealItems(st)[0], {
    reels: [
      { label: 'Cards', value: '3', tone: 'cards' },
      { label: 'Wild', value: '3s' },
    ],
    result: '3 cards \u00b7 3s wild!',
  });
});

test('Five Crowns resolve: in progress until every round is entered, then lowest wins', () => {
  const partial = { scores: { p1: [5], p2: [3] } };
  assert.equal(fiveCrowns.resolve(sides, partial).status.phase, 'inProgress');

  const full = { scores: { p1: new Array(11).fill(1), p2: new Array(11).fill(2) } };
  const { totals, status } = fiveCrowns.resolve(sides, full);
  assert.equal(status.phase, 'complete');
  assert.deepEqual(status.leaders, ['p1']);
  assert.equal(totals.p1, 11);
  assert.equal(totals.p2, 22);
});

test('Super Random keeps the same 11-round scoring and lowest-total winner', () => {
  const state = {
    variant: 'super-random',
    scores: { p1: new Array(11).fill(4), p2: new Array(11).fill(7) },
  };
  const { totals, status } = fiveCrowns.resolve(sides, state);
  assert.equal(status.phase, 'complete');
  assert.deepEqual(status.leaders, ['p1']);
  assert.deepEqual(totals, { p1: 44, p2: 77 });
});

test('Five Crowns resolve: a joiner scores from their filled rows alone', () => {
  const joined = [{ id: 'p1', name: 'Us' }];
  const { totals } = fiveCrowns.resolve(joined, { scores: { p1: [0, 0, 10, 5] } });
  assert.equal(totals.p1, 15);
});

test('500 resolve reports which hand ended the game', () => {
  const hand = (bidderId, deltas, made) => ({
    id: 'h',
    bidderId,
    bid: { kind: 'suit', suit: 'spades', level: 6 },
    made,
    tricks: {},
    deltas,
  });

  const open = five00.resolve(sides, { hands: [hand('p1', { p1: 300, p2: 0 }, true)] });
  assert.equal(open.status.phase, 'inProgress');
  assert.equal(open.status.terminalHand, null);

  const won = five00.resolve(sides, {
    hands: [
      hand('p1', { p1: 300, p2: 0 }, true),
      hand('p1', { p1: 300, p2: 0 }, true),
      hand('p2', { p1: 0, p2: 400 }, true),
    ],
  });
  assert.equal(won.status.phase, 'complete');
  assert.equal(won.status.terminalHand, 1, 'the second hand takes Us past 500');
  assert.deepEqual(won.totals, { p1: 600, p2: 0 }, 'the third hand scores nothing');

  const out = five00.resolve(sides, {
    hands: [hand('p2', { p1: 0, p2: -500 }, false), hand('p1', { p1: 120, p2: 0 }, true)],
  });
  assert.equal(out.status.phase, 'out');
  assert.equal(out.status.terminalHand, 0);
});

/* ---------- final standings ---------- */

const ROSTER = [
  { id: 'p1', name: 'Dad' },
  { id: 'p2', name: 'Mum' },
  { id: 'p3', name: 'Sam' },
];

test('standings rank a low-scoring game from the front', () => {
  const places = standings(ROSTER, { p1: 14, p2: 30, p3: 90 }, 'low', ['p1']);
  assert.deepEqual(
    places.map((place) => [place.place, place.label, place.names, place.score]),
    [
      [1, '1st', ['Dad'], 14],
      [2, '2nd', ['Mum'], 30],
      [3, '3rd', ['Sam'], 90],
    ],
  );
});

test('standings rank a high-scoring game from the front', () => {
  const places = standings(ROSTER, { p1: 100, p2: 5000, p3: 900 }, 'high', ['p2']);
  assert.deepEqual(
    places.map((place) => place.names[0]),
    ['Mum', 'Sam', 'Dad'],
  );
});

test('an equal score shares a place and the next one steps over it', () => {
  const places = standings(ROSTER, { p1: 20, p2: 20, p3: 90 }, 'low', []);
  assert.deepEqual(
    places.map((place) => [place.place, place.label, place.names]),
    [
      [1, '1st', ['Dad', 'Mum']],
      [3, '3rd', ['Sam']],
    ],
  );
});

// 500 hands the game to the side that made its bid, or to whoever is left
// standing, and neither is always the highest total.
test('whoever the rules call a winner leads, however they scored', () => {
  const places = standings(ROSTER, { p1: 520, p2: 700, p3: -500 }, 'high', ['p1']);
  assert.deepEqual(
    places.map((place) => [place.place, place.names[0], place.score]),
    [
      [1, 'Dad', 520],
      [2, 'Mum', 700],
      [3, 'Sam', -500],
    ],
  );
});

test('several winners are ranked among themselves before everyone else', () => {
  const places = standings(ROSTER, { p1: 10, p2: 90, p3: 400 }, 'high', ['p1', 'p2']);
  assert.deepEqual(
    places.map((place) => place.names[0]),
    ['Mum', 'Dad', 'Sam'],
  );
});

test('standings stop at the podium and cope with an empty table', () => {
  const wide = Array.from({ length: 6 }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const totals = {};
  wide.forEach((player, i) => {
    totals[player.id] = i * 10;
  });
  assert.equal(standings(wide, totals, 'low', []).length, 3);
  assert.deepEqual(standings([], {}, 'low', []), []);
  assert.deepEqual(standings(null, null, 'low'), []);
});

test('a missing total counts as nothing rather than breaking the ranking', () => {
  const places = standings(ROSTER, { p1: 14 }, 'low', []);
  assert.deepEqual(
    places.map((place) => [place.place, place.names, place.score]),
    [
      [1, ['Mum', 'Sam'], 0],
      [3, ['Dad'], 14],
    ],
  );
});

test('ending early settles the game on the scores as they stand', () => {
  const status = endedEarlyStatus(ROSTER, { p1: 14, p2: 30, p3: 90 }, 'low');
  assert.equal(status.phase, 'complete');
  assert.equal(status.endedEarly, true);
  assert.deepEqual(status.leaders, ['p1']);
  assert.match(status.text, /Dad wins with 14/);
});

test('a tie at the top of an early end stays a tie', () => {
  const status = endedEarlyStatus(ROSTER, { p1: 20, p2: 20, p3: 20 }, 'low');
  assert.deepEqual(status.leaders, [], 'nobody is highlighted when everyone is level');
  assert.match(status.text, /Tie at 20/);
});
