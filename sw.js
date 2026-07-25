// The app ships from the root of a GitHub Pages project site, so every path is
// resolved against this file's own location rather than the origin root.
const VERSION = 'v1';
const CACHE = 'fivecrowns-' + VERSION;

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'favicon.svg',
  'icon-192.png',
  'icon-512.png',
  'css/base.css',
  'css/scoreboard.css',
  'css/controls.css',
  'css/reel.css',
  'css/responsive.css',
  'app.js',
  'reel.js',
  'state.js',
  'games.js',
  'lib/dom.js',
  'lib/platform.js',
  'lib/random.js',
  'lib/storage.js',
  'lib/dealer-rig.js',
  'rules/shared.js',
  'rules/five-crowns.js',
  'rules/five00.js',
  'rules/greed.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((path) => new URL(path, self.registration.scope))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

function offlineFallback() {
  return caches.match(new URL('index.html', self.registration.scope)).then((cached) => {
    if (cached) return cached;
    return new Response('Offline and no cached copy of the app is available.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

// Navigations go to the network first so a deploy is picked up on the next
// online load. Pages serves this repository's default branch directly, with no
// build step to fingerprint filenames, so a cache-first shell would pin users
// to a stale version indefinitely.
function handleNavigation(request) {
  return fetch(request)
    .then((response) => {
      const copy = response.clone();
      caches
        .open(CACHE)
        .then((cache) => cache.put(new URL('index.html', self.registration.scope), copy))
        .catch(() => {});
      return response;
    })
    .catch(() => caches.match(request).then((cached) => cached || offlineFallback()));
}

// Static assets are served from cache immediately and refreshed in the
// background, so a reveal never waits on the network mid-game.
function handleAsset(request) {
  return caches.open(CACHE).then((cache) =>
    cache.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }
  event.respondWith(handleAsset(request));
});
