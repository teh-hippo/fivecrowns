import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeOutChanceForMisses, nextFakeOutMisses } from '../reel.js';

test('fake-out chance rises five percentage points after each miss', () => {
  assert.equal(fakeOutChanceForMisses(0), 0.25);
  assert.equal(fakeOutChanceForMisses(1), 0.30);
  assert.equal(fakeOutChanceForMisses(3), 0.40);
  assert.equal(fakeOutChanceForMisses(20), 1);
});

test('fake-out miss streak resets after a respin', () => {
  assert.equal(nextFakeOutMisses(0, false), 1);
  assert.equal(nextFakeOutMisses(3, false), 4);
  assert.equal(nextFakeOutMisses(3, true), 0);
});
