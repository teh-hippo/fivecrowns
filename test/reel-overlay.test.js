import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { bootDom, press } from './helpers/dom.js';

let harness = null;
afterEach(() => {
  if (harness) harness.cleanup();
  harness = null;
});

async function openReel({ animations = false, reducedMotion = false } = {}) {
  harness = bootDom({ animations, reducedMotion });
  const { window, byId } = harness;
  const { createReel } = await import('../reel.js');
  const overlay = byId('reel-overlay');
  const state = { confirmed: 0, closed: 0 };
  const reel = createReel({
    overlay,
    wheels: byId('reel-wheels'),
    title: byId('reel-title'),
    action: byId('reel-action'),
    effects: byId('reel-effects'),
    onBusyChange: () => {},
  });
  const show = () =>
    reel.show({
      reels: [{ label: 'Wild', full: ['3s', '4s'], remaining: ['3s', '4s'], target: '3s' }],
      resultText: '3s is wild!',
      round: 0,
      fullSetSize: 2,
      options: {},
      onConfirm: () => state.confirmed++,
      onClose: () => state.closed++,
    });
  return { window, byId, overlay, reel, show, state, main: window.document.querySelector('main') };
}

test('the reveal overlay is marked up as a modal dialog', async () => {
  const { overlay } = await openReel();
  assert.equal(overlay.getAttribute('role'), 'dialog');
  assert.equal(overlay.getAttribute('aria-modal'), 'true');
  assert.equal(overlay.getAttribute('aria-labelledby'), 'reel-title');
});

test('opening moves focus in and hides the background from assistive tech', async () => {
  const { byId, show, main } = await openReel();
  const opener = byId('menu-btn');
  opener.focus();
  assert.equal(main.getAttribute('aria-hidden'), null);

  assert.equal(show(), true);
  assert.equal(byId('reel-action'), harness.document.activeElement, 'focus lands on the action');
  assert.equal(main.getAttribute('aria-hidden'), 'true');
  assert.equal(main.inert, true);
});

test('closing restores the background and returns focus to the opener', async () => {
  const { window, byId, overlay, show, main, state } = await openReel();
  const opener = byId('menu-btn');
  opener.focus();
  show();

  // Without the Web Animations API the reel lands immediately, so one press confirms.
  press(window, overlay, 'Escape');

  assert.equal(overlay.hidden, true);
  assert.equal(state.confirmed, 1, 'closing commits the reveal');
  assert.equal(main.getAttribute('aria-hidden'), null);
  assert.equal(main.inert, false);
  assert.equal(harness.document.activeElement, opener, 'focus goes back where it came from');
});

test('Tab is trapped inside the overlay', async () => {
  const { window, byId, overlay, show } = await openReel();
  show();
  const action = byId('reel-action');

  byId('menu-btn').focus();
  press(window, overlay, 'Tab');
  assert.equal(harness.document.activeElement, action, 'Tab pulls stray focus back in');

  press(window, overlay, 'Tab');
  assert.equal(harness.document.activeElement, action, 'forward Tab wraps');

  press(window, overlay, 'Tab', { shiftKey: true });
  assert.equal(harness.document.activeElement, action, 'Shift+Tab wraps');
});

test('Escape advances the reveal rather than abandoning it', async () => {
  const { window, overlay, show, state } = await openReel({ animations: true });
  show();
  assert.equal(overlay.hidden, false);

  press(window, overlay, 'Escape'); // idle -> spin
  assert.equal(overlay.hidden, false, 'the first Escape starts the spin');
  assert.equal(state.confirmed, 0, 'nothing is committed yet');

  press(window, overlay, 'Escape'); // spin -> land
  assert.equal(overlay.hidden, false, 'the second Escape skips to the result');
  assert.equal(state.confirmed, 0);

  press(window, overlay, 'Escape'); // land -> confirm
  assert.equal(overlay.hidden, true);
  assert.equal(state.confirmed, 1, 'only the final Escape commits');
});

test('other keys are left alone', async () => {
  const { window, overlay, show, state } = await openReel({ animations: true });
  show();
  press(window, overlay, 'a');
  press(window, overlay, 'ArrowDown');
  assert.equal(overlay.hidden, false);
  assert.equal(state.confirmed, 0);
});

test('reduced motion keeps the reel from animating at all', async () => {
  const { reel } = await openReel({ animations: true, reducedMotion: true });
  assert.equal(reel.canAnimate(), false);
});
