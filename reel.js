import { el, clamp } from './lib/dom.js';

const EFFECTS = Object.freeze({
  confetti: { label: 'Confetti', amount: 44, repeatMs: 1000 },
  explosion: { label: 'Explosion', amount: 30, repeatMs: 950 },
  lasers: { label: 'Lasers', amount: 5, repeatMs: 1050 },
});
const DEFAULT_REEL_OPTIONS = Object.freeze({
  spinMs: 7200, spinCycles: 7, idlePxps: 260, fakeOutChance: 0.15,
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
const GEOMETRY = Object.freeze({ stripCycles: 14, landingCycle: 2, minIdleMs: 400, safetyMs: 800 }); const DECEL = 'cubic-bezier(0.16, 0.9, 0.22, 1)';
const FAKEOUT_EASE = 'cubic-bezier(0.4, 0, 0.15, 1)'; const EFFECT_COLORS = ['#a78bfa', '#e3c14e', '#5fe39a', '#ff6b5e', '#ececf3'];
const EXPLOSION_COLORS = ['#fff3a3', '#ffd166', '#ff8c42', '#ff4d3d']; const LASER_COLORS = ['#71f6ff', '#ff5cf4', '#a78bfa']; const EFFECT_NODE_LIMIT = 140;

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

function createReel({ overlay, strip, title, action, effects, onBusyChange }) {
  let spinning = false, animationUnavailable = false, effectCleanup = null; const setBusy = (value) => { spinning = value; if (onBusyChange) onBusyChange(); };
  const translate = (y, fixed) => strip.style.setProperty('transform', 'translateY(' + y + 'px)', fixed ? 'important' : '');
  const currentY = () => {
    const transform = getComputedStyle(strip).transform; if (!transform || transform === 'none') return 0;
    try { return new DOMMatrixReadOnly(transform).m42; } catch (_) { return 0; }
  };
  const reject = (animation) => {
    cancel(animation); cancelAll(strip); animationUnavailable = true;
  };
  const startAnimation = (keyframes, options) => {
    if (animationUnavailable) return null; const animation = animate(strip, keyframes, options);
    if (!usable(animation)) { reject(animation); return null; }
    return animation;
  };
  const stopAnimation = (animation) => {
    if (animation == null) return true; const result = cancelResult(animation); if (result.failed) animationUnavailable = true; if (result.stopped) return true;
    const remaining = cancelAll(strip); if (remaining.failed) animationUnavailable = true; return remaining.stopped;
  };
  const geometry = (remaining, target, fullSetSize, spinCycles) => {
    strip.innerHTML = ''; const values = shuffle(remaining), length = values.length; const fullLength = Math.max(length, Math.floor(fullSetSize) || length);
    const travelCycles = Math.ceil(spinCycles * fullLength / length);
    const stripCycles = Math.max(Math.ceil(GEOMETRY.stripCycles * fullLength / length), travelCycles + GEOMETRY.landingCycle + 2);
    const landIndex = values.indexOf(target) + GEOMETRY.landingCycle * length;
    for (let cycle = 0; cycle < stripCycles; cycle++) {
      values.forEach((value) => strip.appendChild(el('div', { class: 'reel-item' }, value)));
    }
    const itemH = strip.children[0] ? strip.children[0].getBoundingClientRect().height : 0; const cycleH = length * itemH, landY = -(landIndex - 1) * itemH;
    let fakeOutRows = fullLength + 1; if (fakeOutRows % length === 0) fakeOutRows++;
    return {
      cycleH, landY, landIndex,
      idleBase: landY - travelCycles * cycleH,
      fakeOutY: landY - fakeOutRows * itemH,
    };
  };
  const bounds = () => {
    const rect = effects.getBoundingClientRect(), windowRect = strip.parentElement.getBoundingClientRect();
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
    }; const emit = type === 'explosion' ? emitExplosion : type === 'lasers' ? emitLasers : emitConfetti;
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

  function show({ remaining, target, resultText, round, fullSetSize, options, onConfirm, onLand, onClose }) {
    const supplied = options || {};
    const settings = {
      spinMs: setting('spinMs', supplied.spinMs), spinCycles: setting('spinCycles', supplied.spinCycles),
      idlePxps: setting('idlePxps', supplied.idlePxps), fakeOutChance: setting('fakeOutChance', supplied.fakeOutChance),
      fakeOutHoldMs: setting('fakeOutHoldMs', supplied.fakeOutHoldMs),
      fakeOutBurstMs: setting('fakeOutBurstMs', supplied.fakeOutBurstMs),
      effect: supplied.effect || DEFAULT_REEL_OPTIONS.effect,
      effectAmount: setting('effectAmount', supplied.effectAmount),
      title: supplied.title || 'Round ' + (round + 1),
    }; stopEffects(); if (animationUnavailable) return false; const initial = cancelAll(strip);
    if (!initial.stopped || initial.failed) { animationUnavailable = true; return false; }
    setBusy(true); title.textContent = settings.title; action.textContent = 'Spin'; overlay.hidden = false;
    const geo = geometry(remaining, target, fullSetSize, settings.spinCycles); const fakeOut = remaining.length > 1 && geo.cycleH > 0 && Math.random() < settings.fakeOutChance;
    const selectedMs = settings.spinMs + (fakeOut ? settings.fakeOutHoldMs + settings.fakeOutBurstMs : 0);
    let phase = 'idle', idle = null, selection = null, fakeTimer = null, safetyTimer = null;
    const clearTimers = () => {
      if (fakeTimer != null) clearTimeout(fakeTimer); if (safetyTimer != null) clearTimeout(safetyTimer); fakeTimer = safetyTimer = null;
    };
    const land = () => {
      if (phase === 'confirm' || phase === 'closed') return; phase = 'confirm'; clearTimers(); stopAnimation(idle); stopAnimation(selection); idle = selection = null;
      translate(geo.landY, true); const winner = strip.children[geo.landIndex]; if (winner) winner.classList.add('reel-target');
      title.textContent = winner ? resultText || winner.textContent : settings.title; action.textContent = 'Confirm'; const type = effectType(settings.effect);
      startEffects(type, settings.effectAmount); if (onLand) onLand(type, fakeOut);
    };
    const close = () => {
      if (phase === 'closed') return; phase = 'closed'; overlay.removeEventListener('click', onTap); clearTimers(); stopAnimation(idle); stopAnimation(selection); stopEffects();
      if (onConfirm) onConfirm(); overlay.hidden = true; setBusy(false); if (onClose) onClose();
    };
    const startSelection = (from, to, duration, easing, done) => {
      const animation = startAnimation(
        [{ transform: 'translateY(' + from + 'px)' }, { transform: 'translateY(' + to + 'px)' }],
        { duration, easing, fill: 'forwards' },
      );
      if (!animation) { land(); return false; }
      selection = animation;
      if (!setHandler(animation, 'onfinish', done)) { selection = null; animationUnavailable = true; stopAnimation(animation); land(); return false; }
      return true;
    };
    const finishFakeOut = () => {
      if (phase !== 'spin') return; const animation = selection; selection = null;
      if (!stopAnimation(animation) || animationUnavailable) { land(); return; }
      translate(geo.fakeOutY, false);
      fakeTimer = setTimeout(() => {
        fakeTimer = null; if (phase === 'spin') startSelection(geo.fakeOutY, geo.landY, settings.fakeOutBurstMs, FAKEOUT_EASE, land);
      }, settings.fakeOutHoldMs);
    };
    const spin = () => {
      if (phase !== 'idle') return; phase = 'spin'; action.textContent = 'Skip';
      safetyTimer = setTimeout(() => { safetyTimer = null; if (phase === 'spin') land(); }, selectedMs + GEOMETRY.safetyMs);
      const current = currentY(), animation = idle; idle = null;
      if (!stopAnimation(animation) || animationUnavailable) { land(); return; }
      translate(current, false); startSelection(current, fakeOut ? geo.fakeOutY : geo.landY, settings.spinMs, DECEL, fakeOut ? finishFakeOut : land);
    }; const onTap = () => { if (phase === 'idle') spin(); else if (phase === 'spin') land(); else close(); };
    overlay.addEventListener('click', onTap); action.focus(); translate(geo.idleBase, false); const idleMs = Math.max(GEOMETRY.minIdleMs, geo.cycleH / settings.idlePxps * 1000);
    idle = startAnimation(
      [{ transform: 'translateY(' + geo.idleBase + 'px)' }, { transform: 'translateY(' + (geo.idleBase + geo.cycleH) + 'px)' }],
      { duration: idleMs, iterations: Infinity, easing: 'linear' },
    ); if (!idle) land(); return true;
  }
  return {
    show, isBusy: () => spinning,
    canAnimate: () => !reducedMotion() && hasAnimation(strip) && !animationUnavailable,
  };
}

export { DEFAULT_REEL_OPTIONS, REEL_FIELDS, createReel };
