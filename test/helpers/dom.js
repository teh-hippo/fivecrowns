import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const INDEX = fileURLToPath(new URL('../../index.html', import.meta.url));

// jsdom has no Web Animations API. This stand-in finishes synchronously when
// asked, which is enough to drive the reel through its phases.
function installFakeAnimations(window) {
  const pending = new Set();
  window.Element.prototype.animate = function animate() {
    const animation = {
      onfinish: null,
      oncancel: null,
      effect: {},
      play() {},
      pause() {},
      cancel() {
        pending.delete(animation);
        if (typeof animation.oncancel === 'function') animation.oncancel();
      },
      finish() {
        pending.delete(animation);
        if (typeof animation.onfinish === 'function') animation.onfinish();
      },
    };
    pending.add(animation);
    return animation;
  };
  window.Element.prototype.getAnimations = () => [...pending];
  window.finishAnimations = () => [...pending].forEach((animation) => animation.finish());
}

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    clear: () => data.clear(),
  };
}

// Boots index.html into jsdom and publishes the globals the browser modules
// expect. Returns a cleanup so tests do not leak globals into each other.
function bootDom({ animations = false, reducedMotion = false } = {}) {
  const dom = new JSDOM(readFileSync(INDEX, 'utf8'), { pretendToBeVisual: true });
  const { window } = dom;

  window.matchMedia = (query) => ({
    matches: reducedMotion && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });

  if (animations) installFakeAnimations(window);

  const had = {
    window: 'window' in globalThis,
    document: 'document' in globalThis,
    localStorage: 'localStorage' in globalThis,
  };
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = memoryStorage();

  return {
    dom,
    window,
    document: window.document,
    byId: (id) => window.document.getElementById(id),
    cleanup() {
      if (!had.window) delete globalThis.window;
      if (!had.document) delete globalThis.document;
      if (!had.localStorage) delete globalThis.localStorage;
      window.close();
    },
  };
}

function press(window, target, name, init = {}) {
  return target.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }),
  );
}

export { bootDom, memoryStorage, press };
