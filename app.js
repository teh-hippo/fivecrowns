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
const CARD_GLYPH = '\u{1F0A0}';

// Hidden round-reveal wheel: production defaults are also the starting values in
// the secret tuning screen.
const DEFAULT_REEL_OPTIONS = Object.freeze({
  spinMs: 7200,
  spinCycles: 7,
  idlePxps: 260,
  fakeOutChance: 0.15,
  fakeOutHoldMs: 300,
  fakeOutBurstMs: 850,
  effect: 'random',
  effectAmount: 44,
});
const REEL_STRIP_BASE_CYCLES = 14;      // full-set passes worth of rendered rows
const REEL_LAND_CYCLE = 2;              // which repeat the wheel rests on
const REEL_DECEL = 'cubic-bezier(0.16, 0.9, 0.22, 1)'; // smooth deceleration
const REEL_FAKEOUT_BURST_EASE = 'cubic-bezier(0.4, 0, 0.15, 1)';
const DEBUG_TAP_TARGET = 5;

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
function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Select the whole value when a field is activated so a tap overwrites the
// existing name. iOS Safari collapses a selection made during the focus event,
// so defer it to the next tick and re-apply on the pointer release that focused
// the field. Only the focusing tap selects; later taps can place the caret.
function selectAllOnEdit(input) {
  let armed = false;
  const run = () => setTimeout(() => {
    if (document.activeElement !== input) return;
    try { input.setSelectionRange(0, input.value.length); }
    catch (_) { try { input.select(); } catch (_) { /* unsupported input type */ } }
  }, 0);
  input.addEventListener('focus', () => { armed = true; run(); });
  input.addEventListener('pointerup', () => { if (armed) { armed = false; run(); } });
  input.addEventListener('blur', () => { armed = false; });
}

/* ---------- state ---------- */
let activeGame = null;
let state = null;
let setupNames = [];
let setupVariant = null;
let handEditIndex = null;
let handDraft = null;
let reelSpinning = false;
let reelAnimationUnavailable = false;
let fiveCrownsDebugTaps = 0;

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
// Stored per game as { last, memory }: `last` is the most recent roster (seeds the
// setup screen unchanged); `memory` is a positional union that never shrinks, so a
// name dropped when playing with fewer players can still be recalled when one is
// added back (e.g. 4 players -> down to 2 -> adding a 3rd recalls the old player 3).
function loadRosters() {
  try {
    const obj = JSON.parse(localStorage.getItem(NAMES_KEY));
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (e) { return {}; }
}

// Parse either storage shape: a bare array (old format) or { last, memory }.
function rosterFor(gameId) {
  const raw = loadRosters()[gameId];
  if (Array.isArray(raw)) return { last: raw.slice(), memory: raw.slice() };
  if (raw && typeof raw === 'object') {
    const last = Array.isArray(raw.last) ? raw.last.slice() : [];
    const memory = Array.isArray(raw.memory) ? raw.memory.slice() : last.slice();
    return { last, memory };
  }
  return { last: [], memory: [] };
}

function rememberNames(game, names) {
  const all = loadRosters();
  // Update each used position but keep any higher-index names from a larger past
  // roster, so dropping players never erases names we might still want to recall.
  const memory = rosterFor(game.id).memory;
  names.forEach((nm, i) => { memory[i] = nm; });
  all[game.id] = { last: names.slice(), memory };
  localStorage.setItem(NAMES_KEY, JSON.stringify(all));
}

function recalledNames(game) {
  const names = rosterFor(game.id).last;
  if (names.every((n) => typeof n === 'string')
    && names.length >= game.minPlayers
    && names.length <= game.maxPlayers) {
    return names.slice();
  }
  return game.defaultNames();
}

// True for auto-generated names like "Player 3" / "Side 2", which we never suggest.
function isDefaultName(nm) { return /^(player|side)\s+\d+$/i.test((nm || '').trim()); }

// The next remembered name to offer when adding a player: the first name in the
// per-game memory that is real (not a default) and not already in use, falling back
// to the generated "Player N" / "Side N" once remembered names run out.
function nextRecalledName(currentNames) {
  const used = new Set(currentNames.map((n) => (n || '').trim().toLowerCase()));
  for (const nm of rosterFor(activeGame.id).memory) {
    if (typeof nm !== 'string') continue;
    const t = nm.trim();
    if (t === '' || isDefaultName(t) || used.has(t.toLowerCase())) continue;
    return nm;
  }
  return cap(unitSingular(activeGame)) + ' ' + (currentNames.length + 1);
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

function usesRoundReveal() {
  return !!(activeGame && state && Array.isArray(activeGame.revealVariants)
    && activeGame.revealVariants.indexOf(state.variant) !== -1);
}

function revealNoun() {
  return activeGame && typeof activeGame.revealNoun === 'function'
    ? activeGame.revealNoun(state)
    : 'round';
}

/* ---------- DOM refs ---------- */
const setupScreen = document.getElementById('setup-screen');
const gameScreen = document.getElementById('game-screen');
const debugScreen = document.getElementById('debug-screen');
const picker = document.getElementById('game-picker');
const setupFresh = document.getElementById('setup-fresh');
const variantControl = document.getElementById('variant-control');
const variantLegend = document.getElementById('variant-legend');
const variantOptions = document.getElementById('variant-options');
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

const debugBack = document.getElementById('debug-back');
const debugSpinBtn = document.getElementById('debug-spin');
const debugReset = document.getElementById('debug-reset');
const debugStatus = document.getElementById('debug-status');
const debugSpinMs = document.getElementById('debug-spin-ms');
const debugSpinMsValue = document.getElementById('debug-spin-ms-value');
const debugSpinCycles = document.getElementById('debug-spin-cycles');
const debugSpinCyclesValue = document.getElementById('debug-spin-cycles-value');
const debugIdleSpeed = document.getElementById('debug-idle-speed');
const debugIdleSpeedValue = document.getElementById('debug-idle-speed-value');
const debugFakeOutChance = document.getElementById('debug-fakeout-chance');
const debugFakeOutChanceValue = document.getElementById('debug-fakeout-chance-value');
const debugFakeOutHold = document.getElementById('debug-fakeout-hold');
const debugFakeOutHoldValue = document.getElementById('debug-fakeout-hold-value');
const debugFakeOutBurst = document.getElementById('debug-fakeout-burst');
const debugFakeOutBurstValue = document.getElementById('debug-fakeout-burst-value');
const debugEffect = document.getElementById('debug-effect');
const debugEffectAmount = document.getElementById('debug-effect-amount');
const debugEffectAmountValue = document.getElementById('debug-effect-amount-value');

const gameName = document.getElementById('game-name');
const headerScoreHandBtn = document.getElementById('score-hand-btn');
const playAgainBtn = document.getElementById('play-again-btn');
const addBtn = document.getElementById('add-btn');
const menuBtn = document.getElementById('menu-btn');
const caption = document.getElementById('table-caption');
const scoreTable = document.getElementById('score-table');
const headRow = document.getElementById('head-row');
const scoreBody = document.getElementById('score-body');
const totalRow = document.getElementById('total-row');
const winnerBanner = document.getElementById('winner-banner');
const scoreForm = document.getElementById('score-form');

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

const reelOverlay = document.getElementById('reel-overlay');
const reelStrip = document.getElementById('reel-strip');
const reelTitle = document.getElementById('reel-title');
const reelAction = document.getElementById('reel-action');
const reelEffects = document.getElementById('reel-effects');
const revealWildBtn = document.getElementById('reveal-wild-btn');

/* ---------- screen switching ---------- */
function showSetup() {
  fiveCrownsDebugTaps = 0;
  setupScreen.hidden = false;
  gameScreen.hidden = true;
  debugScreen.hidden = true;
  window.scrollTo(0, 0);
  renderPicker();
  refreshSetupView();
}

function showGame() {
  setupScreen.hidden = true;
  gameScreen.hidden = false;
  debugScreen.hidden = true;
  gameName.textContent = activeGame.name;
  renderGame();
}

function showDebug() {
  setupScreen.hidden = true;
  gameScreen.hidden = true;
  debugScreen.hidden = false;
  window.scrollTo(0, 0);
  updateDebugControlOutputs();
  debugStatus.textContent = 'Ready.';
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
    const name = el('span', { class: 'pick-name' }, g.name);
    name.addEventListener('click', (e) => {
      if (id !== 'fivecrowns') {
        fiveCrownsDebugTaps = 0;
        return;
      }
      fiveCrownsDebugTaps++;
      if (fiveCrownsDebugTaps < DEBUG_TAP_TARGET) return;
      fiveCrownsDebugTaps = 0;
      e.preventDefault();
      showDebug();
    });
    label.appendChild(input);
    label.appendChild(name);
    picker.appendChild(label);
  });
}

