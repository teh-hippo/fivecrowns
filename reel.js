import { el, clamp } from './lib/dom.js';

const EFFECTS = Object.freeze({
  confetti: { label: 'Confetti', amount: 44, repeatMs: 1000 },
  explosion: { label: 'Explosion', amount: 30, repeatMs: 950 },
  lasers: { label: 'Lasers', amount: 5, repeatMs: 1050 },
  fireworks: { label: 'Fireworks', amount: 14, repeatMs: 1600 },
  sparkle: { label: 'Sparkle', amount: 20, repeatMs: 900 },
  coins: { label: 'Coin shower', amount: 16, repeatMs: 1100 },
  shockwave: { label: 'Shockwave', amount: 5, repeatMs: 1000 },
});
const DEFAULT_REEL_OPTIONS = Object.freeze({
  spinMs: 7200, spinCycles: 7, idlePxps: 260, fakeOutChance: 0.25,
  fakeOutHoldMs: 300, fakeOutBurstMs: 850, effect: 'random', effectAmount: EFFECTS.confetti.amount,
});
// Shared runtime and tuning bounds keep every preview production-valid.
const REEL_FIELDS = [
  { key: 'spinMs', id: 'spin-ms', label: 'Spin duration', min: 250, max: 12000, step: 50, unit: ' ms' },
  { key: 'spinCycles', id: 'spin-cycles', label: 'Travel', min: 1, max: 12, step: 1, unit: ' passes', integer: true },
  { key: 'idlePxps', id: 'idle-speed', label: 'Idle speed', min: 50, max: 600, step: 10, unit: ' px/s' },
  { key: 'fakeOutChance', id: 'fakeout-chance', label: 'Fake-out chance', min: 0, max: 1, step: 0.05, scale: 100, unit: '%' },
  { key: 'fakeOutHoldMs', id: 'fakeout-hold', label: 'Fake-out pause', min: 0, max: 1500, step: 50, unit: ' ms' },
  { key: 'fakeOutBurstMs', id: 'fakeout-burst', label: 'Fake-out finish', min: 100, max: 2500, step: 50, unit: ' ms' },
  { key: 'effect', id: 'effect', label: 'Landing effect', options: [['random', 'Random'], ...Object.keys(EFFECTS).map((key) => [key, EFFECTS[key].label]), ['none', 'None']] },
  { key: 'effectAmount', id: 'effect-amount', label: 'Effect amount', min: 1, max: 120, step: 1, integer: true },
]; const FIELDS = {}; REEL_FIELDS.forEach((field) => { FIELDS[field.key] = field; });
// Fourteen rendered passes safely contain the seven-pass default travel.
const GEOMETRY = Object.freeze({
  stripCycles: 14, landingCycle: 2, minIdleMs: 400, safetyMs: 800, trackStaggerMs: 180,
}); const DECEL = 'cubic-bezier(0.16, 0.9, 0.22, 1)';
const FAKEOUT_EASE = 'cubic-bezier(0.4, 0, 0.15, 1)'; const EFFECT_COLORS = ['#a78bfa', '#e3c14e', '#5fe39a', '#ff6b5e', '#ececf3'];
const EXPLOSION_COLORS = ['#fff3a3', '#ffd166', '#ff8c42', '#ff4d3d']; const LASER_COLORS = ['#71f6ff', '#ff5cf4', '#a78bfa']; const FIREWORK_COLORS = ['#a78bfa', '#e3c14e', '#5fe39a', '#ff6b5e', '#71f6ff', '#ff5cf4']; const EFFECT_NODE_LIMIT = 140;

