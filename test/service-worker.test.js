import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(root, 'sw.js'), 'utf8');

function precacheList() {
  const block = source.match(/const SHELL = \[([\s\S]*?)\];/);
  assert.ok(block, 'sw.js should declare a SHELL precache list');
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

// Everything index.html pulls in, which is what has to survive going offline.
function referencedAssets() {
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  const found = new Set();
  for (const [, href] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (!href.startsWith('http') && !href.startsWith('#')) found.add(href);
  }
  return [...found];
}

// Follows relative imports out from app.js, so a new module cannot be added
// without the precache list noticing.
function moduleGraph(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    const text = readFileSync(resolve(root, current), 'utf8');
    for (const [, spec] of text.matchAll(/from\s+'(\.[^']+)'/g)) {
      const target = resolve(dirname(resolve(root, current)), spec).slice(root.length + 1);
      queue.push(target);
    }
  }
  return [...seen];
}

test('every precached path exists on disk', () => {
  for (const path of precacheList()) {
    if (path === './') continue;
    assert.ok(existsSync(resolve(root, path)), `sw.js precaches missing file "${path}"`);
  }
});

test('the precache list covers every module the app loads', () => {
  const cached = new Set(precacheList());
  for (const path of moduleGraph('app.js')) {
    assert.ok(cached.has(path), `sw.js should precache "${path}"`);
  }
});

test('the precache list covers every asset index.html references', () => {
  const cached = new Set(precacheList());
  for (const path of referencedAssets()) {
    assert.ok(cached.has(path), `sw.js should precache "${path}"`);
  }
});

test('the service worker is registered and scoped to the app', () => {
  const app = readFileSync(resolve(root, 'app.js'), 'utf8');
  assert.match(app, /'serviceWorker' in navigator/, 'registration is feature-detected');
  assert.match(app, /navigator\.serviceWorker\.register\(/);
  assert.match(app, /new URL\('sw\.js', import\.meta\.url\)/, 'scope follows the deployed path');
});

test('the service worker ignores requests it must not touch', () => {
  assert.match(source, /request\.method !== 'GET'/, 'non-GET requests pass through');
  assert.match(source, /url\.origin !== self\.location\.origin/, 'cross-origin passes through');
});

test('stale caches are dropped when a new version activates', () => {
  assert.match(source, /caches\.delete/);
  assert.match(source, /clients\.claim/);
});

// The stale build this repository shipped for a fortnight was cached code, not
// a bad deploy: Pages serves the default branch with no fingerprinted
// filenames, so a cache-first read of app.js can never tell one build from the
// next.
test('the app is read from the network first so a deploy is picked up', () => {
  assert.match(source, /function networkFirst\(/, 'there is a network-first strategy');
  assert.match(
    source,
    /networkFirst\(request\)\s*:\s*cacheFirst\(request\)/,
    'code takes it and everything else falls back to cache-first',
  );
  const code = source.match(/const CODE = ([^;]+);/);
  assert.ok(code, 'sw.js declares which paths count as code');
  for (const path of ['app.js', 'app/main.js', 'reel.js', 'css/reel.css', 'index.html']) {
    assert.match(path, new RegExp(code[1].trim().slice(1, -1)), `"${path}" is treated as code`);
  }
  for (const path of ['icon-192.png', 'favicon.svg']) {
    assert.doesNotMatch(path, new RegExp(code[1].trim().slice(1, -1)), `"${path}" is not`);
  }
});

test('navigations and assets both survive going offline', () => {
  assert.match(source, /offlineFallback\(\)/, 'a navigation falls back to the cached shell');
  assert.match(source, /status: 504/, 'and an uncached asset fails loudly rather than hanging');
});