function selectGame(id) {
  activeGame = GAMES[id];
  refreshSetupView();
}

// Segmented per-game options (e.g. Five Crowns' wild order). Reuses the game
// picker's radio-group markup; hidden entirely for games without variants.
function renderVariantControl() {
  const spec = activeGame.variants;
  variantControl.hidden = !spec;
  variantOptions.innerHTML = '';
  if (!spec) return;
  variantLegend.textContent = spec.label;
  spec.options.forEach((opt) => {
    const label = el('label', { class: 'pick' });
    const input = el('input', { type: 'radio', name: 'variant', value: opt.value });
    if (opt.value === setupVariant) input.checked = true;
    input.addEventListener('change', () => { if (input.checked) setupVariant = opt.value; });
    label.appendChild(input);
    const name = el('span', { class: 'pick-name' }, opt.label);
    if (opt.hint) name.appendChild(el('span', { class: 'pick-hint' }, opt.hint));
    label.appendChild(name);
    variantOptions.appendChild(label);
  });
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
    setupVariant = activeGame.variants ? activeGame.variants.default : null;
    renderVariantControl();
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
    selectAllOnEdit(input);
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
  // Cell-entry games type into cells, so every column must stay strict (a growing
  // score must not reflow the grid); hand games let the first column grow for the
  // summary. The width rules keyed off this live in styles.css.
  scoreTable.dataset.entry = activeGame.entry;
  renderHeaderActions(status);
  buildHead();
  buildBody(status);
  buildFoot();
  updateTotalsAndBanner(totals, status);
  maybeAutoReveal();
}

function renderHeaderActions(st) {
  const inProgress = st.phase === 'inProgress';
  const ended = st.phase === 'complete' || st.phase === 'out';
  addBtn.textContent = '+ ' + cap(unitSingular(activeGame));
  addBtn.hidden = !inProgress;
  headerScoreHandBtn.hidden = !(activeGame.entry === 'hand' && inProgress);
  playAgainBtn.hidden = !ended;
  updateRevealButton();
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
      if (activeGame.entry === 'hand') refreshHandLabels();
      else refreshScoreLabels(p.id);
      updateTotalsAndBanner();
    });
    // Blank names fall back to a default like setup does, rather than persisting an
    // empty header until the next reload. Done on blur so mid-edit emptying is fine.
    input.addEventListener('blur', () => {
      if (input.value.trim() !== '') return;
      p.name = cap(unitSingular(activeGame)) + ' ' + (i + 1);
      input.value = p.name;
      save();
      if (activeGame.entry === 'hand') refreshHandLabels();
      else refreshScoreLabels(p.id);
      updateTotalsAndBanner();
    });
    th.appendChild(input);
    headRow.appendChild(th);
  });
}

