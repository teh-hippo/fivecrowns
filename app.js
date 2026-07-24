import { GAMES, GAME_ORDER, lastFilledIndex, cap, unitSingular } from './games.js';
import { defaultState } from './state.js';
import { el, refs, onlyDigits, clamp, selectAllOnEdit } from './lib/dom.js';
import {
  loadGame, saveGame, recalledNames, nextRecalledName as recalledNextName, lastGameId, hasStartedSave,
} from './lib/storage.js';
import { installViewport, installDialogFallback } from './lib/platform.js';
import {
  DEFAULT_REEL_OPTIONS, REEL_FIELDS, createReel, fakeOutChanceForMisses, nextFakeOutMisses,
} from './reel.js';
const DEBUG_TAP_TARGET = 5; // deliberate enough to avoid accidental entry
/* ---------- state ---------- */
let activeGame = null; let state = null; let setupNames = []; let setupVariant = null; let handEditIndex = null; let handDraft = null; let fiveCrownsDebugTaps = 0;
function save() { saveGame(activeGame, state); }
function nextRecalledName(names) { return recalledNextName(activeGame, names); }

/* ---------- state helpers ---------- */
function playerById(id) { return state.players.find((p) => p.id === id); }
function nameOf(id) { const p = playerById(id); return p ? p.name : id; }
function addPlayerToState(name, seed) {
  const id = 'p' + state.nextId++; const clean = (name || '').trim() || cap(unitSingular(activeGame)) + ' ' + (state.players.length + 1);
  state.players.push({ id, name: clean, seed: seed || 0 });
  if (activeGame.entry === 'cell') {
    state.scores[id] = activeGame.rounds.kind === 'fixed'
      ? new Array(activeGame.rounds.count).fill(null)
      : [];
  }
  return id;
}
function setScore(pid, round, value) {
  if (!Array.isArray(state.scores[pid])) state.scores[pid] = []; const arr = state.scores[pid]; while (arr.length <= round) arr.push(null); arr[round] = value; save();
}
function resolve() { return activeGame.resolve(state.players, state); }
function usesRoundReveal() {
  return !!(activeGame && state && Array.isArray(activeGame.revealVariants)
    && activeGame.revealVariants.indexOf(state.variant) !== -1);
}
function revealNoun() {
  return typeof activeGame.revealNoun === 'function' ? activeGame.revealNoun(state) : 'round';
}
const {
  setupScreen, gameScreen, debugScreen, gamePicker: picker, setupFresh, variantControl, variantLegend,
  variantOptions, setupResume, resumeNote, resumeBtn, newFromSetupBtn, countLabel, playersCount,
  playersDec, playersInc, nameList, startBtn, debugControls, debugBack, debugSpin: debugSpinBtn,
  debugReset, debugStatus, gameName, scoreHandBtn: headerScoreHandBtn, playAgainBtn, addBtn, menuBtn,
  tableCaption: caption, scoreTable, headRow, scoreBody, totalRow, winnerBanner, scoreForm, addDialog,
  addTitle, addName, addSeed, addHint, addConfirm, addCancel, confirmDialog, confirmCancel, confirmOk,
  menuDialog, switchBtn, newgameBtn, menuClose, handDialog, handTitle, handBody, handPreview,
  handDelete: handDeleteBtn, handCancel, handSave, reelOverlay, reelWheels, reelTitle, reelAction,
  reelEffects, revealWildBtn,
} = refs(`
  setup-screen game-screen debug-screen game-picker setup-fresh variant-control variant-legend
  variant-options setup-resume resume-note resume-btn new-from-setup-btn count-label players-count
  players-dec players-inc name-list start-btn debug-controls debug-back debug-spin debug-reset debug-status
  game-name score-hand-btn play-again-btn add-btn menu-btn table-caption score-table head-row score-body
  total-row winner-banner score-form add-dialog add-title add-name add-seed add-hint add-confirm add-cancel
  confirm-dialog confirm-cancel confirm-ok menu-dialog switch-btn newgame-btn menu-close hand-dialog
  hand-title hand-body hand-preview hand-delete hand-cancel hand-save reel-overlay reel-wheels reel-title
  reel-action reel-effects reveal-wild-btn
`); const screens = [setupScreen, gameScreen, debugScreen];
const reel = createReel({
  overlay: reelOverlay, wheels: reelWheels, title: reelTitle, action: reelAction,
  effects: reelEffects, onBusyChange: updateRevealButton,
});
function showOnly(screen) { screens.forEach((node) => { node.hidden = node !== screen; }); }
function showSetup() { fiveCrownsDebugTaps = 0; showOnly(setupScreen); window.scrollTo(0, 0); renderPicker(); refreshSetupView(); }
function showGame() { showOnly(gameScreen); renderGame(); }
function showDebug() { showOnly(debugScreen); window.scrollTo(0, 0); syncDebugControls(); debugStatus.textContent = 'Ready.'; }
function renderChoices(container, group, options, selected, onChange, onTap) {
  container.innerHTML = '';
  options.forEach((option) => {
    const label = el('label', { class: 'pick' }); const input = el('input', { type: 'radio', name: group, value: option.value }); input.checked = option.value === selected;
    input.addEventListener('change', () => { if (input.checked) onChange(option.value); }); const name = el('span', { class: 'pick-name' }, option.label);
    if (option.hint) name.appendChild(el('span', { class: 'pick-hint' }, option.hint)); if (onTap) name.addEventListener('click', (e) => onTap(option.value, e));
    label.append(input, name); container.appendChild(label);
  });
}
function registerDebugTap(id, event) {
  fiveCrownsDebugTaps = id === 'fivecrowns' ? fiveCrownsDebugTaps + 1 : 0; if (fiveCrownsDebugTaps < DEBUG_TAP_TARGET) return; fiveCrownsDebugTaps = 0; event.preventDefault();
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
  const spec = activeGame.variants; variantControl.hidden = !spec; if (!spec) return; variantLegend.textContent = spec.label;
  renderChoices(variantOptions, 'variant', spec.options, setupVariant, (value) => { setupVariant = value; });
}
function refreshSetupView() {
  countLabel.textContent = cap(activeGame.unitLabel); const resumable = hasStartedSave(activeGame);
  setupResume.hidden = !resumable; setupFresh.hidden = resumable;
  if (resumable) { resumeNote.textContent = 'You have a ' + activeGame.name + ' game in progress.'; return; }
  setupNames = recalledNames(activeGame); setupVariant = activeGame.variants ? activeGame.variants.default : null;
  renderVariantControl(); renderNameList();
}
function renderNameList() {
  playersCount.textContent = setupNames.length; playersDec.disabled = setupNames.length <= activeGame.minPlayers; playersInc.disabled = setupNames.length >= activeGame.maxPlayers;
  nameList.innerHTML = ''; const unit = cap(unitSingular(activeGame));
  setupNames.forEach((nm, i) => {
    const li = el('li', { class: 'name-row' }); const field = unit + ' ' + (i + 1);
    const grip = el('button', {
      type: 'button', class: 'name-drag', 'aria-label': 'Reorder ' + field, title: 'Drag to reorder',
    }); grip.appendChild(dragIcon()); grip.addEventListener('pointerdown', (e) => startRowDrag(e, grip)); grip.addEventListener('keydown', (e) => moveRowByKey(e, i));
    li.appendChild(grip);
    const input = el('input', {
      type: 'text', value: nm, placeholder: field, 'aria-label': field + ' name',
      autocomplete: 'off', autocapitalize: 'words', autocorrect: 'off',
      spellcheck: 'false', enterkeyhint: 'next',
    }); input.addEventListener('input', () => { setupNames[i] = input.value; }); selectAllOnEdit(input); li.appendChild(input);
    if (setupNames.length > activeGame.minPlayers) {
      const rm = el('button', {
        type: 'button', class: 'name-remove', 'aria-label': 'Remove ' + field,
      }, '\u00d7'); rm.addEventListener('click', () => { setupNames.splice(i, 1); renderNameList(); }); li.appendChild(rm);
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
    const r = document.createElementNS(SVG_NS, 'rect'); r.setAttribute('x', '4'); r.setAttribute('y', String(y));
    r.setAttribute('width', '12'); r.setAttribute('height', '2'); r.setAttribute('rx', '1'); svg.appendChild(r);
  }); return svg;
}
function commitNameOrder() { setupNames = Array.from(nameList.querySelectorAll('.name-row input'), (input) => input.value); }
// Pointer capture keeps touch reordering active if the drag leaves the handle.
function startRowDrag(e, grip) {
  const li = grip.closest('.name-row'); if (!li) return; e.preventDefault(); const pid = e.pointerId;
  try { grip.setPointerCapture(pid); } catch (_) { /* unsupported */ }
  li.classList.add('dragging');
  const move = (ev) => {
    if (ev.pointerId !== pid) return; const rows = Array.prototype.filter.call(nameList.querySelectorAll('.name-row'), (o) => o !== li);
    const before = rows.find((o) => {
      const r = o.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2;
    }) || null; if (before !== li.nextElementSibling) nameList.insertBefore(li, before);
  };
  const end = (ev) => {
    if (ev && ev.pointerId !== pid) return; document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end);
    document.removeEventListener('pointercancel', end);
    try { grip.releasePointerCapture(pid); } catch (_) { /* already released */ }
    li.classList.remove('dragging'); commitNameOrder(); renderNameList();
  }; document.addEventListener('pointermove', move); document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);
}
function moveRowByKey(e, i) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return; const j = i + (e.key === 'ArrowUp' ? -1 : 1); if (j < 0 || j >= setupNames.length) return; e.preventDefault();
  [setupNames[i], setupNames[j]] = [setupNames[j], setupNames[i]]; renderNameList(); const grips = nameList.querySelectorAll('.name-drag'); if (grips[j]) grips[j].focus();
}

