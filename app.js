import { GAMES, GAME_ORDER, lastFilledIndex, cap, unitSingular } from './games.js';
import { defaultState, normalizeState, serializeState } from './state.js';

/*
 * Generic scorekeeping engine. Reads the active game object from `games.js`
 * (imported as an ES module) and renders setup, the score grid, totals, the
 * winner/target banner and the score-entry dialogs from it. No game rules live
 * here; everything game-specific is a property of the game object.
 */

const LAST_GAME_KEY = 'scorer:lastGame';
const NAMES_KEY = 'scorer:names';

/* ---------- small helpers ---------- */
function el(tag, attrs, text) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'hidden') { if (attrs[k]) node.hidden = true; }
      else node.setAttribute(k, attrs[k]);
    }
  }
  if (text != null) node.textContent = text;
  return node;
}
function onlyDigits(value) { return String(value).replace(/[^0-9]/g, ''); }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/* ---------- state ---------- */
let activeGame = null;
let state = null;
let setupNames = [];
let prevStatus = null;
let handEditIndex = null;
let handDraft = null;

function loadGame(game) {
  try {
    const raw = localStorage.getItem(game.storageKey);
    if (raw) return normalizeState(game, JSON.parse(raw));
  } catch (e) { console.warn('fivecrowns: ignoring corrupt or unavailable save', e); }
  return defaultState(game);
}

function hasStartedSave(game) {
  const st = loadGame(game);
  return st.started && st.players.length > 0;
}

function save() {
  try {
    localStorage.setItem(activeGame.storageKey, JSON.stringify(serializeState(activeGame, state)));
    localStorage.setItem(LAST_GAME_KEY, activeGame.id);
    // Remember the current roster so the next new game of this type can reuse it.
    // Guarded on players.length so newGame()'s empty save keeps the saved names.
    if (state.players.length > 0) rememberNames(activeGame, state.players.map((p) => p.name));
  } catch (e) { /* storage may be full or blocked; scores stay in memory */ }
}

