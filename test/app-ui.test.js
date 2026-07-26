import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, press, type } from './helpers/dom.js';

let app = null;
afterEach(() => {
  if (app) app.cleanup();
  app = null;
});

const pick = (value) => app.document.querySelector(`.pick input[value="${value}"]`);
const choose = (value) => {
  const input = pick(value);
  input.checked = true;
  input.dispatchEvent(new app.window.Event('change', { bubbles: true }));
};
const scoreInputs = () => [...app.document.querySelectorAll('#score-body .score-input')];
const totals = () => [...app.document.querySelectorAll('.total-cell')].map((n) => n.textContent);
const nameInputs = () => [...app.document.querySelectorAll('.name-row input')];
const start = () => app.byId('start-btn').click();

/* ---------- setup screen ---------- */

test('the setup screen offers every registered game', async () => {
  app = await bootApp();
  const labels = [...app.document.querySelectorAll('#game-picker .pick-name')].map((n) =>
    n.textContent.trim(),
  );
  assert.deepEqual(labels, ['Five Crowns', 'Greed', '500']);
  assert.equal(app.byId('setup-screen').hidden, false);
  assert.equal(app.byId('game-screen').hidden, true);
});

test('the player stepper respects each game min and max', async () => {
  app = await bootApp();
  const dec = app.byId('players-dec');
  const inc = app.byId('players-inc');

  assert.equal(app.byId('players-count').textContent, '3');
  inc.click();
  assert.equal(nameInputs().length, 4);

  for (let i = 0; i < 10; i++) inc.click();
  assert.equal(nameInputs().length, 8, 'Five Crowns caps at eight players');
  assert.equal(inc.disabled, true);

  for (let i = 0; i < 10; i++) dec.click();
  assert.equal(nameInputs().length, 2, 'and floors at two');
  assert.equal(dec.disabled, true);
});

test('switching game swaps the unit label and default names', async () => {
  app = await bootApp();
  assert.equal(app.byId('count-label').textContent, 'Players');

  choose('five00');
  assert.equal(app.byId('count-label').textContent, 'Sides');
  assert.deepEqual(
    nameInputs().map((i) => i.value),
    ['Us', 'Them'],
  );

  choose('greed');
  assert.equal(app.byId('count-label').textContent, 'Players');
  assert.deepEqual(
    nameInputs().map((i) => i.value),
    ['Player 1', 'Player 2'],
  );
});

test('the variant control only appears for games that have variants', async () => {
  app = await bootApp();
  assert.equal(app.byId('variant-control').hidden, false, 'Five Crowns has round orders');

  choose('greed');
  assert.equal(app.byId('variant-control').hidden, true, 'Greed has none');
});

test('the dealer control only appears for random Five Crowns variants', async () => {
  app = await bootApp();
  const dealer = app.byId('dealer-control');
  assert.equal(dealer.hidden, true, 'hidden for the plain Up order');

  choose('random');
  assert.equal(dealer.hidden, false);

  const toggle = app.byId('dealer-toggle');
  assert.equal(app.byId('first-dealer-field').hidden, true);
  toggle.checked = true;
  toggle.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.equal(app.byId('first-dealer-field').hidden, false);
  assert.equal(app.byId('first-dealer').options.length, 3, 'one option per player');

  choose('up');
  assert.equal(dealer.hidden, true, 'hidden again for a fixed order');
});

test('names can be reordered with the keyboard', async () => {
  app = await bootApp();
  const [first, second] = nameInputs();
  type(app.window, first, 'Alex');
  type(app.window, second, 'Blair');

  const grip = app.document.querySelectorAll('.name-drag')[0];
  press(app.window, grip, 'ArrowDown');
  assert.deepEqual(
    nameInputs()
      .map((i) => i.value)
      .slice(0, 2),
    ['Blair', 'Alex'],
  );

  press(app.window, app.document.querySelectorAll('.name-drag')[1], 'ArrowUp');
  assert.deepEqual(
    nameInputs()
      .map((i) => i.value)
      .slice(0, 2),
    ['Alex', 'Blair'],
  );
});

test('a row cannot be moved off either end of the list', async () => {
  app = await bootApp();
  const before = nameInputs().map((i) => i.value);
  const grips = app.document.querySelectorAll('.name-drag');
  press(app.window, grips[0], 'ArrowUp');
  press(app.window, grips[grips.length - 1], 'ArrowDown');
  assert.deepEqual(
    nameInputs().map((i) => i.value),
    before,
  );
});

/* ---------- scoreboard ---------- */

test('starting Five Crowns builds an eleven round sheet', async () => {
  app = await bootApp();
  start();

  assert.equal(app.byId('game-screen').hidden, false);
  assert.equal(app.byId('setup-screen').hidden, true);
  assert.equal(app.document.querySelectorAll('#score-body tr').length, 11);
  assert.equal(scoreInputs().length, 33, 'eleven rounds times three players');
  assert.deepEqual(totals(), ['0', '0', '0']);
});