/* ---------- game rendering ---------- */
function captionText() {
  const dir = activeGame.winDirection === 'low' ? 'Lowest' : 'Highest'; let t = activeGame.name + ' score sheet. ' + dir + ' total wins';
  if (activeGame.target != null) t += '; first to ' + activeGame.target; return t + '.';
}
function cornerLabel() { return activeGame.entry === 'hand' ? 'Hand' : 'Round'; }
function cellRowCount(st) {
  if (activeGame.rounds.kind === 'fixed') return activeGame.rounds.count; let lastFilled = -1;
  state.players.forEach((p) => { lastFilled = Math.max(lastFilled, lastFilledIndex(state.scores[p.id] || [])); }); const started = lastFilled + 1;
  if (st && st.finalRound != null) return st.finalRound + 1;        // capped final round (Greed)
  if (!st || st.phase === 'inProgress') return started + 1;          // trailing empty row
  return started;
}
function renderGame() {
  const { totals, status } = resolve(); gameName.textContent = activeGame.name; caption.textContent = captionText();
  scoreTable.dataset.entry = activeGame.entry; scoreTable.dataset.game = activeGame.id;
  renderHeaderActions(status); buildHead(); buildBody(status); buildFoot(); updateTotalsAndBanner(totals, status); maybeAutoReveal();
}
function renderHeaderActions(st) {
  const inProgress = st.phase === 'inProgress'; const ended = st.phase === 'complete' || st.phase === 'out'; addBtn.textContent = '+ ' + cap(unitSingular(activeGame));
  addBtn.hidden = !inProgress; headerScoreHandBtn.hidden = !(activeGame.entry === 'hand' && inProgress); playAgainBtn.hidden = !ended; updateRevealButton();
}
function playerNameChanged(player) { save(); if (activeGame.entry === 'hand') refreshHandLabels(); else refreshScoreLabels(player.id); updateTotalsAndBanner(); }
function buildHead() {
  headRow.innerHTML = ''; headRow.appendChild(el('th', { class: 'round-col corner', scope: 'col' }, cornerLabel()));
  state.players.forEach((p, i) => {
    const th = el('th', { class: 'player-col', scope: 'col', 'data-pid': p.id });
    const input = el('input', {
      type: 'text', class: 'name-input', value: p.name,
      'aria-label': cap(unitSingular(activeGame)) + ' ' + (i + 1) + ' name',
      autocomplete: 'off', autocapitalize: 'words', autocorrect: 'off',
      spellcheck: 'false', enterkeyhint: 'done',
    }); input.addEventListener('input', () => { p.name = input.value; playerNameChanged(p); });
    input.addEventListener('blur', () => {
      if (input.value.trim() !== '') return; p.name = cap(unitSingular(activeGame)) + ' ' + (i + 1); input.value = p.name; playerNameChanged(p);
    }); th.appendChild(input); headRow.appendChild(th);
  });
}
// Re-run browser scrolling after focus or an iOS visual-viewport resize.
function revealScoreInput(input) {
  input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/* ---------- score-entry advance ---------- */
// Hardware Enter stays in the round; iOS uses the form's native Previous/Next bar.
function scoreCellsInRow(input) { const tr = input.closest('tr'); return tr ? Array.from(tr.querySelectorAll('.score-input')) : [input]; }
function nextScoreCol(input) {
  const cells = scoreCellsInRow(input); const cur = cells.indexOf(input);
  for (let i = 1; i < cells.length; i++) { const j = (cur + i) % cells.length; if (cells[j].value === '') return j; }
  return null;
}
function advanceFrom(input) {
  const target = nextScoreCol(input);
  if (target == null) { input.blur(); return; }
  scoreCellsInRow(input)[target].focus();
}
function scoreCellLabel(name, label) {
  // Hidden details are not spoken, so screen readers do not spoil the reveal.
  const details = []; if (label.cards && !label.cardsMasked && !label.cardsReady) details.push(label.cards);
  if (label.sub && !label.masked && !label.ready) details.push(label.sub + ' wild');
  return name + ', round ' + label.num + (details.length ? ', ' + details.join(', ') : '') + ' score';
}
function refreshScoreLabels(pid) {
  const p = playerById(pid); if (!p) return;
  scoreBody.querySelectorAll('.score-input[data-pid="' + pid + '"]').forEach((input) => {
    const r = Number(input.getAttribute('data-round')); input.setAttribute('aria-label', scoreCellLabel(p.name, activeGame.roundLabel(r, state)));
  });
}
function refreshHandLabels() {
  if (activeGame.entry !== 'hand') return; const hands = state.hands || [];
  scoreBody.querySelectorAll('tr[data-hand]').forEach((tr) => {
    const i = Number(tr.getAttribute('data-hand')); const hand = hands[i]; if (!hand) return; const summary = activeGame.handSummary(hand, state.players);
    const btn = tr.querySelector('.hand-edit'); if (!btn) return; btn.setAttribute('aria-label', 'Edit hand ' + (i + 1) + ', ' + summary); const wild = btn.querySelector('.wild');
    if (wild) wild.textContent = summary;
  });
}
function buildBody(st) {
  scoreBody.innerHTML = '';
  if (activeGame.entry === 'hand') {
    buildHandRows();
  } else { const rows = cellRowCount(st); for (let r = 0; r < rows; r++) scoreBody.appendChild(buildCellRow(r)); }
}
function setRoundKeyText(node, value, kind, labelled) {
  const suffix = ' ' + kind; node.textContent = labelled && value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
  if (labelled) node.appendChild(el('span', { class: 'round-kind' }, suffix));
}
function applyRoundHeader(th, label) {
  const roundKey = !!label.hideRoundNumber;
  th.classList.toggle('round-key', roundKey); th.classList.toggle('round-key-paired', roundKey && !!label.cards);
  let cards = th.querySelector('.cards');
  if (label.cards) {
    if (!cards) {
      cards = el('span', { class: 'cards' }); const num = th.querySelector('.round-num'); if (num) num.insertAdjacentElement('afterend', cards); else th.appendChild(cards);
    }
    setRoundKeyText(cards, label.cards, 'cards', roundKey && !label.cardsMasked); cards.setAttribute('aria-label', label.cards);
    cards.classList.toggle('cards-masked', !!label.cardsMasked); cards.classList.toggle('cards-ready', !!label.cardsReady);
  } else if (cards) { cards.remove(); }
  let wild = th.querySelector('.wild');
  if (label.sub) {
    if (!wild) { wild = el('span', { class: 'wild' }); th.appendChild(wild); }
    setRoundKeyText(wild, label.sub, 'wild', roundKey && !label.masked);
    wild.classList.toggle('wild-masked', !!label.masked); wild.classList.toggle('wild-ready', !!label.ready);
  } else if (wild) { wild.remove(); }
  const ready = !!label.ready; th.classList.toggle('round-ready', ready);
  if (ready) {
    th.dataset.ready = '1'; th.setAttribute('role', 'button'); th.setAttribute('tabindex', '0');
    th.setAttribute('aria-label', 'Reveal the ' + revealNoun() + ' for round ' + label.num);
  } else { delete th.dataset.ready; th.removeAttribute('role'); th.removeAttribute('tabindex'); th.removeAttribute('aria-label'); }
}
function applyRoundRow(tr, r, label = activeGame.roundLabel(r, state)) {
  const th = tr.querySelector('.round-col'); if (th) applyRoundHeader(th, label); const lock = !!label.masked || !!label.ready;
  tr.querySelectorAll('.score-input').forEach((inp) => {
    inp.disabled = lock; const p = playerById(inp.getAttribute('data-pid')); if (p) inp.setAttribute('aria-label', scoreCellLabel(p.name, label));
  });
}
function buildCellRow(r) {
  const label = activeGame.roundLabel(r, state); const tr = el('tr', { 'data-round': String(r) }); const rh = el('th', { class: 'round-col', scope: 'row' });
  if (!label.hideRoundNumber) rh.appendChild(el('span', { class: 'round-num' }, label.num));
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
    }); const arr = state.scores[p.id] || []; const v = arr[r]; input.value = v == null ? '' : String(v);
    input.addEventListener('input', () => {
      const digits = onlyDigits(input.value); if (digits !== input.value) input.value = digits; setScore(p.id, r, digits === '' ? null : parseInt(digits, 10)); handleCellChange();
    }); input.addEventListener('focus', () => revealScoreInput(input));
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return; e.preventDefault(); advanceFrom(input);
    }); selectAllOnEdit(input); td.appendChild(input); tr.appendChild(td);
  }); applyRoundRow(tr, r, label); return tr;
}
function buildHandRows() {
  const hands = state.hands || [];
  hands.forEach((hand, i) => {
    const summary = activeGame.handSummary(hand, state.players); const tr = el('tr', { 'data-hand': String(i) }); const rh = el('th', { class: 'round-col hand-head', scope: 'row' });
    const btn = el('button', { type: 'button', class: 'hand-edit', 'aria-label': 'Edit hand ' + (i + 1) + ', ' + summary });
    btn.appendChild(el('span', { class: 'round-num' }, 'Hand ' + (i + 1))); btn.appendChild(el('span', { class: 'wild' }, summary));
    btn.addEventListener('click', () => openHandDialog(i)); rh.appendChild(btn); tr.appendChild(rh);
    state.players.forEach((p) => {
      const td = el('td', { class: 'score-cell delta-cell' }); const d = hand.deltas ? hand.deltas[p.id] : undefined;
      if (d != null) { td.textContent = (d > 0 ? '+' : '') + d; if (d < 0) td.classList.add('neg'); }
      tr.appendChild(td);
    }); scoreBody.appendChild(tr);
  });
  if (hands.length === 0) {
    const tr = el('tr');
    const td = el('td', { class: 'empty-hint', colspan: String(state.players.length + 1) },
      'No hands yet. Tap "Score hand" to record one.');
    tr.appendChild(td); scoreBody.appendChild(tr);
  }
}
function buildFoot() {
  totalRow.innerHTML = ''; totalRow.appendChild(el('th', { class: 'round-col', scope: 'row' }, 'Total'));
  state.players.forEach((p) => {
    totalRow.appendChild(el('td', { class: 'total-cell', 'data-pid': p.id }));
  });
}
function updateTotalsAndBanner(totals, st) {
  if (!totals || !st) { const r = resolve(); totals = r.totals; st = r.status; }
  state.players.forEach((p) => {
    const cell = totalRow.querySelector('.total-cell[data-pid="' + p.id + '"]'); if (!cell) return; const t = totals[p.id]; const isLeader = st.leaders.indexOf(p.id) !== -1;
    cell.textContent = ''; cell.appendChild(document.createTextNode(String(t))); cell.classList.toggle('leader', isLeader);
    cell.classList.toggle('neg', activeGame.allowNegative && t < 0);
    if (isLeader) {
      cell.appendChild(el('span', { class: 'leader-mark', 'aria-hidden': 'true' }, '\u265B')); cell.appendChild(el('span', { class: 'visually-hidden' }, ' leader'));
    }
    if (activeGame.onBoardMin && t === 0 && lastFilledIndex(state.scores[p.id] || []) >= 0) {
      cell.appendChild(el('span', {
        class: 'needs',
        title: 'Needs ' + activeGame.onBoardMin + ' in a single turn to get on the board',
      }, 'needs ' + activeGame.onBoardMin));
    }
  }); winnerBanner.className = 'winner-banner phase-' + st.phase;
  if (st.text) {
    winnerBanner.hidden = false; winnerBanner.textContent = st.text;
  } else { winnerBanner.hidden = true; winnerBanner.textContent = ''; }
}
// Update in place so the keystroke that changes the game state keeps focus.
function handleCellChange() {
  const { totals, status } = resolve(); renderHeaderActions(status); updateTotalsAndBanner(totals, status); const want = cellRowCount(status);
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
    const r = Number(tr.getAttribute('data-round')); if (!Number.isNaN(r)) applyRoundRow(tr, r);
  }); updateRevealButton();
}