// Per-game roster of the last-used names, kept apart from the game state so it
// survives a "new game" (which wipes the state) and seeds the next setup screen.
function loadRosters() {
  try {
    const obj = JSON.parse(localStorage.getItem(NAMES_KEY));
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (e) { return {}; }
}

function rememberNames(game, names) {
  const all = loadRosters();
  all[game.id] = names;
  localStorage.setItem(NAMES_KEY, JSON.stringify(all));
}

function recalledNames(game) {
  const names = loadRosters()[game.id];
  if (Array.isArray(names)
    && names.every((n) => typeof n === 'string')
    && names.length >= game.minPlayers
    && names.length <= game.maxPlayers) {
    return names.slice();
  }
  return game.defaultNames();
}

/* ---------- state helpers ---------- */
function playerById(id) { return state.players.find((p) => p.id === id); }
function nameOf(id) { const p = playerById(id); return p ? p.name : id; }

function addPlayerToState(name, seed) {
  const id = 'p' + state.nextId++;
  const clean = (name || '').trim() || cap(unitSingular(activeGame)) + ' ' + (state.players.length + 1);
  state.players.push({ id, name: clean, seed: seed || 0 });
  if (activeGame.entry === 'cell') {
    state.scores[id] = activeGame.rounds.kind === 'fixed'
      ? new Array(activeGame.rounds.count).fill(null)
      : [];
  }
  return id;
}

function setScore(pid, round, value) {
  if (!Array.isArray(state.scores[pid])) state.scores[pid] = [];
  const arr = state.scores[pid];
  while (arr.length <= round) arr.push(null);
  arr[round] = value;
  save();
}

// One pass that returns totals and status together (kept consistent by the game).
function resolve() {
  return activeGame.resolve(state.players, state);
}

/* ---------- DOM refs ---------- */
const setupScreen = document.getElementById('setup-screen');
const gameScreen = document.getElementById('game-screen');
const picker = document.getElementById('game-picker');
const setupFresh = document.getElementById('setup-fresh');
const setupResume = document.getElementById('setup-resume');
const resumeNote = document.getElementById('resume-note');
const resumeBtn = document.getElementById('resume-btn');
const newFromSetupBtn = document.getElementById('new-from-setup-btn');
const countLabel = document.getElementById('count-label');
const playersCount = document.getElementById('players-count');
const playersDec = document.getElementById('players-dec');
const playersInc = document.getElementById('players-inc');
const nameList = document.getElementById('name-list');
const startBtn = document.getElementById('start-btn');

const gameName = document.getElementById('game-name');
const headerScoreHandBtn = document.getElementById('score-hand-btn');
const playAgainBtn = document.getElementById('play-again-btn');
const addBtn = document.getElementById('add-btn');
const menuBtn = document.getElementById('menu-btn');
const caption = document.getElementById('table-caption');
const headRow = document.getElementById('head-row');
const scoreBody = document.getElementById('score-body');
const totalRow = document.getElementById('total-row');
const winnerBanner = document.getElementById('winner-banner');

const addDialog = document.getElementById('add-dialog');
const addTitle = document.getElementById('add-title');
const addName = document.getElementById('add-name');
const addSeed = document.getElementById('add-seed');
const addHint = document.getElementById('add-hint');
const addConfirm = document.getElementById('add-confirm');
const addCancel = document.getElementById('add-cancel');

const confirmDialog = document.getElementById('confirm-dialog');
const confirmCancel = document.getElementById('confirm-cancel');
const confirmOk = document.getElementById('confirm-ok');

const menuDialog = document.getElementById('menu-dialog');
const switchBtn = document.getElementById('switch-btn');
const newgameBtn = document.getElementById('newgame-btn');
const menuClose = document.getElementById('menu-close');

const handDialog = document.getElementById('hand-dialog');
const handTitle = document.getElementById('hand-title');
const handBody = document.getElementById('hand-body');
const handPreview = document.getElementById('hand-preview');
const handDeleteBtn = document.getElementById('hand-delete');
const handCancel = document.getElementById('hand-cancel');
const handSave = document.getElementById('hand-save');

/* ---------- screen switching ---------- */
function showSetup() {
  setupScreen.hidden = false;
  gameScreen.hidden = true;
  renderPicker();
  refreshSetupView();
}

function showGame() {
  setupScreen.hidden = true;
  gameScreen.hidden = false;
  gameName.textContent = activeGame.name;
  renderGame();
}

/* ---------- picker + setup ---------- */
function renderPicker() {
  picker.innerHTML = '';
  GAME_ORDER.forEach((id) => {
    const g = GAMES[id];
    const label = el('label', { class: 'pick' });
    const input = el('input', { type: 'radio', name: 'game', value: id });
    if (id === activeGame.id) input.checked = true;
    input.addEventListener('change', () => { if (input.checked) selectGame(id); });
    label.appendChild(input);
    label.appendChild(el('span', { class: 'pick-name' }, g.name));
    picker.appendChild(label);
  });
}

function selectGame(id) {
  activeGame = GAMES[id];
  refreshSetupView();
}

function refreshSetupView() {
  countLabel.textContent = cap(activeGame.unitLabel);
  if (hasStartedSave(activeGame)) {
    setupResume.hidden = false;
    setupFresh.hidden = true;
    resumeNote.textContent = 'You have a ' + activeGame.name + ' game in progress.';
  } else {
    setupResume.hidden = true;
    setupFresh.hidden = false;
    setupNames = recalledNames(activeGame);
    renderNameList();
  }
}

function renderNameList() {
  playersCount.textContent = setupNames.length;
  playersDec.disabled = setupNames.length <= activeGame.minPlayers;
  playersInc.disabled = setupNames.length >= activeGame.maxPlayers;
  nameList.innerHTML = '';
  const unit = cap(unitSingular(activeGame));
  setupNames.forEach((nm, i) => {
    const li = el('li', { class: 'name-row' });

    // Grip handle: drag to reorder (mouse + touch via Pointer Events) or, when
    // focused, ArrowUp/ArrowDown to move the row for keyboard users.
    const grip = el('button', {
      type: 'button',
      class: 'name-drag',
      'aria-label': 'Reorder ' + unit + ' ' + (i + 1),
      title: 'Drag to reorder',
    });
    grip.appendChild(dragIcon());
    grip.addEventListener('pointerdown', (e) => startRowDrag(e, grip));
    grip.addEventListener('keydown', (e) => moveRowByKey(e, i));
    li.appendChild(grip);

    const input = el('input', {
      type: 'text',
      value: nm,
      placeholder: cap(unitSingular(activeGame)) + ' ' + (i + 1),
      'aria-label': cap(unitSingular(activeGame)) + ' ' + (i + 1) + ' name',
      autocomplete: 'off',
      autocapitalize: 'words',
      autocorrect: 'off',
      spellcheck: 'false',
      enterkeyhint: 'next',
    });
    input.addEventListener('input', () => { setupNames[i] = input.value; });
    li.appendChild(input);
    if (setupNames.length > activeGame.minPlayers) {
      const rm = el('button', {
        type: 'button',
        class: 'name-remove',
        'aria-label': 'Remove ' + cap(unitSingular(activeGame)) + ' ' + (i + 1),
      }, '\u00d7');
      rm.addEventListener('click', () => { setupNames.splice(i, 1); renderNameList(); });
      li.appendChild(rm);
    }
    nameList.appendChild(li);
  });
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function dragIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  [4, 9, 14].forEach((y) => {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', '4'); r.setAttribute('y', String(y));
    r.setAttribute('width', '12'); r.setAttribute('height', '2'); r.setAttribute('rx', '1');
    svg.appendChild(r);
  });
  return svg;
}

// Rebuild setupNames from the inputs in their current DOM order (after a drag).
function commitNameOrder() {
  setupNames = Array.prototype.map.call(nameList.querySelectorAll('.name-row input'), (inp) => inp.value);
}

// Live pointer-drag reordering of a name row. The grip captures the pointer so
// touch drags don't scroll the page; move/end listen on the document so the drag
// always commits even if the pointer leaves the grip. On release we read the new
// order and re-render to refresh each row's index-bound handlers and labels.
function startRowDrag(e, grip) {
  const li = grip.closest('.name-row');
  if (!li) return;
  e.preventDefault();
  const pid = e.pointerId;
  try { grip.setPointerCapture(pid); } catch (_) { /* unsupported */ }
  li.classList.add('dragging');

  const move = (ev) => {
    if (ev.pointerId !== pid) return;
    const rows = Array.prototype.filter.call(nameList.querySelectorAll('.name-row'), (o) => o !== li);
    const before = rows.find((o) => {
      const r = o.getBoundingClientRect();
      return ev.clientY < r.top + r.height / 2;
    }) || null;
    if (before !== li.nextElementSibling) nameList.insertBefore(li, before);
  };
  const end = (ev) => {
    if (ev && ev.pointerId !== pid) return;
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', end);
    document.removeEventListener('pointercancel', end);
    try { grip.releasePointerCapture(pid); } catch (_) { /* already released */ }
    li.classList.remove('dragging');
    commitNameOrder();
    renderNameList();
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
}

function moveRowByKey(e, i) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const j = i + (e.key === 'ArrowUp' ? -1 : 1);
  if (j < 0 || j >= setupNames.length) return;
  e.preventDefault();
  const moved = setupNames[i];
  setupNames[i] = setupNames[j];
  setupNames[j] = moved;
  renderNameList();
  const grips = nameList.querySelectorAll('.name-drag');
  if (grips[j]) grips[j].focus();
}

/* ---------- game rendering ---------- */
function captionText() {
  const dir = activeGame.winDirection === 'low' ? 'Lowest' : 'Highest';
  let t = activeGame.name + ' score sheet. ' + dir + ' total wins';
  if (activeGame.target != null) t += '; first to ' + activeGame.target;
  return t + '.';
}

function cornerLabel() { return activeGame.entry === 'hand' ? 'Hand' : 'Round'; }

function cellRowCount(st) {
  if (activeGame.rounds.kind === 'fixed') return activeGame.rounds.count;
  let lastFilled = -1;
  state.players.forEach((p) => { lastFilled = Math.max(lastFilled, lastFilledIndex(state.scores[p.id] || [])); });
  const started = lastFilled + 1;
  if (st && st.finalRound != null) return st.finalRound + 1;        // capped final round (Greed)
  if (!st || st.phase === 'inProgress') return started + 1;          // trailing empty row
  return started;
}

function renderGame() {
  const { totals, status } = resolve();
  gameName.textContent = activeGame.name;
  caption.textContent = captionText();
  renderHeaderActions(status);
  buildHead();
  buildBody(status);
  buildFoot();
  updateTotalsAndBanner(totals, status);
  prevStatus = status;
}

function renderHeaderActions(st) {
  const inProgress = st.phase === 'inProgress';
  const ended = st.phase === 'complete' || st.phase === 'out';
  addBtn.textContent = '+ ' + cap(unitSingular(activeGame));
  addBtn.hidden = !inProgress;
  headerScoreHandBtn.hidden = !(activeGame.entry === 'hand' && inProgress);
  playAgainBtn.hidden = !ended;
}

function buildHead() {
  headRow.innerHTML = '';
  headRow.appendChild(el('th', { class: 'round-col corner', scope: 'col' }, cornerLabel()));
  state.players.forEach((p, i) => {
    const th = el('th', { class: 'player-col', scope: 'col', 'data-pid': p.id });
    const input = el('input', { type: 'text', class: 'name-input', value: p.name, 'aria-label': cap(unitSingular(activeGame)) + ' ' + (i + 1) + ' name', autocomplete: 'off', autocapitalize: 'words', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done' });
    input.addEventListener('input', () => {
      p.name = input.value;
      save();
      refreshScoreLabels(p.id);
      updateTotalsAndBanner();
    });
    th.appendChild(input);
    headRow.appendChild(th);
  });
}

// Keep the focused score cell clear of the on-screen keyboard and the sticky
// header/footer. scrollIntoView centres in the layout viewport, which on iOS
// ignores the keyboard (it shrinks only the visual viewport), so measure the
// visual viewport and scroll the table within that visible band instead.
function scrollScoreInputIntoView(input) {
  const wrap = input.closest('.table-wrap');
  const vv = window.visualViewport;
  if (!wrap || !vv) { input.scrollIntoView({ block: 'center', inline: 'nearest' }); return; }
  setTimeout(() => {
    if (document.activeElement !== input) return;
    const cell = input.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const corner = wrap.querySelector('thead .round-col');
    const foot = wrap.querySelector('tfoot');
    const headH = corner ? corner.getBoundingClientRect().height : 0;
    const stickyW = corner ? corner.getBoundingClientRect().width : 0;
    const footH = foot ? foot.getBoundingClientRect().height : 0;
    const m = 24;
    const top = wrapRect.top + headH + m;
    const bottom = Math.min(vv.offsetTop + vv.height, wrapRect.bottom - footH) - m;
    if (cell.bottom > bottom) wrap.scrollTop += cell.bottom - bottom;
    else if (cell.top < top) wrap.scrollTop -= top - cell.top;
    const left = wrapRect.left + stickyW + m;
    const right = wrapRect.right - m;
    if (cell.right > right) wrap.scrollLeft += cell.right - right;
    else if (cell.left < left) wrap.scrollLeft -= left - cell.left;
  }, 300);
}


function scoreCellLabel(name, label) {
  return name + ', round ' + label.num + (label.sub ? ' (' + label.sub + ')' : '') + ' score';
}

// Keep score-cell aria-labels in sync when a player is renamed (cell games).
function refreshScoreLabels(pid) {
  const p = playerById(pid);
  if (!p) return;
  scoreBody.querySelectorAll('.score-input[data-pid="' + pid + '"]').forEach((input) => {
    const r = Number(input.getAttribute('data-round'));
    input.setAttribute('aria-label', scoreCellLabel(p.name, activeGame.roundLabel(r)));
  });
}

function buildBody(st) {
  scoreBody.innerHTML = '';
  if (activeGame.entry === 'hand') {
    buildHandRows();
  } else {
    const rows = cellRowCount(st);
    for (let r = 0; r < rows; r++) scoreBody.appendChild(buildCellRow(r));
  }
}

function buildCellRow(r) {
  const label = activeGame.roundLabel(r);
  const tr = el('tr', { 'data-round': String(r) });
  const rh = el('th', { class: 'round-col', scope: 'row' });
  rh.appendChild(el('span', { class: 'round-num' }, label.num));
  if (label.sub) rh.appendChild(el('span', { class: 'wild' }, label.sub));
  tr.appendChild(rh);

  state.players.forEach((p) => {
    const td = el('td', { class: 'score-cell' });
    const input = el('input', {
      type: 'text',
      inputmode: 'numeric',
      pattern: '[0-9]*',
      enterkeyhint: 'next',
      class: 'score-input',
      'data-pid': p.id,
      'data-round': String(r),
      'aria-label': scoreCellLabel(p.name, label),
    });
    const arr = state.scores[p.id] || [];
    const v = arr[r];
    input.value = v == null ? '' : String(v);
    input.addEventListener('input', () => {
      const digits = onlyDigits(input.value);
      if (digits !== input.value) input.value = digits;
      setScore(p.id, r, digits === '' ? null : parseInt(digits, 10));
      handleCellChange();
    });
    input.addEventListener('focus', () => scrollScoreInputIntoView(input));
    // The numeric keypad has no Next key, so wire Enter to the following cell.
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const inputs = Array.from(scoreBody.querySelectorAll('.score-input'));
      const next = inputs[inputs.indexOf(input) + 1];
      if (next) next.focus(); else input.blur();
    });
    td.appendChild(input);
    tr.appendChild(td);
  });
  return tr;
}

function buildHandRows() {
  const hands = state.hands || [];
  hands.forEach((hand, i) => {
    const tr = el('tr', { 'data-hand': String(i) });
    const rh = el('th', { class: 'round-col hand-head', scope: 'row' });
    const btn = el('button', { type: 'button', class: 'hand-edit', 'aria-label': 'Edit hand ' + (i + 1) + ', ' + activeGame.handSummary(hand, state.players) });
    btn.appendChild(el('span', { class: 'round-num' }, 'Hand ' + (i + 1)));
    btn.appendChild(el('span', { class: 'wild' }, activeGame.handSummary(hand, state.players)));
    btn.addEventListener('click', () => openHandDialog(i));
    rh.appendChild(btn);
    tr.appendChild(rh);

    state.players.forEach((p) => {
      const td = el('td', { class: 'score-cell delta-cell' });
      const d = hand.deltas ? hand.deltas[p.id] : undefined;
      if (d != null) {
        td.textContent = (d > 0 ? '+' : '') + d;
        if (d < 0) td.classList.add('neg');
      }
      tr.appendChild(td);
    });
    scoreBody.appendChild(tr);
  });

  if (hands.length === 0) {
    const tr = el('tr');
    const td = el('td', { class: 'empty-hint', colspan: String(state.players.length + 1) },
      'No hands yet. Tap "Score hand" to record one.');
    tr.appendChild(td);
    scoreBody.appendChild(tr);
  }
}

function buildFoot() {
  totalRow.innerHTML = '';
  totalRow.appendChild(el('th', { class: 'round-col', scope: 'row' }, 'Total'));
  state.players.forEach((p) => {
    totalRow.appendChild(el('td', { class: 'total-cell', 'data-pid': p.id }));
  });
}

function updateTotalsAndBanner(totals, st) {
  if (!totals || !st) { const r = resolve(); totals = r.totals; st = r.status; }

  state.players.forEach((p) => {
    const cell = totalRow.querySelector('.total-cell[data-pid="' + p.id + '"]');
    if (!cell) return;
    const t = totals[p.id];
    const isLeader = st.leaders.indexOf(p.id) !== -1;
    cell.textContent = '';
    cell.appendChild(document.createTextNode(String(t)));
    cell.classList.toggle('leader', isLeader);
    cell.classList.toggle('neg', activeGame.allowNegative && t < 0);
    // A crown marks the leader so it does not rely on the green colour alone.
    if (isLeader) {
      cell.appendChild(el('span', { class: 'leader-mark', 'aria-hidden': 'true' }, '\u265B'));
      cell.appendChild(el('span', { class: 'visually-hidden' }, ' leader'));
    }
    // Greed: subtle hint while a player has not yet banked >= 500 to get on board.
    if (activeGame.onBoardMin && t === 0 && lastFilledIndex(state.scores[p.id] || []) >= 0) {
      cell.appendChild(el('span', {
        class: 'needs',
        title: 'Needs ' + activeGame.onBoardMin + ' in a single turn to get on the board',
      }, 'needs ' + activeGame.onBoardMin));
    }
  });

  winnerBanner.className = 'winner-banner phase-' + st.phase;
  if (st.text) {
    winnerBanner.hidden = false;
    winnerBanner.textContent = st.text;
  } else {
    winnerBanner.hidden = true;
    winnerBanner.textContent = '';
  }
}

// After a cell edit, update header/totals/banner in place and grow or trim the
// trailing rows. Never a full rebuild, so the focused input is preserved even on
// the keystroke that completes a game or first reaches a target.
function handleCellChange() {
  const { totals, status } = resolve();
  renderHeaderActions(status);
  updateTotalsAndBanner(totals, status);
  const want = cellRowCount(status);
  while (scoreBody.children.length < want) scoreBody.appendChild(buildCellRow(scoreBody.children.length));
  // only trim trailing rows that don't hold focus
  while (scoreBody.children.length > want
    && !scoreBody.lastChild.contains(document.activeElement)) {
    scoreBody.removeChild(scoreBody.lastChild);
  }
  prevStatus = status;
}

/* ---------- actions ---------- */
function startGame() {
  state = defaultState(activeGame);
  state.started = true;
  setupNames.forEach((n) => addPlayerToState(n, 0));
  save();
  showGame();
}

function resumeGame() {
  state = loadGame(activeGame);
  showGame();
}

function newGame() {
  state = defaultState(activeGame);
  save();
  setupNames = recalledNames(activeGame);
  showSetup();
}

// Start a fresh game with the same players, so a rematch keeps everyone's names.
function playAgain() {
  const keep = state.players.map((p) => ({ id: p.id, name: p.name, seed: 0 }));
  const fresh = defaultState(activeGame);
  fresh.started = true;
  fresh.players = keep;
  fresh.nextId = state.nextId;
  keep.forEach((p) => {
    if (activeGame.entry === 'cell') {
      fresh.scores[p.id] = activeGame.rounds.kind === 'fixed'
        ? new Array(activeGame.rounds.count).fill(null)
        : [];
    }
  });
  state = fresh;
  save();
  renderGame();
}

function addPlayer(name, seed) {
  addPlayerToState(name, seed);
  save();
  renderGame();
}

/* ---------- add-player dialog ---------- */
function validateSeed() {
  const seed = parseInt(onlyDigits(addSeed.value), 10) || 0;
  if (activeGame.target != null && seed >= activeGame.target) {
    addHint.hidden = false;
    addHint.textContent = 'Starting score must be less than ' + activeGame.target + '.';
    addHint.classList.add('error');
    addConfirm.disabled = true;
    return false;
  }
  addHint.classList.remove('error');
  if (activeGame.target != null) {
    addHint.hidden = false;
    addHint.textContent = 'Must be less than ' + activeGame.target + '.';
  } else {
    addHint.hidden = true;
  }
  addConfirm.disabled = false;
  return true;
}

function openAddDialog() {
  addTitle.textContent = 'Add ' + unitSingular(activeGame);
  addName.value = '';
  addSeed.value = '0';
  validateSeed();
  addDialog.returnValue = '';
  addDialog.showModal();
  addName.focus();
}

/* ---------- generic UI helpers ---------- */

function chip(label, selected, onClick, ariaLabel) {
  const b = el('button', { type: 'button', class: 'chip' + (selected ? ' selected' : ''), 'aria-pressed': selected ? 'true' : 'false' }, label);
  if (ariaLabel) b.setAttribute('aria-label', ariaLabel);
  b.addEventListener('click', onClick);
  return b;
}

function labeledStepper(label, value, min, max, onChange) {
  const wrap = el('div', { class: 'hand-stepper' });
  wrap.appendChild(el('span', { class: 'hand-stepper-label' }, label));
  const ctrl = el('div', { class: 'stepper' });
  const dec = el('button', { type: 'button', class: 'step-btn', 'aria-label': 'Decrease ' + label }, '−');
  const out = el('output', {}, String(value));
  const inc = el('button', { type: 'button', class: 'step-btn', 'aria-label': 'Increase ' + label }, '+');
  dec.disabled = value <= min;
  inc.disabled = value >= max;
  dec.addEventListener('click', () => onChange(clamp(value - 1, min, max)));
  inc.addEventListener('click', () => onChange(clamp(value + 1, min, max)));
  ctrl.appendChild(dec); ctrl.appendChild(out); ctrl.appendChild(inc);
  wrap.appendChild(ctrl);
  return wrap;
}

/* ---------- hand dialog (delegated to the game) ---------- */
const HAND_UI = { el: el, chip: chip, labeledStepper: labeledStepper };

function renderHandForm() {
  handBody.innerHTML = '';
  activeGame.hand.build(handBody, handDraft, state.players, HAND_UI, onHandChange);
}

function onHandChange() {
  renderHandForm();
  updateHandPreview();
}

function updateHandPreview() {
  const v = activeGame.hand.validate(handDraft, state.players);
  handSave.disabled = !v.valid;
  handPreview.textContent = v.message;
}

function openHandDialog(index) {
  if (index == null && state.players.length < 2) return;
  handEditIndex = index;
  handDraft = index != null
    ? activeGame.hand.draftFromRecord(state.hands[index])
    : activeGame.hand.newDraft(state.players);
  handTitle.textContent = index != null ? 'Edit hand ' + (index + 1) : 'Score hand';
  handDeleteBtn.hidden = index == null;
  renderHandForm();
  updateHandPreview();
  handDialog.returnValue = '';
  handDialog.showModal();
  const firstChip = handBody.querySelector('.chip');
  if (firstChip) firstChip.focus();
}

function saveHand() {
  const id = handEditIndex != null ? state.hands[handEditIndex].id : null;
  const record = activeGame.hand.toRecord(handDraft, state.players, id);
  if (handEditIndex != null) state.hands[handEditIndex] = record;
  else state.hands.push(record);
  save();
  const focusIdx = handEditIndex != null ? handEditIndex : state.hands.length - 1;
  renderGame();
  focusHandRow(focusIdx);
}

function deleteHand() {
  if (handEditIndex == null) return;
  state.hands.splice(handEditIndex, 1);
  save();
  renderGame();
  focusHandRow(Math.min(handEditIndex, state.hands.length - 1));
}

// Restore focus after a hand-row rebuild: to the affected row's edit button, or
// the Score hand button if no rows remain.
function focusHandRow(i) {
  if (i >= 0) {
    const btn = scoreBody.querySelector('tr[data-hand="' + i + '"] .hand-edit');
    if (btn) { btn.focus(); return; }
  }
  if (!headerScoreHandBtn.hidden) headerScoreHandBtn.focus();
}

/* ---------- wiring ---------- */
playersInc.addEventListener('click', () => {
  if (setupNames.length < activeGame.maxPlayers) {
    setupNames.push(cap(unitSingular(activeGame)) + ' ' + (setupNames.length + 1));
    renderNameList();
  }
});
playersDec.addEventListener('click', () => {
  if (setupNames.length > activeGame.minPlayers) {
    setupNames.pop();
    renderNameList();
  }
});
startBtn.addEventListener('click', startGame);
resumeBtn.addEventListener('click', resumeGame);
newFromSetupBtn.addEventListener('click', () => { confirmDialog.returnValue = ''; confirmDialog.showModal(); });

addBtn.addEventListener('click', openAddDialog);
playAgainBtn.addEventListener('click', playAgain);
headerScoreHandBtn.addEventListener('click', () => openHandDialog(null));
addSeed.addEventListener('input', () => { addSeed.value = onlyDigits(addSeed.value); validateSeed(); });
addCancel.addEventListener('click', () => addDialog.close('cancel'));
addDialog.addEventListener('close', () => {
  if (addDialog.returnValue === 'add') {
    const seed = parseInt(onlyDigits(addSeed.value), 10) || 0;
    if (activeGame.target != null && seed >= activeGame.target) return;
    addPlayer(addName.value, seed);
  }
});

menuBtn.addEventListener('click', () => { menuDialog.returnValue = ''; menuDialog.showModal(); });
menuClose.addEventListener('click', () => menuDialog.close('cancel'));
switchBtn.addEventListener('click', () => { menuDialog.close('cancel'); save(); showSetup(); });
newgameBtn.addEventListener('click', () => {
  menuDialog.close('cancel');
  confirmDialog.returnValue = '';
  confirmDialog.showModal();
});
confirmCancel.addEventListener('click', () => confirmDialog.close('cancel'));
confirmOk.addEventListener('click', () => confirmDialog.close('ok'));
confirmDialog.addEventListener('close', () => { if (confirmDialog.returnValue === 'ok') newGame(); });

handCancel.addEventListener('click', () => handDialog.close('cancel'));
handDeleteBtn.addEventListener('click', () => handDialog.close('delete'));
handDialog.addEventListener('close', () => {
  if (handDialog.returnValue === 'save') saveHand();
  else if (handDialog.returnValue === 'delete') deleteHand();
});

// Tapping the backdrop dismisses non-destructive dialogs (phones have no Esc key).
function closeOnBackdropTap(dialog) {
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return; // ignore clicks on the dialog's contents
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      dialog.close('cancel');
    }
  });
}
[addDialog, menuDialog, handDialog].forEach(closeOnBackdropTap);

