import { createApp } from './app/main.js';

// Best-effort protection against storage eviction.
if (navigator.storage && typeof navigator.storage.persist === 'function') {
  navigator.storage.persist().catch(() => {});
}

// Offline support is a bonus, never a precondition for starting a game.
if ('serviceWorker' in navigator) {
  // A worker that takes over a page it did not start has just replaced the
  // shell that page was built from. Markup comes from the network and modules
  // can still come from the cache, so for one load the two can disagree: new
  // buttons wired to code that has never heard of them, doing nothing when
  // tapped. Reloading once puts them back in step. A first visit has no
  // controller to change, so it is left alone.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', import.meta.url)).catch(() => {});
  });
}

createApp();
