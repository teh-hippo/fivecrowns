import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { bootDom } from './helpers/dom.js';
import { DEFAULT_REEL_OPTIONS, REEL_FIELDS } from '../reel.js';

let harness = null;
afterEach(() => {
  if (harness) harness.cleanup();
  harness = null;
});

// Every landing effect, with the class its nodes carry so a renamed or
// unregistered emitter is caught rather than silently falling back to confetti.
const EFFECTS = [
  ['confetti', 'confetti-bit'],
  ['explosion', 'explosion-core'],
  ['lasers', 'laser-beam'],
  ['fireworks', 'firework-rocket'],
  ['sparkle', 'sparkle-star'],
  ['coins', 'coin-disc'],
  ['shockwave', 'shock-ring'],
  ['neon', 'neon-edge'],
  ['suits', 'suit-glyph'],
  ['streamers', 'streamer'],
  ['slotframe', 'slot-frame'],
  ['sunburst', 'sun-ray'],
  ['bubbles', 'bubble'],
];

async function spinTo(options = {}) {
  harness = bootDom({ animations: true });
  const { createReel } = await import('../reel.js');
  const { byId, window } = harness;
  const effects = byId('reel-effects');
  let landed;
  let fakedOut;
  const reel = createReel({
    overlay: byId('reel-overlay'),
    wheels: byId('reel-wheels'),
    title: byId('reel-title'),
    action: byId('reel-action'),
    effects,
    onBusyChange: () => {},
  });
  const shown = reel.show({
    reels: [
      { label: 'Cards', tone: 'cards', full: ['3', '4', '5'], remaining: ['3', '4'], target: '3' },
      { label: 'Wild', full: ['3s', '4s', '5s'], remaining: ['3s', '4s'], target: '3s' },
    ],
    resultText: '3 cards · 3s wild!',
    round: 0,
    fullSetSize: 3,
    options: { fakeOutChance: 0, ...options },
    onConfirm: () => {},
    onLand: (effect, fakeOut) => {
      landed = effect;
      fakedOut = fakeOut;
    },
  });
  byId('reel-action').click();
  window.finishAnimations();
  return { reel, effects, shown, landed: () => landed, fakedOut: () => fakedOut, harness };
}

test('the reel renders one wheel per supplied track', async () => {
  const { effects } = await spinTo({ effect: 'none' });
  const wheels = harness.byId('reel-wheels');
  assert.equal(wheels.dataset.count, '2');
  assert.equal(wheels.querySelectorAll('.reel-wheel').length, 2);
  assert.equal(wheels.querySelectorAll('.reel-wheel-cards').length, 1, 'the cards tone is applied');
  assert.equal(effects.childElementCount, 0, 'effect none emits nothing');
});

test('landing marks the winning item and shows the result', async () => {
  await spinTo({ effect: 'none' });
  assert.equal(harness.byId('reel-title').textContent, '3 cards · 3s wild!');
  assert.equal(harness.byId('reel-action').textContent, 'Confirm');
  assert.ok(harness.byId('reel-wheels').querySelector('.reel-target'), 'the target is flagged');
});

for (const [effect, className] of EFFECTS) {
  test(`the ${effect} effect emits its own nodes`, async () => {
    const { effects, landed } = await spinTo({ effect });
    assert.equal(landed(), effect, 'the chosen effect is reported to the caller');
    assert.equal(effects.dataset.effect, effect);
    assert.ok(effects.childElementCount > 0, 'nodes are emitted');
    assert.ok(
      effects.querySelector('.' + className),
      `expected a .${className} node from the ${effect} emitter`,
    );
  });
}

test('every registered effect is reachable from the debug picker', async () => {
  const field = REEL_FIELDS.find((item) => item.key === 'effect');
  const offered = field.options.map(([value]) => value);
  for (const [effect] of EFFECTS) {
    assert.ok(offered.includes(effect), `${effect} should be offered in the picker`);
  }
  assert.ok(offered.includes('random'));
  assert.ok(offered.includes('none'));
  assert.equal(offered.length, EFFECTS.length + 2, 'the picker lists exactly the known effects');
});

test('an unknown effect name falls back to a real one', async () => {
  const { landed } = await spinTo({ effect: 'not-a-real-effect' });
  assert.ok(
    EFFECTS.some(([name]) => name === landed()),
    'an unknown name resolves to a registered effect',
  );
});

test('effect amount is clamped to the tunable range', async () => {
  const field = REEL_FIELDS.find((item) => item.key === 'effectAmount');
  const { effects } = await spinTo({ effect: 'confetti', effectAmount: 10000 });
  assert.ok(effects.childElementCount <= 140, 'a hard node limit protects slower phones');
  assert.ok(field.max < 10000, 'and the slider cannot ask for that many anyway');
});

test('confirming clears every effect node', async () => {
  const { effects } = await spinTo({ effect: 'confetti' });
  assert.ok(effects.childElementCount > 0);

  harness.byId('reel-action').click();
  assert.equal(effects.childElementCount, 0, 'nothing is left animating');
  assert.equal(effects.dataset.effect, undefined);
  assert.equal(harness.byId('reel-overlay').hidden, true);
});

test('reduced motion suppresses effects entirely', async () => {
  harness = bootDom({ animations: true, reducedMotion: true });
  const { createReel } = await import('../reel.js');
  const reel = createReel({
    overlay: harness.byId('reel-overlay'),
    wheels: harness.byId('reel-wheels'),
    title: harness.byId('reel-title'),
    action: harness.byId('reel-action'),
    effects: harness.byId('reel-effects'),
    onBusyChange: () => {},
  });
  assert.equal(reel.canAnimate(), false);
});

test('a fake-out lands on a different value before the real one', async () => {
  const { fakedOut } = await spinTo({ effect: 'none', fakeOutChance: 1, fakeOutHoldMs: 0 });
  assert.equal(typeof fakedOut(), 'boolean');
});

test('the reel refuses malformed track specifications', async () => {
  harness = bootDom({ animations: true });
  const { createReel } = await import('../reel.js');
  const reel = createReel({
    overlay: harness.byId('reel-overlay'),
    wheels: harness.byId('reel-wheels'),
    title: harness.byId('reel-title'),
    action: harness.byId('reel-action'),
    effects: harness.byId('reel-effects'),
    onBusyChange: () => {},
  });
  const attempt = (reels) =>
    reel.show({
      reels,
      resultText: 'x',
      round: 0,
      fullSetSize: 2,
      options: {},
      onConfirm: () => {},
    });

  assert.equal(attempt([]), false, 'no tracks');
  assert.equal(attempt(null), false, 'no array');
  assert.equal(
    attempt([{ label: 'Wild', full: ['a'], remaining: ['a'], target: 'missing' }]),
    false,
    'a target outside the full set',
  );
  assert.equal(
    attempt([{ label: 'Wild', full: ['a', 'b'], remaining: [], target: 'a' }]),
    false,
    'a target that is no longer remaining',
  );
  assert.equal(harness.byId('reel-overlay').hidden, true, 'the overlay never opened');
});

test('the default options sit inside their own tuning bounds', () => {
  for (const field of REEL_FIELDS) {
    if (field.options) continue;
    const value = DEFAULT_REEL_OPTIONS[field.key];
    assert.equal(typeof value, 'number', `${field.key} has a numeric default`);
    assert.ok(
      value >= field.min && value <= field.max,
      `${field.key} default ${value} is outside ${field.min}..${field.max}`,
    );
  }
});
