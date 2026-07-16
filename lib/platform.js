function installViewport(onScoreResize) {
  const sync = () => {
    const viewport = window.visualViewport; const keyboard = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
    document.documentElement.style.setProperty('--keyboard-height', keyboard + 'px');
  };
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      sync(); const active = document.activeElement; if (active && active.classList && active.classList.contains('score-input')) onScoreResize(active);
    }); window.visualViewport.addEventListener('scroll', sync);
  }
  window.addEventListener('orientationchange', sync); sync();
}

// Recreates the native modal and form[method=dialog] contract on iOS before 15.4.
function installDialogFallback() {
  const proto = window.HTMLDialogElement && HTMLDialogElement.prototype; if (proto && typeof proto.showModal === 'function') return;
  document.documentElement.classList.add('no-dialog'); let openCount = 0;
  function show() { if (this.hasAttribute('open')) return; this.setAttribute('open', ''); openCount++; document.documentElement.classList.add('has-open-dialog'); }
  function close(value) {
    if (!this.hasAttribute('open')) return; if (value !== undefined) this.returnValue = value; this.removeAttribute('open'); openCount = Math.max(0, openCount - 1);
    if (!openCount) document.documentElement.classList.remove('has-open-dialog'); this.dispatchEvent(new Event('close'));
  }
  Array.prototype.forEach.call(document.querySelectorAll('dialog'), (dialog) => {
    dialog.showModal = show; dialog.show = show; dialog.close = close; if (!('returnValue' in dialog) || typeof dialog.returnValue !== 'string') dialog.returnValue = '';
    dialog.addEventListener('click', (event) => {
      const button = event.target && event.target.closest ? event.target.closest('button') : null; const form = button && dialog.contains(button) ? button.form : null;
      if (!form || form.getAttribute('method') !== 'dialog' || (button.type !== 'submit' && button.type)) return; event.preventDefault(); dialog.close(button.value || '');
    });
  });
}

export { installViewport, installDialogFallback };