/* ---------- Hidden round-reveal wheel ---------- */
function commitReveal(round) { state.revealedCount = Math.max(Math.floor(state.revealedCount || 0), round + 1); save(); refreshRevealRows(); }
function revealReels(items, round) {
  const remaining = items.slice(round); const target = remaining[0];
  return target.reels.map((targetReel, index) => ({
    label: targetReel.label,
    tone: targetReel.tone,
    full: items.map((item) => item.reels[index].value),
    remaining: remaining.map((item) => item.reels[index].value),
    target: targetReel.value,
  }));
}
function openRoundReveal(round) {
  if (reel.isBusy() || !usesRoundReveal()) return; const label = activeGame.roundLabel(round, state);
  const items = typeof activeGame.revealItems === 'function' ? activeGame.revealItems(state) : []; const target = items[round];
  if (!label.ready || !target || !Array.isArray(target.reels) || target.reels.length === 0) return;
  if (!reel.canAnimate()) { commitReveal(round); return; }
  const progressiveFakeOut = !!activeGame.progressiveFakeOut; let didFakeOut = false;
  const shown = reel.show({
    reels: revealReels(items, round),
    resultText: target.result, round, fullSetSize: items.length,
    options: progressiveFakeOut ? { fakeOutChance: fakeOutChanceForMisses(state.fakeOutMisses) } : undefined,
    onConfirm: () => {
      if (progressiveFakeOut) state.fakeOutMisses = nextFakeOutMisses(state.fakeOutMisses, didFakeOut);
      commitReveal(round);
    },
    onLand(_effect, fakeOut) { didFakeOut = fakeOut; },
  }); if (!shown) commitReveal(round);
}
function readyRoundIndex() {
  if (!usesRoundReveal()) return -1; const count = activeGame.rounds.kind === 'fixed' ? activeGame.rounds.count : 0;
  const round = Math.max(0, Math.min(count, Math.floor(state.revealedCount || 0))); return round < count && activeGame.roundLabel(round, state).ready ? round : -1;
}
function updateRevealButton() {
  const round = readyRoundIndex(); const available = round >= 0 && !reel.isBusy() && !gameScreen.hidden; revealWildBtn.textContent = 'Reveal ' + revealNoun();
  revealWildBtn.hidden = !usesRoundReveal(); revealWildBtn.disabled = !available; revealWildBtn.classList.toggle('reveal-unavailable', !available);
}
function maybeAutoReveal() { if (!gameScreen.hidden && !reel.isBusy() && readyRoundIndex() === 0) openRoundReveal(0); }
const debugFields = {};
function debugFieldValue(field, value = DEFAULT_REEL_OPTIONS[field.key]) { return field.scale ? value * field.scale : value; }
function formatDebugValue(field, value) { if (field.key === 'spinCycles') return value + (Number(value) === 1 ? ' pass' : ' passes'); return value + (field.unit || ''); }
function buildDebugControls() {
  REEL_FIELDS.forEach((field) => {
    const label = el('label', { class: 'debug-control', for: 'debug-' + field.id }); label.appendChild(el('span', {}, field.label)); let input;
    if (field.options) {
      input = el('select', { id: 'debug-' + field.id }); field.options.forEach(([value, text]) => input.appendChild(el('option', { value }, text)));
    } else {
      const scale = field.scale || 1; const output = el('output', { id: 'debug-' + field.id + '-value', for: 'debug-' + field.id });
      input = el('input', {
        id: 'debug-' + field.id, type: 'range',
        min: field.min * scale, max: field.max * scale, step: field.step * scale,
      }); label.appendChild(output);
      input.addEventListener('input', () => {
        output.textContent = formatDebugValue(field, input.value);
      }); debugFields[field.key] = { field, input, output };
    }
    if (!debugFields[field.key]) debugFields[field.key] = { field, input }; label.appendChild(input); debugControls.appendChild(label);
  });
}
function syncDebugControls(reset) {
  Object.values(debugFields).forEach(({ field, input, output }) => {
    if (reset) input.value = String(debugFieldValue(field)); if (output) output.textContent = formatDebugValue(field, input.value);
  });
}
function resetDebugControls() { syncDebugControls(true); debugStatus.textContent = 'Defaults restored.'; }
function debugReelOptions() {
  const options = {};
  Object.keys(debugFields).forEach((key) => {
    const { field, input } = debugFields[key]; options[key] = field.options ? input.value : Number(input.value) / (field.scale || 1);
  }); return options;
}
function runDebugSpin() {
  if (reel.isBusy()) return; const debugGame = GAMES.fivecrowns; const previewState = debugGame.initVariant('super-random'); const items = debugGame.revealItems(previewState);
  const targetIndex = Math.floor(Math.random() * items.length); const target = items[targetIndex]; const options = debugReelOptions(); debugSpinBtn.disabled = true;
  debugStatus.textContent = 'Reel open. Tap Spin.';
  const shown = reel.show({
    reels: revealReels(items, targetIndex),
    resultText: target.result, round: targetIndex, fullSetSize: items.length,
    options: {
      ...options,
      title: 'Debug spin',
    },
    onConfirm() {},
    onLand(effect, fakeOut) {
      debugStatus.textContent = target.result + ' Effect: ' + (effect || 'none') + (fakeOut ? ' with fake-out.' : '.');
    },
    onClose() { debugSpinBtn.disabled = false; debugSpinBtn.focus(); },
  });
  if (!shown) { debugSpinBtn.disabled = false; debugStatus.textContent = 'Reel animation is unavailable in this browser.'; }
}

