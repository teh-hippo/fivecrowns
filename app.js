'use strict';

/* ---------- Five Crowns constants ---------- */
// Round N deals N+2 cards; the wild rank equals that card count.
const WILD_LABELS = ['3s', '4s', '5s', '6s', '7s', '8s', '9s', '10s', 'Jacks', 'Queens', 'Kings'];
const ROUNDS = WILD_LABELS.length; // 11
const STORAGE_KEY = 'fivecrowns:v1';
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;

/* ---------- State ---------- */
function defaultState() {
  return { started: false, players: [], scores: {}, nextId: 1 };
}

function normalize(s) {
  if (!s || typeof s !== 'object') return defaultState();
  const seen = new Set();
  const players = [];
  let maxId = 0;
  (Array.isArray(s.players) ? s.players : []).forEach((p) => {
    if (!p || typeof p.id !== 'string' || seen.has(p.id)) return;
    seen.add(p.id);
    const seed = typeof p.seed === 'number' && Number.isFinite(p.seed) ? p.seed : 0;
    const name = typeof p.name === 'string' && p.name.trim() ? p.name : 'Player ' + (players.length + 1);
    players.push({ id: p.id, name, seed });
    const m = /^p(\d+)$/.exec(p.id);
    if (m) maxId = Math.max(maxId, parseInt(m[1], 10));
  });
  const srcScores = s.scores && typeof s.scores === 'object' ? s.scores : {};
  const scores = {};
  players.forEach((p) => {
    const a = Array.isArray(srcScores[p.id]) ? srcScores[p.id].slice(0, ROUNDS) : [];
    while (a.length < ROUNDS) a.push(null);
    scores[p.id] = a.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null));
  });
  const storedNext = typeof s.nextId === 'number' && Number.isFinite(s.nextId) ? s.nextId : 0;
  // Recompute nextId from the highest existing pN id so corrupt/stale storage
  // can never make addPlayerToState reuse an id and clobber another player.
  const nextId = Math.max(maxId + 1, storedNext, players.length + 1);
  return { started: !!s.started, players, scores, nextId };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { /* ignore corrupt/unavailable storage */ }
  return defaultState();
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) { /* storage may be full or blocked; scores stay in memory */ }
}

let state = load();
let setupNames = ['Player 1', 'Player 2', 'Player 3'];

/* ---------- State helpers ---------- */
function playerById(id) {
  return state.players.find((p) => p.id === id);
}

function addPlayerToState(name, seed) {
  const id = 'p' + state.nextId++;
  const clean = (name || '').trim() || 'Player ' + (state.players.length + 1);
  state.players.push({ id, name: clean, seed: seed || 0 });
  state.scores[id] = new Array(ROUNDS).fill(null);
  return id;
}

function setScore(pid, round, value) {
  if (!Array.isArray(state.scores[pid])) state.scores[pid] = new Array(ROUNDS).fill(null);
  state.scores[pid][round] = value;
  save();
}

function totalFor(pid) {
  const player = playerById(pid);
  const seed = player ? player.seed || 0 : 0;
  const arr = state.scores[pid] || [];
  return arr.reduce((sum, v) => sum + (v || 0), seed);
}

// The final round (11) is played by everyone present at the end, so use it to
// decide the game is over without forcing mid-game joiners to fill earlier rounds.
function isComplete() {
  return (
    state.players.length > 0 &&
    state.players.every((p) => {
      const arr = state.scores[p.id];
      return arr && arr[ROUNDS - 1] != null;
    })
  );
}

/* ---------- DOM refs ---------- */
const setupScreen = document.getElementById('setup-screen');
const gameScreen = document.getElementById('game-screen');
const playersCount = document.getElementById('players-count');
const playersDec = document.getElementById('players-dec');
const playersInc = document.getElementById('players-inc');
const nameList = document.getElementById('name-list');
const startBtn = document.getElementById('start-btn');