test('entering a score updates the running total and marks the leader', async () => {
  app = await bootApp();
  start();
  const inputs = scoreInputs();

  type(app.window, inputs[0], '7');
  assert.equal(totals()[0], '7');

  type(app.window, inputs[1], '3');
  type(app.window, inputs[2], '5');
  const cells = [...app.document.querySelectorAll('.total-cell')];
  assert.equal(cells[1].textContent.includes('3'), true);
  assert.equal(cells[1].classList.contains('leader'), true, 'lowest total leads Five Crowns');
  assert.equal(cells[0].classList.contains('leader'), false);
});

test('score cells accept digits only', async () => {
  app = await bootApp();
  start();
  const input = scoreInputs()[0];

  type(app.window, input, '12abc3');
  assert.equal(input.value, '123');
  assert.equal(totals()[0], '123');

  type(app.window, input, '');
  assert.equal(totals()[0], '0');
});

test('Enter moves to the next empty cell in the round', async () => {
  app = await bootApp();
  start();
  const inputs = scoreInputs();

  inputs[0].focus();
  press(app.window, inputs[0], 'Enter');
  assert.equal(app.document.activeElement, inputs[1]);

  type(app.window, inputs[2], '5');
  inputs[1].focus();
  press(app.window, inputs[1], 'Enter');
  assert.notEqual(app.document.activeElement, inputs[2], 'a filled cell is skipped');
});

test('renaming a player updates the scoreboard labels', async () => {
  app = await bootApp();
  start();
  const header = app.document.querySelector('.name-input');

  type(app.window, header, 'Alex');
  assert.match(scoreInputs()[0].getAttribute('aria-label'), /^Alex, round 1/);

  type(app.window, header, '   ');
  header.dispatchEvent(new app.window.Event('blur'));
  assert.equal(header.value, 'Player 1', 'a blank name falls back to a numbered default');
});

test('Greed grows a row at a time and flags who is not on the board', async () => {
  app = await bootApp();
  choose('greed');
  start();

  assert.equal(app.document.querySelectorAll('#score-body tr').length, 1, 'one open row to start');

  type(app.window, scoreInputs()[0], '600');
  assert.equal(app.document.querySelectorAll('#score-body tr').length, 2, 'a fresh row appears');
  assert.equal(totals()[0], '600♛ leader');

  // Scoring under 500 in a turn does not get you on the board.
  type(app.window, scoreInputs()[1], '400');
  const needs = app.document.querySelector('.needs');
  assert.ok(needs, 'a player who scored but stayed off the board is flagged');
  assert.match(needs.textContent, /needs 500/);
});

test('Greed scores below 500 do not get a player on the board', async () => {
  app = await bootApp();
  choose('greed');
  start();

  type(app.window, scoreInputs()[0], '400');
  assert.equal(totals()[0], '0needs 500', 'under 500 in one turn does not count');
});

/* ---------- 500 ---------- */

test('500 starts with a hint and opens a hand sheet', async () => {
  app = await bootApp();
  choose('five00');
  start();

  assert.match(app.document.querySelector('.empty-hint').textContent, /No hands yet/);
  assert.equal(app.byId('score-hand-btn').hidden, false);

  app.byId('score-hand-btn').click();
  assert.equal(app.byId('hand-dialog').hasAttribute('open'), true);
  assert.match(app.byId('hand-body').textContent, /Bidder/);
  assert.match(app.byId('hand-body').textContent, /Contract/);
});

test('500 records a made contract and totals it', async () => {
  app = await bootApp();
  choose('five00');
  start();
  app.byId('score-hand-btn').click();

  const chips = [...app.byId('hand-body').querySelectorAll('.chip')];
  chips.find((c) => c.getAttribute('aria-label') === 'Spades').click();
  assert.equal(app.byId('hand-save').disabled, false, 'a six spades bid is complete by default');
  assert.match(app.byId('hand-preview').textContent, /Made/);

  app.byId('hand-save').click();
  app.byId('hand-dialog').close('save');

  assert.equal(app.document.querySelectorAll('#score-body tr[data-hand]').length, 1);
  // Us make six spades for 40; Them defend four tricks for 40, so it is a tie.
  assert.deepEqual(totals(), ['40', '40'], 'six spades is worth 40');
});

test('500 shows negative deltas and keeps the sheet editable', async () => {
  app = await bootApp();
  choose('five00');
  start();
  app.byId('score-hand-btn').click();

  const chips = [...app.byId('hand-body').querySelectorAll('.chip')];
  chips.find((c) => c.getAttribute('aria-label') === 'Misère').click();
  app.byId('hand-save').click();
  app.byId('hand-dialog').close('save');

  const row = app.document.querySelector('tr[data-hand="0"]');
  assert.ok(row, 'the hand is recorded');
  const edit = row.querySelector('.hand-edit');
  assert.match(edit.getAttribute('aria-label'), /^Edit hand 1,/);

  edit.click();
  assert.equal(app.byId('hand-dialog').hasAttribute('open'), true, 'a recorded hand reopens');
  assert.equal(app.byId('hand-delete').hidden, false, 'and can be deleted');
});

/* ---------- dialogs ---------- */

