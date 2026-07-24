import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fiveCrowns, FIVE_CROWNS_WILDS } from '../games.js';
import { nextRecalledName, saveGame } from '../lib/storage.js';

function storageWith(values) {
  const data = new Map(Object.entries(values));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
  };
}

afterEach(() => { delete globalThis.localStorage; });

test('saving a game remembers players by most recent roster', () => {
  globalThis.localStorage = storageWith({
    'scorer:names': JSON.stringify({
      fivecrowns: {
        last: ['Casey', 'Blair'],
        memory: ['Alex', 'Blair', 'Casey', 'Drew'],
      },
    }),
  });
  assert.equal(nextRecalledName(fiveCrowns, ['Blair']), 'Casey');

  saveGame(fiveCrowns, {
    started: true,
    players: [{ id: 'p1', name: 'Blair', seed: 0 }],
    nextId: 2,
    scores: { p1: new Array(11).fill(null) },
    variant: 'up',
    wildOrder: FIVE_CROWNS_WILDS,
  });

  const rosters = JSON.parse(globalThis.localStorage.getItem('scorer:names'));
  assert.deepEqual(rosters.fivecrowns.memory, ['Blair', 'Casey', 'Alex', 'Drew']);
  assert.equal(nextRecalledName(fiveCrowns, ['Blair']), 'Casey');
});
