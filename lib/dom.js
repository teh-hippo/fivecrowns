function el(tag, attrs, text) {
  const node = document.createElement(tag);
  Object.keys(attrs || {}).forEach((key) => {
    if (key === 'class') node.className = attrs[key]; else if (key !== 'hidden' || attrs[key]) node.setAttribute(key, attrs[key]);
  }); if (text != null) node.textContent = text; return node;
}

function refs(ids) {
  const result = {};
  ids.trim().split(/\s+/).forEach((id) => {
    result[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id);
  }); return result;
}

function onlyDigits(value) { return String(value).replace(/[^0-9]/g, ''); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

// iOS collapses selections made during focus, so select again after the tap.
function selectAllOnEdit(input) {
  let armed = false;
  const select = () => setTimeout(() => {
    if (document.activeElement !== input) return;
    try { input.setSelectionRange(0, input.value.length); }
    catch (_) { try { input.select(); } catch (_) { /* unsupported input type */ } }
  }); input.addEventListener('focus', () => { armed = true; select(); }); input.addEventListener('pointerup', () => { if (armed) { armed = false; select(); } });
  input.addEventListener('blur', () => { armed = false; });
}

export { el, refs, onlyDigits, clamp, selectAllOnEdit };