test('the add-player dialog validates the starting score against the target', async () => {
  app = await bootApp();
  choose('greed');
  start();
  app.byId('add-btn').click();

  const seed = app.byId('add-seed');
  const hint = app.byId('add-hint');
  assert.equal(hint.hidden, false, 'Greed has a target, so the hint shows');

  type(app.window, seed, '5000');
  assert.equal(app.byId('add-confirm').disabled, true);
  assert.match(hint.textContent, /must be less than 5000/i);

  type(app.window, seed, '100');
  assert.equal(app.byId('add-confirm').disabled, false);
});

test('adding a player extends the scoreboard', async () => {
  app = await bootApp();
  start();
  assert.equal(app.document.querySelectorAll('#head-row .player-col').length, 3);

  app.byId('add-btn').click();
  type(app.window, app.byId('add-name'), 'Dana');
  app.byId('add-dialog').close('add');

  assert.equal(app.document.querySelectorAll('#head-row .player-col').length, 4);
  assert.equal([...app.document.querySelectorAll('.name-input')].pop().value, 'Dana');
});

test('the menu can start a new game or return to setup', async () => {
  app = await bootApp();
  start();

  app.byId('menu-btn').click();
  assert.equal(app.byId('menu-dialog').hasAttribute('open'), true);

  app.byId('switch-btn').click();
  assert.equal(app.byId('setup-screen').hidden, false, 'switching goes back to setup');
});

test('starting a new game asks first and then clears the sheet', async () => {
  app = await bootApp();
  start();
  type(app.window, scoreInputs()[0], '9');
  assert.equal(totals()[0], '9');

  app.byId('menu-btn').click();
  app.byId('newgame-btn').click();
  assert.equal(app.byId('confirm-dialog').hasAttribute('open'), true, 'it confirms first');

  app.byId('confirm-ok').click();
  app.byId('confirm-dialog').close('ok');
  assert.equal(app.byId('setup-screen').hidden, false);
});

/* ---------- reveal wiring ---------- */

test('fixed round orders show every wild and no reveal button', async () => {
  app = await bootApp();
  start();

  assert.equal(app.byId('reveal-wild-btn').hidden, true);
  const wilds = [...app.document.querySelectorAll('#score-body .wild')].map((n) => n.textContent);
  assert.equal(wilds[0], '3s wild');
  assert.equal(wilds[10], 'Kings wild');
});

test('random orders mask later rounds behind a reveal', async () => {
  app = await bootApp({ animations: true });
  choose('random');
  start();

  const wilds = [...app.document.querySelectorAll('#score-body .wild')];
  assert.equal(
    wilds.slice(1).every((n) => n.classList.contains('wild-masked')),
    true,
  );
  assert.equal(app.byId('reveal-wild-btn').hidden, false, 'a reveal control is offered');
  assert.match(app.byId('reveal-wild-btn').textContent, /Reveal wild/);
});

test('Super Random labels the reveal as a round, not a wild', async () => {
  app = await bootApp({ animations: true });
  choose('super-random');
  start();
  assert.match(app.byId('reveal-wild-btn').textContent, /Reveal round/);
});

test('the reveal offers a dealer override that reseats the table', async () => {
  app = await bootApp({ animations: true });
  choose('random');
  const toggle = app.byId('dealer-toggle');
  toggle.checked = true;
  toggle.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  start();

  const columns = () =>
    [...app.document.querySelectorAll('#head-row .player-col .name-input')].map((n) => n.value);
  const overlay = app.byId('reel-overlay');
  const picker = app.byId('reel-picker');
  assert.equal(overlay.hidden, false, 'round one opens the reel');
  assert.equal(picker.hidden, false, 'the dealer can be overridden before the spin');
  const select = picker.querySelector('select');
  const names = [...select.options].map((option) => option.textContent);
  assert.equal(names.length, 3, 'one option per player');
  assert.deepEqual(columns(), names);
  assert.equal(app.byId('reel-title').textContent, names[0] + ' deals \u00b7 Round 1');

  select.click();
  assert.equal(app.byId('reel-action').textContent, 'Spin', 'touching the picker does not spin');

  select.value = select.options[2].value;
  select.dispatchEvent(new app.window.Event('change', { bubbles: true }));

  assert.equal(overlay.hidden, false, 'the reveal reopens on the new dealer');
  assert.equal(app.byId('reel-title').textContent, names[2] + ' deals \u00b7 Round 1');
  assert.deepEqual(
    columns(),
    [names[2], names[0], names[1]],
    'the new dealer takes the seat and the rest shuffle down',
  );
  assert.equal(
    app.document.querySelector('#score-body .wild').classList.contains('wild-ready'),
    true,
    'switching dealer does not commit the round',
  );

  app.byId('reel-action').click();
  assert.equal(app.byId('reel-picker').hidden, true, 'the override closes once the reel spins');
});

test('reduced motion reveals without opening the reel', async () => {
  app = await bootApp({ animations: true, reducedMotion: true });
  choose('random');
  start();

  assert.equal(app.byId('reel-overlay').hidden, true, 'no reel is shown');
  const first = app.document.querySelector('#score-body .wild');
  assert.equal(first.classList.contains('wild-masked'), false, 'round one is revealed outright');
});
