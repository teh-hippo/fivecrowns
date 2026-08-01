import { el, clamp } from './lib/dom.js';
import { shuffle } from './lib/random.js';

const EFFECTS = Object.freeze({
  confetti: { label: 'Confetti', amount: 44, repeatMs: 1000 },
  explosion: { label: 'Explosion', amount: 30, repeatMs: 950 },
  lasers: { label: 'Lasers', amount: 5, repeatMs: 1050 },
  fireworks: { label: 'Fireworks', amount: 14, repeatMs: 1600 },
  sparkle: { label: 'Sparkle', amount: 20, repeatMs: 900 },
  coins: { label: 'Coin shower', amount: 16, repeatMs: 1100 },
  shockwave: { label: 'Shockwave', amount: 5, repeatMs: 1000 },
  neon: { label: 'Neon halo', amount: 4, repeatMs: 1000 },
  suits: { label: 'Suit rain', amount: 16, repeatMs: 1200 },
  streamers: { label: 'Streamers', amount: 12, repeatMs: 1300 },
  slotframe: { label: 'Slot frame', amount: 3, repeatMs: 800 },
  sunburst: { label: 'Sunburst', amount: 12, repeatMs: 950 },
  bubbles: { label: 'Bubbles', amount: 16, repeatMs: 1200 },
});
const DEFAULT_REEL_OPTIONS = Object.freeze({
  spinMs: 7200,
  spinCycles: 7,
  idlePxps: 260,
  fakeOutChance: 0.25,
  fakeOutHoldMs: 300,
  fakeOutBurstMs: 850,
  effect: 'random',
  effectAmount: EFFECTS.confetti.amount,
});
const FAKE_OUT_CHANCE_STEP = 0.05;
// Shared runtime and tuning bounds keep every preview production-valid.
const REEL_FIELDS = [
  {
    key: 'spinMs',
    id: 'spin-ms',
    label: 'Spin duration',
    min: 250,
    max: 12000,
    step: 50,
    unit: ' ms',
  },
  {
    key: 'spinCycles',
    id: 'spin-cycles',
    label: 'Travel',
    min: 1,
    max: 12,
    step: 1,
    unit: ' passes',
    integer: true,
  },
  {
    key: 'idlePxps',
    id: 'idle-speed',
    label: 'Idle speed',
    min: 50,
    max: 600,
    step: 10,
    unit: ' px/s',
  },
  {
    key: 'fakeOutChance',
    id: 'fakeout-chance',
    label: 'Fake-out chance',
    min: 0,
    max: 1,
    step: 0.05,
    scale: 100,
    unit: '%',
  },
  {
    key: 'fakeOutHoldMs',
    id: 'fakeout-hold',
    label: 'Fake-out pause',
    min: 0,
    max: 1500,
    step: 50,
    unit: ' ms',
  },
  {
    key: 'fakeOutBurstMs',
    id: 'fakeout-burst',
    label: 'Fake-out finish',
    min: 100,
    max: 2500,
    step: 50,
    unit: ' ms',
  },
  {
    key: 'effect',
    id: 'effect',
    label: 'Landing effect',
    options: [
      ['random', 'Random'],
      ...Object.keys(EFFECTS).map((key) => [key, EFFECTS[key].label]),
      ['none', 'None'],
    ],
  },
  {
    key: 'effectAmount',
    id: 'effect-amount',
    label: 'Effect amount',
    min: 1,
    max: 120,
    step: 1,
    integer: true,
  },
];
const FIELDS = {};
REEL_FIELDS.forEach((field) => {
  FIELDS[field.key] = field;
});
// Fourteen rendered passes safely contain the seven-pass default travel.
const GEOMETRY = Object.freeze({
  stripCycles: 14,
  landingCycle: 2,
  minIdleMs: 400,
  safetyMs: 800,
  trackStaggerMs: 180,
});
const DECEL = 'cubic-bezier(0.16, 0.9, 0.22, 1)';
const FAKEOUT_EASE = 'cubic-bezier(0.4, 0, 0.15, 1)';
const PODIUM_POP = 'cubic-bezier(0.2, 1.5, 0.4, 1)';
// Long enough for a place to land and be read before the next one arrives.
const PODIUM_STEP_MS = 950;
const PODIUM_IN_MS = 460;
const EFFECT_COLORS = ['#a78bfa', '#e3c14e', '#5fe39a', '#ff6b5e', '#ececf3'];
const EXPLOSION_COLORS = ['#fff3a3', '#ffd166', '#ff8c42', '#ff4d3d'];
const LASER_COLORS = ['#71f6ff', '#ff5cf4', '#a78bfa'];
const FIREWORK_COLORS = ['#a78bfa', '#e3c14e', '#5fe39a', '#ff6b5e', '#71f6ff', '#ff5cf4'];
const SUIT_GLYPHS = [
  ['\u265B', '#e3c14e'],
  ['\u2660', '#ececf3'],
  ['\u2665', '#ff6b5e'],
  ['\u2666', '#ff6b5e'],
  ['\u2663', '#ececf3'],
];
const EFFECT_NODE_LIMIT = 140;

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function setting(key, value) {
  const field = FIELDS[key];
  const result = clamp(numberOr(value, DEFAULT_REEL_OPTIONS[key]), field.min, field.max);
  return field.integer ? Math.round(result) : result;
}
function normaliseFakeOutMisses(value) {
  const misses = numberOr(value, 0);
  return Math.max(0, Math.floor(misses));
}
function fakeOutChanceForMisses(misses, baseChance = DEFAULT_REEL_OPTIONS.fakeOutChance) {
  return setting(
    'fakeOutChance',
    numberOr(baseChance, DEFAULT_REEL_OPTIONS.fakeOutChance) +
      normaliseFakeOutMisses(misses) * FAKE_OUT_CHANCE_STEP,
  );
}
function nextFakeOutMisses(misses, didFakeOut) {
  return didFakeOut ? 0 : normaliseFakeOutMisses(misses) + 1;
}
function reducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// No layout-dependent visibility check here: offsetParent is null for
// fixed-position subtrees and in non-rendering engines, which would silently
// empty the list and disable the trap entirely.
function focusableWithin(node) {
  if (!node || typeof node.querySelectorAll !== 'function') return [];
  return Array.prototype.filter.call(
    node.querySelectorAll(FOCUSABLE),
    (item) => !item.hidden && !item.closest('[hidden]'),
  );
}

// The overlay is a hand-rolled modal, so the background has to be hidden from
// assistive technology and keyboard order explicitly. inert does both where it
// is supported; aria-hidden covers browsers that lack it.
function backgroundSiblings(overlay) {
  if (!overlay || !overlay.parentNode) return [];
  return Array.prototype.filter.call(
    overlay.parentNode.children,
    (node) => node !== overlay && node.tagName !== 'SCRIPT',
  );
}

