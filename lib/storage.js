import { cap, unitSingular } from '../games.js';
import { defaultState, normalizeState, serializeState } from '../state.js';

const LAST_GAME_KEY = 'scorer:lastGame'; const NAMES_KEY = 'scorer:names';

function loadGame(game) {
  try {
    const raw = localStorage.getItem(game.storageKey); if (raw) return normalizeState(game, JSON.parse(raw));
  } catch (error) { console.warn('fivecrowns: ignoring corrupt or unavailable save', error); }
  return defaultState(game);
}

function loadRosters() {
  try {
    const value = JSON.parse(localStorage.getItem(NAMES_KEY)); return value && typeof value === 'object' ? value : {};
  } catch (_) { return {}; }
}

function rosterFor(gameId) {
  const raw = loadRosters()[gameId]; if (Array.isArray(raw)) return { last: raw.slice(), memory: raw.slice() };
  if (!raw || typeof raw !== 'object') return { last: [], memory: [] }; const last = Array.isArray(raw.last) ? raw.last.slice() : [];
  return { last, memory: Array.isArray(raw.memory) ? raw.memory.slice() : last.slice() };
}

function recentNameMemory(...groups) {
  const names = [], seen = new Set();
  groups.forEach((group) => {
    (Array.isArray(group) ? group : []).forEach((name) => {
      if (typeof name !== 'string') return; const clean = name.trim(), key = clean.toLowerCase();
      if (!clean || seen.has(key)) return; seen.add(key); names.push(clean);
    });
  }); return names;
}

function saveGame(game, state) {
  try {
    localStorage.setItem(game.storageKey, JSON.stringify(serializeState(game, state))); localStorage.setItem(LAST_GAME_KEY, game.id); if (!state.players.length) return;
    const rosters = loadRosters(); const previous = rosterFor(game.id); const last = state.players.map((player) => player.name);
    rosters[game.id] = { last, memory: recentNameMemory(last, previous.last, previous.memory) };
    localStorage.setItem(NAMES_KEY, JSON.stringify(rosters));
  } catch (_) { /* state remains available in memory */ }
}

function recalledNames(game) {
  const names = rosterFor(game.id).last;
  return names.every((name) => typeof name === 'string')
    && names.length >= game.minPlayers && names.length <= game.maxPlayers
    ? names.slice() : game.defaultNames();
}

function nextRecalledName(game, currentNames) {
  const used = new Set(currentNames.map((name) => (name || '').trim().toLowerCase()));
  const roster = rosterFor(game.id);
  for (const name of recentNameMemory(roster.last, roster.memory)) {
    if (typeof name !== 'string') continue; const clean = name.trim(); if (clean && !/^(player|side)\s+\d+$/i.test(clean) && !used.has(clean.toLowerCase())) return name;
  }
  return cap(unitSingular(game)) + ' ' + (currentNames.length + 1);
}

function lastGameId(games, fallback) {
  let id = null;
  try { id = localStorage.getItem(LAST_GAME_KEY); } catch (_) { /* storage unavailable */ }
  return id && games[id] ? id : fallback;
}

function hasStartedSave(game) { const state = loadGame(game); return state.started && state.players.length > 0; }

export { loadGame, saveGame, recalledNames, nextRecalledName, lastGameId, hasStartedSave };