/* ---------- actions ---------- */
function startGame() {
  state = defaultState(activeGame); state.started = true; if (activeGame.variants) Object.assign(state, activeGame.initVariant(setupVariant));
  setupNames.forEach((n) => addPlayerToState(n, 0)); save(); showGame();
}
function resumeGame() { state = loadGame(activeGame); showGame(); }
function newGame() { state = defaultState(activeGame); save(); setupNames = recalledNames(activeGame); showSetup(); }
function playAgain() {
  const keep = state.players.map((p) => ({ id: p.id, name: p.name, seed: 0 })); const fresh = defaultState(activeGame); fresh.started = true; fresh.players = keep;
  fresh.nextId = state.nextId; if (activeGame.variants && state.variant) Object.assign(fresh, activeGame.initVariant(state.variant));
  keep.forEach((p) => {
    if (activeGame.entry === 'cell') {
      fresh.scores[p.id] = activeGame.rounds.kind === 'fixed'
        ? new Array(activeGame.rounds.count).fill(null)
        : [];
    }
  }); state = fresh; save(); renderGame();
}

/* ---------- add-player dialog ---------- */
function validateSeed() {
  const seed = parseInt(onlyDigits(addSeed.value), 10) || 0; const target = activeGame.target; const invalid = target != null && seed >= target;
  addHint.hidden = target == null; addHint.classList.toggle('error', invalid);
  if (target != null) addHint.textContent = (invalid ? 'Starting score must' : 'Must') + ' be less than ' + target + '.';
  addConfirm.disabled = invalid; return !invalid;
}
function showDialog(dialog, focus) { dialog.returnValue = ''; dialog.showModal(); if (focus) focus.focus(); }
function openAddDialog() {
  addTitle.textContent = 'Add ' + unitSingular(activeGame); addName.value = nextRecalledName(state.players.map((p) => p.name)); addSeed.value = '0'; validateSeed();
  showDialog(addDialog, addName);
}