function numberOr(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function setting(key, value) {
  const field = FIELDS[key]; const result = clamp(numberOr(value, DEFAULT_REEL_OPTIONS[key]), field.min, field.max); return field.integer ? Math.round(result) : result;
}
function reducedMotion() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
function animationObject(value) { return value != null && ['object', 'function'].includes(typeof value); }
function hasAnimation(node) { try { return !!node && typeof node.animate === 'function'; } catch (_) { return false; } }
function animate(node, keyframes, options) {
  let method; try { method = node && node.animate; } catch (_) { return null; }
  if (typeof method !== 'function') return null;
  try { return method.call(node, keyframes, options); } catch (_) { return null; }
}
function usable(animation) {
  if (!animationObject(animation)) return false;
  try { return typeof animation.cancel === 'function' && typeof animation.play === 'function' && 'onfinish' in animation; }
  catch (_) { return false; }
}
function setHandler(animation, name, handler) {
  if (!animationObject(animation)) return false;
  try {
    if (!(name in animation)) return false; animation[name] = handler; return animation[name] === handler;
  } catch (_) { return false; }
}
function clearHandler(animation, name) {
  if (!animationObject(animation)) return;
  try { if (name in animation) animation[name] = null; } catch (_) { /* broken handler */ }
}
function neutralize(animation) {
  if (!animationObject(animation)) return false;
  try { if (typeof animation.pause === 'function') animation.pause(); } catch (_) { /* detach below */ }
  try { if (!('effect' in animation)) return false; animation.effect = null; return animation.effect == null; } catch (_) { return false; }
}
function cancelResult(animation) {
  if (animation == null) return { stopped: true, failed: false }; clearHandler(animation, 'onfinish'); clearHandler(animation, 'oncancel');
  let cancel; try { cancel = animation.cancel; } catch (_) { cancel = null; }
  if (typeof cancel === 'function') try { cancel.call(animation); return { stopped: true, failed: false }; } catch (_) {}
  return { stopped: neutralize(animation), failed: true };
}
function cancel(animation) { return cancelResult(animation).stopped; }
function cancelAll(node) {
  let method; try { method = node && node.getAnimations; } catch (_) { return { stopped: false, failed: true }; }
  if (typeof method !== 'function') return { stopped: true, failed: false };
  let animations; try { animations = Array.from(method.call(node)); } catch (_) { return { stopped: false, failed: true }; }
  let stopped = true, failed = false;
  animations.forEach((item) => {
    const result = cancelResult(item); stopped = stopped && result.stopped; failed = failed || result.failed;
  }); return { stopped, failed };
}
function shuffle(values) {
  const result = values.slice();
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}

function createReel({ overlay, wheels, title, action, effects, onBusyChange }) {
  let spinning = false, animationUnavailable = false, effectCleanup = null; const setBusy = (value) => { spinning = value; if (onBusyChange) onBusyChange(); };
  const translate = (track, y, fixed) => track.strip.style.setProperty('transform', 'translateY(' + y + 'px)', fixed ? 'important' : '');
  const currentY = (track) => {
    const transform = getComputedStyle(track.strip).transform; if (!transform || transform === 'none') return 0;
    try { return new DOMMatrixReadOnly(transform).m42; } catch (_) { return 0; }
  };
  const reject = (track, animation) => {
    cancel(animation); cancelAll(track.strip); animationUnavailable = true;
  };
  const startAnimation = (track, keyframes, options) => {
    if (animationUnavailable) return null; const animation = animate(track.strip, keyframes, options);
    if (!usable(animation)) { reject(track, animation); return null; }
    return animation;
  };
  const stopAnimation = (track, animation) => {
    if (animation == null) return true; const result = cancelResult(animation); if (result.failed) animationUnavailable = true; if (result.stopped) return true;
    const remaining = cancelAll(track.strip); if (remaining.failed) animationUnavailable = true; return remaining.stopped;
  };
  const renderTracks = (specs) => {
    wheels.textContent = ''; wheels.dataset.count = String(specs.length);
    return specs.map((spec, index) => {
      const wheel = el('div', { class: 'reel-wheel' });
      wheel.appendChild(el('p', { class: 'reel-label' }, spec.label));
      const windowNode = el('div', { class: 'reel-window' }); const strip = el('div', { class: 'reel-strip', 'aria-hidden': 'true' });
      windowNode.appendChild(strip); wheel.appendChild(windowNode); wheels.appendChild(wheel);
      return {
        spec, strip,
        direction: index % 2 === 0 ? 1 : -1,
        delayMs: index * GEOMETRY.trackStaggerMs,
      };
    });
  };
  const clearTracks = () => {
    let stopped = true;
    wheels.querySelectorAll('.reel-strip').forEach((strip) => {
      const result = cancelAll(strip); stopped = stopped && result.stopped; if (result.failed) animationUnavailable = true;
    }); wheels.textContent = ''; delete wheels.dataset.count; return stopped && !animationUnavailable;
  };
  const geometry = (track, fullSetSize, spinCycles) => {
    // Show every value so the reel looks full, but only land or fake-out on a still-remaining option.
    const { full, remaining, target } = track.spec; track.strip.innerHTML = ''; const values = shuffle([...new Set(full)]); const length = values.length;
    const fullLength = Math.max(length, Math.floor(fullSetSize) || length);
    const travelCycles = Math.ceil(spinCycles * fullLength / length);
    const stripCycles = Math.max(Math.ceil(GEOMETRY.stripCycles * fullLength / length), travelCycles + GEOMETRY.landingCycle + 2);
    const landingCycle = track.direction > 0 ? GEOMETRY.landingCycle : GEOMETRY.landingCycle + travelCycles;
    const landIndex = values.indexOf(target) + landingCycle * length;
    for (let cycle = 0; cycle < stripCycles; cycle++) {
      values.forEach((value) => track.strip.appendChild(el('div', { class: 'reel-item' }, value)));
    }
    const itemH = track.strip.children[0] ? track.strip.children[0].getBoundingClientRect().height : 0; const cycleH = length * itemH, landY = -(landIndex - 1) * itemH;
    const decoys = remaining.filter((value) => value !== target && values.indexOf(value) !== -1);
    const decoy = decoys.length ? decoys[Math.floor(Math.random() * decoys.length)] : target;
    const fakeIndex = values.indexOf(decoy) + landingCycle * length;
    return {
      cycleH, landY, landIndex,
      idleBase: landY - track.direction * travelCycles * cycleH,
      fakeOutY: -(fakeIndex - 1) * itemH,
    };
  };
  const bounds = () => {
    const rect = effects.getBoundingClientRect(), windowRect = wheels.getBoundingClientRect();
    return {
      width: rect.width || window.innerWidth, height: rect.height || window.innerHeight,
      cx: windowRect.width ? windowRect.left - rect.left + windowRect.width / 2 : (rect.width || window.innerWidth) / 2,
      cy: windowRect.height ? windowRect.top - rect.top + windowRect.height / 2 : (rect.height || window.innerHeight) * 0.4,
    };
  };
  const emitConfetti = (add, amount) => {
    const area = bounds(); let started = false;
    for (let i = 0; i < amount; i++) {
      const bit = el('div', { class: 'confetti-bit' }); bit.style.background = EFFECT_COLORS[i % EFFECT_COLORS.length]; const angle = Math.random() * Math.PI * 2;
      const distance = 80 + Math.random() * Math.min(240, area.width * 0.55); const dx = Math.cos(angle) * distance, dy = Math.sin(angle) * distance - 40;
      const rotation = Math.random() * 900 - 450;
      if (add(bit, [
        { transform: 'translate3d(' + area.cx + 'px,' + area.cy + 'px,0) rotate(0deg)', opacity: 1 },
        { transform: 'translate3d(' + (area.cx + dx) + 'px,' + (area.cy + dy) + 'px,0) rotate(' + (rotation * 0.6) + 'deg)', opacity: 1, offset: 0.6 },
        { transform: 'translate3d(' + (area.cx + dx) + 'px,' + (area.cy + dy + 280) + 'px,0) rotate(' + rotation + 'deg)', opacity: 0 },
      ], { duration: 1400 + Math.random() * 700, easing: 'cubic-bezier(0.2,0.7,0.3,1)', fill: 'forwards' })) started = true;
    }
    return started;
  };
  const emitExplosion = (add, amount) => {
    const area = bounds(), centre = 'translate3d(' + area.cx + 'px,' + area.cy + 'px,0) translate(-50%,-50%)';
    let started = add(el('div', { class: 'explosion-core' }), [
      { transform: centre + ' scale(0.15)', opacity: 0 },
      { transform: centre + ' scale(2.2)', opacity: 1, offset: 0.28 },
      { transform: centre + ' scale(4.8)', opacity: 0 },
    ], { duration: 820, easing: 'cubic-bezier(0.15,0.7,0.2,1)', fill: 'forwards' });
    for (let i = 0; i < 3; i++) {
      const ring = el('div', { class: 'explosion-ring' }); ring.style.borderColor = EXPLOSION_COLORS[i + 1];
      if (add(ring, [
        { transform: centre + ' scale(0.2)', opacity: 0.95 },
        { transform: centre + ' scale(' + (7 + i * 2) + ')', opacity: 0 },
      ], { duration: 850 + i * 180, delay: i * 90, easing: 'cubic-bezier(0.12,0.72,0.25,1)', fill: 'forwards' })) started = true;
    }
    const count = Math.max(6, Math.round(amount * EFFECTS.explosion.amount / DEFAULT_REEL_OPTIONS.effectAmount));
    for (let i = 0; i < count; i++) {
      const spark = el('div', { class: 'explosion-spark' }), color = EXPLOSION_COLORS[i % EXPLOSION_COLORS.length];
      spark.style.background = color; spark.style.boxShadow = '0 0 8px ' + color; const angle = Math.PI * 2 * i / count + (Math.random() - 0.5) * 0.24;
      const distance = 90 + Math.random() * Math.min(230, area.width * 0.5); const dx = Math.cos(angle) * distance, dy = Math.sin(angle) * distance;
      if (add(spark, [
        { transform: 'translate3d(' + area.cx + 'px,' + area.cy + 'px,0) scale(1.4)', opacity: 1 },
        { transform: 'translate3d(' + (area.cx + dx) + 'px,' + (area.cy + dy) + 'px,0) scale(0.9)', opacity: 1, offset: 0.65 },
        { transform: 'translate3d(' + (area.cx + dx) + 'px,' + (area.cy + dy + 75) + 'px,0) scale(0.2)', opacity: 0 },
      ], { duration: 800 + Math.random() * 450, delay: Math.random() * 90, easing: 'cubic-bezier(0.18,0.75,0.25,1)', fill: 'forwards' })) started = true;
    }
    return started;
  };
  const emitLasers = (add, amount) => {
    const area = bounds(), length = Math.hypot(area.width, area.height) * 1.25;
    const count = Math.max(1, Math.round(amount * EFFECTS.lasers.amount / DEFAULT_REEL_OPTIONS.effectAmount)); let started = false;
    for (let i = 0; i < count; i++) {
      const beam = el('div', { class: 'laser-beam' }), color = LASER_COLORS[i % LASER_COLORS.length];
      const angle = -58 + Math.random() * 116, sweep = (i % 2 ? -1 : 1) * (18 + Math.random() * 12);
      const x = area.cx - length / 2, y = area.cy + (i - (count - 1) / 2) * Math.min(34, area.height * 0.04); beam.style.width = length + 'px'; beam.style.background = color;
      beam.style.boxShadow = '0 0 6px ' + color + ', 0 0 18px ' + color;
      if (add(beam, [
        { transform: 'translate3d(' + x + 'px,' + (y - 18) + 'px,0) rotate(' + (angle - sweep) + 'deg)', opacity: 0 },
        { opacity: 0.92, offset: 0.14 },
        { transform: 'translate3d(' + x + 'px,' + (y + 18) + 'px,0) rotate(' + (angle + sweep) + 'deg)', opacity: 0.92, offset: 0.86 },
        { transform: 'translate3d(' + x + 'px,' + (y + 24) + 'px,0) rotate(' + (angle + sweep * 1.15) + 'deg)', opacity: 0 },
      ], { duration: 1300 + Math.random() * 250, delay: i * 130, easing: 'ease-in-out', fill: 'forwards' })) started = true;
    }
    return started;
  };
  const emitFireworks = (add, amount) => {
    const area = bounds(); const scale = amount / DEFAULT_REEL_OPTIONS.effectAmount;
    const shells = Math.max(2, Math.round(3 * scale)); const sparks = Math.max(8, Math.round(EFFECTS.fireworks.amount * scale)); let started = false;
    for (let shell = 0; shell < shells; shell++) {
      const color = FIREWORK_COLORS[shell % FIREWORK_COLORS.length];
      const burstX = area.width * (0.2 + Math.random() * 0.6), burstY = area.height * (0.2 + Math.random() * 0.32);
      const launch = shell * 240, riseMs = 500 + Math.random() * 200;
      const rocket = el('div', { class: 'firework-rocket' }); rocket.style.background = color; rocket.style.boxShadow = '0 0 6px ' + color;
      if (add(rocket, [
        { transform: 'translate3d(' + burstX + 'px,' + area.height + 'px,0) scaleY(1.4)', opacity: 0 },
        { opacity: 1, offset: 0.15 },
        { transform: 'translate3d(' + burstX + 'px,' + burstY + 'px,0) scaleY(0.6)', opacity: 0.9 },
      ], { duration: riseMs, delay: launch, easing: 'cubic-bezier(0.2,0.6,0.2,1)', fill: 'forwards' })) started = true;
      const flash = el('div', { class: 'firework-flash' }); flash.style.background = color; flash.style.boxShadow = '0 0 18px 6px ' + color;
      if (add(flash, [
        { transform: 'translate3d(' + burstX + 'px,' + burstY + 'px,0) translate(-50%,-50%) scale(0.2)', opacity: 0 },
        { transform: 'translate3d(' + burstX + 'px,' + burstY + 'px,0) translate(-50%,-50%) scale(1.6)', opacity: 1, offset: 0.5 },
        { transform: 'translate3d(' + burstX + 'px,' + burstY + 'px,0) translate(-50%,-50%) scale(2.6)', opacity: 0 },
      ], { duration: 460, delay: launch + riseMs, easing: 'ease-out', fill: 'forwards' })) started = true;
      for (let i = 0; i < sparks; i++) {
        const spark = el('div', { class: 'firework-spark' }); spark.style.background = color; spark.style.boxShadow = '0 0 6px ' + color;
        const angle = Math.PI * 2 * i / sparks + (Math.random() - 0.5) * 0.3, distance = 50 + Math.random() * Math.min(150, area.width * 0.32);
        const dx = Math.cos(angle) * distance, dy = Math.sin(angle) * distance, drop = 60 + Math.random() * 60;
        if (add(spark, [
          { transform: 'translate3d(' + burstX + 'px,' + burstY + 'px,0) scale(1.1)', opacity: 1 },
          { transform: 'translate3d(' + (burstX + dx) + 'px,' + (burstY + dy) + 'px,0) scale(0.9)', opacity: 1, offset: 0.7 },
          { transform: 'translate3d(' + (burstX + dx) + 'px,' + (burstY + dy + drop) + 'px,0) scale(0.2)', opacity: 0 },
        ], { duration: 780 + Math.random() * 340, delay: launch + riseMs, easing: 'cubic-bezier(0.15,0.7,0.3,1)', fill: 'forwards' })) started = true;
      }
    }
    return started;
  };
  const emitSparkle = (add, amount) => {
    const area = bounds(); const count = Math.max(10, Math.round(EFFECTS.sparkle.amount * amount / DEFAULT_REEL_OPTIONS.effectAmount)); let started = false;
    for (let i = 0; i < count; i++) {
      const star = el('div', { class: 'sparkle-star' }, '\u2726'); star.style.color = EFFECT_COLORS[i % EFFECT_COLORS.length];
      const x = area.width * (0.08 + Math.random() * 0.84), y = area.height * (0.1 + Math.random() * 0.8);
      const size = 0.7 + Math.random() * 1.1, spin = Math.random() * 180 - 90, base = 'translate3d(' + x + 'px,' + y + 'px,0) translate(-50%,-50%)';
      if (add(star, [
        { transform: base + ' scale(0) rotate(0deg)', opacity: 0 },
        { transform: base + ' scale(' + size + ') rotate(' + spin + 'deg)', opacity: 1, offset: 0.5 },
        { transform: base + ' scale(0) rotate(' + (spin * 2) + 'deg)', opacity: 0 },
      ], { duration: 620 + Math.random() * 520, delay: Math.random() * 700, easing: 'ease-in-out', fill: 'forwards' })) started = true;
    }
    return started;
  };
  const emitCoins = (add, amount) => {
    const area = bounds(); const count = Math.max(8, Math.round(EFFECTS.coins.amount * amount / DEFAULT_REEL_OPTIONS.effectAmount)); const fall = area.height + 40; let started = false;
    for (let i = 0; i < count; i++) {
      const coin = el('div', { class: 'coin-disc' });
      const x = area.width * (0.08 + Math.random() * 0.84), drift = (Math.random() - 0.5) * 60, spins = 3 + Math.floor(Math.random() * 4);
      if (add(coin, [
        { transform: 'translate3d(' + x + 'px,-40px,0) rotateY(0deg)', opacity: 1 },
        { transform: 'translate3d(' + (x + drift * 0.5) + 'px,' + (fall * 0.62) + 'px,0) rotateY(' + (spins * 180) + 'deg)', opacity: 1, offset: 0.75 },
        { transform: 'translate3d(' + (x + drift) + 'px,' + fall + 'px,0) rotateY(' + (spins * 360) + 'deg)', opacity: 0 },
      ], { duration: 900 + Math.random() * 500, delay: Math.random() * 500, easing: 'cubic-bezier(0.4,0.1,0.7,1)', fill: 'forwards' })) started = true;
    }
    return started;
  };
  const emitShockwave = (add, amount) => {
    const area = bounds(); const centre = 'translate3d(' + area.cx + 'px,' + area.cy + 'px,0) translate(-50%,-50%)';
    const rings = Math.max(3, Math.round(EFFECTS.shockwave.amount * amount / DEFAULT_REEL_OPTIONS.effectAmount)); let started = false;
    for (let i = 0; i < rings; i++) {
      const ring = el('div', { class: 'shock-ring' }); ring.style.borderColor = EFFECT_COLORS[i % EFFECT_COLORS.length];
      if (add(ring, [
        { transform: centre + ' scale(0.1)', opacity: 0.85 },
        { transform: centre + ' scale(' + (6 + i * 1.5) + ')', opacity: 0 },
      ], { duration: 900 + i * 120, delay: i * 180, easing: 'cubic-bezier(0.2,0.7,0.3,1)', fill: 'forwards' })) started = true;
    }
    return started;
  };
  const emitters = { confetti: emitConfetti, explosion: emitExplosion, lasers: emitLasers, fireworks: emitFireworks, sparkle: emitSparkle, coins: emitCoins, shockwave: emitShockwave };
  const stopEffects = () => {
    const cleanup = effectCleanup; effectCleanup = null;
    try { if (cleanup) cleanup(); } catch (_) { /* confirmation must still close */ }
    effects.textContent = ''; delete effects.dataset.effect;
  };
  const startEffects = (type, amount) => {
    stopEffects(); if (!type || reducedMotion() || !hasAnimation(effects)) return; const animations = new Set(), effectAmount = setting('effectAmount', amount);
    let timer = null, stopped = false;
    const add = (node, keyframes, options) => {
      if (effects.childElementCount >= EFFECT_NODE_LIMIT || !hasAnimation(node)) return false; effects.appendChild(node); const animation = animate(node, keyframes, options);
      if (!usable(animation)) { cancel(animation); node.remove(); return false; }
      const discard = () => { animations.delete(animation); node.remove(); };
      if (!setHandler(animation, 'onfinish', discard) || !setHandler(animation, 'oncancel', discard)) { cancel(animation); node.remove(); return false; }
      animations.add(animation); return true;
    }; const emit = emitters[type] || emitConfetti;
    const repeat = () => {
      if (stopped) return;
      if (!emit(add, effectAmount)) { stopEffects(); return; }
      timer = setTimeout(repeat, EFFECTS[type].repeatMs);
    }; effects.dataset.effect = type;
    effectCleanup = () => {
      stopped = true; if (timer != null) clearTimeout(timer); Array.from(animations).forEach(cancel); animations.clear();
    }; repeat();
  };
  const effectType = (type) => {
    if (type === 'none') return null; return EFFECTS[type] ? type : Object.keys(EFFECTS)[Math.floor(Math.random() * Object.keys(EFFECTS).length)];
  };

  function show({ reels, resultText, round, fullSetSize, options, onConfirm, onLand, onClose }) {
    const supplied = options || {};
    const settings = {
      spinMs: setting('spinMs', supplied.spinMs), spinCycles: setting('spinCycles', supplied.spinCycles),
      idlePxps: setting('idlePxps', supplied.idlePxps), fakeOutChance: setting('fakeOutChance', supplied.fakeOutChance),
      fakeOutHoldMs: setting('fakeOutHoldMs', supplied.fakeOutHoldMs),
      fakeOutBurstMs: setting('fakeOutBurstMs', supplied.fakeOutBurstMs),
      effect: supplied.effect || DEFAULT_REEL_OPTIONS.effect,
      effectAmount: setting('effectAmount', supplied.effectAmount),
      title: supplied.title || 'Round ' + (round + 1),
    };
    const valid = Array.isArray(reels) && reels.length > 0 && reels.every((spec) => (
      spec && Array.isArray(spec.full) && spec.full.length > 0 && spec.full.indexOf(spec.target) !== -1
      && Array.isArray(spec.remaining) && spec.remaining.length > 0 && spec.remaining.indexOf(spec.target) !== -1
    ));
    stopEffects(); if (!valid || animationUnavailable || !clearTracks()) return false;
    setBusy(true); title.textContent = settings.title; action.textContent = 'Spin'; overlay.hidden = false;
    const tracks = renderTracks(reels); const geos = tracks.map((track) => geometry(track, fullSetSize, settings.spinCycles));
    const fakeOut = reels[0].remaining.length > 1 && geos.every((geo) => geo.cycleH > 0) && Math.random() < settings.fakeOutChance;
    const maxDelayMs = tracks.reduce((max, track) => Math.max(max, track.delayMs), 0);
    const selectedMs = settings.spinMs + maxDelayMs
      + (fakeOut ? settings.fakeOutHoldMs + settings.fakeOutBurstMs + maxDelayMs : 0);
    let phase = 'idle', idles = [], selections = [], fakeTimer = null, safetyTimer = null;
    const clearTimers = () => {
      if (fakeTimer != null) clearTimeout(fakeTimer); if (safetyTimer != null) clearTimeout(safetyTimer); fakeTimer = safetyTimer = null;
    };
    const stopAnimations = (animations) => {
      let stopped = true;
      tracks.forEach((track, index) => { stopped = stopAnimation(track, animations[index]) && stopped; });
      return stopped;
    };
    const land = () => {
      if (phase === 'confirm' || phase === 'closed') return; phase = 'confirm'; clearTimers(); stopAnimations(idles); stopAnimations(selections); idles = []; selections = [];
      const results = tracks.map((track, index) => {
        const geo = geos[index]; translate(track, geo.landY, true); const winner = track.strip.children[geo.landIndex];
        if (winner) winner.classList.add('reel-target'); return winner ? winner.textContent : '';
      });
      title.textContent = resultText || results.filter(Boolean).join(' \u00b7 ') || settings.title;
      action.textContent = 'Confirm'; const type = effectType(settings.effect);
      startEffects(type, settings.effectAmount); if (onLand) onLand(type, fakeOut);
    };
    const close = () => {
      if (phase === 'closed') return; phase = 'closed'; overlay.removeEventListener('click', onTap); clearTimers(); stopAnimations(idles); stopAnimations(selections); stopEffects();
      if (onConfirm) onConfirm(); overlay.hidden = true; setBusy(false); if (onClose) onClose();
    };
    const startSelections = (from, to, duration, easing, done) => {
      const started = [];
      for (let i = 0; i < tracks.length; i++) {
        const animation = startAnimation(
          tracks[i],
          [{ transform: 'translateY(' + from[i] + 'px)' }, { transform: 'translateY(' + to[i] + 'px)' }],
          { duration, delay: tracks[i].delayMs, easing, fill: 'forwards' },
        );
        if (!animation) { stopAnimations(started); land(); return false; }
        started.push(animation);
      }
      let pending = started.length;
      const finish = () => {
        if (phase !== 'spin' || pending === 0) return; pending--; if (pending === 0) done();
      };
      for (let i = 0; i < started.length; i++) {
        if (!setHandler(started[i], 'onfinish', finish)) {
          animationUnavailable = true; stopAnimations(started); land(); return false;
        }
      }
      selections = started;
      return true;
    };
    const finishFakeOut = () => {
      if (phase !== 'spin') return; const animations = selections; selections = [];
      if (!stopAnimations(animations) || animationUnavailable) { land(); return; }
      tracks.forEach((track, index) => translate(track, geos[index].fakeOutY, false));
      fakeTimer = setTimeout(() => {
        fakeTimer = null;
        if (phase === 'spin') {
          startSelections(
            geos.map((geo) => geo.fakeOutY), geos.map((geo) => geo.landY),
            settings.fakeOutBurstMs, FAKEOUT_EASE, land,
          );
        }
      }, settings.fakeOutHoldMs);
    };
    const spin = () => {
      if (phase !== 'idle') return; phase = 'spin'; action.textContent = 'Skip';
      safetyTimer = setTimeout(() => { safetyTimer = null; if (phase === 'spin') land(); }, selectedMs + GEOMETRY.safetyMs);
      const current = tracks.map(currentY), animations = idles; idles = [];
      if (!stopAnimations(animations) || animationUnavailable) { land(); return; }
      tracks.forEach((track, index) => translate(track, current[index], false));
      startSelections(
        current, geos.map((geo) => fakeOut ? geo.fakeOutY : geo.landY),
        settings.spinMs, DECEL, fakeOut ? finishFakeOut : land,
      );
    }; const onTap = () => { if (phase === 'idle') spin(); else if (phase === 'spin') land(); else close(); };
    overlay.addEventListener('click', onTap); action.focus();
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i], geo = geos[i]; translate(track, geo.idleBase, false);
      const idleMs = Math.max(GEOMETRY.minIdleMs, geo.cycleH / settings.idlePxps * 1000);
      const animation = startAnimation(
        track,
        [
          { transform: 'translateY(' + geo.idleBase + 'px)' },
          { transform: 'translateY(' + (geo.idleBase + track.direction * geo.cycleH) + 'px)' },
        ],
        { duration: idleMs, delay: -track.delayMs, iterations: Infinity, easing: 'linear' },
      );
      if (!animation) { land(); return true; }
      idles.push(animation);
    }
    return true;
  }
  return {
    show, isBusy: () => spinning,
    canAnimate: () => !reducedMotion() && hasAnimation(wheels) && !animationUnavailable,
  };
}

export { DEFAULT_REEL_OPTIONS, REEL_FIELDS, createReel };
