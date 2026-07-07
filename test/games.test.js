import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contractValue, suitContractValue, bidLabel, buildBidOrder,
  five00, greed, greedRunningTotals,
  fiveCrowns, fiveCrownsWildOrder, FIVE_CROWNS_WILDS, FIVE_CROWNS_ROUNDS,
  leadersOf, sumScores, lastFilledIndex, joinNames, winnerText,
} from '../games.js';

const sides = [{ id: 'p1', name: 'Us', seed: 0 }, { id: 'p2', name: 'Them', seed: 0 }];

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
  assert.deepEqual(leadersOf({ p1: 10, p2: 20 }, 'low'), { best: 10, leaders: ['p1'], distinct: true });
  assert.deepEqual(leadersOf({ p1: 20, p2: 10 }, 'high'), { best: 20, leaders: ['p1'], distinct: true });
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
  const r = five00.scoreHand({ bidderId: 'p1', bid: { kind: 'suit', suit: 'spades', level: 7 }, tricks: { p1: 7, p2: 3 } }, sides);
  assert.equal(r.meta.made, true);
  assert.deepEqual(r.deltas, { p1: 140, p2: 30 });
});

test('scoreHand: a set bid loses its value, opponents still score tricks', () => {
  const r = five00.scoreHand({ bidderId: 'p1', bid: { kind: 'suit', suit: 'spades', level: 7 }, tricks: { p1: 6, p2: 4 } }, sides);
  assert.equal(r.meta.made, false);
  assert.deepEqual(r.deltas, { p1: -140, p2: 40 });
});

test('scoreHand: a slam on a low bid is worth 250', () => {
  const r = five00.scoreHand({ bidderId: 'p1', bid: { kind: 'suit', suit: 'spades', level: 6 }, tricks: { p1: 10, p2: 0 } }, sides);
  assert.deepEqual(r.deltas, { p1: 250, p2: 0 });
});

test('scoreHand: a high bid taken with all tricks scores its own value (no slam bonus)', () => {
  const r = five00.scoreHand({ bidderId: 'p1', bid: { kind: 'nt', suit: 'nt', level: 8 }, tricks: { p1: 10, p2: 0 } }, sides);
  assert.equal(r.deltas.p1, 320);
});

test('scoreHand: misere made and set', () => {
  const made = five00.scoreHand({ bidderId: 'p1', bid: { kind: 'misere' }, tricks: { p1: 0, p2: 0 } }, sides);
  assert.deepEqual(made.deltas, { p1: 250, p2: 0 });
  const set = five00.scoreHand({ bidderId: 'p1', bid: { kind: 'misere' }, tricks: { p1: 1, p2: 0 } }, sides);
  assert.deepEqual(set.deltas, { p1: -250, p2: 0 });
});

test('scoreHand: open misere made and set', () => {
  const made = five00.scoreHand({ bidderId: 'p1', bid: { kind: 'open' }, tricks: { p1: 0, p2: 0 } }, sides);
  assert.deepEqual(made.deltas, { p1: 500, p2: 0 });
  const set = five00.scoreHand({ bidderId: 'p1', bid: { kind: 'open' }, tricks: { p1: 2, p2: 0 } }, sides);
  assert.deepEqual(set.deltas, { p1: -500, p2: 0 });
});

/* ---------- 500 resolve ---------- */
function handFor(input) {
  const r = five00.scoreHand(input, sides);
  return { id: 'h', bidderId: input.bidderId, bid: input.bid, bidValue: r.meta.bidValue, made: r.meta.made, tricks: r.meta.tricks, deltas: r.deltas };
}

test('500 resolve: in progress until a side reaches the target', () => {
  const state = { hands: [handFor({ bidderId: 'p1', bid: { kind: 'suit', suit: 'spades', level: 7 }, tricks: { p1: 7, p2: 3 } })] };
  const { status } = five00.resolve(sides, state);
  assert.equal(status.phase, 'inProgress');
});

test('500 resolve: a made bid reaching 500 wins', () => {
  const state = { hands: [handFor({ bidderId: 'p1', bid: { kind: 'open' }, tricks: { p1: 0, p2: 0 } })] };
  const { totals, status } = five00.resolve(sides, state);
  assert.equal(status.phase, 'complete');
  assert.deepEqual(status.leaders, ['p1']);
  assert.equal(totals.p1, 500);
});

test('500 resolve: dropping to -500 puts a side out and the other wins', () => {
  const state = { hands: [handFor({ bidderId: 'p1', bid: { kind: 'open' }, tricks: { p1: 3, p2: 0 } })] };
  const { status } = five00.resolve(sides, state);
  assert.equal(status.phase, 'out');
  assert.deepEqual(status.leaders, ['p2']);
});

test('500 resolve: hands after the deciding hand are ignored', () => {
  const win = handFor({ bidderId: 'p1', bid: { kind: 'open' }, tricks: { p1: 0, p2: 0 } }); // p1 -> +500, wins
  const extra = handFor({ bidderId: 'p2', bid: { kind: 'suit', suit: 'hearts', level: 6 }, tricks: { p2: 6, p1: 4 } });
  const { totals, status } = five00.resolve(sides, { hands: [win, extra] });
  assert.equal(status.phase, 'complete');
  assert.deepEqual(status.leaders, ['p1']);
  assert.equal(totals.p2, 0); // the extra hand never counted
});