// Keep the focused score cell clear of the sticky header/footer and, when the
// on-screen keyboard is open, above it. The maths lives in .table-wrap's
// scroll-padding (which reserves --keyboard-height at the bottom); this just asks
// the browser to re-run its own scroll on focus and on a keyboard-driven resize.
function revealScoreInput(input) {
  input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/* ---------- score-entry advance ----------
   Touch keypads (iOS in particular) have no Return/Next key, so entering a
   round needs help. advanceFrom() moves to the next still-empty cell in the same
   round (skipping ones already scored) and blurs once none are left. A hardware
   Return/Enter key drives it on desktop and Android. On iOS the keyboard's own
   Previous/Next bar (enabled by wrapping the grid in #score-form) also steps
   between cells, but in linear DOM order: it flows on into the next round,
   bypassing advanceFrom(). */

function scoreCellsInRow(input) {
  const tr = input.closest('tr');
  return tr ? Array.from(tr.querySelectorAll('.score-input')) : [input];
}

// Column the next step lands on: the next still-empty cell in the round, scanning
// cyclically from the one after `input` so already-scored cells are skipped. null
// when no other cell is empty, which is what surfaces "Done" - regardless of which
// player's column we are on.
function nextScoreCol(input) {
  const cells = scoreCellsInRow(input);
  const cur = cells.indexOf(input);
  for (let i = 1; i < cells.length; i++) {
    const j = (cur + i) % cells.length;
    if (cells[j].value === '') return j;
  }
  return null;
}

function advanceFrom(input) {
  const target = nextScoreCol(input);
  if (target == null) { input.blur(); return; }
  scoreCellsInRow(input)[target].focus();
}

function scoreCellLabel(name, label) {
  // Hidden details are not spoken, so screen readers do not spoil the reveal.
  const details = [];
  if (label.cards && !label.cardsMasked && !label.cardsReady) details.push(label.cards);
  if (label.sub && !label.masked && !label.ready) details.push(label.sub + ' wild');
  return name + ', round ' + label.num + (details.length ? ', ' + details.join(', ') : '') + ' score';
}

// Keep score-cell aria-labels in sync when a player is renamed (cell games).
function refreshScoreLabels(pid) {
  const p = playerById(pid);
  if (!p) return;
  scoreBody.querySelectorAll('.score-input[data-pid="' + pid + '"]').forEach((input) => {
    const r = Number(input.getAttribute('data-round'));
    input.setAttribute('aria-label', scoreCellLabel(p.name, activeGame.roundLabel(r, state)));
  });
}

// Keep 500's hand-row summaries and their aria-labels in sync when a side is
// renamed (hand games have no .score-input for refreshScoreLabels to update).
function refreshHandLabels() {
  if (activeGame.entry !== 'hand') return;
  const hands = state.hands || [];
  scoreBody.querySelectorAll('tr[data-hand]').forEach((tr) => {
    const i = Number(tr.getAttribute('data-hand'));
    const hand = hands[i];
    if (!hand) return;
    const summary = activeGame.handSummary(hand, state.players);
    const btn = tr.querySelector('.hand-edit');
    if (!btn) return;
    btn.setAttribute('aria-label', 'Edit hand ' + (i + 1) + ', ' + summary);
    const wild = btn.querySelector('.wild');
    if (wild) wild.textContent = summary;
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

// Set a round header's details and ready-to-spin affordance from roundLabel.
// Reused on build and on every in-place refresh.
function applyRoundHeader(th, label) {
  let cards = th.querySelector('.cards');
  if (label.cards) {
    if (!cards) {
      cards = el('span', { class: 'cards' });
      const num = th.querySelector('.round-num');
      if (num) num.insertAdjacentElement('afterend', cards);
      else th.appendChild(cards);
    }
    cards.textContent = label.cards.replace(/ cards$/, ' ' + CARD_GLYPH);
    cards.setAttribute('aria-label', label.cards);
    cards.classList.toggle('cards-masked', !!label.cardsMasked);
    cards.classList.toggle('cards-ready', !!label.cardsReady);
  } else if (cards) {
    cards.remove();
  }

  let wild = th.querySelector('.wild');
  if (label.sub) {
    if (!wild) { wild = el('span', { class: 'wild' }); th.appendChild(wild); }
    wild.textContent = label.sub;
    wild.classList.toggle('wild-masked', !!label.masked);
    wild.classList.toggle('wild-ready', !!label.ready);
  } else if (wild) {
    wild.remove();
  }
  const ready = !!label.ready;
  th.classList.toggle('round-ready', ready);
  if (ready) {
    th.dataset.ready = '1';
    th.setAttribute('role', 'button');
    th.setAttribute('tabindex', '0');
    th.setAttribute('aria-label', 'Reveal the ' + revealNoun() + ' for round ' + label.num);
  } else {
    delete th.dataset.ready;
    th.removeAttribute('role');
    th.removeAttribute('tabindex');
    th.removeAttribute('aria-label');
  }
}

// Apply a round's state to its whole row: header affordance plus cell locking.
// A round's score cells stay disabled until the round has been revealed.
function applyRoundRow(tr, r) {
  const label = activeGame.roundLabel(r, state);
  const th = tr.querySelector('.round-col');
  if (th) applyRoundHeader(th, label);
  const lock = !!label.masked || !!label.ready;
  tr.querySelectorAll('.score-input').forEach((inp) => {
    inp.disabled = lock;
    const p = playerById(inp.getAttribute('data-pid'));
    if (p) inp.setAttribute('aria-label', scoreCellLabel(p.name, label));
  });
}

function buildCellRow(r) {
  const tr = el('tr', { 'data-round': String(r) });
  const rh = el('th', { class: 'round-col', scope: 'row' });
  rh.appendChild(el('span', { class: 'round-num' }, activeGame.roundLabel(r, state).num));
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
    input.addEventListener('focus', () => revealScoreInput(input));
    // A hardware Return/Enter key advances to the next empty cell in the round.
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      advanceFrom(input);
    });
    // Tapping a cell that already holds a score selects it for easy overwrite.
    selectAllOnEdit(input);
    td.appendChild(input);
    tr.appendChild(td);
  });
  applyRoundRow(tr, r);
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
  refreshRevealRows();
}

// Refresh hidden round headers and cell-locking in place as rounds complete or
// are revealed. This touches headers and input.disabled only, never the values.
function refreshRevealRows() {
  if (!usesRoundReveal()) return;
  Array.prototype.forEach.call(scoreBody.children, (tr) => {
    const r = Number(tr.getAttribute('data-round'));
    if (!Number.isNaN(r)) applyRoundRow(tr, r);
  });
  updateRevealButton();
}

