// The app ships from the root of a GitHub Pages project site, so every path is
// resolved against this file's own location rather than the origin root.
const VERSION = 'v2';
const CACHE = 'fivecrowns-' + VERSION;

// Pages serves this repository's default branch directly, with no build step to
// fingerprint filenames, so nothing here can be told apart by its URL between
// one deploy and the next. Anything the app is built from is read from the
// network first for that reason; only the images, which carry no behaviour, are
// cheap enough to serve stale.
const CODE = /\.(?:js|css|html|webmanifest)$/;

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
  'app/main.js',
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

function store(key, response) {
  if (!response || !response.ok) return;
  const copy = response.clone();
  caches
    .open(CACHE)
    .then((cache) => cache.put(key, copy))
    .catch(() => {});
}

// The network decides what the app is; the cache only answers when it cannot be
// reached. Writing the fresh copy back as it passes keeps the offline shell one
// deploy behind at worst, rather than pinning it to whatever landed first.
function networkFirst(request, key = request) {
  return fetch(request)
    .then((response) => {
      store(key, response);
      return response;
    })
    .catch(() =>
      caches.match(key).then((cached) => {
        if (cached) return cached;
        if (request.mode === 'navigate') return offlineFallback();
        return new Response('Offline and this file is not cached.', {
          status: 504,
          headers: { 'Content-Type': 'text/plain' },
        });
      }),
    );
}

// Images never change how the app behaves, so they are served from cache
// immediately and refreshed in the background rather than made to wait.
function cacheFirst(request) {
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
    event.respondWith(networkFirst(request, new URL('index.html', self.registration.scope)));
    return;
  }
  event.respondWith(CODE.test(url.pathname) ? networkFirst(request) : cacheFirst(request));
});