/* ---------- generic UI helpers ---------- */
function chip(label, selected, onClick, ariaLabel) {
  const b = el('button', { type: 'button', class: 'chip' + (selected ? ' selected' : ''), 'aria-pressed': selected ? 'true' : 'false' }, label);
  if (ariaLabel) b.setAttribute('aria-label', ariaLabel); b.addEventListener('click', onClick); return b;
}
function labeledStepper(label, value, min, max, onChange) {
  const wrap = el('div', { class: 'hand-stepper' }); wrap.appendChild(el('span', { class: 'hand-stepper-label' }, label)); const ctrl = el('div', { class: 'stepper' });
  const dec = el('button', { type: 'button', class: 'step-btn', 'aria-label': 'Decrease ' + label }, '−'); const out = el('output', {}, String(value));
  const inc = el('button', { type: 'button', class: 'step-btn', 'aria-label': 'Increase ' + label }, '+'); dec.disabled = value <= min; inc.disabled = value >= max;
  dec.addEventListener('click', () => onChange(clamp(value - 1, min, max))); inc.addEventListener('click', () => onChange(clamp(value + 1, min, max)));
  ctrl.appendChild(dec); ctrl.appendChild(out); ctrl.appendChild(inc); wrap.appendChild(ctrl); return wrap;
}

