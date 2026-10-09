export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** @param {unknown} value */
export function errorMessage(value) {
  return value instanceof Error ? value.message : String(value ?? 'Beklenmeyen hata');
}

/** @param {string} name @param {string} [classes] */
export function iconHtml(name, classes = '') {
  return `<i class="ph ph-${escapeHtml(name)} a-btn__icon ${escapeHtml(classes)}" aria-hidden="true"></i>`;
}

/**
 * @param {{
 *  label: string,
 *  id?: string,
 *  type?: 'button' | 'submit' | 'reset',
 *  variant?: 'primary' | 'secondary' | 'danger' | 'ghost',
 *  size?: 'default' | 'compact',
 *  icon?: string,
 *  classes?: string,
 *  attrs?: Record<string, unknown>,
 *  disabled?: boolean,
 * }} opts
 */
export function buttonHtml(opts) {
  const variant = opts.variant ?? 'primary';
  const size = opts.size === 'compact' ? ' a-btn--compact' : '';
  const legacySecondary = variant === 'secondary' ? ' secondary' : '';
  const cls = [
    'a-btn',
    `a-btn--${variant}`,
    legacySecondary.trim(),
    size.trim(),
    opts.classes ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const attrs = Object.entries(opts.attrs ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => (v === true ? ` ${escapeHtml(k)}` : ` ${escapeHtml(k)}="${escapeHtml(v)}"`))
    .join('');
  const id = opts.id ? ` id="${escapeHtml(opts.id)}"` : '';
  const disabled = opts.disabled ? ' disabled' : '';
  const icon = opts.icon ? iconHtml(opts.icon) : '';
  return `<button type="${opts.type ?? 'button'}"${id} class="${cls}"${attrs}${disabled}>${icon}<span>${escapeHtml(opts.label)}</span></button>`;
}

/** @param {string} message @param {'success' | 'error' | 'info'} [tone] */
export function showToast(message, tone = 'info') {
  let host = document.querySelector('.a-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'a-toast-host';
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('aria-relevant', 'additions');
    document.body.appendChild(host);
  }
  const toast = document.createElement('div');
  toast.className = `a-toast a-toast--${tone}`;
  toast.textContent = message;
  host.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add('a-toast--leaving');
    window.setTimeout(() => toast.remove(), 180);
  }, tone === 'error' ? 5200 : 3200);
}

/**
 * @param {HTMLElement | null | undefined} btn
 * @param {boolean} busy
 * @param {string} [label]
 */
export function setButtonBusy(btn, busy, label = 'İşleniyor…') {
  if (!btn) return;
  if (busy) {
    if (!btn.dataset.idleHtml) btn.dataset.idleHtml = btn.innerHTML;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.classList.add('a-btn--loading');
    btn.innerHTML = `<span class="a-spinner" aria-hidden="true"></span><span>${escapeHtml(label)}</span>`;
  } else {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.classList.remove('a-btn--loading');
    if (btn.dataset.idleHtml) {
      btn.innerHTML = btn.dataset.idleHtml;
      delete btn.dataset.idleHtml;
    }
  }
}

/**
 * @template T
 * @param {HTMLElement | null | undefined} btn
 * @param {string} label
 * @param {() => Promise<T>} fn
 */
export async function withButtonBusy(btn, label, fn) {
  if (btn?.disabled) return undefined;
  setButtonBusy(btn, true, label);
  try {
    return await fn();
  } finally {
    setButtonBusy(btn, false);
  }
}

/**
 * @param {{
 *  title: string,
 *  message: string,
 *  confirmLabel?: string,
 *  cancelLabel?: string,
 *  variant?: 'primary' | 'danger',
 * }} opts
 */
export function showConfirmDialog(opts) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = document.createElement('div');
    overlay.className = 'a-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'a-confirm-title');
    overlay.innerHTML = `
      <div class="a-dialog">
        <h2 class="a-dialog-title" id="a-confirm-title">${escapeHtml(opts.title)}</h2>
        <p class="a-dialog-msg">${escapeHtml(opts.message)}</p>
        <div class="a-dialog-actions">
          ${buttonHtml({ label: opts.cancelLabel ?? 'Vazgeç', variant: 'secondary', attrs: { 'data-act': 'cancel' } })}
          ${buttonHtml({ label: opts.confirmLabel ?? 'Onayla', variant: opts.variant ?? 'primary', attrs: { 'data-act': 'ok' } })}
        </div>
      </div>`;

    /** @param {boolean} value */
    const finish = (value) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      previousFocus?.focus();
      resolve(value);
    };

    /** @param {KeyboardEvent} e */
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
      if (e.key === 'Tab') {
        const focusable = [...overlay.querySelectorAll('button')];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });
    overlay.querySelector('[data-act="cancel"]')?.addEventListener('click', () => finish(false));
    overlay.querySelector('[data-act="ok"]')?.addEventListener('click', () => finish(true));
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => /** @type {HTMLElement | null} */ (overlay.querySelector('[data-act="ok"]'))?.focus());
  });
}

/** @param {string} message @param {number} colspan */
export function emptyRowHtml(message, colspan) {
  return `<tr><td colspan="${colspan}" class="a-empty-cell">${escapeHtml(message)}</td></tr>`;
}

/** @param {HTMLElement} container @param {string} selector */
export function focusField(container, selector) {
  requestAnimationFrame(() => {
    const el = /** @type {HTMLElement | null} */ (container.querySelector(selector));
    el?.focus();
  });
}