/* ---------- keyboard-aware viewport ---------- */
// Track the visual viewport so the game screen and bottom-sheet dialogs shrink
// to the area above the on-screen keyboard instead of being hidden behind it
// (iOS shrinks only the visual viewport, not the layout one). Exposed as CSS
// custom properties so the layout stays declarative.
function syncViewport() {
  const vv = window.visualViewport;
  const appH = vv ? vv.height : window.innerHeight;
  const kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  const docEl = document.documentElement;
  docEl.style.setProperty('--app-height', appH + 'px');
  docEl.style.setProperty('--keyboard-height', kb + 'px');
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncViewport);
  window.visualViewport.addEventListener('scroll', syncViewport);
}
window.addEventListener('orientationchange', syncViewport);
syncViewport();

/* ---------- <dialog> fallback ---------- */
// Minimal modal-dialog fallback for browsers without showModal (iOS Safari
// < 15.4). Completely inert when native modal dialogs are supported, so it
// adds nothing on current browsers.
(function dialogFallback() {
  const proto = window.HTMLDialogElement && HTMLDialogElement.prototype;
  if (proto && typeof proto.showModal === 'function') return;
  document.documentElement.classList.add('no-dialog');
  let openCount = 0;
  function show() {
    if (this.hasAttribute('open')) return;
    this.setAttribute('open', '');
    openCount++;
    document.documentElement.classList.add('has-open-dialog');
  }
  function close(value) {
    if (!this.hasAttribute('open')) return;
    if (value !== undefined) this.returnValue = value;
    this.removeAttribute('open');
    openCount = Math.max(0, openCount - 1);
    if (openCount === 0) document.documentElement.classList.remove('has-open-dialog');
    this.dispatchEvent(new Event('close'));
  }
  Array.prototype.forEach.call(document.querySelectorAll('dialog'), (d) => {
    d.showModal = show;
    d.show = show;
    d.close = close;
    if (!('returnValue' in d) || typeof d.returnValue !== 'string') d.returnValue = '';
    // Re-create native form[method=dialog] submit semantics (set returnValue
    // from the activated button, then close).
    d.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!btn || !d.contains(btn)) return;
      const form = btn.form;
      if (form && form.getAttribute('method') === 'dialog' && (btn.type === 'submit' || !btn.type)) {
        e.preventDefault();
        d.close(btn.value || '');
      }
    });
  });
})();

/* ---------- init ---------- */
function init() {
  let lastId = null;
  try { lastId = localStorage.getItem(LAST_GAME_KEY); } catch (e) { /* storage unavailable */ }
  if (!lastId || !GAMES[lastId]) lastId = 'fivecrowns'; // first-run / migration default
  activeGame = GAMES[lastId] || GAMES.fivecrowns;
  if (hasStartedSave(activeGame)) {
    state = loadGame(activeGame);
    showGame();
  } else {
    state = defaultState(activeGame);
    setupNames = recalledNames(activeGame);
    showSetup();
  }
}

// Ask for persistent storage so saved games are less likely to be evicted under
// storage pressure. Best-effort and silent: installed apps are favoured to be
// granted it, and a refusal changes nothing (scores still live in localStorage).
if (navigator.storage && typeof navigator.storage.persist === 'function') {
  navigator.storage.persist().catch(() => {});
}

init();
