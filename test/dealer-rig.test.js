import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEALER_RIG_RULES,
  defaultDealerRigSettings,
  dealerPreferenceResolver,
  normaliseDealerRigSettings,
} from '../lib/dealer-rig.js';
import { fiveCrownsRigCardOrder } from '../games.js';

test('every rig rule declares a dealer, a direction and a label', () => {
  assert.ok(DEALER_RIG_RULES.length > 0);
  for (const rule of DEALER_RIG_RULES) {
    assert.equal(typeof rule.key, 'string');
    assert.equal(typeof rule.id, 'string');
    assert.equal(typeof rule.dealer, 'string');
    assert.ok(['low', 'high'].includes(rule.prefer));
    assert.equal(typeof rule.label, 'string');
  }
  const keys = DEALER_RIG_RULES.map((rule) => rule.key);
  assert.equal(new Set(keys).size, keys.length, 'rule keys are unique');
});

test('settings default on and coerce junk to booleans', () => {
  const defaults = defaultDealerRigSettings();
  assert.deepEqual(
    Object.values(defaults),
    DEALER_RIG_RULES.map((rule) => rule.default),
  );
  assert.deepEqual(
    Object.values(defaults),
    DEALER_RIG_RULES.map(() => true),
    'both rigs are on out of the box',
  );
  assert.deepEqual(normaliseDealerRigSettings(null), defaults);
  assert.deepEqual(normaliseDealerRigSettings({ dadLowCards: '' }), {
    ...defaults,
    dadLowCards: false,
  });
  // An absent key is a setting never made, so the rule's own default stands.
  assert.deepEqual(normaliseDealerRigSettings({ unknown: true }), defaults);
});

test('the resolver matches dealer names case and space insensitively', () => {
  const prefer = dealerPreferenceResolver({ dadLowCards: true, mumHighCards: true });
  assert.equal(prefer('Dad'), 'low');
  assert.equal(prefer('  dad  '), 'low');
  assert.equal(prefer('MUM'), 'high');
  assert.equal(prefer('Sam'), null);
  assert.equal(prefer(''), null);
  assert.equal(prefer(null), null);
});

test('a disabled rule stops resolving', () => {
  const prefer = dealerPreferenceResolver({ dadLowCards: false, mumHighCards: true });
  assert.equal(prefer('Dad'), null);
  assert.equal(prefer('Mum'), 'high');
  assert.equal(dealerPreferenceResolver({ dadLowCards: false, mumHighCards: false })('Mum'), null);
});

test('every rule declares the default it falls back on', () => {
  for (const rule of DEALER_RIG_RULES) assert.equal(typeof rule.default, 'boolean');
});

test('the rules layer honours any resolver, not just the configured names', () => {
  const base = [3, 4, 5, 6];
  // A resolver naming nobody from DEALER_RIG_RULES proves the rules are generic.
  const prefer = (name) => (name === 'Robot' ? 'high' : null);
  assert.deepEqual(
    fiveCrownsRigCardOrder(base, ['Robot', 'Sam', 'Sam', 'Sam'], prefer),
    [6, 3, 4, 5],
  );
});

test('rig ordering falls back to the base order without a resolver', () => {
  const base = [3, 4, 5, 6];
  const nobody = dealerPreferenceResolver({ dadLowCards: false, mumHighCards: false });
  assert.deepEqual(fiveCrownsRigCardOrder(base, ['Dad', 'Mum'], undefined), base);
  assert.deepEqual(fiveCrownsRigCardOrder(base, [], nobody), base);
  assert.deepEqual(fiveCrownsRigCardOrder(null, ['Dad'], nobody), []);
});
