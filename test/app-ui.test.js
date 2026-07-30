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

test('the menu add-player button hands over a selected recalled name', async () => {
  app = await bootApp();
  const input = () => app.document.activeElement;

  app.byId('players-inc').click();

  assert.equal(input(), nameInputs()[3], 'the new row takes focus, as the add dialog does');
  assert.deepEqual([input().selectionStart, input().selectionEnd], [0, input().value.length]);
});

test('tapping a name box selects the whole name whenever focus lands', async () => {
  app = await bootApp();
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const fire = (target, name) =>
    target.dispatchEvent(new app.window.Event(name, { bubbles: true }));

  for (const focusFirst of [true, false]) {
    const input = nameInputs()[focusFirst ? 0 : 1];
    // Chromium focuses between pointerdown and click; Safari focuses after
    // pointerup and then drops a caret where the tap landed.
    fire(input, 'pointerdown');
    if (focusFirst) input.focus();
    fire(input, 'pointerup');
    if (!focusFirst) input.focus();
    await tick();
    input.setSelectionRange(3, 3);
    fire(input, 'click');
    await tick();

    assert.deepEqual(
      [input.selectionStart, input.selectionEnd],
      [0, input.value.length],
      focusFirst ? 'Chromium order' : 'Safari order',
    );
    input.blur();
  }
});