/* ---------- hand dialog (delegated to the game) ---------- */
const HAND_UI = { el: el, chip: chip, labeledStepper: labeledStepper };
function renderHandForm() { handBody.innerHTML = ''; activeGame.hand.build(handBody, handDraft, state.players, HAND_UI, onHandChange); }
function onHandChange() { renderHandForm(); updateHandPreview(); }
function updateHandPreview() { const v = activeGame.hand.validate(handDraft, state.players); handSave.disabled = !v.valid; handPreview.textContent = v.message; }
function openHandDialog(index) {
  if (index == null && state.players.length < 2) return; handEditIndex = index;
  handDraft = index != null
    ? activeGame.hand.draftFromRecord(state.hands[index])
    : activeGame.hand.newDraft(state.players);
  handTitle.textContent = index != null ? 'Edit hand ' + (index + 1) : 'Score hand'; handDeleteBtn.hidden = index == null; renderHandForm(); updateHandPreview();
  showDialog(handDialog, handBody.querySelector('.chip'));
}
function saveHand() {
  const id = handEditIndex != null ? state.hands[handEditIndex].id : null; const record = activeGame.hand.toRecord(handDraft, state.players, id);
  if (handEditIndex != null) state.hands[handEditIndex] = record; else state.hands.push(record); save();
  const focusIdx = handEditIndex != null ? handEditIndex : state.hands.length - 1; renderGame(); focusHandRow(focusIdx);
}
function deleteHand() {
  if (handEditIndex == null) return; state.hands.splice(handEditIndex, 1); save(); renderGame(); focusHandRow(Math.min(handEditIndex, state.hands.length - 1));
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
  if (setupNames.length < activeGame.maxPlayers) { setupNames.push(nextRecalledName(setupNames)); renderNameList(); }
});
playersDec.addEventListener('click', () => {
  if (setupNames.length > activeGame.minPlayers) { setupNames.pop(); renderNameList(); }
}); startBtn.addEventListener('click', startGame); resumeBtn.addEventListener('click', resumeGame);
newFromSetupBtn.addEventListener('click', () => showDialog(confirmDialog));
// The form exists for iOS Previous/Next controls and must never submit.
scoreForm.addEventListener('submit', (e) => e.preventDefault());
scoreBody.addEventListener('click', (e) => {
  const th = e.target.closest ? e.target.closest('.round-col[data-ready="1"]') : null; if (!th) return; openRoundReveal(Number(th.closest('tr').getAttribute('data-round')));
});
scoreBody.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return; const th = e.target.closest ? e.target.closest('.round-col[data-ready="1"]') : null; if (!th) return;
  e.preventDefault(); openRoundReveal(Number(th.closest('tr').getAttribute('data-round')));
});
revealWildBtn.addEventListener('click', () => {
  const rr = readyRoundIndex(); if (rr >= 0) openRoundReveal(rr);
}); addBtn.addEventListener('click', openAddDialog); playAgainBtn.addEventListener('click', playAgain); headerScoreHandBtn.addEventListener('click', () => openHandDialog(null));
selectAllOnEdit(addName);
addSeed.addEventListener('input', () => { addSeed.value = onlyDigits(addSeed.value); validateSeed(); });
menuBtn.addEventListener('click', () => showDialog(menuDialog));
switchBtn.addEventListener('click', () => { menuDialog.close('cancel'); save(); showSetup(); });
newgameBtn.addEventListener('click', () => {
  menuDialog.close('cancel'); showDialog(confirmDialog);
}); confirmOk.addEventListener('click', () => confirmDialog.close('ok'));
handDeleteBtn.addEventListener('click', () => handDialog.close('delete'));
function bindDialog(dialog, cancel, onClose, backdrop) {
  cancel.addEventListener('click', () => dialog.close('cancel'));
  if (onClose) dialog.addEventListener('close', () => onClose(dialog.returnValue));
  if (backdrop) dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return; const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close('cancel');
  });
}
bindDialog(addDialog, addCancel, (value) => {
  if (value !== 'add' || !validateSeed()) return; addPlayerToState(addName.value, parseInt(onlyDigits(addSeed.value), 10) || 0); save(); renderGame();
}, true);
bindDialog(menuDialog, menuClose, null, true);
bindDialog(confirmDialog, confirmCancel, (value) => { if (value === 'ok') newGame(); }, false);
bindDialog(handDialog, handCancel, (value) => {
  if (value === 'save') saveHand(); else if (value === 'delete') deleteHand();
}, true);

installViewport(revealScoreInput); installDialogFallback();
function init() {
  buildDebugControls(); resetDebugControls(); activeGame = GAMES[lastGameId(GAMES, 'fivecrowns')];
  if (hasStartedSave(activeGame)) {
    state = loadGame(activeGame); showGame();
  } else { state = defaultState(activeGame); setupNames = recalledNames(activeGame); showSetup(); }
}
// Best-effort protection against storage eviction.
if (navigator.storage && typeof navigator.storage.persist === 'function') {
  navigator.storage.persist().catch(() => {});
}
init();