const headRow = document.getElementById('head-row');
const scoreBody = document.getElementById('score-body');
const totalRow = document.getElementById('total-row');
const winnerBanner = document.getElementById('winner-banner');
const addPlayerBtn = document.getElementById('add-player-btn');
const newGameBtn = document.getElementById('new-game-btn');

const addDialog = document.getElementById('add-dialog');
const addName = document.getElementById('add-name');
const addSeed = document.getElementById('add-seed');
const addCancel = document.getElementById('add-cancel');
const confirmDialog = document.getElementById('confirm-dialog');
const confirmCancel = document.getElementById('confirm-cancel');

/* ---------- DOM helper ---------- */
function el(tag, attrs, text) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      if (k === 'class') node.className = attrs[k];
      else node.setAttribute(k, attrs[k]);
    }
  }
  if (text != null) node.textContent = text;
  return node;
}

function onlyDigits(value) {
  return String(value).replace(/[^0-9]/g, '');
}

/* ---------- Screen switching ---------- */
function showSetup() {
  setupScreen.hidden = false;
  gameScreen.hidden = true;
}

function showGame() {
  setupScreen.hidden = true;
  gameScreen.hidden = false;
  renderGame();
}

/* ---------- Setup rendering ---------- */
function renderSetup() {
  playersCount.textContent = setupNames.length;
  playersDec.disabled = setupNames.length <= MIN_PLAYERS;
  playersInc.disabled = setupNames.length >= MAX_PLAYERS;
  nameList.innerHTML = '';
  setupNames.forEach((nm, i) => {
    const li = el('li', { class: 'name-row' });
    const input = el('input', {
      type: 'text',
      value: nm,
      placeholder: 'Player ' + (i + 1),
      'aria-label': 'Player ' + (i + 1) + ' name',
      autocomplete: 'off',
    });
    input.addEventListener('input', () => { setupNames[i] = input.value; });
    li.appendChild(input);
    nameList.appendChild(li);
  });
}

/* ---------- Game rendering ---------- */
function renderGame() {
  // Header row: corner + one editable name per player.
  headRow.innerHTML = '';
  headRow.appendChild(el('th', { class: 'round-col corner', scope: 'col' }, 'Round'));
  state.players.forEach((p) => {
    const th = el('th', { class: 'player-col', scope: 'col', 'data-pid': p.id });
    const input = el('input', { type: 'text', class: 'name-input', value: p.name, 'aria-label': 'Player name', autocomplete: 'off' });
    input.addEventListener('input', () => {
      p.name = input.value;
      save();
      refreshScoreLabels(p.id);
      updateTotals();
    });
    th.appendChild(input);
    headRow.appendChild(th);
  });

  // Body: 11 rounds.
  scoreBody.innerHTML = '';
  for (let r = 0; r < ROUNDS; r++) {
    const tr = el('tr', { 'data-round': String(r) });
    const rh = el('th', { class: 'round-col', scope: 'row' });
    rh.appendChild(el('span', { class: 'round-num' }, String(r + 1)));
    rh.appendChild(el('span', { class: 'wild' }, WILD_LABELS[r] + ' wild'));
    tr.appendChild(rh);

    state.players.forEach((p) => {
      const td = el('td', { class: 'score-cell' });
      const input = el('input', {
        type: 'text',
        inputmode: 'numeric',
        pattern: '[0-9]*',
        class: 'score-input',
        'data-pid': p.id,
        'data-round': String(r),
        'aria-label': p.name + ' round ' + (r + 1) + ' score',
      });
      const v = state.scores[p.id] ? state.scores[p.id][r] : null;
      input.value = v == null ? '' : String(v);
      input.addEventListener('input', () => {
        const digits = onlyDigits(input.value);
        if (digits !== input.value) input.value = digits;
        setScore(p.id, r, digits === '' ? null : parseInt(digits, 10));
        updateTotals();
      });
      td.appendChild(input);
      tr.appendChild(td);
    });
    scoreBody.appendChild(tr);
  }

  // Footer: totals.
  totalRow.innerHTML = '';
  totalRow.appendChild(el('th', { class: 'round-col', scope: 'row' }, 'Total'));
  state.players.forEach((p) => {
    totalRow.appendChild(el('td', { class: 'total-cell', 'data-pid': p.id }));
  });

  updateTotals();
}

