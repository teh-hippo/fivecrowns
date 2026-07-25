import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shuffle } from '../lib/random.js';

// A tiny deterministic generator, so the assertions describe a fixed permutation.
function sequence(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test('shuffle leaves the input untouched and keeps every element', () => {
  const input = [1, 2, 3, 4, 5];
  const result = shuffle(input, sequence([0.1, 0.9, 0.4, 0.7]));
  assert.deepEqual(input, [1, 2, 3, 4, 5], 'the caller keeps its array');
  assert.deepEqual(
    [...result].sort((a, b) => a - b),
    [1, 2, 3, 4, 5],
  );
});

test('shuffle is deterministic for a given random source', () => {
  const first = shuffle(['a', 'b', 'c', 'd'], sequence([0.1, 0.9, 0.4]));
  const second = shuffle(['a', 'b', 'c', 'd'], sequence([0.1, 0.9, 0.4]));
  assert.deepEqual(first, second);
});

test('shuffle copes with empty, single and non-array input', () => {
  assert.deepEqual(shuffle([]), []);
  assert.deepEqual(shuffle(['only']), ['only']);
  assert.deepEqual(shuffle(null), []);
  assert.deepEqual(shuffle(undefined), []);
});