/* ---------- Hidden round-reveal wheel ---------- */
function shuffleArr(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

function reduceMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// Commit a reveal: mark the round opened, persist, and refresh the grid so its
// details show, its cells unlock and the next round can start glowing.
function commitReveal(r) {
  const opened = Math.max(0, Math.floor(state.revealedCount || 0));
  state.revealedCount = Math.max(opened, r + 1);
  save();
  refreshRevealRows();
}

// Open the wheel for round r if it is the ready (next, unlocked) hidden round.
function openRoundReveal(r) {
  if (reelSpinning) return;
  if (!usesRoundReveal()) return;
  const label = activeGame.roundLabel(r, state);
  if (!label.ready) return;
  const items = typeof activeGame.revealItems === 'function' ? activeGame.revealItems(state) : [];
  const target = items[r];
  if (!target || typeof target.label !== 'string') return;
  if (reduceMotion() || !hasAnimationMethod(reelStrip) || reelAnimationUnavailable) {
    commitReveal(r);
    return;
  }
  const shown = showReel(items.slice(r).map((item) => item.label), target.label, target.result, r, items.length);
  if (!shown) commitReveal(r);
}

// The round whose wheel can currently be opened, or -1. Drives the header button.
function readyRoundIndex() {
  if (!usesRoundReveal()) return -1;
  const count = activeGame.rounds.kind === 'fixed' ? activeGame.rounds.count : 0;
  const r = Math.max(0, Math.min(count, Math.floor(state.revealedCount || 0)));
  if (r >= count) return -1;
  return activeGame.roundLabel(r, state).ready ? r : -1;
}

function updateRevealButton() {
  const rr = readyRoundIndex();
  const available = rr >= 0 && !reelSpinning && !gameScreen.hidden;
  revealWildBtn.textContent = 'Reveal ' + revealNoun();
  revealWildBtn.hidden = !usesRoundReveal();
  revealWildBtn.disabled = !available;
  revealWildBtn.classList.toggle('reveal-unavailable', !available);
}

function currentTranslateY() {
  const t = getComputedStyle(reelStrip).transform;
  if (!t || t === 'none') return 0;
  try { return new DOMMatrixReadOnly(t).m42; } catch (_) { return 0; }
}

function animationObject(animation) {
  return animation != null && (typeof animation === 'object' || typeof animation === 'function');
}

function hasAnimationMethod(node) {
  try { return !!node && typeof node.animate === 'function'; } catch (_) { return false; }
}

function createAnimation(node, keyframes, options) {
  let animate;
  try { animate = node && node.animate; } catch (_) { return null; }
  if (typeof animate !== 'function') return null;
  try { return animate.call(node, keyframes, options); } catch (_) { return null; }
}

function usableAnimation(animation) {
  if (!animationObject(animation)) return false;
  try {
    return typeof animation.cancel === 'function'
      && typeof animation.play === 'function'
      && 'onfinish' in animation;
  } catch (_) {
    return false;
  }
}

function setAnimationHandler(animation, name, handler) {
  if (!animationObject(animation)) return false;
  try {
    if (!(name in animation)) return false;
    animation[name] = handler;
    return animation[name] === handler;
  } catch (_) {
    return false;
  }
}

function clearAnimationHandler(animation, name) {
  if (!animationObject(animation)) return;
  try {
    if (name in animation) animation[name] = null;
  } catch (_) { /* broken animation event handler */ }
}

function neutralizeAnimation(animation) {
  if (!animationObject(animation)) return false;
  try {
    if (typeof animation.pause === 'function') animation.pause();
  } catch (_) { /* continue detaching the effect */ }
  try {
    if (!('effect' in animation)) return false;
    animation.effect = null;
    return animation.effect == null;
  } catch (_) {
    return false;
  }
}

function cancelAnimationResult(animation) {
  if (animation == null) return { stopped: true, capabilityFailed: false };
  clearAnimationHandler(animation, 'onfinish');
  clearAnimationHandler(animation, 'oncancel');
  let cancel;
  try {
    cancel = animation.cancel;
  } catch (_) {
    return { stopped: neutralizeAnimation(animation), capabilityFailed: true };
  }
  if (typeof cancel !== 'function') {
    return { stopped: neutralizeAnimation(animation), capabilityFailed: true };
  }
  try {
    cancel.call(animation);
    return { stopped: true, capabilityFailed: false };
  } catch (_) {
    return { stopped: neutralizeAnimation(animation), capabilityFailed: true };
  }
}

function cancelAnimation(animation) {
  return cancelAnimationResult(animation).stopped;
}

function cancelElementAnimations(node) {
  let getAnimations;
  try {
    getAnimations = node && node.getAnimations;
  } catch (_) {
    return { stopped: false, capabilityFailed: true };
  }
  if (typeof getAnimations !== 'function') return { stopped: true, capabilityFailed: false };
  let animations;
  try {
    animations = Array.from(getAnimations.call(node));
  } catch (_) {
    return { stopped: false, capabilityFailed: true };
  }
  let stopped = true;
  let capabilityFailed = false;
  animations.forEach((animation) => {
    const result = cancelAnimationResult(animation);
    if (!result.stopped) stopped = false;
    if (result.capabilityFailed) capabilityFailed = true;
  });
  return { stopped, capabilityFailed };
}

function setReelTranslate(y, forceStatic) {
  reelStrip.style.setProperty('transform', 'translateY(' + y + 'px)', forceStatic ? 'important' : '');
}

function rejectReelAnimation(animation) {
  cancelAnimation(animation);
  cancelElementAnimations(reelStrip);
  reelAnimationUnavailable = true;
}

function startReelAnimation(keyframes, options) {
  if (reelAnimationUnavailable) return null;
  const animation = createAnimation(reelStrip, keyframes, options);
  if (!usableAnimation(animation)) {
    rejectReelAnimation(animation);
    return null;
  }
  return animation;
}

function stopReelAnimation(animation) {
  if (animation == null) return true;
  const result = cancelAnimationResult(animation);
  if (result.capabilityFailed) reelAnimationUnavailable = true;
  if (result.stopped) return true;
  const remaining = cancelElementAnimations(reelStrip);
  if (remaining.capabilityFailed) reelAnimationUnavailable = true;
  return remaining.stopped;
}

// Build the reel: one shuffled pass of the remaining choices, repeated enough to
// keep the rendered rows and spin travel near their full-set sizes. The target is
// NOT highlighted here (only once it stops). The strip scrolls downward (numbers
// descend), resting at `landY` after travelling up from the deeper `idleBase`.
function buildReelStrip(remaining, target, fullSetSize, spinCycles) {
  reelStrip.innerHTML = '';
  const reel = shuffleArr(remaining);
  const len = reel.length;
  const fullLen = Math.max(len, Math.floor(fullSetSize) || len);
  const travelCycles = Math.ceil(spinCycles * fullLen / len);
  const stripCycles = Math.max(
    Math.ceil(REEL_STRIP_BASE_CYCLES * fullLen / len),
    travelCycles + REEL_LAND_CYCLE + 2,
  );
  const tIdx = reel.indexOf(target);
  const landIdx = tIdx + REEL_LAND_CYCLE * len; // the resting occurrence of the target
  for (let c = 0; c < stripCycles; c++) {
    reel.forEach((w) => reelStrip.appendChild(el('div', { class: 'reel-item' }, w)));
  }
  const h = reelStrip.children[0] ? reelStrip.children[0].getBoundingClientRect().height : 0;
  const cycleH = len * h;
  const landY = -(landIdx - 1) * h;                 // centres the target in the window
  const idleBase = landY - travelCycles * cycleH;   // deeper start for a downward spin
  let fakeOutRows = fullLen + 1;
  if (fakeOutRows % len === 0) fakeOutRows += 1;     // the decoy must not repeat the target
  const fakeOutY = landY - fakeOutRows * h;
  return { itemH: h, cycleH, landY, idleBase, landIdx, fakeOutY };
}

const LANDING_EFFECTS = ['confetti', 'explosion', 'lasers'];
const EFFECT_COLORS = ['#a78bfa', '#e3c14e', '#5fe39a', '#ff6b5e', '#ececf3'];
const EXPLOSION_COLORS = ['#fff3a3', '#ffd166', '#ff8c42', '#ff4d3d'];
const LASER_COLORS = ['#71f6ff', '#ff5cf4', '#a78bfa'];
const EFFECT_NODE_LIMIT = 140;

// Choose only when the reel enters confirm. This visual choice is uniform,
// session-only and completely separate from persisted card/wild order.
function chooseLandingEffect() {
  return LANDING_EFFECTS[Math.floor(Math.random() * LANDING_EFFECTS.length)];
}

function resolveLandingEffect(type) {
  if (type === 'none') return null;
  return LANDING_EFFECTS.indexOf(type) !== -1 ? type : chooseLandingEffect();
}

function effectBounds() {
  const rect = reelEffects.getBoundingClientRect();
  const windowRect = reelStrip.parentElement.getBoundingClientRect();
  return {
    width: rect.width || window.innerWidth,
    height: rect.height || window.innerHeight,
    cx: windowRect.width ? windowRect.left - rect.left + windowRect.width / 2 : (rect.width || window.innerWidth) / 2,
    cy: windowRect.height ? windowRect.top - rect.top + windowRect.height / 2 : (rect.height || window.innerHeight) * 0.4,
  };
}

function emitConfetti(animateNode, amount) {
  const bounds = effectBounds();
  const cx = bounds.cx;
  const cy = bounds.cy;
  let started = false;
  for (let i = 0; i < amount; i++) {
    const bit = el('div', { class: 'confetti-bit' });
    bit.style.background = EFFECT_COLORS[i % EFFECT_COLORS.length];
    const ang = Math.random() * Math.PI * 2;
    const dist = 80 + Math.random() * Math.min(240, bounds.width * 0.55);
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist - 40;
    const rot = Math.random() * 900 - 450;
    if (animateNode(bit, [
      { transform: 'translate3d(' + cx + 'px,' + cy + 'px,0) rotate(0deg)', opacity: 1 },
      { transform: 'translate3d(' + (cx + dx) + 'px,' + (cy + dy) + 'px,0) rotate(' + (rot * 0.6) + 'deg)', opacity: 1, offset: 0.6 },
      { transform: 'translate3d(' + (cx + dx) + 'px,' + (cy + dy + 280) + 'px,0) rotate(' + rot + 'deg)', opacity: 0 },
    ], { duration: 1400 + Math.random() * 700, easing: 'cubic-bezier(0.2,0.7,0.3,1)', fill: 'forwards' })) started = true;
  }
  return started;
}

function emitExplosion(animateNode, amount) {
  const bounds = effectBounds();
  const cx = bounds.cx;
  const cy = bounds.cy;
  const centre = 'translate3d(' + cx + 'px,' + cy + 'px,0) translate(-50%,-50%)';
  let started = false;
  const core = el('div', { class: 'explosion-core' });
  if (animateNode(core, [
    { transform: centre + ' scale(0.15)', opacity: 0 },
    { transform: centre + ' scale(2.2)', opacity: 1, offset: 0.28 },
    { transform: centre + ' scale(4.8)', opacity: 0 },
  ], { duration: 820, easing: 'cubic-bezier(0.15,0.7,0.2,1)', fill: 'forwards' })) started = true;

  for (let i = 0; i < 3; i++) {
    const ring = el('div', { class: 'explosion-ring' });
    ring.style.borderColor = EXPLOSION_COLORS[i + 1];
    if (animateNode(ring, [
      { transform: centre + ' scale(0.2)', opacity: 0.95 },
      { transform: centre + ' scale(' + (7 + i * 2) + ')', opacity: 0 },
    ], { duration: 850 + i * 180, delay: i * 90, easing: 'cubic-bezier(0.12,0.72,0.25,1)', fill: 'forwards' })) started = true;
  }

  const sparkCount = Math.max(6, Math.round(amount * 30 / DEFAULT_REEL_OPTIONS.effectAmount));
  for (let i = 0; i < sparkCount; i++) {
    const spark = el('div', { class: 'explosion-spark' });
    const color = EXPLOSION_COLORS[i % EXPLOSION_COLORS.length];
    spark.style.background = color;
    spark.style.boxShadow = '0 0 8px ' + color;
    const ang = (Math.PI * 2 * i / sparkCount) + (Math.random() - 0.5) * 0.24;
    const dist = 90 + Math.random() * Math.min(230, bounds.width * 0.5);
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist;
    if (animateNode(spark, [
      { transform: 'translate3d(' + cx + 'px,' + cy + 'px,0) scale(1.4)', opacity: 1 },
      { transform: 'translate3d(' + (cx + dx) + 'px,' + (cy + dy) + 'px,0) scale(0.9)', opacity: 1, offset: 0.65 },
      { transform: 'translate3d(' + (cx + dx) + 'px,' + (cy + dy + 75) + 'px,0) scale(0.2)', opacity: 0 },
    ], { duration: 800 + Math.random() * 450, delay: Math.random() * 90, easing: 'cubic-bezier(0.18,0.75,0.25,1)', fill: 'forwards' })) started = true;
  }
  return started;
}

function emitLasers(animateNode, amount) {
  const bounds = effectBounds();
  const length = Math.hypot(bounds.width, bounds.height) * 1.25;
  const cx = bounds.cx;
  const cy = bounds.cy;
  const beamCount = Math.max(1, Math.round(amount * 5 / DEFAULT_REEL_OPTIONS.effectAmount));
  const middle = (beamCount - 1) / 2;
  let started = false;
  for (let i = 0; i < beamCount; i++) {
    const beam = el('div', { class: 'laser-beam' });
    const color = LASER_COLORS[i % LASER_COLORS.length];
    const angle = -58 + Math.random() * 116;
    const sweep = (i % 2 ? -1 : 1) * (18 + Math.random() * 12);
    const offset = (i - middle) * Math.min(34, bounds.height * 0.04);
    const x = cx - length / 2;
    const y = cy + offset;
    beam.style.width = length + 'px';
    beam.style.background = color;
    beam.style.boxShadow = '0 0 6px ' + color + ', 0 0 18px ' + color;
    if (animateNode(beam, [
      { transform: 'translate3d(' + x + 'px,' + (y - 18) + 'px,0) rotate(' + (angle - sweep) + 'deg)', opacity: 0 },
      { opacity: 0.92, offset: 0.14 },
      { transform: 'translate3d(' + x + 'px,' + (y + 18) + 'px,0) rotate(' + (angle + sweep) + 'deg)', opacity: 0.92, offset: 0.86 },
      { transform: 'translate3d(' + x + 'px,' + (y + 24) + 'px,0) rotate(' + (angle + sweep * 1.15) + 'deg)', opacity: 0 },
    ], { duration: 1300 + Math.random() * 250, delay: i * 130, easing: 'ease-in-out', fill: 'forwards' })) started = true;
  }
  return started;
}

const landingEffectController = (() => {
  let cleanup = null;

  function stop() {
    const current = cleanup;
    cleanup = null;
    try {
      if (current) current();
    } catch (_) {
      // Effect cleanup is best-effort and must never block Confirm or persistence.
    } finally {
      reelEffects.textContent = '';
      delete reelEffects.dataset.effect;
    }
  }

  function start(type, amount) {
    stop();
    if (!type || reduceMotion() || !hasAnimationMethod(reelEffects)) return;
    const effectAmount = clamp(
      Math.round(numberOr(amount, DEFAULT_REEL_OPTIONS.effectAmount)),
      1,
      120,
    );
    const animations = new Set();
    let repeatTimer = null;
    let stopped = false;

    const animateNode = (node, keyframes, options) => {
      if (reelEffects.childElementCount >= EFFECT_NODE_LIMIT || !hasAnimationMethod(node)) {
        node.remove();
        return false;
      }
      reelEffects.appendChild(node);
      const animation = createAnimation(node, keyframes, options);
      if (!usableAnimation(animation)) {
        cancelAnimation(animation);
        node.remove();
        return false;
      }
      const discard = () => {
        animations.delete(animation);
        node.remove();
      };
      if (!setAnimationHandler(animation, 'onfinish', discard)
        || !setAnimationHandler(animation, 'oncancel', discard)) {
        cancelAnimation(animation);
        node.remove();
        return false;
      }
      animations.add(animation);
      return true;
    };

    const emit = type === 'explosion' ? emitExplosion : type === 'lasers' ? emitLasers : emitConfetti;
    const interval = type === 'explosion' ? 950 : type === 'lasers' ? 1050 : 1000;
    const repeat = () => {
      if (stopped) return;
      if (!emit(animateNode, effectAmount)) {
        stop();
        return;
      }
      repeatTimer = setTimeout(repeat, interval);
    };

    reelEffects.dataset.effect = type;
    cleanup = () => {
      stopped = true;
      if (repeatTimer != null) {
        clearTimeout(repeatTimer);
        repeatTimer = null;
      }
      Array.from(animations).forEach((animation) => {
        cancelAnimation(animation);
      });
      animations.clear();
    };
    repeat();
  }

  return { start, stop };
})();

// Show the wheel: it idles with a quick downward loop until tapped (Spin), then a
// long decelerating spin lands on the target, which is highlighted with one
// repeating landing effect only once it stops. Confirm commits and clears it.
function showReel(remaining, target, resultText, r, fullSetSize, options) {
  const supplied = options || {};
  const settings = {
    spinMs: clamp(numberOr(supplied.spinMs, DEFAULT_REEL_OPTIONS.spinMs), 100, 30000),
    spinCycles: clamp(Math.round(numberOr(supplied.spinCycles, DEFAULT_REEL_OPTIONS.spinCycles)), 1, 30),
    idlePxps: clamp(numberOr(supplied.idlePxps, DEFAULT_REEL_OPTIONS.idlePxps), 20, 2000),
    fakeOutChance: clamp(numberOr(supplied.fakeOutChance, DEFAULT_REEL_OPTIONS.fakeOutChance), 0, 1),
    fakeOutHoldMs: clamp(numberOr(supplied.fakeOutHoldMs, DEFAULT_REEL_OPTIONS.fakeOutHoldMs), 0, 5000),
    fakeOutBurstMs: clamp(numberOr(supplied.fakeOutBurstMs, DEFAULT_REEL_OPTIONS.fakeOutBurstMs), 50, 10000),
    effect: supplied.effect || DEFAULT_REEL_OPTIONS.effect,
    effectAmount: clamp(
      Math.round(numberOr(supplied.effectAmount, DEFAULT_REEL_OPTIONS.effectAmount)),
      1,
      120,
    ),
    title: supplied.title || 'Round ' + (r + 1),
  };
  landingEffectController.stop();
  if (reelAnimationUnavailable) return false;
  const initialCleanup = cancelElementAnimations(reelStrip);
  if (!initialCleanup.stopped || initialCleanup.capabilityFailed) {
    reelAnimationUnavailable = true;
    return false;
  }
  reelSpinning = true;
  updateRevealButton();
  reelTitle.textContent = settings.title;
  reelAction.textContent = 'Spin';
  reelOverlay.hidden = false;
  const geo = buildReelStrip(remaining, target, fullSetSize, settings.spinCycles);
  // On occasional spins, decelerate onto an unmarked display-strip decoy, pause,
  // then continue through roughly a full-set pass to the real target. This never
  // changes the persisted target/order or identifies a later round's result.
  const fakeOut = remaining.length > 1 && geo.cycleH > 0 && Math.random() < settings.fakeOutChance;
  const decoyY = geo.fakeOutY;
  const selectedMs = settings.spinMs
    + (fakeOut ? settings.fakeOutHoldMs + settings.fakeOutBurstMs : 0);

  let phase = 'idle';
  let idle = null;
  let sel = null;
  let fakeOutTimer = null;
  let safetyTimer = null;

  const clearReelTimers = () => {
    if (fakeOutTimer != null) {
      clearTimeout(fakeOutTimer);
      fakeOutTimer = null;
    }
    if (safetyTimer != null) {
      clearTimeout(safetyTimer);
      safetyTimer = null;
    }
  };

  const land = () => {
    if (phase === 'confirm' || phase === 'closed') return;
    phase = 'confirm';
    clearReelTimers();
    const idleAnimation = idle;
    const selectionAnimation = sel;
    idle = null;
    sel = null;
    stopReelAnimation(idleAnimation);
    stopReelAnimation(selectionAnimation);
    setReelTranslate(geo.landY, true);
    const winner = reelStrip.children[geo.landIdx];
    if (winner) winner.classList.add('reel-target');
    reelTitle.textContent = winner ? (resultText || winner.textContent) : settings.title;
    reelAction.textContent = 'Confirm';
    const effect = resolveLandingEffect(settings.effect);
    landingEffectController.start(effect, settings.effectAmount);
    if (typeof supplied.onLand === 'function') supplied.onLand(effect, fakeOut);
  };

  const confirm = () => {
    if (phase === 'closed') return;
    phase = 'closed';
    reelOverlay.removeEventListener('click', onTap);
    clearReelTimers();
    const idleAnimation = idle;
    const selectionAnimation = sel;
    idle = null;
    sel = null;
    stopReelAnimation(idleAnimation);
    stopReelAnimation(selectionAnimation);
    landingEffectController.stop();
    if (typeof supplied.onConfirm === 'function') supplied.onConfirm();
    else commitReveal(r);     // reveal behind the overlay, then drop it
    reelOverlay.hidden = true;
    reelSpinning = false;
    updateRevealButton();
    if (typeof supplied.onClose === 'function') supplied.onClose();
  };

  const startSelection = (fromY, toY, duration, easing, onfinish) => {
    const animation = startReelAnimation(
      [{ transform: 'translateY(' + fromY + 'px)' }, { transform: 'translateY(' + toY + 'px)' }],
      { duration, easing, fill: 'forwards' },
    );
    if (!animation) {
      land();
      return false;
    }
    sel = animation;
    if (!setAnimationHandler(animation, 'onfinish', onfinish)) {
      sel = null;
      reelAnimationUnavailable = true;
      stopReelAnimation(animation);
      land();
      return false;
    }
    return true;
  };

  const finishFakeOut = () => {
    if (phase !== 'spin') return;
    const selectionAnimation = sel;
    sel = null;
    if (!stopReelAnimation(selectionAnimation) || reelAnimationUnavailable) {
      land();
      return;
    }
    setReelTranslate(decoyY, false);
    fakeOutTimer = setTimeout(() => {
      fakeOutTimer = null;
      if (phase !== 'spin') return;
      startSelection(decoyY, geo.landY, settings.fakeOutBurstMs, REEL_FAKEOUT_BURST_EASE, land);
    }, settings.fakeOutHoldMs);
  };

  const spin = () => {
    if (phase !== 'idle') return;
    phase = 'spin';
    reelAction.textContent = 'Skip';
    safetyTimer = setTimeout(() => {
      safetyTimer = null;
      if (phase === 'spin') land();
    }, selectedMs + 800);
    const current = currentTranslateY();
    const idleAnimation = idle;
    idle = null;
    if (!stopReelAnimation(idleAnimation) || reelAnimationUnavailable) {
      land();
      return;
    }
    setReelTranslate(current, false);
    const firstLandY = fakeOut ? decoyY : geo.landY;
    if (!startSelection(
      current,
      firstLandY,
      settings.spinMs,
      REEL_DECEL,
      fakeOut ? finishFakeOut : land,
    )) return;
  };

  const onTap = () => {
    if (phase === 'idle') spin();
    else if (phase === 'spin') land();
    else confirm();
  };
  reelOverlay.addEventListener('click', onTap);
  reelAction.focus();
  setReelTranslate(geo.idleBase, false);
  const idleMs = Math.max(400, (geo.cycleH / settings.idlePxps) * 1000);
  idle = startReelAnimation(
    [{ transform: 'translateY(' + geo.idleBase + 'px)' }, { transform: 'translateY(' + (geo.idleBase + geo.cycleH) + 'px)' }],
    { duration: idleMs, iterations: Infinity, easing: 'linear' },
  );
  if (!idle) land();
  return true;
}

// Round 1 of a hidden game reveals on its own as soon as the game is shown with
// nothing revealed yet. This covers start, resume and play again.
function maybeAutoReveal() {
  if (gameScreen.hidden || reelSpinning) return;
  if (!usesRoundReveal()) return;
  if (readyRoundIndex() !== 0) return;
  openRoundReveal(0);
}

/* ---------- Secret reel tuning screen ---------- */
function updateDebugControlOutputs() {
  const cycles = Number(debugSpinCycles.value);
  debugSpinMsValue.textContent = debugSpinMs.value + ' ms';
  debugSpinCyclesValue.textContent = cycles + (cycles === 1 ? ' pass' : ' passes');
  debugIdleSpeedValue.textContent = debugIdleSpeed.value + ' px/s';
  debugFakeOutChanceValue.textContent = debugFakeOutChance.value + '%';
  debugFakeOutHoldValue.textContent = debugFakeOutHold.value + ' ms';
  debugFakeOutBurstValue.textContent = debugFakeOutBurst.value + ' ms';
  debugEffectAmountValue.textContent = debugEffectAmount.value;
}

function resetDebugControls() {
  debugSpinMs.value = String(DEFAULT_REEL_OPTIONS.spinMs);
  debugSpinCycles.value = String(DEFAULT_REEL_OPTIONS.spinCycles);
  debugIdleSpeed.value = String(DEFAULT_REEL_OPTIONS.idlePxps);
  debugFakeOutChance.value = String(DEFAULT_REEL_OPTIONS.fakeOutChance * 100);
  debugFakeOutHold.value = String(DEFAULT_REEL_OPTIONS.fakeOutHoldMs);
  debugFakeOutBurst.value = String(DEFAULT_REEL_OPTIONS.fakeOutBurstMs);
  debugEffect.value = DEFAULT_REEL_OPTIONS.effect;
  debugEffectAmount.value = String(DEFAULT_REEL_OPTIONS.effectAmount);
  updateDebugControlOutputs();
  debugStatus.textContent = 'Defaults restored.';
}

function debugReelOptions() {
  return {
    spinMs: Number(debugSpinMs.value),
    spinCycles: Number(debugSpinCycles.value),
    idlePxps: Number(debugIdleSpeed.value),
    fakeOutChance: Number(debugFakeOutChance.value) / 100,
    fakeOutHoldMs: Number(debugFakeOutHold.value),
    fakeOutBurstMs: Number(debugFakeOutBurst.value),
    effect: debugEffect.value,
    effectAmount: Number(debugEffectAmount.value),
  };
}

function runDebugSpin() {
  if (reelSpinning) return;
  const debugGame = GAMES.fivecrowns;
  const previewState = debugGame.initVariant('random');
  const items = debugGame.revealItems(previewState);
  const targetIndex = Math.floor(Math.random() * items.length);
  const target = items[targetIndex];
  const options = debugReelOptions();
  debugSpinBtn.disabled = true;
  debugStatus.textContent = 'Reel open. Tap Spin.';
  const shown = showReel(
    items.map((item) => item.label),
    target.label,
    target.result,
    targetIndex,
    items.length,
    {
      ...options,
      title: 'Debug spin',
      onConfirm() {},
      onLand(effect, fakeOut) {
        debugStatus.textContent = target.result + ' Effect: ' + (effect || 'none')
          + (fakeOut ? ' with fake-out.' : '.');
      },
      onClose() {
        debugSpinBtn.disabled = false;
        debugSpinBtn.focus();
      },
    },
  );
  if (!shown) {
    debugSpinBtn.disabled = false;
    debugStatus.textContent = 'Reel animation is unavailable in this browser.';
  }
}

/* ---------- actions ---------- */
function startGame() {
  state = defaultState(activeGame);
  state.started = true;
  if (activeGame.variants) Object.assign(state, activeGame.initVariant(setupVariant));
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
  // Keep the same variant, reshuffling Random and Super Random for a new order.
  if (activeGame.variants && state.variant) Object.assign(fresh, activeGame.initVariant(state.variant));
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
  addName.value = nextRecalledName(state.players.map((p) => p.name));
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
[
  debugSpinMs,
  debugSpinCycles,
  debugIdleSpeed,
  debugFakeOutChance,
  debugFakeOutHold,
  debugFakeOutBurst,
  debugEffectAmount,
].forEach((input) => input.addEventListener('input', updateDebugControlOutputs));
debugBack.addEventListener('click', showSetup);
debugSpinBtn.addEventListener('click', runDebugSpin);
debugReset.addEventListener('click', resetDebugControls);

playersInc.addEventListener('click', () => {
  if (setupNames.length < activeGame.maxPlayers) {
    setupNames.push(nextRecalledName(setupNames));
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

// The score grid is wrapped in a <form> only so iOS Safari shows its native
// Previous/Next keyboard accessory bar. It must never submit: a submit would
// navigate/reload and lose the in-progress game. (CSP rules out an inline
// onsubmit, so swallow it here.)
scoreForm.addEventListener('submit', (e) => e.preventDefault());

// Tap or keyboard-activate a glowing "ready" round header to spin it open.
scoreBody.addEventListener('click', (e) => {
  const th = e.target.closest ? e.target.closest('.round-col[data-ready="1"]') : null;
  if (!th) return;
  openRoundReveal(Number(th.closest('tr').getAttribute('data-round')));
});
scoreBody.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  const th = e.target.closest ? e.target.closest('.round-col[data-ready="1"]') : null;
  if (!th) return;
  e.preventDefault();
  openRoundReveal(Number(th.closest('tr').getAttribute('data-round')));
});
revealWildBtn.addEventListener('click', () => {
  const rr = readyRoundIndex();
  if (rr >= 0) openRoundReveal(rr);
});

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
// Track the on-screen keyboard's height in --keyboard-height. The bottom-sheet
// dialogs lift above it, and the grid reserves it via scroll-padding-bottom so a
// focused cell can clear it. The game screen is deliberately NOT resized (it stays
// full height and the keyboard overlays its lower edge), so editing never reflows
// the grid; the focused cell is kept visible by revealScoreInput.
function syncViewport() {
  const vv = window.visualViewport;
  const kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  document.documentElement.style.setProperty('--keyboard-height', kb + 'px');
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    syncViewport();
    const active = document.activeElement;
    if (active && active.classList && active.classList.contains('score-input')) revealScoreInput(active);
  });
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
  resetDebugControls();
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