// Keep score-input aria-labels in sync when a player is renamed.
function refreshScoreLabels(pid) {
  const player = playerById(pid);
  if (!player) return;
  scoreBody.querySelectorAll('.score-input[data-pid="' + pid + '"]').forEach((input) => {
    const r = Number(input.getAttribute('data-round'));
    input.setAttribute('aria-label', player.name + ' round ' + (r + 1) + ' score');
  });
}

function updateTotals() {
  const totals = state.players.map((p) => ({ p, total: totalFor(p.id) }));
  if (totals.length === 0) return;

  const min = Math.min(...totals.map((t) => t.total));
  const max = Math.max(...totals.map((t) => t.total));
  const highlight = totals.length > 1 && min !== max;

  totals.forEach(({ p, total }) => {
    const cell = totalRow.querySelector('.total-cell[data-pid="' + p.id + '"]');
    if (cell) {
      cell.textContent = String(total);
      cell.classList.toggle('leader', highlight && total === min);
    }
  });

  if (isComplete()) {
    const winners = totals.filter((t) => t.total === min).map((t) => t.p.name);
    winnerBanner.hidden = false;
    winnerBanner.textContent =
      winners.length === 1
        ? '\u{1F3C6} ' + winners[0] + ' wins with ' + min + '!'
        : '\u{1F3C6} Tie at ' + min + ': ' + winners.join(', ');
  } else {
    winnerBanner.hidden = true;
    winnerBanner.textContent = '';
  }
}

/* ---------- Actions ---------- */
function startGame() {
  state = defaultState();
  state.started = true;
  setupNames.forEach((n) => addPlayerToState(n, 0));
  save();
  showGame();
}

function addPlayer(name, seed) {
  addPlayerToState(name, seed);
  save();
  renderGame();
}

function newGame() {
  state = defaultState();
  setupNames = ['Player 1', 'Player 2', 'Player 3'];
  save();
  renderSetup();
  showSetup();
}

/* ---------- Wiring ---------- */
playersInc.addEventListener('click', () => {
  if (setupNames.length < MAX_PLAYERS) {
    setupNames.push('Player ' + (setupNames.length + 1));
    renderSetup();
  }
});
playersDec.addEventListener('click', () => {
  if (setupNames.length > MIN_PLAYERS) {
    setupNames.pop();
    renderSetup();
  }
});
startBtn.addEventListener('click', startGame);

addPlayerBtn.addEventListener('click', () => {
  addName.value = '';
  addSeed.value = '0';
  // Reset returnValue so an Escape-dismiss can't replay the previous "add"
  // (Firefox/Safari don't clear it on a bare close request the way Chromium does).
  addDialog.returnValue = '';
  addDialog.showModal();
  addName.focus();
});
addCancel.addEventListener('click', () => addDialog.close('cancel'));
addSeed.addEventListener('input', () => { addSeed.value = onlyDigits(addSeed.value); });
addDialog.addEventListener('close', () => {
  if (addDialog.returnValue === 'add') {
    const seed = parseInt(onlyDigits(addSeed.value), 10) || 0;
    addPlayer(addName.value, seed);
  }
});

newGameBtn.addEventListener('click', () => {
  confirmDialog.returnValue = '';
  confirmDialog.showModal();
});
confirmCancel.addEventListener('click', () => confirmDialog.close('cancel'));
confirmDialog.addEventListener('close', () => {
  if (confirmDialog.returnValue === 'ok') newGame();
});

/* ---------- Init ---------- */
if (state.started && state.players.length > 0) {
  showGame();
} else {
  renderSetup();
  showSetup();
}