function deactivateBackground(overlay) {
  const affected = [];
  backgroundSiblings(overlay).forEach((node) => {
    affected.push({ node, inert: node.inert, hidden: node.getAttribute('aria-hidden') });
    try {
      node.inert = true;
    } catch (_) {
      /* inert is unsupported, aria-hidden below still applies */
    }
    node.setAttribute('aria-hidden', 'true');
  });
  return () => {
    affected.forEach(({ node, inert, hidden }) => {
      try {
        node.inert = !!inert;
      } catch (_) {
        /* nothing to restore */
      }
      if (hidden == null) node.removeAttribute('aria-hidden');
      else node.setAttribute('aria-hidden', hidden);
    });
  };
}
function animationObject(value) {
  return value != null && ['object', 'function'].includes(typeof value);
}
function hasAnimation(node) {
  try {
    return !!node && typeof node.animate === 'function';
  } catch (_) {
    return false;
  }
}
function animate(node, keyframes, options) {
  let method;
  try {
    method = node && node.animate;
  } catch (_) {
    return null;
  }
  if (typeof method !== 'function') return null;
  try {
    return method.call(node, keyframes, options);
  } catch (_) {
    return null;
  }
}
function usable(animation) {
  if (!animationObject(animation)) return false;
  try {
    return (
      typeof animation.cancel === 'function' &&
      typeof animation.play === 'function' &&
      'onfinish' in animation
    );
  } catch (_) {
    return false;
  }
}
function setHandler(animation, name, handler) {
  if (!animationObject(animation)) return false;
  try {
    if (!(name in animation)) return false;
    animation[name] = handler;
    return animation[name] === handler;
  } catch (_) {
    return false;
  }
}
function clearHandler(animation, name) {
  if (!animationObject(animation)) return;
  try {
    if (name in animation) animation[name] = null;
  } catch (_) {
    /* broken handler */
  }
}
function neutralize(animation) {
  if (!animationObject(animation)) return false;
  try {
    if (typeof animation.pause === 'function') animation.pause();
  } catch (_) {
    /* detach below */
  }
  try {
    if (!('effect' in animation)) return false;
    animation.effect = null;
    return animation.effect == null;
  } catch (_) {
    return false;
  }
}
function cancelResult(animation) {
  if (animation == null) return { stopped: true, failed: false };
  clearHandler(animation, 'onfinish');
  clearHandler(animation, 'oncancel');
  let cancel;
  try {
    cancel = animation.cancel;
  } catch (_) {
    cancel = null;
  }
  if (typeof cancel === 'function')
    try {
      cancel.call(animation);
      return { stopped: true, failed: false };
    } catch (_) {
      /* a throwing cancel() falls through to neutralize below */
    }
  return { stopped: neutralize(animation), failed: true };
}
function cancel(animation) {
  return cancelResult(animation).stopped;
}
function cancelAll(node) {
  let method;
  try {
    method = node && node.getAnimations;
  } catch (_) {
    return { stopped: false, failed: true };
  }
  if (typeof method !== 'function') return { stopped: true, failed: false };
  let animations;
  try {
    animations = Array.from(method.call(node));
  } catch (_) {
    return { stopped: false, failed: true };
  }
  let stopped = true,
    failed = false;
  animations.forEach((item) => {
    const result = cancelResult(item);
    stopped = stopped && result.stopped;
    failed = failed || result.failed;
  });
  return { stopped, failed };
}