test('500 resolve: a winning banner reports the actual total, not the 500 target', () => {
  const lead = handFor({ bidderId: 'p1', bid: { kind: 'suit', suit: 'spades', level: 7 }, tricks: { p1: 7, p2: 3 } }); // p1 +140
  const clinch = handFor({ bidderId: 'p1', bid: { kind: 'open' }, tricks: { p1: 0, p2: 0 } }); // p1 +500 -> 640, wins
  const { totals, status } = five00.resolve(sides, { hands: [lead, clinch] });
  assert.equal(status.phase, 'complete');
  assert.equal(totals.p1, 640);
  assert.match(status.text, /wins with 640/);
  assert.doesNotMatch(status.text, /500/);
});

test('500 resolve: an out banner reports the actual total, not the -500 threshold', () => {
  const drop = handFor({ bidderId: 'p1', bid: { kind: 'suit', suit: 'spades', level: 7 }, tricks: { p1: 6, p2: 4 } }); // p1 -140, p2 +40
  const bust = handFor({ bidderId: 'p1', bid: { kind: 'open' }, tricks: { p1: 3, p2: 0 } }); // p1 -500 -> -640, out
  const { totals, status } = five00.resolve(sides, { hands: [drop, bust] });
  assert.equal(status.phase, 'out');
  assert.equal(totals.p1, -640);
  assert.deepEqual(status.leaders, ['p2']);
  assert.match(status.text, /out at -640/);
});

/* ---------- Greed ---------- */
test('greedRunningTotals respects getting on the board', () => {
  assert.deepEqual(greedRunningTotals(0, [300, 600, 100]), [0, 600, 700]);
  assert.deepEqual(greedRunningTotals(0, [400]), [0]);
  assert.deepEqual(greedRunningTotals(0, [500]), [500]);
  assert.deepEqual(greedRunningTotals(100, [50, 200]), [150, 350]); // a positive seed is already on
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
test('Five Crowns round labels count the wilds up by default', () => {
  assert.equal(FIVE_CROWNS_ROUNDS, 11);
  assert.deepEqual(fiveCrowns.roundLabel(0), { num: '1', sub: '3s' });
  assert.deepEqual(fiveCrowns.roundLabel(10), { num: '11', sub: 'Kings' });
  assert.equal(FIVE_CROWNS_WILDS.length, 11);
});

test('Five Crowns wild order: up as printed, down reversed, random a full shuffle', () => {
  assert.deepEqual(fiveCrownsWildOrder('up'), FIVE_CROWNS_WILDS);
  assert.deepEqual(fiveCrownsWildOrder('down'), [...FIVE_CROWNS_WILDS].reverse());

  const up = fiveCrowns.initVariant('up');
  assert.equal(up.variant, 'up');
  assert.equal(up.wildOrder[0], '3s');

  const down = fiveCrowns.initVariant('down');
  assert.equal(down.wildOrder[0], 'Kings');
  assert.equal(down.wildOrder[10], '3s');
  assert.deepEqual(fiveCrowns.roundLabel(0, down).sub, 'Kings');

  const random = fiveCrowns.initVariant('random');
  assert.equal(random.variant, 'random');
  assert.equal(random.revealedCount, 0);
  assert.equal(random.wildOrder.length, 11);
  assert.deepEqual([...random.wildOrder].sort(), [...FIVE_CROWNS_WILDS].sort());

  // Up/Down are never masked, so they carry no revealedCount.
  assert.equal(up.revealedCount, undefined);
  assert.equal(down.revealedCount, undefined);

  // An unknown variant falls back to the default.
  assert.equal(fiveCrowns.initVariant('nope').variant, 'up');
});

test('Random wilds are gated by a spin: locked, then ready, then revealed', () => {
  const order = FIVE_CROWNS_WILDS;
  const st = { variant: 'random', wildOrder: order, revealedCount: 0, players: sides, scores: { p1: [], p2: [] } };

  // Round 0 starts ready (glowing, tappable), not yet revealed; round 1 is locked.
  assert.deepEqual(fiveCrowns.roundLabel(0, st), { num: '1', sub: '?', ready: true });
  assert.deepEqual(fiveCrowns.roundLabel(1, st), { num: '2', sub: '\u2014', masked: true });

  // Opening round 0 (spin done) reveals its wild; round 1 stays locked until
  // round 0 is fully entered.
  st.revealedCount = 1;
  assert.deepEqual(fiveCrowns.roundLabel(0, st), { num: '1', sub: order[0] });
  assert.deepEqual(fiveCrowns.roundLabel(1, st), { num: '2', sub: '\u2014', masked: true });

  st.scores.p1[0] = 5; // only one player scored round 0
  assert.deepEqual(fiveCrowns.roundLabel(1, st), { num: '2', sub: '\u2014', masked: true });

  st.scores.p2[0] = 3; // round 0 now complete -> round 1 becomes ready (not auto-revealed)
  assert.deepEqual(fiveCrowns.roundLabel(1, st), { num: '2', sub: '?', ready: true });
  assert.deepEqual(fiveCrowns.roundLabel(2, st), { num: '3', sub: '\u2014', masked: true });

  // Spinning round 1 open reveals it.
  st.revealedCount = 2;
  assert.deepEqual(fiveCrowns.roundLabel(1, st), { num: '2', sub: order[1] });
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

test('Five Crowns resolve: a seed is added to the total', () => {
  const seeded = [{ id: 'p1', name: 'Us', seed: 10 }];
  const { totals } = fiveCrowns.resolve(seeded, { scores: { p1: [5] } });
  assert.equal(totals.p1, 15);
});
