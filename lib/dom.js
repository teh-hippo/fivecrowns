// A false, null or undefined value omits the attribute; true sets it to the
// empty string, which is how HTML spells a boolean attribute being present.
function el(tag, attrs, text) {
  const node = document.createElement(tag);
  Object.keys(attrs || {}).forEach((key) => {
    const value = attrs[key];
    if (value === false || value == null) return;
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value === true ? '' : value);
  });
  if (text != null) node.textContent = text;
  return node;
}

function refs(ids) {
  const result = {};
  ids
    .trim()
    .split(/\s+/)
    .forEach((id) => {
      result[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id);
    });
  return result;
}

function onlyDigits(value) {
  return String(value).replace(/[^0-9]/g, '');
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Tapping into a field replaces the whole value. Browsers disagree on when
// focus lands: Chromium focuses before pointerup, Safari after it, and Safari
// then collapses the selection onto a caret at the tap point. Only the
// trailing click reliably follows both, so a tap is armed on the way down and
// the selection reapplied there. A tap inside a field that already holds
// focus, or a drag that picks out part of the value, is left alone.
function selectAllOnEdit(input) {
  let armed = false;
  const select = () =>
    setTimeout(() => {
      if (document.activeElement !== input) return;
      try {
        input.setSelectionRange(0, input.value.length);
      } catch (_) {
        try {
          input.select();
        } catch (_) {
          /* unsupported input type */
        }
      }
    });
  const dragged = () => {
    try {
      const { selectionStart: from, selectionEnd: to } = input;
      return from !== to && !(from === 0 && to === input.value.length);
    } catch (_) {
      return false;
    }
  };
  input.addEventListener('pointerdown', () => {
    armed = document.activeElement !== input;
  });
  input.addEventListener('focus', select);
  input.addEventListener('click', () => {
    if (!armed) return;
    armed = false;
    if (!dragged()) select();
  });
  input.addEventListener('blur', () => {
    armed = false;
  });
}

export { el, refs, onlyDigits, clamp, selectAllOnEdit };