function createReel({
  overlay,
  wheels,
  title,
  action,
  effects,
  picker,
  podium,
  replay,
  onBusyChange,
}) {
  let spinning = false,
    animationUnavailable = false,
    effectCleanup = null,
    activeClose = null,
    activeReplay = null;
  // The overlay treats any tap as "advance the reveal", so the picker has to
  // keep its own taps to itself. Replaying is a step back rather than on, so it
  // does the same.
  if (picker) picker.addEventListener('click', (event) => event.stopPropagation());
  if (replay)
    replay.addEventListener('click', (event) => {
      event.stopPropagation();
      if (activeReplay) activeReplay();
    });
  const clearPodium = () => {
    if (!podium) return;
    podium.querySelectorAll('.podium-row').forEach((row) => cancelAll(row));
    podium.hidden = true;
    podium.textContent = '';
  };
  // Opening and closing a hand-rolled modal is the same job whatever it shows.
  const beginModal = () => {
    const restoreFocusTo = document.activeElement;
    const restoreBackground = deactivateBackground(overlay);
    overlay.hidden = false;
    return () => {
      overlay.hidden = true;
      restoreBackground();
      if (restoreFocusTo && typeof restoreFocusTo.focus === 'function') {
        try {
          restoreFocusTo.focus();
        } catch (_) {
          /* the opener has gone, leave focus where the browser put it */
        }
      }
    };
  };
  // Tab never leaves the dialog: it wraps at both ends and pulls stray focus in.
  const keepTabInside = (event) => {
    const focusable = focusableWithin(overlay);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (!overlay.contains(active)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const clearPicker = () => {
    if (!picker) return;
    picker.hidden = true;
    picker.innerHTML = '';
  };
  // A picker only earns its place when there is something to choose between.
  // It opens on whoever the reveal already has, so it offers to correct an
  // answer rather than asking a question.
  const renderPicker = (spec) => {
    clearPicker();
    const choices = spec && Array.isArray(spec.options) ? spec.options : [];
    if (!picker || choices.length < 2) return;
    const select = el('select', { class: 'reel-picker-select' });
    choices.forEach((choice) =>
      select.appendChild(el('option', { value: choice.value }, choice.text)),
    );
    select.value = String(spec.value);
    // Arrow keys fire a change for every option they pass, and each one would
    // reseat the table underneath the reader. A keyboard choice is only acted
    // on once it is committed; pointer and touch pickers commit as they close,
    // so those still apply straight away.
    let byKey = false;
    const commit = () => {
      byKey = false;
      if (!select.value) return;
      if (select.value !== String(spec.value) && spec.onChange) spec.onChange(select.value);
    };
    select.addEventListener('pointerdown', () => {
      byKey = false;
    });
    select.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === 'Tab') commit();
      else byKey = true;
    });
    select.addEventListener('change', () => {
      if (!byKey) commit();
    });
    select.addEventListener('blur', () => {
      if (byKey) commit();
    });
    picker.append(el('span', { class: 'reel-picker-label' }, spec.label || ''), select);
    picker.hidden = false;
  };
  const setBusy = (value) => {
    spinning = value;
    if (onBusyChange) onBusyChange();
  };
  const translate = (track, y, fixed) =>
    track.strip.style.setProperty('transform', 'translateY(' + y + 'px)', fixed ? 'important' : '');
  const currentY = (track) => {
    const transform = window.getComputedStyle(track.strip).transform;
    if (!transform || transform === 'none') return 0;
    try {
      return new window.DOMMatrixReadOnly(transform).m42;
    } catch (_) {
      return 0;
    }
  };
  const reject = (track, animation) => {
    cancel(animation);
    cancelAll(track.strip);
    animationUnavailable = true;
  };
  const startAnimation = (track, keyframes, options) => {
    if (animationUnavailable) return null;
    const animation = animate(track.strip, keyframes, options);
    if (!usable(animation)) {
      reject(track, animation);
      return null;
    }
    return animation;
  };
  const stopAnimation = (track, animation) => {
    if (animation == null) return true;
    const result = cancelResult(animation);
    if (result.failed) animationUnavailable = true;
    if (result.stopped) return true;
    const remaining = cancelAll(track.strip);
    if (remaining.failed) animationUnavailable = true;
    return remaining.stopped;
  };
  const renderTracks = (specs) => {
    wheels.textContent = '';
    wheels.dataset.count = String(specs.length);
    return specs.map((spec, index) => {
      const wheel = el('div', {
        class: 'reel-wheel' + (spec.tone === 'cards' ? ' reel-wheel-cards' : ''),
      });
      wheel.appendChild(el('p', { class: 'reel-label' }, spec.label));
      const windowNode = el('div', { class: 'reel-window' });
      const strip = el('div', { class: 'reel-strip', 'aria-hidden': 'true' });
      windowNode.appendChild(strip);
      wheel.appendChild(windowNode);
      wheels.appendChild(wheel);
      return {
        spec,
        strip,
        direction: index % 2 === 0 ? 1 : -1,
        delayMs: index * GEOMETRY.trackStaggerMs,
      };
    });
  };
  const clearTracks = () => {
    let stopped = true;
    wheels.querySelectorAll('.reel-strip').forEach((strip) => {
      const result = cancelAll(strip);
      stopped = stopped && result.stopped;
      if (result.failed) animationUnavailable = true;
    });
    wheels.textContent = '';
    delete wheels.dataset.count;
    return stopped && !animationUnavailable;
  };
  const geometry = (track, fullSetSize, spinCycles) => {
    // Show every value so the reel looks full, but only land or fake-out on a still-remaining option.
    const { full, remaining, target } = track.spec;
    track.strip.innerHTML = '';
    const values = shuffle([...new Set(full)]);
    const length = values.length;
    const fullLength = Math.max(length, Math.floor(fullSetSize) || length);
    const travelCycles = Math.ceil((spinCycles * fullLength) / length);
    const stripCycles = Math.max(
      Math.ceil((GEOMETRY.stripCycles * fullLength) / length),
      travelCycles + GEOMETRY.landingCycle + 2,
    );
    const landingCycle =
      track.direction > 0 ? GEOMETRY.landingCycle : GEOMETRY.landingCycle + travelCycles;
    const landIndex = values.indexOf(target) + landingCycle * length;
    for (let cycle = 0; cycle < stripCycles; cycle++) {
      values.forEach((value) => track.strip.appendChild(el('div', { class: 'reel-item' }, value)));
    }
    const itemH = track.strip.children[0]
      ? track.strip.children[0].getBoundingClientRect().height
      : 0;
    const cycleH = length * itemH,
      landY = -(landIndex - 1) * itemH;
    const decoys = remaining.filter((value) => value !== target && values.indexOf(value) !== -1);
    const decoy = decoys.length ? decoys[Math.floor(Math.random() * decoys.length)] : target;
    const fakeIndex = values.indexOf(decoy) + landingCycle * length;
    return {
      cycleH,
      landY,
      landIndex,
      idleBase: landY - track.direction * travelCycles * cycleH,
      fakeOutY: -(fakeIndex - 1) * itemH,
    };
  };
  // Effects burst from whatever the overlay is showing: the reels during a
  // reveal, the podium at the end of a game.
  const focalNode = () => (podium && !podium.hidden ? podium : wheels);
  const bounds = () => {
    const rect = effects.getBoundingClientRect(),
      windowRect = focalNode().getBoundingClientRect();
    return {
      width: rect.width || window.innerWidth,
      height: rect.height || window.innerHeight,
      cx: windowRect.width
        ? windowRect.left - rect.left + windowRect.width / 2
        : (rect.width || window.innerWidth) / 2,
      cy: windowRect.height
        ? windowRect.top - rect.top + windowRect.height / 2
        : (rect.height || window.innerHeight) * 0.4,
    };
  };
  const emitConfetti = (add, amount) => {
    const area = bounds();
    let started = false;
    for (let i = 0; i < amount; i++) {
      const bit = el('div', { class: 'confetti-bit' });
      bit.style.background = EFFECT_COLORS[i % EFFECT_COLORS.length];
      const angle = Math.random() * Math.PI * 2;
      const distance = 80 + Math.random() * Math.min(240, area.width * 0.55);
      const dx = Math.cos(angle) * distance,
        dy = Math.sin(angle) * distance - 40;
      const rotation = Math.random() * 900 - 450;
      if (
        add(
          bit,
          [
            {
              transform: 'translate3d(' + area.cx + 'px,' + area.cy + 'px,0) rotate(0deg)',
              opacity: 1,
            },
            {
              transform:
                'translate3d(' +
                (area.cx + dx) +
                'px,' +
                (area.cy + dy) +
                'px,0) rotate(' +
                rotation * 0.6 +
                'deg)',
              opacity: 1,
              offset: 0.6,
            },
            {
              transform:
                'translate3d(' +
                (area.cx + dx) +
                'px,' +
                (area.cy + dy + 280) +
                'px,0) rotate(' +
                rotation +
                'deg)',
              opacity: 0,
            },
          ],
          {
            duration: 1400 + Math.random() * 700,
            easing: 'cubic-bezier(0.2,0.7,0.3,1)',
            fill: 'forwards',
          },
        )
      )
        started = true;
    }
    return started;
  };
  const emitExplosion = (add, amount) => {
    const area = bounds(),
      centre = 'translate3d(' + area.cx + 'px,' + area.cy + 'px,0) translate(-50%,-50%)';
    let started = add(
      el('div', { class: 'explosion-core' }),
      [
        { transform: centre + ' scale(0.15)', opacity: 0 },
        { transform: centre + ' scale(2.2)', opacity: 1, offset: 0.28 },
        { transform: centre + ' scale(4.8)', opacity: 0 },
      ],
      { duration: 820, easing: 'cubic-bezier(0.15,0.7,0.2,1)', fill: 'forwards' },
    );
    for (let i = 0; i < 3; i++) {
      const ring = el('div', { class: 'explosion-ring' });
      ring.style.borderColor = EXPLOSION_COLORS[i + 1];
      if (
        add(
          ring,
          [
            { transform: centre + ' scale(0.2)', opacity: 0.95 },
            { transform: centre + ' scale(' + (7 + i * 2) + ')', opacity: 0 },
          ],
          {
            duration: 850 + i * 180,
            delay: i * 90,
            easing: 'cubic-bezier(0.12,0.72,0.25,1)',
            fill: 'forwards',
          },
        )
      )
        started = true;
    }
    const count = Math.max(
      6,
      Math.round((amount * EFFECTS.explosion.amount) / DEFAULT_REEL_OPTIONS.effectAmount),
    );
    for (let i = 0; i < count; i++) {
      const spark = el('div', { class: 'explosion-spark' }),
        color = EXPLOSION_COLORS[i % EXPLOSION_COLORS.length];
      spark.style.background = color;
      spark.style.boxShadow = '0 0 8px ' + color;
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.24;
      const distance = 90 + Math.random() * Math.min(230, area.width * 0.5);
      const dx = Math.cos(angle) * distance,
        dy = Math.sin(angle) * distance;
      if (
        add(
          spark,
          [
            {
              transform: 'translate3d(' + area.cx + 'px,' + area.cy + 'px,0) scale(1.4)',
              opacity: 1,
            },
            {
              transform:
                'translate3d(' + (area.cx + dx) + 'px,' + (area.cy + dy) + 'px,0) scale(0.9)',
              opacity: 1,
              offset: 0.65,
            },
            {
              transform:
                'translate3d(' + (area.cx + dx) + 'px,' + (area.cy + dy + 75) + 'px,0) scale(0.2)',
              opacity: 0,
            },
          ],
          {
            duration: 800 + Math.random() * 450,
            delay: Math.random() * 90,
            easing: 'cubic-bezier(0.18,0.75,0.25,1)',
            fill: 'forwards',
          },
        )
      )
        started = true;
    }
    return started;
  };
  const emitLasers = (add, amount) => {
    const area = bounds(),
      length = Math.hypot(area.width, area.height) * 1.25;
    const count = Math.max(
      1,
      Math.round((amount * EFFECTS.lasers.amount) / DEFAULT_REEL_OPTIONS.effectAmount),
    );
    let started = false;
    for (let i = 0; i < count; i++) {
      const beam = el('div', { class: 'laser-beam' }),
        color = LASER_COLORS[i % LASER_COLORS.length];
      const angle = -58 + Math.random() * 116,
        sweep = (i % 2 ? -1 : 1) * (18 + Math.random() * 12);
      const x = area.cx - length / 2,
        y = area.cy + (i - (count - 1) / 2) * Math.min(34, area.height * 0.04);
      beam.style.width = length + 'px';
      beam.style.background = color;
      beam.style.boxShadow = '0 0 6px ' + color + ', 0 0 18px ' + color;
      if (
        add(
          beam,
          [
            {
              transform:
                'translate3d(' + x + 'px,' + (y - 18) + 'px,0) rotate(' + (angle - sweep) + 'deg)',
              opacity: 0,
            },
            { opacity: 0.92, offset: 0.14 },
            {
              transform:
                'translate3d(' + x + 'px,' + (y + 18) + 'px,0) rotate(' + (angle + sweep) + 'deg)',
              opacity: 0.92,
              offset: 0.86,
            },
            {
              transform:
                'translate3d(' +
                x +
                'px,' +
                (y + 24) +
                'px,0) rotate(' +
                (angle + sweep * 1.15) +
                'deg)',
              opacity: 0,
            },
          ],
          {
            duration: 1300 + Math.random() * 250,
            delay: i * 130,
            easing: 'ease-in-out',
            fill: 'forwards',
          },
        )
      )
        started = true;
    }
    return started;
  };
  const emitFireworks = (add, amount) => {
    const area = bounds();
    const scale = amount / DEFAULT_REEL_OPTIONS.effectAmount;
    const shells = Math.max(2, Math.round(3 * scale));
    const sparks = Math.max(8, Math.round(EFFECTS.fireworks.amount * scale));
    let started = false;
    for (let shell = 0; shell < shells; shell++) {
      const color = FIREWORK_COLORS[shell % FIREWORK_COLORS.length];
      const burstX = area.width * (0.2 + Math.random() * 0.6),
        burstY = area.height * (0.2 + Math.random() * 0.32);
      const launch = shell * 240,
        riseMs = 500 + Math.random() * 200;
      const rocket = el('div', { class: 'firework-rocket' });
      rocket.style.background = color;
      rocket.style.boxShadow = '0 0 6px ' + color;
      if (
        add(
          rocket,
          [
            {
              transform: 'translate3d(' + burstX + 'px,' + area.height + 'px,0) scaleY(1.4)',
              opacity: 0,
            },
            { opacity: 1, offset: 0.15 },
            {
              transform: 'translate3d(' + burstX + 'px,' + burstY + 'px,0) scaleY(0.6)',
              opacity: 0.9,
            },
          ],
          {
            duration: riseMs,
            delay: launch,
            easing: 'cubic-bezier(0.2,0.6,0.2,1)',
            fill: 'forwards',
          },
        )
      )
        started = true;
      const flash = el('div', { class: 'firework-flash' });
      flash.style.background = color;
      flash.style.boxShadow = '0 0 18px 6px ' + color;
      if (
        add(
          flash,
          [
            {
              transform:
                'translate3d(' + burstX + 'px,' + burstY + 'px,0) translate(-50%,-50%) scale(0.2)',
              opacity: 0,
            },
            {
              transform:
                'translate3d(' + burstX + 'px,' + burstY + 'px,0) translate(-50%,-50%) scale(1.6)',
              opacity: 1,
              offset: 0.5,
            },
            {
              transform:
                'translate3d(' + burstX + 'px,' + burstY + 'px,0) translate(-50%,-50%) scale(2.6)',
              opacity: 0,
            },
          ],
          { duration: 460, delay: launch + riseMs, easing: 'ease-out', fill: 'forwards' },
        )
      )
        started = true;
      for (let i = 0; i < sparks; i++) {
        const spark = el('div', { class: 'firework-spark' });
        spark.style.background = color;
        spark.style.boxShadow = '0 0 6px ' + color;
        const angle = (Math.PI * 2 * i) / sparks + (Math.random() - 0.5) * 0.3,
          distance = 50 + Math.random() * Math.min(150, area.width * 0.32);
        const dx = Math.cos(angle) * distance,
          dy = Math.sin(angle) * distance,
          drop = 60 + Math.random() * 60;
        if (
          add(
            spark,
            [
              {
                transform: 'translate3d(' + burstX + 'px,' + burstY + 'px,0) scale(1.1)',
                opacity: 1,
              },
              {
                transform:
                  'translate3d(' + (burstX + dx) + 'px,' + (burstY + dy) + 'px,0) scale(0.9)',
                opacity: 1,
                offset: 0.7,
              },
              {
                transform:
                  'translate3d(' +
                  (burstX + dx) +
                  'px,' +
                  (burstY + dy + drop) +
                  'px,0) scale(0.2)',
                opacity: 0,
              },
            ],
            {
              duration: 780 + Math.random() * 340,
              delay: launch + riseMs,
              easing: 'cubic-bezier(0.15,0.7,0.3,1)',
              fill: 'forwards',
            },
          )
        )
          started = true;
      }
    }
    return started;
  };
  const emitSparkle = (add, amount) => {
    const area = bounds();
    const count = Math.max(
      10,
      Math.round((EFFECTS.sparkle.amount * amount) / DEFAULT_REEL_OPTIONS.effectAmount),
    );
    let started = false;
    for (let i = 0; i < count; i++) {
      const star = el('div', { class: 'sparkle-star' }, '\u2726');
      star.style.color = EFFECT_COLORS[i % EFFECT_COLORS.length];
      const x = area.width * (0.08 + Math.random() * 0.84),
        y = area.height * (0.1 + Math.random() * 0.8);
      const size = 0.7 + Math.random() * 1.1,
        spin = Math.random() * 180 - 90,
        base = 'translate3d(' + x + 'px,' + y + 'px,0) translate(-50%,-50%)';
      if (
        add(
          star,
          [
            { transform: base + ' scale(0) rotate(0deg)', opacity: 0 },
            {
              transform: base + ' scale(' + size + ') rotate(' + spin + 'deg)',
              opacity: 1,
              offset: 0.5,
            },
            { transform: base + ' scale(0) rotate(' + spin * 2 + 'deg)', opacity: 0 },
          ],
          {
            duration: 620 + Math.random() * 520,
            delay: Math.random() * 700,
            easing: 'ease-in-out',
            fill: 'forwards',
          },
        )
      )
        started = true;
    }
    return started;
  };
  const emitCoins = (add, amount) => {
    const area = bounds();
    const count = Math.max(
      8,
      Math.round((EFFECTS.coins.amount * amount) / DEFAULT_REEL_OPTIONS.effectAmount),
    );
    const fall = area.height + 40;
    let started = false;
    for (let i = 0; i < count; i++) {
      const coin = el('div', { class: 'coin-disc' });
      const x = area.width * (0.08 + Math.random() * 0.84),
        drift = (Math.random() - 0.5) * 60,
        spins = 3 + Math.floor(Math.random() * 4);
      if (
        add(
          coin,
          [
            { transform: 'translate3d(' + x + 'px,-40px,0) rotateY(0deg)', opacity: 1 },
            {
              transform:
                'translate3d(' +
                (x + drift * 0.5) +
                'px,' +
                fall * 0.62 +
                'px,0) rotateY(' +
                spins * 180 +
                'deg)',
              opacity: 1,
              offset: 0.75,
            },
            {
              transform:
                'translate3d(' +
                (x + drift) +
                'px,' +
                fall +
                'px,0) rotateY(' +
                spins * 360 +
                'deg)',
              opacity: 0,
            },
          ],
          {
            duration: 900 + Math.random() * 500,
            delay: Math.random() * 500,
            easing: 'cubic-bezier(0.4,0.1,0.7,1)',
            fill: 'forwards',
          },
        )
      )
        started = true;
    }
    return started;
  };
  const emitShockwave = (add, amount) => {
    const area = bounds();
    const centre = 'translate3d(' + area.cx + 'px,' + area.cy + 'px,0) translate(-50%,-50%)';
    const rings = Math.max(
      3,
      Math.round((EFFECTS.shockwave.amount * amount) / DEFAULT_REEL_OPTIONS.effectAmount),
    );
    let started = false;
    for (let i = 0; i < rings; i++) {
      const ring = el('div', { class: 'shock-ring' });
      ring.style.borderColor = EFFECT_COLORS[i % EFFECT_COLORS.length];
      if (
        add(
          ring,
          [
            { transform: centre + ' scale(0.1)', opacity: 0.85 },
            { transform: centre + ' scale(' + (6 + i * 1.5) + ')', opacity: 0 },
          ],
          {
            duration: 900 + i * 120,
            delay: i * 180,
            easing: 'cubic-bezier(0.2,0.7,0.3,1)',
            fill: 'forwards',
          },
        )
      )
        started = true;
    }
    return started;
  };
  const emitNeon = (add, amount) => {
    const area = bounds();
    const centre = 'translate3d(' + area.cx + 'px,' + area.cy + 'px,0) translate(-50%,-50%)';
    const pulses = Math.max(
      2,
      Math.round((EFFECTS.neon.amount * amount) / DEFAULT_REEL_OPTIONS.effectAmount),
    );
    let started = false;
    const edge = el('div', { class: 'neon-edge' });
    if (
      add(edge, [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], {
        duration: 900,
        easing: 'ease-in-out',
        fill: 'forwards',
      })
    )
      started = true;
    for (let i = 0; i < pulses; i++) {
      const halo = el('div', { class: 'neon-halo' });
      halo.style.color = EFFECT_COLORS[i % 2];
      if (
        add(
          halo,
          [
            { transform: centre + ' scale(0.4)', opacity: 0 },
            { transform: centre + ' scale(1.2)', opacity: 0.95, offset: 0.4 },
            { transform: centre + ' scale(2.6)', opacity: 0 },
          ],
          {
            duration: 1000 + i * 160,
            delay: i * 220,
            easing: 'cubic-bezier(0.2,0.7,0.3,1)',
            fill: 'forwards',
          },
        )
      )
        started = true;
    }
    return started;
  };
  const emitSuits = (add, amount) => {
    const area = bounds();
    const count = Math.max(
      8,
      Math.round((EFFECTS.suits.amount * amount) / DEFAULT_REEL_OPTIONS.effectAmount),
    );
    const fall = area.height + 50;
    let started = false;
    for (let i = 0; i < count; i++) {
      const [glyph, color] = SUIT_GLYPHS[i % SUIT_GLYPHS.length];
      const node = el('div', { class: 'suit-glyph' }, glyph);
      node.style.color = color;
      const x = area.width * (0.06 + Math.random() * 0.88),
        drift = (Math.random() - 0.5) * 70,
        rot = Math.random() * 360 - 180;
      if (
        add(
          node,
          [
            { transform: 'translate3d(' + x + 'px,-50px,0) rotate(0deg)', opacity: 0 },
            { opacity: 1, offset: 0.12 },
            {
              transform:
                'translate3d(' + (x + drift) + 'px,' + fall + 'px,0) rotate(' + rot + 'deg)',
              opacity: 0,
            },
          ],
          {
            duration: 1100 + Math.random() * 600,
            delay: Math.random() * 600,
            easing: 'cubic-bezier(0.3,0.2,0.5,1)',
            fill: 'forwards',
          },
        )
      )
        started = true;
    }
    return started;
  };
  const emitStreamers = (add, amount) => {
    const area = bounds();
    const count = Math.max(
      6,
      Math.round((EFFECTS.streamers.amount * amount) / DEFAULT_REEL_OPTIONS.effectAmount),
    );
    const fall = area.height + 60;
    let started = false;
    for (let i = 0; i < count; i++) {
      const ribbon = el('div', { class: 'streamer' });
      ribbon.style.background = FIREWORK_COLORS[i % FIREWORK_COLORS.length];
      const x = area.width * (0.05 + Math.random() * 0.9),
        sway = 30 + Math.random() * 50,
        dir = i % 2 ? 1 : -1,
        tilt = 20 + Math.random() * 40;
      if (
        add(
          ribbon,
          [
            {
              transform:
                'translate3d(' + x + 'px,-60px,0) rotate(' + dir * tilt + 'deg) scaleY(0.4)',
              opacity: 0,
            },
            { opacity: 1, offset: 0.15 },
            {
              transform:
                'translate3d(' +
                (x + dir * sway) +
                'px,' +
                fall * 0.5 +
                'px,0) rotate(' +
                -dir * tilt +
                'deg) scaleY(1)',
              opacity: 1,
              offset: 0.55,
            },
            {
              transform:
                'translate3d(' +
                (x - dir * sway) +
                'px,' +
                fall +
                'px,0) rotate(' +
                dir * tilt +
                'deg) scaleY(1)',
              opacity: 0,
            },
          ],
          {
            duration: 1300 + Math.random() * 600,
            delay: Math.random() * 500,
            easing: 'cubic-bezier(0.37,0,0.63,1)',
            fill: 'forwards',
          },
        )
      )
        started = true;
    }
    return started;
  };
  const emitSlotFrame = (add, amount) => {
    const rect = effects.getBoundingClientRect(),
      wr = wheels.getBoundingClientRect(),
      pad = 14;
    const left = wr.left - rect.left - pad,
      top = wr.top - rect.top - pad,
      w = (wr.width || rect.width) + pad * 2,
      h = (wr.height || rect.height) + pad * 2;
    const frames = Math.max(
      1,
      Math.round((EFFECTS.slotframe.amount * amount) / DEFAULT_REEL_OPTIONS.effectAmount),
    );
    let started = false;
    for (let i = 0; i < frames; i++) {
      const frame = el('div', { class: 'slot-frame' });
      frame.style.color = EFFECT_COLORS[i % 2];
      frame.style.left = left + 'px';
      frame.style.top = top + 'px';
      frame.style.width = w + 'px';
      frame.style.height = h + 'px';
      if (
        add(
          frame,
          [
            { transform: 'scale(0.96)', opacity: 0 },
            { transform: 'scale(1)', opacity: 1, offset: 0.25 },
            { transform: 'scale(1.05)', opacity: 0 },
          ],
          { duration: 700 + i * 120, delay: i * 140, easing: 'ease-out', fill: 'forwards' },
        )
      )
        started = true;
    }
    return started;
  };
  const emitSunburst = (add, amount) => {
    const area = bounds();
    const rays = Math.max(
      6,
      Math.round((EFFECTS.sunburst.amount * amount) / DEFAULT_REEL_OPTIONS.effectAmount),
    );
    const length = Math.min(area.width, area.height) * 0.7;
    let started = false;
    for (let i = 0; i < rays; i++) {
      const ray = el('div', { class: 'sun-ray' });
      ray.style.background = FIREWORK_COLORS[i % FIREWORK_COLORS.length];
      ray.style.height = length + 'px';
      const angle = (360 * i) / rays,
        pivot = 'translate3d(' + area.cx + 'px,' + area.cy + 'px,0) rotate(' + angle + 'deg)';
      if (
        add(
          ray,
          [
            { transform: pivot + ' scaleY(0)', opacity: 0 },
            { transform: pivot + ' scaleY(1)', opacity: 0.9, offset: 0.4 },
            {
              transform:
                'translate3d(' +
                area.cx +
                'px,' +
                area.cy +
                'px,0) rotate(' +
                (angle + 24) +
                'deg) scaleY(1)',
              opacity: 0,
            },
          ],
          {
            duration: 700 + Math.random() * 300,
            delay: Math.floor(i / 2) * 40,
            easing: 'cubic-bezier(0.2,0.7,0.3,1)',
            fill: 'forwards',
          },
        )
      )
        started = true;
    }
    return started;
  };
  const emitBubbles = (add, amount) => {
    const area = bounds();
    const count = Math.max(
      8,
      Math.round((EFFECTS.bubbles.amount * amount) / DEFAULT_REEL_OPTIONS.effectAmount),
    );
    const rise = -(area.height + 60);
    let started = false;
    for (let i = 0; i < count; i++) {
      const bubble = el('div', { class: 'bubble' });
      const size = 10 + Math.random() * 22;
      bubble.style.width = size + 'px';
      bubble.style.height = size + 'px';
      const x = area.width * (0.06 + Math.random() * 0.88),
        wobble = 18 + Math.random() * 26,
        dir = i % 2 ? 1 : -1,
        startY = area.height + 20;
      if (
        add(
          bubble,
          [
            { transform: 'translate3d(' + x + 'px,' + startY + 'px,0) scale(0.6)', opacity: 0 },
            { opacity: 0.85, offset: 0.15 },
            {
              transform:
                'translate3d(' +
                (x + dir * wobble) +
                'px,' +
                (startY + rise * 0.55) +
                'px,0) scale(1)',
              opacity: 0.85,
              offset: 0.6,
            },
            {
              transform:
                'translate3d(' + (x - dir * wobble) + 'px,' + (startY + rise) + 'px,0) scale(1.25)',
              opacity: 0,
            },
          ],
          {
            duration: 1300 + Math.random() * 700,
            delay: Math.random() * 700,
            easing: 'cubic-bezier(0.37,0,0.63,1)',
            fill: 'forwards',
          },
        )
      )
        started = true;
    }
    return started;
  };
  const emitters = {
    confetti: emitConfetti,
    explosion: emitExplosion,
    lasers: emitLasers,
    fireworks: emitFireworks,
    sparkle: emitSparkle,
    coins: emitCoins,
    shockwave: emitShockwave,
    neon: emitNeon,
    suits: emitSuits,
    streamers: emitStreamers,
    slotframe: emitSlotFrame,
    sunburst: emitSunburst,
    bubbles: emitBubbles,
  };
  const stopEffects = () => {
    const cleanup = effectCleanup;
    effectCleanup = null;
    try {
      if (cleanup) cleanup();
    } catch (_) {
      /* confirmation must still close */
    }
    effects.textContent = '';
    delete effects.dataset.effect;
  };
  const startEffects = (type, amount) => {
    stopEffects();
    if (!type || reducedMotion() || !hasAnimation(effects)) return;
    const animations = new Set(),
      effectAmount = setting('effectAmount', amount);
    let timer = null,
      stopped = false;
    const add = (node, keyframes, options) => {
      if (effects.childElementCount >= EFFECT_NODE_LIMIT || !hasAnimation(node)) return false;
      effects.appendChild(node);
      const animation = animate(node, keyframes, options);
      if (!usable(animation)) {
        cancel(animation);
        node.remove();
        return false;
      }
      const discard = () => {
        animations.delete(animation);
        node.remove();
      };
      if (
        !setHandler(animation, 'onfinish', discard) ||
        !setHandler(animation, 'oncancel', discard)
      ) {
        cancel(animation);
        node.remove();
        return false;
      }
      animations.add(animation);
      return true;
    };
    const emit = emitters[type] || emitConfetti;
    const repeat = () => {
      if (stopped) return;
      if (!emit(add, effectAmount)) {
        stopEffects();
        return;
      }
      timer = setTimeout(repeat, EFFECTS[type].repeatMs);
    };
    effects.dataset.effect = type;
    effectCleanup = () => {
      stopped = true;
      if (timer != null) clearTimeout(timer);
      Array.from(animations).forEach(cancel);
      animations.clear();
    };
    repeat();
  };
  const effectType = (type) => {
    if (type === 'none') return null;
    return EFFECTS[type]
      ? type
      : Object.keys(EFFECTS)[Math.floor(Math.random() * Object.keys(EFFECTS).length)];
  };

  function show({ reels, resultText, round, fullSetSize, options, onConfirm, onLand, onClose }) {
    const supplied = options || {};
    const settings = {
      spinMs: setting('spinMs', supplied.spinMs),
      spinCycles: setting('spinCycles', supplied.spinCycles),
      idlePxps: setting('idlePxps', supplied.idlePxps),
      fakeOutChance: setting('fakeOutChance', supplied.fakeOutChance),
      fakeOutHoldMs: setting('fakeOutHoldMs', supplied.fakeOutHoldMs),
      fakeOutBurstMs: setting('fakeOutBurstMs', supplied.fakeOutBurstMs),
      effect: supplied.effect || DEFAULT_REEL_OPTIONS.effect,
      effectAmount: setting('effectAmount', supplied.effectAmount),
      title: supplied.title || 'Round ' + (round + 1),
    };
    const valid =
      Array.isArray(reels) &&
      reels.length > 0 &&
      reels.every(
        (spec) =>
          spec &&
          Array.isArray(spec.full) &&
          spec.full.length > 0 &&
          spec.full.indexOf(spec.target) !== -1 &&
          Array.isArray(spec.remaining) &&
          spec.remaining.length > 0 &&
          spec.remaining.indexOf(spec.target) !== -1,
      );
    stopEffects();
    if (!valid || animationUnavailable || !clearTracks()) return false;
    clearPodium();
    setBusy(true);
    title.textContent = settings.title;
    action.hidden = false;
    action.textContent = 'Spin';
    renderPicker(supplied.picker);
    const endModal = beginModal();
    const tracks = renderTracks(reels);
    const geos = tracks.map((track) => geometry(track, fullSetSize, settings.spinCycles));
    const fakeOut =
      reels[0].remaining.length > 1 &&
      geos.every((geo) => geo.cycleH > 0) &&
      Math.random() < settings.fakeOutChance;
    const maxDelayMs = tracks.reduce((max, track) => Math.max(max, track.delayMs), 0);
    const selectedMs =
      settings.spinMs +
      maxDelayMs +
      (fakeOut ? settings.fakeOutHoldMs + settings.fakeOutBurstMs + maxDelayMs : 0);
    let phase = 'idle',
      idles = [],
      selections = [],
      fakeTimer = null,
      safetyTimer = null,
      fakeOutShown = false;
    const clearTimers = () => {
      if (fakeTimer != null) clearTimeout(fakeTimer);
      if (safetyTimer != null) clearTimeout(safetyTimer);
      fakeTimer = safetyTimer = null;
    };
    const stopAnimations = (animations) => {
      let stopped = true;
      tracks.forEach((track, index) => {
        stopped = stopAnimation(track, animations[index]) && stopped;
      });
      return stopped;
    };
    const land = () => {
      if (phase === 'confirm' || phase === 'closed') return;
      phase = 'confirm';
      clearPicker();
      clearTimers();
      stopAnimations(idles);
      stopAnimations(selections);
      idles = [];
      selections = [];
      const results = tracks.map((track, index) => {
        const geo = geos[index];
        translate(track, geo.landY, true);
        const winner = track.strip.children[geo.landIndex];
        if (winner) winner.classList.add('reel-target');
        return winner ? winner.textContent : '';
      });
      title.textContent = resultText || results.filter(Boolean).join(' \u00b7 ') || settings.title;
      action.hidden = false;
      action.textContent = 'Confirm';
      // Focus was parked on the overlay for the spin. Hand it back now there
      // is something to press again, so the keyboard can confirm the round.
      const focused = document.activeElement;
      if (focused === overlay || !overlay.contains(focused)) action.focus();
      const type = effectType(settings.effect);
      startEffects(type, settings.effectAmount);
      if (onLand) onLand(type, fakeOutShown);
    };
    // A dismissed reveal is one the caller means to reopen, so it does not
    // count as confirmed and the round stays hidden.
    const close = (confirmed = true) => {
      if (phase === 'closed') return;
      phase = 'closed';
      activeClose = null;
      overlay.removeEventListener('click', onTap);
      overlay.removeEventListener('keydown', onKeyDown);
      clearTimers();
      clearPicker();
      stopAnimations(idles);
      stopAnimations(selections);
      stopEffects();
      // The button is shared with every later reveal, so it is never left
      // hidden by a reveal that has finished with it.
      action.hidden = false;
      if (confirmed && onConfirm) onConfirm();
      endModal();
      setBusy(false);
      if (onClose) onClose();
    };
    const startSelections = (from, to, duration, easing, done) => {
      const started = [];
      for (let i = 0; i < tracks.length; i++) {
        const animation = startAnimation(
          tracks[i],
          [
            { transform: 'translateY(' + from[i] + 'px)' },
            { transform: 'translateY(' + to[i] + 'px)' },
          ],
          { duration, delay: tracks[i].delayMs, easing, fill: 'forwards' },
        );
        if (!animation) {
          stopAnimations(started);
          land();
          return false;
        }
        started.push(animation);
      }
      let pending = started.length;
      const finish = () => {
        if (phase !== 'spin' || pending === 0) return;
        pending--;
        if (pending === 0) done();
      };
      for (let i = 0; i < started.length; i++) {
        if (!setHandler(started[i], 'onfinish', finish)) {
          animationUnavailable = true;
          stopAnimations(started);
          land();
          return false;
        }
      }
      selections = started;
      return true;
    };
    const finishFakeOut = () => {
      if (phase !== 'spin') return;
      const animations = selections;
      selections = [];
      if (!stopAnimations(animations) || animationUnavailable) {
        land();
        return;
      }
      tracks.forEach((track, index) => translate(track, geos[index].fakeOutY, false));
      fakeOutShown = true;
      fakeTimer = setTimeout(() => {
        fakeTimer = null;
        if (phase === 'spin') {
          startSelections(
            geos.map((geo) => geo.fakeOutY),
            geos.map((geo) => geo.landY),
            settings.fakeOutBurstMs,
            FAKEOUT_EASE,
            land,
          );
        }
      }, settings.fakeOutHoldMs);
    };
    const spin = () => {
      if (phase !== 'idle') return;
      phase = 'spin';
      clearPicker();
      // A spin runs its course: there is nothing to press while it does, so
      // the button steps aside rather than offering a way to cut it short.
      // The overlay takes focus first, because a dialog with nothing focusable
      // in it drops focus to the document, and the key handling and the Tab
      // trap are bound to the overlay.
      overlay.focus();
      action.hidden = true;
      safetyTimer = setTimeout(() => {
        safetyTimer = null;
        if (phase === 'spin') land();
      }, selectedMs + GEOMETRY.safetyMs);
      const current = tracks.map(currentY),
        animations = idles;
      idles = [];
      if (!stopAnimations(animations) || animationUnavailable) {
        land();
        return;
      }
      tracks.forEach((track, index) => translate(track, current[index], false));
      startSelections(
        current,
        geos.map((geo) => (fakeOut ? geo.fakeOutY : geo.landY)),
        settings.spinMs,
        DECEL,
        fakeOut ? finishFakeOut : land,
      );
    };
    const onTap = () => {
      if (phase === 'idle') spin();
      else if (phase === 'confirm') close();
    };
    // Escape follows the same progression as a tap rather than abandoning the
    // reveal, so a keyboard user cannot skip past an unconfirmed round. A spin
    // in flight ignores both: it is watched, not raced.
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        // A native control owns its own Escape: closing the dealer dropdown
        // must not start the spin and strip the choice away.
        if (picker && picker.contains(event.target)) return;
        event.preventDefault();
        onTap();
        return;
      }
      if (event.key !== 'Tab') return;
      keepTabInside(event);
    };
    activeClose = close;
    overlay.addEventListener('click', onTap);
    overlay.addEventListener('keydown', onKeyDown);
    action.focus();
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i],
        geo = geos[i];
      translate(track, geo.idleBase, false);
      const idleMs = Math.max(GEOMETRY.minIdleMs, (geo.cycleH / settings.idlePxps) * 1000);
      const animation = startAnimation(
        track,
        [
          { transform: 'translateY(' + geo.idleBase + 'px)' },
          { transform: 'translateY(' + (geo.idleBase + track.direction * geo.cycleH) + 'px)' },
        ],
        { duration: idleMs, delay: -track.delayMs, iterations: Infinity, easing: 'linear' },
      );
      if (!animation) {
        land();
        return true;
      }
      idles.push(animation);
    }
    return true;
  }

  // The end of a game deserves more than a line of text, so the overlay counts
  // the podium down: third, then second, then whoever won, each arriving on its
  // own. The places arrive in the order they are to be revealed. Nothing is
  // committed either way, so it can be watched again without ending anything
  // twice.
  function celebrate({ title: heading, places, resultText, effect, effectAmount, onClose }) {
    const listed = (Array.isArray(places) ? places : []).filter(
      (place) => place && place.name != null,
    );
    if (spinning || !podium || !replay || !listed.length) return false;
    stopEffects();
    clearTracks();
    clearPicker();
    clearPodium();
    setBusy(true);
    // A static podium still says who won, so an engine that cannot animate gets
    // the standings rather than nothing at all.
    const animated = !reducedMotion() && hasAnimation(podium);
    podium.hidden = false;
    const rows = listed.map((place) => {
      const row = el('li', {
        class: 'podium-row' + (place.place === 1 ? ' podium-first' : ''),
        'data-place': String(place.place),
      });
      row.append(
        el('span', { class: 'podium-place' }, place.label),
        el('span', { class: 'podium-name' }, place.name),
        el('span', { class: 'podium-score' }, String(place.score)),
      );
      podium.appendChild(row);
      return row;
    });
    const endModal = beginModal();
    let phase = 'reveal',
      stepTimer = null;
    const announce = (place) => place.label + ' \u00b7 ' + place.name + ' \u00b7 ' + place.score;
    const revealRow = (row, winner) => {
      if (!animated) return;
      animate(
        row,
        [
          {
            opacity: 0,
            transform: winner ? 'translateY(28px) scale(0.84)' : 'translateY(18px) scale(0.96)',
          },
          { opacity: 1, transform: 'none' },
        ],
        {
          duration: winner ? PODIUM_IN_MS * 1.5 : PODIUM_IN_MS,
          easing: winner ? PODIUM_POP : DECEL,
          fill: 'backwards',
        },
      );
    };
    const finish = (text) => {
      if (phase === 'closed') return;
      phase = 'done';
      title.textContent = text;
      action.hidden = false;
      action.disabled = false;
      action.textContent = 'Done';
      replay.hidden = false;
      replay.disabled = false;
      replay.textContent = 'Replay';
      startEffects(effectType(effect), effectAmount);
      const focused = document.activeElement;
      if (focused === overlay || !overlay.contains(focused)) action.focus();
    };
    const play = () => {
      if (phase === 'closed') return;
      phase = 'reveal';
      if (stepTimer != null) clearTimeout(stepTimer);
      stepTimer = null;
      stopEffects();
      rows.forEach((row) => {
        cancelAll(row);
        row.hidden = true;
      });
      title.textContent = heading || '';
      replay.hidden = true;
      if (!animated) {
        rows.forEach((row) => {
          row.hidden = false;
        });
        finish(resultText || heading || '');
        return;
      }
      // Nothing to press while the countdown runs, the same as a spin in
      // flight, so the dialog holds focus rather than letting it fall out.
      action.hidden = true;
      overlay.focus();
      let index = 0;
      const step = () => {
        stepTimer = null;
        if (phase !== 'reveal') return;
        const place = listed[index];
        const row = rows[index];
        const winner = index === rows.length - 1;
        index++;
        row.hidden = false;
        revealRow(row, winner);
        if (winner) finish(resultText || announce(place));
        else {
          title.textContent = announce(place);
          stepTimer = setTimeout(step, PODIUM_STEP_MS);
        }
      };
      step();
    };
    const close = () => {
      if (phase === 'closed') return;
      phase = 'closed';
      activeClose = null;
      activeReplay = null;
      overlay.removeEventListener('click', onTap);
      overlay.removeEventListener('keydown', onKeyDown);
      if (stepTimer != null) clearTimeout(stepTimer);
      stepTimer = null;
      stopEffects();
      clearPodium();
      replay.hidden = true;
      replay.disabled = false;
      // Both buttons are shared with every later reveal, so neither is left
      // hidden or held back by one that has finished with them.
      action.hidden = false;
      action.disabled = false;
      endModal();
      setBusy(false);
      if (onClose) onClose();
    };
    const onTap = () => {
      if (phase === 'done') close();
    };
    // A countdown runs its course, as a spin does, so Escape only answers once
    // there is a result to dismiss.
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onTap();
        return;
      }
      if (event.key !== 'Tab') return;
      keepTabInside(event);
    };
    activeClose = close;
    activeReplay = play;
    overlay.addEventListener('click', onTap);
    overlay.addEventListener('keydown', onKeyDown);
    play();
    return true;
  }

  return {
    show,
    celebrate,
    // Closes an open reveal without committing it, for callers that need to
    // rebuild the spin from changed state.
    dismiss: () => {
      if (activeClose) activeClose(false);
    },
    isBusy: () => spinning,
    canAnimate: () => !reducedMotion() && hasAnimation(wheels) && !animationUnavailable,
  };
}

export { DEFAULT_REEL_OPTIONS, REEL_FIELDS, createReel, fakeOutChanceForMisses, nextFakeOutMisses };