test('tapping inside a focused name box moves the caret instead of reselecting', async () => {
  app = await bootApp();
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const input = nameInputs()[0];
  const fire = (name) => input.dispatchEvent(new app.window.Event(name, { bubbles: true }));

  input.focus();
  await tick();
  fire('pointerdown');
  input.setSelectionRange(2, 2);
  fire('pointerup');
  fire('click');
  await tick();

  assert.deepEqual([input.selectionStart, input.selectionEnd], [2, 2]);
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

  const startingScore = app.byId('add-start');
  const hint = app.byId('add-hint');
  assert.equal(hint.hidden, false, 'Greed has a target, so the hint shows');

  type(app.window, startingScore, '5000');
  assert.equal(app.byId('add-confirm').disabled, true);
  assert.match(hint.textContent, /must be less than 5000/i);

  type(app.window, startingScore, '100');
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

test('an auto-numbered name steps over one already on the sheet', async () => {
  app = await bootApp();
  // Removing the middle row leaves a gap: counting the roster would suggest
  // "Player 3", which the remaining player already answers to.
  app.document.querySelectorAll('.name-remove')[1].click();
  assert.deepEqual(
    nameInputs().map((input) => input.value),
    ['Player 1', 'Player 3'],
  );

  app.byId('players-inc').click();
  assert.deepEqual(
    nameInputs().map((input) => input.value),
    ['Player 1', 'Player 3', 'Player 4'],
  );

  start();
  const labels = [...app.document.querySelectorAll('tr[data-round="0"] .score-input')].map(
    (input) => input.getAttribute('aria-label'),
  );
  assert.equal(new Set(labels).size, labels.length, 'every column is distinguishable by name');
});

test('the add dialog never suggests a name a player already has', async () => {
  app = await bootApp();
  start();
  const header = [...app.document.querySelectorAll('#head-row .name-input')];
  type(app.window, header[1], 'Player 4');

  app.byId('add-btn').click();
  assert.equal(app.byId('add-name').value, 'Player 5', 'it skips the taken number');

  type(app.window, app.byId('add-name'), '   '); // a blank name falls back the same way
  app.byId('add-dialog').close('add');

  const names = [...app.document.querySelectorAll('#head-row .name-input')].map((n) => n.value);
  assert.deepEqual(names, ['Player 1', 'Player 4', 'Player 3', 'Player 5']);
  assert.equal(new Set(names).size, names.length, 'no two columns share a name');
});

test('a player who joins part-way takes a 0 for every round already played', async () => {
  app = await bootApp();
  start();
  const inputs = scoreInputs();
  type(app.window, inputs[0], '7'); // round 1
  type(app.window, inputs[3], '4'); // round 2

  app.byId('add-btn').click();
  type(app.window, app.byId('add-name'), 'Dana');
  app.byId('add-dialog').close('add');

  const joined = () =>
    [...app.document.querySelectorAll('#score-body .score-input')]
      .filter((input) => input.getAttribute('data-pid') === 'p4')
      .map((input) => input.value);
  assert.deepEqual(joined().slice(0, 4), ['0', '0', '', ''], 'the missed rounds read 0, not blank');
  assert.equal(totals().pop(), '0♛ leader');
});

test('a joining player carries their starting score on the latest played round', async () => {
  app = await bootApp();
  choose('greed');
  start();
  type(app.window, scoreInputs()[0], '600'); // round 1
  type(app.window, scoreInputs()[2], '700'); // round 2

  app.byId('add-btn').click();
  type(app.window, app.byId('add-name'), 'Dana');
  type(app.window, app.byId('add-start'), '1200');
  app.byId('add-dialog').close('add');

  const joined = [...app.document.querySelectorAll('#score-body .score-input')]
    .filter((input) => input.getAttribute('data-pid') === 'p3')
    .map((input) => input.value);
  assert.deepEqual(joined, ['0', '1200', ''], 'the starting score lands on the last played round');
  assert.equal(totals().pop(), '1200', 'and counts towards their total');
});

test('500 does not offer to add a side once the game is under way', async () => {
  app = await bootApp();
  choose('five00');
  start();
  assert.equal(app.byId('add-btn').hidden, true);
});

test('the in-game add button stops at the same cap as the setup stepper', async () => {
  app = await bootApp();
  choose('greed');
  start();

  for (let i = 0; i < 10 && !app.byId('add-btn').hidden; i++) {
    app.byId('add-btn').click();
    type(app.window, app.byId('add-name'), 'Extra ' + i);
    app.byId('add-dialog').close('add');
  }

  assert.equal(app.document.querySelectorAll('#head-row .player-col').length, 8, 'caps at eight');
  assert.equal(app.byId('add-btn').hidden, true, 'and the button goes away at the cap');
});

test('an over-cap roster would stop names being remembered, so it never forms', async () => {
  app = await bootApp();
  choose('greed');
  start();
  for (let i = 0; i < 10 && !app.byId('add-btn').hidden; i++) {
    app.byId('add-btn').click();
    type(app.window, app.byId('add-name'), 'Extra ' + i);
    app.byId('add-dialog').close('add');
  }

  app.byId('menu-btn').click();
  app.byId('newgame-btn').click();
  app.byId('confirm-dialog').close('ok');

  assert.equal(nameInputs().length, 8, 'the whole roster comes back');
  assert.equal(nameInputs()[7].value, 'Extra 5', 'rather than falling back to default names');
});

test('Greed keeps rounds played after the game ended, marked as not counting', async () => {
  app = await bootApp();
  choose('greed');
  start();
  const fill = (round, first, second) => {
    type(app.window, scoreInputs()[round * 2], String(first));
    type(app.window, scoreInputs()[round * 2 + 1], String(second));
  };
  for (let round = 0; round < 4; round++) fill(round, 700, 600);

  const rows = () => [...app.document.querySelectorAll('#score-body tr')];
  assert.equal(rows().length, 5, 'four played rounds plus a blank one');

  // Correcting round one hands the game to Player 1 far earlier than it ended.
  type(app.window, scoreInputs()[0], '5000');

  const marked = rows().map((row) => row.classList.contains('round-void'));
  assert.deepEqual(marked, [false, false, true, true], 'the rounds after the final one stay put');
  assert.deepEqual(totals(), ['5700♛ leader', '1200'], 'and score nothing');
  assert.match(
    app.document.querySelector('tr[data-round="3"] .score-input').getAttribute('aria-label'),
    /not counted/,
    'screen readers are told why',
  );

  type(app.window, scoreInputs()[0], '700');
  assert.equal(
    rows().every((row) => !row.classList.contains('round-void')),
    true,
    'undoing the correction brings them back into play',
  );
  assert.deepEqual(totals(), ['2800♛ leader', '2400']);
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

test('the reveal asks who deals and reseats the table around the answer', async () => {
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
  assert.equal(picker.hidden, false, 'and asks who deals before it spins');
  const select = picker.querySelector('select');
  const names = [...select.options].slice(1).map((option) => option.textContent);
  assert.equal(names.length, 3, 'one option per player');
  assert.deepEqual(columns(), names);
  assert.equal(select.value, '', 'nobody is chosen for you');
  assert.equal(app.byId('reel-title').textContent, 'Who deals Round 1?');
  assert.equal(app.byId('reel-action').disabled, true, 'the spin waits on an answer');

  select.click();
  assert.equal(app.byId('reel-action').textContent, 'Spin', 'touching the picker does not spin');

  select.value = select.options[3].value;
  select.dispatchEvent(new app.window.Event('change', { bubbles: true }));

  assert.equal(overlay.hidden, false, 'the reveal reopens on the answer');
  assert.equal(app.byId('reel-title').textContent, names[2] + ' deals \u00b7 Round 1');
  assert.equal(app.byId('reel-action').disabled, false, 'and the spin is released');
  assert.deepEqual(
    columns(),
    [names[2], names[0], names[1]],
    'the new dealer takes the seat and the rest shuffle down',
  );
  assert.equal(
    app.document.querySelector('#score-body .wild').classList.contains('wild-ready'),
    true,
    'naming the dealer does not commit the round',
  );

  app.byId('reel-action').click();
  assert.equal(app.byId('reel-picker').hidden, true, 'the question closes once the reel spins');
  assert.equal(app.byId('reel-action').hidden, true, 'and the spin cannot be cut short');
});

test('naming the dealer the rotation already had leaves the table alone', async () => {
  app = await bootApp({ animations: true });
  choose('random');
  const toggle = app.byId('dealer-toggle');
  toggle.checked = true;
  toggle.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  start();

  const columns = () =>
    [...app.document.querySelectorAll('#head-row .player-col .name-input')].map((n) => n.value);
  const seating = columns();
  const select = app.byId('reel-picker').querySelector('select');

  select.value = select.options[1].value;
  select.dispatchEvent(new app.window.Event('change', { bubbles: true }));

  assert.deepEqual(columns(), seating, 'nobody moves');
  assert.equal(app.byId('reel-title').textContent, seating[0] + ' deals \u00b7 Round 1');
  assert.equal(app.byId('reel-action').disabled, false, 'the answer still releases the spin');
  assert.equal(
    app.byId('reel-picker').querySelector('select').value,
    select.value,
    'and the question is not asked again',
  );
});

test('confirming a reveal hands focus back to the round it opened from', async () => {
  app = await bootApp({ animations: true });
  choose('random');
  start();

  // Round one auto-reveals; clear it so round two can be opened by hand.
  app.byId('reel-action').click();
  app.window.finishAnimations();
  app.byId('reel-action').click();
  app.window.finishAnimations();
  scoreInputs()
    .slice(0, 3)
    .forEach((input) => type(app.window, input, '5'));

  const header = app.document.querySelector('#score-body tr[data-round="1"] .round-col');
  header.focus();
  press(app.window, header, 'Enter');
  assert.equal(app.byId('reel-overlay').hidden, false, 'the round header opens the reel');

  app.byId('reel-action').click();
  app.window.finishAnimations();
  app.byId('reel-action').click();
  app.window.finishAnimations();

  const active = app.document.activeElement;
  assert.equal(app.byId('reel-overlay').hidden, true);
  assert.equal(
    app.byId('reel-overlay').contains(active),
    false,
    'focus does not stay inside the hidden reel',
  );
  assert.equal(active.closest('tr').getAttribute('data-round'), '1', 'it lands on the round');
});

test('reduced motion reveals without opening the reel', async () => {
  app = await bootApp({ animations: true, reducedMotion: true });
  choose('random');
  start();

  assert.equal(app.byId('reel-overlay').hidden, true, 'no reel is shown');
  const first = app.document.querySelector('#score-body .wild');
  assert.equal(first.classList.contains('wild-masked'), false, 'round one is revealed outright');
});

/* ---------- ending a game and revealing the winner ---------- */

// Booted without the Web Animations API, the podium arrives all at once, which
// keeps these about the wiring rather than the countdown.
const podium = () =>
  [...app.document.querySelectorAll('.podium-row')].map((row) => [
    ...[...row.children].map((cell) => cell.textContent),
    row.classList.contains('podium-first'),
  ]);
const openMenu = () => app.byId('menu-btn').click();
const namePlayers = (...names) => {
  nameInputs().forEach((input, i) => {
    if (names[i]) type(app.window, input, names[i]);
  });
};
const endEarly = () => {
  openMenu();
  app.byId('endgame-btn').click();
  app.byId('confirm-ok').click();
  app.byId('confirm-dialog').close('ok');
};

test('the menu ends a game early and settles it on the scores so far', async () => {
  app = await bootApp();
  namePlayers('Dad', 'Mum', 'Sam');
  start();
  [3, 9, 20, 4, 8, 25].forEach((value, i) => type(app.window, scoreInputs()[i], String(value)));

  openMenu();
  assert.equal(app.byId('results-btn').hidden, true, 'there is no result to show yet');
  assert.equal(app.byId('endgame-btn').textContent, 'End game now');

  app.byId('endgame-btn').click();
  assert.equal(app.byId('confirm-dialog').hasAttribute('open'), true, 'it asks first');
  app.byId('confirm-ok').click();
  app.byId('confirm-dialog').close('ok');

  assert.equal(app.byId('winner-banner').textContent, '\u{1F3C6} Dad wins with 7!');
  assert.equal(app.byId('play-again-btn').hidden, false);
});

test('ending a game early reveals the podium from third place to the winner', async () => {
  app = await bootApp();
  namePlayers('Dad', 'Mum', 'Sam');
  start();
  [3, 9, 20, 4, 8, 25].forEach((value, i) => type(app.window, scoreInputs()[i], String(value)));
  endEarly();

  assert.equal(app.byId('reel-overlay').hidden, false, 'the reveal comes up by itself');
  assert.deepEqual(podium(), [
    ['3rd', 'Sam', '45', false],
    ['2nd', 'Mum', '17', false],
    ['1st', 'Dad', '7', true],
  ]);
  assert.equal(app.byId('reel-title').textContent, '\u{1F3C6} Dad wins with 7!');
  assert.equal(app.byId('reel-action').textContent, 'Done');
  assert.equal(app.byId('reel-replay').hidden, false, 'and it can be watched again');
});

test('a game called early can be picked back up from the menu', async () => {
  app = await bootApp();
  start();
  type(app.window, scoreInputs()[0], '9');
  endEarly();
  app.byId('reel-action').click();

  openMenu();
  assert.equal(app.byId('results-btn').hidden, false, 'the result stays reachable');
  assert.equal(app.byId('endgame-btn').textContent, 'Resume scoring');

  app.byId('endgame-btn').click();
  assert.equal(app.byId('winner-banner').hidden, true, 'the verdict is withdrawn');
  assert.equal(app.byId('play-again-btn').hidden, true);

  openMenu();
  assert.equal(app.byId('endgame-btn').textContent, 'End game now');
  assert.equal(app.byId('results-btn').hidden, true);
});

test('the menu shows the result again without ending anything twice', async () => {
  app = await bootApp();
  namePlayers('Dad', 'Mum', 'Sam');
  start();
  [3, 9, 20].forEach((value, i) => type(app.window, scoreInputs()[i], String(value)));
  endEarly();
  app.byId('reel-action').click();
  assert.equal(app.byId('reel-overlay').hidden, true);

  openMenu();
  app.byId('results-btn').click();
  assert.equal(app.byId('reel-overlay').hidden, false, 'it opens again on demand');
  assert.deepEqual(
    podium().map((row) => row[1]),
    ['Sam', 'Mum', 'Dad'],
  );

  app.byId('reel-action').click();
  assert.equal(app.byId('reel-overlay').hidden, true);
  assert.equal(app.byId('winner-banner').textContent.length > 0, true, 'the game is still over');
});

test('a game the rules finished cannot also be called early', async () => {
  app = await bootApp();
  namePlayers('Dad', 'Mum', 'Sam');
  start();
  scoreInputs().forEach((input, i) => type(app.window, input, String((i % 3) + 1)));

  assert.equal(app.byId('winner-banner').textContent, '\u{1F3C6} Dad wins with 11!');
  openMenu();
  assert.equal(app.byId('endgame-btn').hidden, true, 'there is nothing left to cut short');
  assert.equal(app.byId('results-btn').hidden, false);
});

test('the winner reveal waits for the score box to be left', async () => {
  app = await bootApp();
  namePlayers('Dad', 'Mum', 'Sam');
  start();
  const inputs = scoreInputs();
  inputs.forEach((input, i) => {
    if (i < inputs.length - 1) type(app.window, input, String((i % 3) + 1));
  });

  const last = inputs[inputs.length - 1];
  last.focus();
  type(app.window, last, '3');
  assert.equal(app.byId('reel-overlay').hidden, true, 'a score still being typed is left alone');

  last.blur();
  assert.equal(app.byId('reel-overlay').hidden, false, 'leaving the box brings up the reveal');
  assert.deepEqual(
    podium().map((row) => row[1]),
    ['Sam', 'Mum', 'Dad'],
  );
});

test('the reveal comes up once, not on every redraw', async () => {
  app = await bootApp();
  start();
  type(app.window, scoreInputs()[0], '9');
  endEarly();
  app.byId('reel-action').click();

  // Any edit redraws the sheet; the game is still over but has been seen.
  type(app.window, scoreInputs()[1], '4');
  assert.equal(app.byId('reel-overlay').hidden, true);

  openMenu();
  app.byId('switch-btn').click();
  app.byId('resume-btn').click();
  assert.equal(app.byId('reel-overlay').hidden, true, 'nor on picking the game back up');
});

test('a hand-scored game reaches the podium too, and a tie shares a place', async () => {
  app = await bootApp();
  choose('five00');
  namePlayers('Us', 'Them');
  start();
  endEarly();

  assert.equal(app.byId('reel-overlay').hidden, false);
  assert.deepEqual(podium(), [['1st', 'Us & Them', '0', true]], 'level sides share first');
  assert.match(app.byId('winner-banner').textContent, /Tie at 0/);
});
