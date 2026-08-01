import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { bootDom, press } from './helpers/dom.js';

let harness = null;
afterEach(() => {
  if (harness) harness.cleanup();
  harness = null;
});

async function openReel({ animations = false, reducedMotion = false, picker = null } = {}) {
  harness = bootDom({ animations, reducedMotion });
  const { window, byId } = harness;
  const { createReel } = await import('../reel.js');
  const overlay = byId('reel-overlay');
  const state = { confirmed: 0, closed: 0, picked: [] };
  const reel = createReel({
    overlay,
    wheels: byId('reel-wheels'),
    title: byId('reel-title'),
    action: byId('reel-action'),
    effects: byId('reel-effects'),
    picker: byId('reel-picker'),
    onBusyChange: () => {},
  });
  const show = () =>
    reel.show({
      reels: [{ label: 'Wild', full: ['3s', '4s'], remaining: ['3s', '4s'], target: '3s' }],
      resultText: '3s is wild!',
      round: 0,
      fullSetSize: 2,
      options: picker
        ? {
            picker: {
              label: 'Dealer',
              value: 'p1',
              options: [
                { value: 'p1', text: 'Ann' },
                { value: 'p2', text: 'Bob' },
                { value: 'p3', text: 'Cal' },
              ],
              onChange: (id) => state.picked.push(id),
            },
          }
        : {},
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
  const { window, byId, overlay, show, state } = await openReel({ animations: true });
  show();
  assert.equal(overlay.hidden, false);

  press(window, overlay, 'Escape'); // idle -> spin
  assert.equal(overlay.hidden, false, 'the first Escape starts the spin');
  assert.equal(state.confirmed, 0, 'nothing is committed yet');

  window.finishAnimations(); // spin -> land
  assert.equal(byId('reel-action').textContent, 'Confirm');
  assert.equal(state.confirmed, 0);

  press(window, overlay, 'Escape'); // land -> confirm
  assert.equal(overlay.hidden, true);
  assert.equal(state.confirmed, 1, 'only the final Escape commits');
});

test('a spin in flight cannot be cut short', async () => {
  const { window, byId, overlay, show, state } = await openReel({ animations: true });
  show();
  press(window, overlay, 'Escape'); // idle -> spin
  assert.equal(byId('reel-action').hidden, true, 'there is nothing to press mid-spin');

  overlay.click();
  press(window, overlay, 'Escape');
  assert.notEqual(byId('reel-title').textContent, '3s is wild!', 'the reel is still spinning');
  assert.equal(state.confirmed, 0);

  window.finishAnimations();
  assert.equal(byId('reel-action').hidden, false, 'the button comes back with the result');
  assert.equal(byId('reel-title').textContent, '3s is wild!');
});

test('the dialog keeps hold of focus while the spin runs', async () => {
  const { window, byId, overlay, show } = await openReel({ animations: true });
  show();
  press(window, overlay, 'Escape'); // idle -> spin

  assert.equal(harness.document.activeElement, overlay, 'the dialog holds focus for the spin');
  assert.equal(press(window, overlay, 'Tab'), false, 'so Tab is still trapped');

  window.finishAnimations();
  assert.equal(harness.document.activeElement, byId('reel-action'), 'the button takes it back');
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

/* ---------- the dealer picker ---------- */

const pickerSelect = () => harness.byId('reel-picker').querySelector('select');

test('Escape closes the dealer dropdown instead of starting the spin', async () => {
  const { window, byId, show, state } = await openReel({ animations: true, picker: true });
  show();
  const select = pickerSelect();
  select.focus();

  press(window, select, 'Escape');

  assert.equal(byId('reel-action').textContent, 'Spin', 'the reel stays idle');
  assert.equal(byId('reel-picker').hidden, false, 'and the dealer can still be changed');
  assert.deepEqual(state.picked, []);
});

test('arrow keys browse the dealer list without reseating on every press', async () => {
  const { window, byId, show, state } = await openReel({ animations: true, picker: true });
  show();
  const select = pickerSelect();
  select.focus();

  const arrowTo = (value) => {
    press(window, select, 'ArrowDown');
    select.value = value;
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  arrowTo('p2');
  arrowTo('p3');
  assert.deepEqual(state.picked, [], 'passing over a name does not move anyone');

  press(window, select, 'Enter');
  assert.deepEqual(state.picked, ['p3'], 'only the committed choice reseats the table');
  assert.equal(byId('reel-action').textContent, 'Spin', 'and it does not start the spin');
});

test('tapping a dealer from the list applies it straight away', async () => {
  const { window, show, state } = await openReel({ animations: true, picker: true });
  show();
  const select = pickerSelect();

  select.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  select.value = 'p2';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));

  assert.deepEqual(state.picked, ['p2'], 'a touch picker commits as it closes');
});

test('leaving the dealer dropdown commits whatever it was left on', async () => {
  const { window, show, state } = await openReel({ animations: true, picker: true });
  show();
  const select = pickerSelect();
  select.focus();

  press(window, select, 'ArrowDown');
  select.value = 'p2';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.deepEqual(state.picked, []);

  select.dispatchEvent(new window.Event('blur', { bubbles: true }));
  assert.deepEqual(state.picked, ['p2']);
});

test('the dealer list opens on whoever is already dealing', async () => {
  const { byId, show } = await openReel({ animations: true, picker: true });
  show();
  const select = pickerSelect();

  assert.equal(select.value, 'p1', 'the rotation is chosen for you');
  assert.equal(select.options.length, 3, 'and nothing stands in for an answer');
  assert.equal(harness.document.activeElement, byId('reel-action'), 'focus lands on the spin');
  assert.equal(byId('reel-action').disabled, false, 'which is ready straight away');
});

/* ---------- the end-of-game podium ---------- */

// The countdown steps on a timer, so the tests move the clock by hand.
async function openPodium({ animations = true, reducedMotion = false } = {}) {
  harness = bootDom({ animations, reducedMotion });
  const { window, byId } = harness;
  const { createReel } = await import('../reel.js');
  const overlay = byId('reel-overlay');
  const state = { closed: 0 };
  const reel = createReel({
    overlay,
    wheels: byId('reel-wheels'),
    title: byId('reel-title'),
    action: byId('reel-action'),
    effects: byId('reel-effects'),
    picker: byId('reel-picker'),
    podium: byId('reel-podium'),
    replay: byId('reel-replay'),
    onBusyChange: () => {},
  });
  const shown = () =>
    [...byId('reel-podium').querySelectorAll('.podium-row')]
      .filter((row) => !row.hidden)
      .map((row) => row.getAttribute('data-place'));
  const celebrate = () =>
    reel.celebrate({
      title: 'How it finished',
      places: [
        { place: 3, label: '3rd', name: 'Sam', score: 90 },
        { place: 2, label: '2nd', name: 'Mum', score: 30 },
        { place: 1, label: '1st', name: 'Dad', score: 14 },
      ],
      resultText: '\u{1F3C6} Dad wins with 14!',
      effect: 'fireworks',
      onClose: () => state.closed++,
    });
  return { window, byId, overlay, reel, celebrate, shown, state };
}

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const STEP = 1000; // just past the reel's own step, so each place has landed

test('the podium counts down third, second, then the winner', async () => {
  const { byId, celebrate, shown } = await openPodium();

  assert.equal(celebrate(), true);
  assert.deepEqual(shown(), ['3'], 'the lowest place goes first');
  assert.equal(byId('reel-title').textContent, '3rd \u00b7 Sam \u00b7 90');
  assert.equal(byId('reel-action').hidden, true, 'there is nothing to press mid-countdown');

  await tick(STEP);
  assert.deepEqual(shown(), ['3', '2']);
  assert.equal(byId('reel-title').textContent, '2nd \u00b7 Mum \u00b7 30');

  await tick(STEP);
  assert.deepEqual(shown(), ['3', '2', '1'], 'the winner lands last');
  assert.equal(byId('reel-title').textContent, '\u{1F3C6} Dad wins with 14!');
  assert.equal(byId('reel-action').textContent, 'Done');
  assert.equal(byId('reel-effects').dataset.effect, 'fireworks');
});

test('the winner is marked out from the rest of the podium', async () => {
  const { byId, celebrate } = await openPodium();
  celebrate();
  const rows = [...byId('reel-podium').querySelectorAll('.podium-row')];
  assert.deepEqual(
    rows.map((row) => row.classList.contains('podium-first')),
    [false, false, true],
  );
  assert.deepEqual(
    [...rows[2].children].map((cell) => cell.textContent),
    ['1st', 'Dad', '14'],
  );
});

test('the countdown cannot be cut short but a result can be dismissed', async () => {
  const { window, overlay, byId, celebrate, shown, state } = await openPodium();
  celebrate();

  overlay.click();
  press(window, overlay, 'Escape');
  assert.equal(overlay.hidden, false, 'the countdown runs its course');
  assert.deepEqual(shown(), ['3']);

  await tick(STEP * 2);
  press(window, overlay, 'Escape');
  assert.equal(overlay.hidden, true);
  assert.equal(state.closed, 1);
  assert.equal(byId('reel-replay').hidden, true, 'the shared buttons are handed back');
  assert.equal(byId('reel-action').hidden, false);
});

test('replaying runs the countdown again without closing', async () => {
  const { byId, celebrate, shown, state } = await openPodium();
  celebrate();
  await tick(STEP * 2);
  assert.equal(byId('reel-replay').hidden, false);

  byId('reel-replay').click();
  assert.deepEqual(shown(), ['3'], 'it starts over from the lowest place');
  assert.equal(byId('reel-replay').hidden, true, 'and steps aside while it runs');
  assert.equal(byId('reel-effects').dataset.effect, undefined, 'the effects stop with it');
  assert.equal(state.closed, 0, 'nothing has been dismissed');

  await tick(STEP * 2);
  assert.deepEqual(shown(), ['3', '2', '1']);
  assert.equal(state.closed, 0);
});

test('the podium holds focus and hands it to the result', async () => {
  const { byId, overlay, celebrate } = await openPodium();
  byId('menu-btn').focus();
  celebrate();
  assert.equal(harness.document.activeElement, overlay, 'the dialog holds focus mid-countdown');
  assert.equal(harness.document.querySelector('main').inert, true);

  await tick(STEP * 2);
  assert.equal(harness.document.activeElement, byId('reel-action'));

  byId('reel-action').click();
  assert.equal(harness.document.activeElement, byId('menu-btn'), 'focus goes back to the opener');
  assert.equal(harness.document.querySelector('main').inert, false);
});

test('an engine that cannot animate still shows the standings', async () => {
  const { byId, celebrate, shown } = await openPodium({ animations: false });
  assert.equal(celebrate(), true);
  assert.deepEqual(shown(), ['3', '2', '1'], 'every place arrives at once');
  assert.equal(byId('reel-title').textContent, '\u{1F3C6} Dad wins with 14!');
  assert.equal(byId('reel-action').textContent, 'Done');
});

test('reduced motion shows the standings without the countdown', async () => {
  const { celebrate, shown } = await openPodium({ reducedMotion: true });
  celebrate();
  assert.deepEqual(shown(), ['3', '2', '1']);
});

test('a podium with nothing to show is refused', async () => {
  const { reel } = await openPodium();
  assert.equal(reel.celebrate({ places: [] }), false);
  assert.equal(reel.celebrate({ places: null }), false);
  assert.equal(harness.byId('reel-overlay').hidden, true);
});

test('the podium and the reel never share the overlay', async () => {
  const { byId, reel, celebrate } = await openPodium();
  celebrate();
  await tick(STEP * 2);
  byId('reel-action').click();

  reel.show({
    reels: [{ label: 'Wild', full: ['3s', '4s'], remaining: ['3s', '4s'], target: '3s' }],
    resultText: '3s is wild!',
    round: 0,
    fullSetSize: 2,
    options: {},
    onConfirm: () => {},
  });
  assert.equal(byId('reel-podium').hidden, true, 'the reel clears the podium behind it');
  assert.equal(byId('reel-podium').childElementCount, 0);
  assert.equal(byId('reel-action').textContent, 'Spin');
});
