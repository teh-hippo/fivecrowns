import { GAMES, GAME_ORDER, lastFilledIndex, cap, unitSingular, objectFromEntries } from './games.js';
import { defaultState, normalizeState, serializeState } from './state.js';
const LAST_GAME_KEY = 'scorer:lastGame';
const NAMES_KEY = 'scorer:names';
const CARD_GLYPH = '\u{1F0A0}';
const EFFECTS = Object.freeze({
  confetti: { label: 'Confetti', amount: 44, repeatMs: 1000 },
  explosion: { label: 'Explosion', amount: 30, repeatMs: 950 },
  lasers: { label: 'Lasers', amount: 5, repeatMs: 1050 },
});
const DEFAULT_REEL_OPTIONS = Object.freeze({
  spinMs: 7200,
  spinCycles: 7,
  idlePxps: 260,
  fakeOutChance: 0.15,
  fakeOutHoldMs: 300,
  fakeOutBurstMs: 850,
  effect: 'random',
  effectAmount: EFFECTS.confetti.amount,
});
// Bounds are shared by the tuning UI and runtime, so a preview can never test an
// invalid production value.
const REEL_FIELDS = [
  { key: 'spinMs', id: 'spin-ms', label: 'Spin duration', min: 250, max: 12000, step: 50, unit: ' ms' },
  { key: 'spinCycles', id: 'spin-cycles', label: 'Travel', min: 1, max: 12, step: 1, unit: ' passes', integer: true },
  { key: 'idlePxps', id: 'idle-speed', label: 'Idle speed', min: 50, max: 600, step: 10, unit: ' px/s' },
  { key: 'fakeOutChance', id: 'fakeout-chance', label: 'Fake-out chance', min: 0, max: 1, step: 0.05, scale: 100, unit: '%' },
  { key: 'fakeOutHoldMs', id: 'fakeout-hold', label: 'Fake-out pause', min: 0, max: 1500, step: 50, unit: ' ms' },
  { key: 'fakeOutBurstMs', id: 'fakeout-burst', label: 'Fake-out finish', min: 100, max: 2500, step: 50, unit: ' ms' },
  { key: 'effect', id: 'effect', label: 'Landing effect', options: [['random', 'Random'], ...Object.entries(EFFECTS).map(([v, x]) => [v, x.label]), ['none', 'None']] },
  { key: 'effectAmount', id: 'effect-amount', label: 'Effect amount', min: 1, max: 120, step: 1, integer: true },
];
const REEL_FIELD = objectFromEntries(REEL_FIELDS.map((field) => [field.key, field]));
// Geometry reserves fourteen rendered passes around a seven-pass production
// spin, with the winning copy resting two passes into the strip.
const REEL_GEOMETRY = Object.freeze({ stripCycles: 14, landingCycle: 2, minIdleMs: 400, safetyMs: 800 });
const REEL_DECEL = 'cubic-bezier(0.16, 0.9, 0.22, 1)'; // smooth deceleration
const REEL_FAKEOUT_BURST_EASE = 'cubic-bezier(0.4, 0, 0.15, 1)';
const DEBUG_TAP_TARGET = 5; // deliberate enough to avoid accidental entry
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
function reelNumber(key, value) {
  const field = REEL_FIELD[key];
  const n = clamp(numberOr(value, DEFAULT_REEL_OPTIONS[key]), field.min, field.max);
  return field.integer ? Math.round(n) : n;
}
// iOS collapses selections made during focus, so select again after the tap.
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
    if (state.players.length > 0) rememberNames(activeGame, state.players.map((p) => p.name));
  } catch (e) { /* storage may be full or blocked; scores stay in memory */ }
}
// `last` restores the latest roster; non-shrinking `memory` recalls removed slots.
function loadRosters() {
  try {
    const obj = JSON.parse(localStorage.getItem(NAMES_KEY));
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (e) { return {}; }
}
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
function isDefaultName(nm) { return /^(player|side)\s+\d+$/i.test((nm || '').trim()); }
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
function resolve() { return activeGame.resolve(state.players, state); }
function usesRoundReveal() {
  return !!(activeGame && state && Array.isArray(activeGame.revealVariants)
    && activeGame.revealVariants.indexOf(state.variant) !== -1);
}
function revealNoun() {
  return activeGame && typeof activeGame.revealNoun === 'function'
    ? activeGame.revealNoun(state)
    : 'round';
}
function refs(ids) {
  return objectFromEntries(ids.trim().split(/\s+/).map((id) => [
    id.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), document.getElementById(id),
  ]));
}
const {
  setupScreen, gameScreen, debugScreen, gamePicker: picker, setupFresh, variantControl, variantLegend,
  variantOptions, setupResume, resumeNote, resumeBtn, newFromSetupBtn, countLabel, playersCount,
  playersDec, playersInc, nameList, startBtn, debugControls, debugBack, debugSpin: debugSpinBtn,
  debugReset, debugStatus, gameName, scoreHandBtn: headerScoreHandBtn, playAgainBtn, addBtn, menuBtn,
  tableCaption: caption, scoreTable, headRow, scoreBody, totalRow, winnerBanner, scoreForm, addDialog,
  addTitle, addName, addSeed, addHint, addConfirm, addCancel, confirmDialog, confirmCancel, confirmOk,
  menuDialog, switchBtn, newgameBtn, menuClose, handDialog, handTitle, handBody, handPreview,
  handDelete: handDeleteBtn, handCancel, handSave, reelOverlay, reelStrip, reelTitle, reelAction,
  reelEffects, revealWildBtn,
} = refs(`
  setup-screen game-screen debug-screen game-picker setup-fresh variant-control variant-legend
  variant-options setup-resume resume-note resume-btn new-from-setup-btn count-label players-count
  players-dec players-inc name-list start-btn debug-controls debug-back debug-spin debug-reset debug-status
  game-name score-hand-btn play-again-btn add-btn menu-btn table-caption score-table head-row score-body
  total-row winner-banner score-form add-dialog add-title add-name add-seed add-hint add-confirm add-cancel
  confirm-dialog confirm-cancel confirm-ok menu-dialog switch-btn newgame-btn menu-close hand-dialog
  hand-title hand-body hand-preview hand-delete hand-cancel hand-save reel-overlay reel-strip reel-title
  reel-action reel-effects reveal-wild-btn
`);
const screens = [setupScreen, gameScreen, debugScreen];
function showOnly(screen) { screens.forEach((node) => { node.hidden = node !== screen; }); }
function showSetup() {
  fiveCrownsDebugTaps = 0;
  showOnly(setupScreen);
  window.scrollTo(0, 0);
  renderPicker();
  refreshSetupView();
}
function showGame() {
  showOnly(gameScreen);
  gameName.textContent = activeGame.name;
  renderGame();
}
function showDebug() {
  showOnly(debugScreen);
  window.scrollTo(0, 0);
  syncDebugControls();
  debugStatus.textContent = 'Ready.';
}
function renderChoices(container, group, options, selected, onChange, onTap) {
  container.innerHTML = '';
  options.forEach((option) => {
    const label = el('label', { class: 'pick' });
    const input = el('input', { type: 'radio', name: group, value: option.value });
    input.checked = option.value === selected;
    input.addEventListener('change', () => { if (input.checked) onChange(option.value); });
    const name = el('span', { class: 'pick-name' }, option.label);
    if (option.hint) name.appendChild(el('span', { class: 'pick-hint' }, option.hint));
    if (onTap) name.addEventListener('click', (e) => onTap(option.value, e));
    label.append(input, name);
    container.appendChild(label);
  });
}
function registerDebugTap(id, event) {
  fiveCrownsDebugTaps = id === 'fivecrowns' ? fiveCrownsDebugTaps + 1 : 0;
  if (fiveCrownsDebugTaps < DEBUG_TAP_TARGET) return;
  fiveCrownsDebugTaps = 0;
  event.preventDefault();
  showDebug();
}
function renderPicker() {
  renderChoices(
    picker,
    'game',
    GAME_ORDER.map((id) => ({ value: id, label: GAMES[id].name })),
    activeGame.id,
    (id) => { activeGame = GAMES[id]; refreshSetupView(); },
    registerDebugTap,
  );
}
function renderVariantControl() {
  const spec = activeGame.variants;
  variantControl.hidden = !spec;
  if (!spec) return;
  variantLegend.textContent = spec.label;
  renderChoices(variantOptions, 'variant', spec.options, setupVariant, (value) => { setupVariant = value; });
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
    const field = unit + ' ' + (i + 1);
    const grip = el('button', {
      type: 'button', class: 'name-drag', 'aria-label': 'Reorder ' + field, title: 'Drag to reorder',
    });
    grip.appendChild(dragIcon());
    grip.addEventListener('pointerdown', (e) => startRowDrag(e, grip));
    grip.addEventListener('keydown', (e) => moveRowByKey(e, i));
    li.appendChild(grip);
    const input = el('input', {
      type: 'text', value: nm, placeholder: field, 'aria-label': field + ' name',
      autocomplete: 'off', autocapitalize: 'words', autocorrect: 'off',
      spellcheck: 'false', enterkeyhint: 'next',
    });
    input.addEventListener('input', () => { setupNames[i] = input.value; });
    selectAllOnEdit(input);
    li.appendChild(input);
    if (setupNames.length > activeGame.minPlayers) {
      const rm = el('button', {
        type: 'button', class: 'name-remove', 'aria-label': 'Remove ' + field,
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
  Object.entries({
    viewBox: '0 0 20 20', width: '18', height: '18', 'aria-hidden': 'true', focusable: 'false',
  }).forEach(([name, value]) => svg.setAttribute(name, value));
  [4, 9, 14].forEach((y) => {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', '4'); r.setAttribute('y', String(y));
    r.setAttribute('width', '12'); r.setAttribute('height', '2'); r.setAttribute('rx', '1');
    svg.appendChild(r);
  });
  return svg;
}
function commitNameOrder() {
  setupNames = Array.from(nameList.querySelectorAll('.name-row input'), (input) => input.value);
}
// Pointer capture keeps touch reordering active if the drag leaves the handle.
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
  [setupNames[i], setupNames[j]] = [setupNames[j], setupNames[i]];
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
function playerNameChanged(player) {
  save();
  if (activeGame.entry === 'hand') refreshHandLabels();
  else refreshScoreLabels(player.id);
  updateTotalsAndBanner();
}
function buildHead() {
  headRow.innerHTML = '';
  headRow.appendChild(el('th', { class: 'round-col corner', scope: 'col' }, cornerLabel()));
  state.players.forEach((p, i) => {
    const th = el('th', { class: 'player-col', scope: 'col', 'data-pid': p.id });
    const input = el('input', {
      type: 'text', class: 'name-input', value: p.name,
      'aria-label': cap(unitSingular(activeGame)) + ' ' + (i + 1) + ' name',
      autocomplete: 'off', autocapitalize: 'words', autocorrect: 'off',
      spellcheck: 'false', enterkeyhint: 'done',
    });
    input.addEventListener('input', () => { p.name = input.value; playerNameChanged(p); });
    input.addEventListener('blur', () => {
      if (input.value.trim() !== '') return;
      p.name = cap(unitSingular(activeGame)) + ' ' + (i + 1);
      input.value = p.name;
      playerNameChanged(p);
    });
    th.appendChild(input);
    headRow.appendChild(th);
  });
}
// Re-run browser scrolling after focus or an iOS visual-viewport resize.
function revealScoreInput(input) {
  input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/* ---------- score-entry advance ---------- */
// Hardware Enter stays in the round; iOS uses the form's native Previous/Next bar.
function scoreCellsInRow(input) {
  const tr = input.closest('tr');
  return tr ? Array.from(tr.querySelectorAll('.score-input')) : [input];
}
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
function refreshScoreLabels(pid) {
  const p = playerById(pid);
  if (!p) return;
  scoreBody.querySelectorAll('.score-input[data-pid="' + pid + '"]').forEach((input) => {
    const r = Number(input.getAttribute('data-round'));
    input.setAttribute('aria-label', scoreCellLabel(p.name, activeGame.roundLabel(r, state)));
  });
}
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
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      advanceFrom(input);
    });
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
    if (isLeader) {
      cell.appendChild(el('span', { class: 'leader-mark', 'aria-hidden': 'true' }, '\u265B'));
      cell.appendChild(el('span', { class: 'visually-hidden' }, ' leader'));
    }
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
// Update in place so the keystroke that changes the game state keeps focus.
function handleCellChange() {
  const { totals, status } = resolve();
  renderHeaderActions(status);
  updateTotalsAndBanner(totals, status);
  const want = cellRowCount(status);
  while (scoreBody.children.length < want) scoreBody.appendChild(buildCellRow(scoreBody.children.length));
  while (scoreBody.children.length > want
    && !scoreBody.lastChild.contains(document.activeElement)) {
    scoreBody.removeChild(scoreBody.lastChild);
  }
  refreshRevealRows();
}
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
function commitReveal(r) {
  const opened = Math.max(0, Math.floor(state.revealedCount || 0));
  state.revealedCount = Math.max(opened, r + 1);
  save();
  refreshRevealRows();
}
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
function animationObject(animation) { return animation != null && ['object', 'function'].includes(typeof animation); }
function hasAnimationMethod(node) { try { return !!node && typeof node.animate === 'function'; } catch (_) { return false; } }
function createAnimation(node, keyframes, options) {
  let animate; try { animate = node && node.animate; } catch (_) { return null; }
  if (typeof animate !== 'function') return null;
  try { return animate.call(node, keyframes, options); } catch (_) { return null; }
}
function usableAnimation(animation) {
  if (!animationObject(animation)) return false;
  try { return typeof animation.cancel === 'function' && typeof animation.play === 'function' && 'onfinish' in animation; }
  catch (_) { return false; }
}
function setAnimationHandler(animation, name, handler) {
  if (!animationObject(animation)) return false;
  try {
    if (!(name in animation)) return false;
    animation[name] = handler;
    return animation[name] === handler;
  } catch (_) { return false; }
}
function clearAnimationHandler(animation, name) {
  if (!animationObject(animation)) return;
  try { if (name in animation) animation[name] = null; } catch (_) { /* broken handler */ }
}
function neutralizeAnimation(animation) {
  if (!animationObject(animation)) return false;
  try { if (typeof animation.pause === 'function') animation.pause(); } catch (_) { /* detach the effect below */ }
  try {
    if (!('effect' in animation)) return false;
    animation.effect = null;
    return animation.effect == null;
  } catch (_) { return false; }
}
function cancelAnimationResult(animation) {
  if (animation == null) return { stopped: true, capabilityFailed: false };
  clearAnimationHandler(animation, 'onfinish');
  clearAnimationHandler(animation, 'oncancel');
  let cancel; try { cancel = animation.cancel; } catch (_) { cancel = null; }
  if (typeof cancel === 'function') {
    try { cancel.call(animation); return { stopped: true, capabilityFailed: false }; } catch (_) { /* fall through */ }
  }
  return { stopped: neutralizeAnimation(animation), capabilityFailed: true };
}
function cancelAnimation(animation) { return cancelAnimationResult(animation).stopped; }
function cancelElementAnimations(node) {
  let getAnimations; try { getAnimations = node && node.getAnimations; }
  catch (_) { return { stopped: false, capabilityFailed: true }; }
  if (typeof getAnimations !== 'function') return { stopped: true, capabilityFailed: false };
  let animations; try { animations = Array.from(getAnimations.call(node)); }
  catch (_) { return { stopped: false, capabilityFailed: true }; }
  let stopped = true;
  let capabilityFailed = false;
  animations.forEach((animation) => {
    const result = cancelAnimationResult(animation);
    stopped = stopped && result.stopped;
    capabilityFailed = capabilityFailed || result.capabilityFailed;
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
// Repeat the shuffled choices far enough to cover idle and selection travel.
function buildReelStrip(remaining, target, fullSetSize, spinCycles) {
  reelStrip.innerHTML = '';
  const reel = shuffleArr(remaining);
  const len = reel.length;
  const fullLen = Math.max(len, Math.floor(fullSetSize) || len);
  const travelCycles = Math.ceil(spinCycles * fullLen / len);
  const stripCycles = Math.max(
    Math.ceil(REEL_GEOMETRY.stripCycles * fullLen / len),
    travelCycles + REEL_GEOMETRY.landingCycle + 2,
  );
  const tIdx = reel.indexOf(target);
  const landIdx = tIdx + REEL_GEOMETRY.landingCycle * len;
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
const LANDING_EFFECTS = Object.keys(EFFECTS);
const EFFECT_COLORS = ['#a78bfa', '#e3c14e', '#5fe39a', '#ff6b5e', '#ececf3'];
const EXPLOSION_COLORS = ['#fff3a3', '#ffd166', '#ff8c42', '#ff4d3d'];
const LASER_COLORS = ['#71f6ff', '#ff5cf4', '#a78bfa'];
const EFFECT_NODE_LIMIT = 140; // caps overlapping bursts on slower phones
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
  const sparkCount = Math.max(6, Math.round(amount * EFFECTS.explosion.amount / DEFAULT_REEL_OPTIONS.effectAmount));
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
  const beamCount = Math.max(1, Math.round(amount * EFFECTS.lasers.amount / DEFAULT_REEL_OPTIONS.effectAmount));
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
    const effectAmount = reelNumber('effectAmount', amount);
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
    const interval = EFFECTS[type].repeatMs;
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
// Idle, selection, optional fake-out and confirm share one overlay lifecycle.
function showReel(remaining, target, resultText, r, fullSetSize, options) {
  const supplied = options || {};
  const settings = {
    spinMs: reelNumber('spinMs', supplied.spinMs),
    spinCycles: reelNumber('spinCycles', supplied.spinCycles),
    idlePxps: reelNumber('idlePxps', supplied.idlePxps),
    fakeOutChance: reelNumber('fakeOutChance', supplied.fakeOutChance),
    fakeOutHoldMs: reelNumber('fakeOutHoldMs', supplied.fakeOutHoldMs),
    fakeOutBurstMs: reelNumber('fakeOutBurstMs', supplied.fakeOutBurstMs),
    effect: supplied.effect || DEFAULT_REEL_OPTIONS.effect,
    effectAmount: reelNumber('effectAmount', supplied.effectAmount),
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
  // A fake-out pauses on an unmarked decoy without changing the saved target.
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
    }, selectedMs + REEL_GEOMETRY.safetyMs);
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
  const idleMs = Math.max(REEL_GEOMETRY.minIdleMs, (geo.cycleH / settings.idlePxps) * 1000);
  idle = startReelAnimation(
    [{ transform: 'translateY(' + geo.idleBase + 'px)' }, { transform: 'translateY(' + (geo.idleBase + geo.cycleH) + 'px)' }],
    { duration: idleMs, iterations: Infinity, easing: 'linear' },
  );
  if (!idle) land();
  return true;
}
function maybeAutoReveal() {
  if (gameScreen.hidden || reelSpinning) return;
  if (!usesRoundReveal()) return;
  if (readyRoundIndex() !== 0) return;
  openRoundReveal(0);
}
const debugFields = {};
function debugFieldValue(field, value = DEFAULT_REEL_OPTIONS[field.key]) {
  return field.scale ? value * field.scale : value;
}
function formatDebugValue(field, value) {
  if (field.key === 'spinCycles') return value + (Number(value) === 1 ? ' pass' : ' passes');
  return value + (field.unit || '');
}
function buildDebugControls() {
  REEL_FIELDS.forEach((field) => {
    const label = el('label', { class: 'debug-control', for: 'debug-' + field.id });
    label.appendChild(el('span', {}, field.label));
    let input;
    if (field.options) {
      input = el('select', { id: 'debug-' + field.id });
      field.options.forEach(([value, text]) => input.appendChild(el('option', { value }, text)));
    } else {
      const scale = field.scale || 1;
      const output = el('output', { id: 'debug-' + field.id + '-value', for: 'debug-' + field.id });
      input = el('input', {
        id: 'debug-' + field.id, type: 'range',
        min: field.min * scale, max: field.max * scale, step: field.step * scale,
      });
      label.appendChild(output);
      input.addEventListener('input', () => {
        output.textContent = formatDebugValue(field, input.value);
      });
      debugFields[field.key] = { field, input, output };
    }
    if (!debugFields[field.key]) debugFields[field.key] = { field, input };
    label.appendChild(input);
    debugControls.appendChild(label);
  });
}
function syncDebugControls(reset) {
  Object.values(debugFields).forEach(({ field, input, output }) => {
    if (reset) input.value = String(debugFieldValue(field));
    if (output) output.textContent = formatDebugValue(field, input.value);
  });
}
function resetDebugControls() {
  syncDebugControls(true);
  debugStatus.textContent = 'Defaults restored.';
}
function debugReelOptions() {
  return objectFromEntries(Object.entries(debugFields).map(([key, { field, input }]) => [
    key, field.options ? input.value : Number(input.value) / (field.scale || 1),
  ]));
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
        debugStatus.textContent = target.result + ' Effect: ' + (effect || 'none') + (fakeOut ? ' with fake-out.' : '.');
      },
      onClose() { debugSpinBtn.disabled = false; debugSpinBtn.focus(); },
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
function playAgain() {
  const keep = state.players.map((p) => ({ id: p.id, name: p.name, seed: 0 }));
  const fresh = defaultState(activeGame);
  fresh.started = true;
  fresh.players = keep;
  fresh.nextId = state.nextId;
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
function focusHandRow(i) {
  if (i >= 0) {
    const btn = scoreBody.querySelector('tr[data-hand="' + i + '"] .hand-edit');
    if (btn) { btn.focus(); return; }
  }
  if (!headerScoreHandBtn.hidden) headerScoreHandBtn.focus();
}
[[debugBack, showSetup], [debugSpinBtn, runDebugSpin], [debugReset, resetDebugControls]]
  .forEach(([node, handler]) => node.addEventListener('click', handler));
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
// The form exists for iOS Previous/Next controls and must never submit.
scoreForm.addEventListener('submit', (e) => e.preventDefault());
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
function closeOnBackdropTap(dialog) {
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      dialog.close('cancel');
    }
  });
}
[addDialog, menuDialog, handDialog].forEach(closeOnBackdropTap);

/* ---------- keyboard-aware viewport ---------- */
// iOS only exposes keyboard overlap through visualViewport.
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
// Inert on browsers with native modal dialogs.
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
function init() {
  buildDebugControls();
  resetDebugControls();
  let lastId = null;
  try { lastId = localStorage.getItem(LAST_GAME_KEY); } catch (e) { /* storage unavailable */ }
  if (!lastId || !GAMES[lastId]) lastId = 'fivecrowns';
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
// Best-effort protection against storage eviction.
if (navigator.storage && typeof navigator.storage.persist === 'function') {
  navigator.storage.persist().catch(() => {});
}
init();
