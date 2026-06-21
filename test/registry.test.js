import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAMES, GAME_ORDER } from '../games.js';

test('GAME_ORDER and GAMES describe exactly the same set of games', () => {
  assert.deepEqual([...GAME_ORDER].sort(), Object.keys(GAMES).sort());
});

test('every game id matches its registry key', () => {
  for (const [key, game] of Object.entries(GAMES)) {
    assert.equal(game.id, key, `game registered under "${key}" should have id "${key}"`);
  }
});

test('storage keys are unique across games', () => {
  const keys = Object.values(GAMES).map((g) => g.storageKey);
  assert.equal(new Set(keys).size, keys.length);
});

test('every game implements the engine contract', () => {
  for (const game of Object.values(GAMES)) {
    for (const field of ['id', 'name', 'storageKey', 'unitLabel', 'winDirection', 'rounds', 'entry']) {
      assert.ok(game[field] != null, `${game.id} is missing ${field}`);
    }
    assert.ok(['low', 'high'].includes(game.winDirection));
    assert.ok(['cell', 'hand'].includes(game.entry));
    assert.ok(game.maxPlayers >= game.minPlayers);
    assert.equal(typeof game.defaultNames, 'function');
    assert.equal(typeof game.roundLabel, 'function');
    assert.equal(typeof game.resolve, 'function');

    const label = game.roundLabel(0);
    assert.equal(typeof label.num, 'string');
    assert.ok(Array.isArray(game.defaultNames()));
  }
});
