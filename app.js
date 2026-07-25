import { createApp } from './app/main.js';

// Best-effort protection against storage eviction.
if (navigator.storage && typeof navigator.storage.persist === 'function') {
  navigator.storage.persist().catch(() => {});
}

// Offline support is a bonus, never a precondition for starting a game.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', import.meta.url)).catch(() => {});
  });
}

createApp();
