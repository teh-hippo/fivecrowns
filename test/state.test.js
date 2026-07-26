import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, normaliseState, serializeState } from '../state.js';
import { fiveCrowns, greed, five00, FIVE_CROWNS_WILDS, FIVE_CROWNS_CARD_COUNTS } from '../games.js';

test('defaultState is an empty, not-started game', () => {
  assert.deepEqual(defaultState(fiveCrowns), {
    gameId: 'fivecrowns',
    started: false,
    players: [],
    nextId: 1,
    scores: {},
    hands: [],
  });
});

test('normaliseState falls back to a default for missing or junk input', () => {
  for (const bad of [null, undefined, 'garbage', 42, []]) {
    const s = normaliseState(fiveCrowns, bad);
    assert.equal(s.started, false);
    assert.deepEqual(s.players, []);
  }
});

test('normaliseState pads fixed-round scores to the full round count', () => {
  const s = normaliseState(fiveCrowns, {
    started: true,
    players: [{ id: 'p1', name: 'Zac' }],
    scores: { p1: [5, 12] },
  });
  assert.equal(s.scores.p1.length, 11);
  assert.deepEqual(s.scores.p1.slice(0, 3), [5, 12, null]);
  assert.equal(s.started, true);
});

test('normaliseState drops duplicate, non-string and id-less players', () => {
  const s = normaliseState(fiveCrowns, {
    players: [
      { id: 'p1', name: 'A' },
      { id: 'p1', name: 'B' },
      { id: 5, name: 'C' },
      { name: 'D' },
    ],
  });
  assert.equal(s.players.length, 1);
  assert.equal(s.players[0].name, 'A');
});

test('normaliseState gives a missing name a sensible default', () => {
  const s = normaliseState(fiveCrowns, { players: [{ id: 'p1' }] });
  assert.equal(s.players[0].name, 'Player 1');
  const sides = normaliseState(five00, { players: [{ id: 'p1' }] });
  assert.equal(sides.players[0].name, 'Side 1');
});

test('normaliseState keeps valid hands and discards malformed ones', () => {
  const s = normaliseState(five00, {
    started: true,
    players: [
      { id: 'p1', name: 'Us' },
      { id: 'p2', name: 'Them' },
    ],
    hands: [
      {
        id: 'h1',
        bidderId: 'p1',
        bid: { kind: 'open' },
        made: true,
        tricks: {},
        deltas: { p1: 500, p2: 0 },
      },
      { nonsense: true },
      { bidderId: 'p2' }, // no deltas
    ],
  });
  assert.equal(s.hands.length, 1);
  assert.equal(s.hands[0].bidderId, 'p1');
});

test('serializeState trims trailing blanks for open cell games', () => {
  const out = serializeState(greed, {
    started: true,
    players: [{ id: 'p1', name: 'Zac' }],
    nextId: 2,
    scores: { p1: [600, null, null] },
    hands: [],
  });
  assert.deepEqual(out.scores.p1, [600]);
});

test('serializeState writes scores for cell games and hands for hand games', () => {
  const fc = serializeState(
    fiveCrowns,
    normaliseState(fiveCrowns, {
      started: true,
      players: [{ id: 'p1', name: 'Zac' }],
      scores: { p1: [5] },
    }),
  );
  assert.ok('scores' in fc);
  assert.ok(!('hands' in fc));

  const f5 = serializeState(five00, {
    started: true,
    players: [{ id: 'p1', name: 'Us' }],
    nextId: 2,
    hands: [
      {
        id: 'h1',
        bidderId: 'p1',
        bid: { kind: 'open' },
        made: true,
        tricks: {},
        deltas: { p1: 500 },
      },
    ],
  });
  assert.ok('hands' in f5);
  assert.ok(!('scores' in f5));
});

test('serialise then normalise round-trips a Five Crowns game', () => {
  const original = normaliseState(fiveCrowns, {
    started: true,
    players: [
      { id: 'p1', name: 'Zac' },
      { id: 'p2', name: 'Xavi' },
    ],
    scores: { p1: new Array(11).fill(1), p2: new Array(11).fill(2) },
    variant: 'random',
    wildOrder: [...FIVE_CROWNS_WILDS].reverse(),
    revealedCount: 4,
    fakeOutMisses: 3,
    dealerEnabled: true,
    dealerOrder: ['p2', 'p1'],
    dealerRounds: ['p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2'],
    dealerOrderStartsAt: 0,
  });
  const round = normaliseState(fiveCrowns, serializeState(fiveCrowns, original));
  assert.deepEqual(round.players, original.players);
  assert.deepEqual(round.scores, original.scores);
  assert.equal(round.variant, 'random');
  assert.deepEqual(round.wildOrder, [...FIVE_CROWNS_WILDS].reverse());
  assert.equal(round.revealedCount, 4);
  assert.equal(round.fakeOutMisses, 3);
  assert.equal(round.dealerEnabled, true);
  assert.deepEqual(round.dealerOrder, ['p2', 'p1']);
  assert.deepEqual(round.dealerRounds, original.dealerRounds);
  assert.equal(round.dealerOrderStartsAt, 0);
});

test('serialise then normalise round-trips Super Random card and wild orders', () => {
  const original = normaliseState(fiveCrowns, {
    started: true,
    players: [
      { id: 'p1', name: 'Zac' },
      { id: 'p2', name: 'Xavi' },
    ],
    scores: { p1: [1], p2: [2] },
    variant: 'super-random',
    wildOrder: [...FIVE_CROWNS_WILDS].reverse(),
    cardOrder: [...FIVE_CROWNS_CARD_COUNTS].reverse(),
    cardOrderBase: FIVE_CROWNS_CARD_COUNTS,
    revealedCount: 1,
  });
  const saved = serializeState(fiveCrowns, original);
  const round = normaliseState(fiveCrowns, saved);

  assert.equal(round.variant, 'super-random');
  assert.deepEqual(round.wildOrder, original.wildOrder);
  assert.deepEqual(round.cardOrder, original.cardOrder);
  assert.deepEqual(round.cardOrderBase, original.cardOrderBase);
  assert.equal(round.revealedCount, 1);
  assert.notStrictEqual(round.cardOrder, saved.cardOrder);
});

test('serialise then normalise round-trips a 500 game', () => {
  const original = normaliseState(five00, {
    started: true,
    players: [
      { id: 'p1', name: 'Us' },
      { id: 'p2', name: 'Them' },
    ],
    hands: [
      {
        id: 'h1',
        bidderId: 'p1',
        bid: { kind: 'suit', suit: 'spades', level: 7 },
        made: true,
        tricks: { p1: 7, p2: 3 },
        deltas: { p1: 140, p2: 30 },
      },
    ],
  });
  const round = normaliseState(five00, serializeState(five00, original));
  assert.deepEqual(round.players, original.players);
  assert.deepEqual(round.hands, original.hands);
});
