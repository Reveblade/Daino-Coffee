import { api, decodeJwt, getRefreshToken, getToken, setToken } from './api.js';
import { connectOrdersStaffRealtime } from './orders-realtime.js';
import geyikBrandUrl from './assets/geyik.svg?url';

document.documentElement.style.setProperty(
  '--a-brand-logo-mask',
  `url("${geyikBrandUrl}")`,
);
import QRCode from 'qrcode';
import { idStr } from './menu/helpers.js';
import { renderMenuList } from './menu/pages/menu-list.js';
import { renderProductFormPage } from './menu/pages/product-form-page.js';
import { renderCategoryFormPage } from './menu/pages/category-form-page.js';

/** @type {'login' | 'app'} */
let screen = 'login';
/** @type {string} */
let view = 'orders';
let pollTimer = null;
/** @type {(() => void) | null} */
let stopOrdersWs = null;
/** True while staff orders WebSocket is connected (disables fast HTTP polling). */
let ordersWsLive = false;

/** Geçmiş liste / detay (sayfa yeniden çizilince korunur). */
let historyUi = {
  /** @type {string | null} */
  detailOrderId: null,
  page: 0,
  /** @type {string} */
  q: '',
  pageSize: 20,
};

function defaultMenuListUi() {
  return {
    catPage: 0,
    catPageSize: 20,
    catQ: '',
    prodPage: 0,
    prodPageSize: 20,
    prodQ: '',
  };
}

/** Menü: liste veya ayrı form sayfaları. */
let menuUi = {
  /** @type {'list' | 'category-new' | 'category-edit' | 'product-new' | 'product-edit'} */
  sub: 'list',
  /** @type {string | null} */
  id: null,
  list: defaultMenuListUi(),
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function channelLabelTr(ch) {
  if (ch === 'IN_PLACE') return 'Masa (QR)';
  if (ch === 'ONLINE') return 'Teslimat (web)';
  return String(ch ?? '');
}

function inPlaceStatusTr(st) {
  const m = {
    PLACED: 'Alındı',
    IN_PROGRESS: 'Hazırlanıyor',
    READY: 'Teslim edildi',
    AWAITING_PAYMENT: 'Ödeme bekliyor',
    PAID: 'Ödendi',
    CANCELLED: 'İptal edildi',
  };
  return m[st] ?? String(st ?? '');
}

function onlineStatusTr(st) {
  const m = {
    PLACED: 'Alındı',
    CONFIRMED: 'Onaylandı',
    IN_PROGRESS: 'Hazırlanıyor',
    READY_FOR_HANDOFF: 'Kuryeye hazır',
    ASSIGNED: 'Kurye atandı',
    OUT_FOR_DELIVERY: 'Yolda',
    DELIVERED: 'Teslim edildi',
    AWAITING_CASHIER_PAYMENT: 'Ödeme bekliyor',
    PAID: 'Ödendi',
    CANCELLED: 'İptal edildi',
  };
  return m[st] ?? String(st ?? '');
}

/** @param {string} st @returns {{ act: string, label: string }[]} */
function inPlaceActions(st) {
  if (st === 'PAID' || st === 'CANCELLED') return [];
  if (st === 'PLACED')
    return [
      { act: 'START', label: 'Hazırla' },
      { act: 'CANCEL', label: 'İptal et' },
    ];
  if (st === 'IN_PROGRESS')
    return [
      { act: 'READY', label: 'Teslim edildi' },
      { act: 'CANCEL', label: 'İptal et' },
    ];
  if (st === 'READY')
    return [
      { act: 'AWAIT_PAYMENT', label: 'Ödeme bekliyor' },
      { act: 'MARK_PAID', label: 'Ödendi' },
      { act: 'CANCEL', label: 'İptal et' },
    ];
  if (st === 'AWAITING_PAYMENT')
    return [
      { act: 'MARK_PAID', label: 'Ödendi' },
      { act: 'CANCEL', label: 'İptal et' },
    ];
  return [];
}

/** @param {string} st @returns {{ act: string, label: string }[]} */
function onlineStaffActions(st) {
  if (st === 'PAID' || st === 'CANCELLED') return [];
  if (st === 'PLACED')
    return [
      { act: 'CONFIRM', label: 'Onayla' },
      { act: 'CANCEL', label: 'İptal et' },
    ];
  if (st === 'CONFIRMED')
    return [
      { act: 'START_PREP', label: 'Hazırla' },
      { act: 'CANCEL', label: 'İptal et' },
    ];
  if (st === 'IN_PROGRESS')
    return [
      { act: 'READY_HANDOFF', label: 'Teslime hazır' },
      { act: 'CANCEL', label: 'İptal et' },
    ];
  if (st === 'READY_FOR_HANDOFF')
    return [{ act: 'CANCEL', label: 'İptal et' }];
  if (st === 'AWAITING_CASHIER_PAYMENT')
    return [
      { act: 'MARK_PAID', label: 'Ödendi' },
      { act: 'CANCEL', label: 'İptal et' },
    ];
  return [];
}

function tableNumberCell(o) {
  const t = o.tableId;
  if (t && typeof t === 'object') {
    if (t.number != null) return esc(`Masa ${t.number}`);
    if (t.label) return esc(String(t.label));
  }
  return '—';
}

function orderItemsSummary(o) {
  if (!Array.isArray(o.items) || !o.items.length) return '—';
  let units = 0;
  for (const i of o.items) units += Number(i.quantity) || 0;
  const lines = o.items.length;
  const addCount = Array.isArray(o.history)
    ? o.history.filter((h) => h?.note === 'IN_PLACE_ITEMS_ADDED').length
    : 0;
  const extra =
    o.channel === 'IN_PLACE' && addCount > 0 ? ` · ${addCount} ek` : '';
  return `${lines} kalem, ${units} adet${extra}`;
}

/** @returns {{ text: string, title: string }} */
function latestInPlaceAdditionDisplay(o) {
  if (o.channel !== 'IN_PLACE' || !Array.isArray(o.history)) {
    return { text: '', title: '' };
  }
  const adds = o.history.filter((h) => h?.note === 'IN_PLACE_ITEMS_ADDED');
  if (!adds.length) return { text: '', title: '' };
  const last = adds[adds.length - 1];
  const meta = last?.metadata?.addedItems;
  const line = Array.isArray(meta)
    ? meta
        .map((a) => {
          const ox = a.optionsLine ? ` (${a.optionsLine})` : '';
          return `${a.quantity}×${a.name}${ox}`;
        })
        .join(', ')
    : '';
  const full = adds
    .slice(-5)
    .map((h) => {
      const m = h?.metadata?.addedItems;
      return Array.isArray(m)
        ? m
            .map((a) => {
              const ox = a.optionsLine ? ` (${a.optionsLine})` : '';
              return `${a.quantity}×${a.name}${ox}`;
            })
            .join(', ')
        : '';
    })
    .filter(Boolean)
    .join(' → ');
  const short = line.length > 52 ? `${line.slice(0, 49)}…` : line;
  return { text: short, title: full || line };
}

/** Menü URL'sine göre QR PNG üretir ve indirmeyi başlatır. */
async function downloadTableQrPng(menuUrl, tableNumber) {
  const name = `masa-${tableNumber}-qr.png`;
  try {
    const dataUrl = await QRCode.toDataURL(menuUrl, {
      width: 512,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 2000);
  } catch (e) {
    alert(e instanceof Error ? e.message : 'QR oluşturulamadı');
  }
}

/** Two explicit steps (embedded / strict UAs may skip stacked `confirm()`). */
function showQrRegenerateTwoStepDialog() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'a-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const panel = document.createElement('div');
    panel.className = 'a-dialog';

    const finish = (value) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(value);
    };

    /** @param {KeyboardEvent} e */
    function onKey(e) {
      if (e.key === 'Escape') finish(false);
    }
    document.addEventListener('keydown', onKey);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });

    function step1() {
      panel.innerHTML = `
        <h2 class="a-dialog-title">QR yenileme</h2>
        <p class="a-dialog-msg">QR kodu ve menü bağlantısı yenilenecek. Daha önce yazdırılmış QR kodları artık çalışmaz.</p>
        <div class="a-dialog-actions">
          <button type="button" class="a-btn secondary" data-act="cancel">İptal</button>
          <button type="button" class="a-btn" data-act="next">Devam et</button>
        </div>`;
      panel.querySelector('[data-act="cancel"]').onclick = () => finish(false);
      panel.querySelector('[data-act="next"]').onclick = () => step2();
      requestAnimationFrame(() =>
        /** @type {HTMLElement} */ (panel.querySelector('[data-act="next"]'))?.focus(),
      );
    }

    function step2() {
      panel.innerHTML = `
        <h2 class="a-dialog-title">Son onay</h2>
        <p class="a-dialog-msg">QR ve masa bağlantısı kalıcı olarak değişecek. Bu işlem geri alınamaz.</p>
        <div class="a-dialog-actions">
          <button type="button" class="a-btn secondary" data-act="cancel">İptal</button>
          <button type="button" class="a-btn" data-act="ok">QR'ı yenile</button>
        </div>`;
      panel.querySelector('[data-act="cancel"]').onclick = () => finish(false);
      panel.querySelector('[data-act="ok"]').onclick = () => finish(true);
      requestAnimationFrame(() =>
        /** @type {HTMLElement} */ (panel.querySelector('[data-act="ok"]'))?.focus(),
      );
    }

    step1();
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  });
}

function role() {
  const t = getToken();
  if (!t) return null;
  return decodeJwt(t)?.role ?? null;
}

function isAdmin() {
  const r = role();
  return r === 'ADMIN_OWNER' || r === 'ADMIN';
}

function isCashierPlus() {
  const r = role();
  return (
    r === 'ADMIN_OWNER' ||
    r === 'ADMIN' ||
    r === 'CASHIER'
  );
}

function isCourier() {
  return role() === 'COURIER';
}

function isCashierOnly() {
  return role() === 'CASHIER';
}

/** @param {object} o */
function isTerminalOrder(o) {
  const st = o?.status;
  return st === 'PAID' || st === 'CANCELLED';
}

/** @param {object} o */
function orderTimeMs(o, field) {
  const v = o?.[field];
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** @param {object} o */
function staffActionsList(o) {
  return o.channel === 'IN_PLACE'
    ? inPlaceActions(o.status)
    : onlineStaffActions(o.status);
}

/** @param {object} o */
function canCancelOrder(o) {
  return staffActionsList(o).some((a) => a.act === 'CANCEL');
}

/**
 * Tek ana ileri adım (durum adı buton etiketinde).
 * @param {object} o
 * @returns {{ kind: 'transition', act: string, targetLabel: string } | { kind: 'assign', targetLabel: string } | null}
 */
function primaryFlowStep(o) {
  if (isTerminalOrder(o)) return null;
  const ch = o.channel;
  const st = o.status;
  if (ch === 'IN_PLACE') {
    if (st === 'PLACED')
      return {
        kind: 'transition',
        act: 'START',
        targetLabel: inPlaceStatusTr('IN_PROGRESS'),
      };
    if (st === 'IN_PROGRESS')
      return {
        kind: 'transition',
        act: 'READY',
        targetLabel: inPlaceStatusTr('READY'),
      };
    if (st === 'READY')
      return {
        kind: 'transition',
        act: 'AWAIT_PAYMENT',
        targetLabel: inPlaceStatusTr('AWAITING_PAYMENT'),
      };
    if (st === 'AWAITING_PAYMENT')
      return {
        kind: 'transition',
        act: 'MARK_PAID',
        targetLabel: inPlaceStatusTr('PAID'),
      };
    return null;
  }
  if (st === 'PLACED')
    return {
      kind: 'transition',
      act: 'CONFIRM',
      targetLabel: onlineStatusTr('CONFIRMED'),
    };
  if (st === 'CONFIRMED')
    return {
      kind: 'transition',
      act: 'START_PREP',
      targetLabel: onlineStatusTr('IN_PROGRESS'),
    };
  if (st === 'IN_PROGRESS')
    return {
      kind: 'transition',
      act: 'READY_HANDOFF',
      targetLabel: onlineStatusTr('READY_FOR_HANDOFF'),
    };
  if (st === 'READY_FOR_HANDOFF')
    return { kind: 'assign', targetLabel: onlineStatusTr('ASSIGNED') };
  if (st === 'AWAITING_CASHIER_PAYMENT')
    return {
      kind: 'transition',
      act: 'MARK_PAID',
      targetLabel: onlineStatusTr('PAID'),
    };
  return null;
}

/** @param {object} o @returns {string} */
function orderFlowActionsInnerHtml(o) {
  const id = esc(idStr(o));
  const chEsc = esc(o.channel);
  const bits = [];
  if (canCancelOrder(o)) {
    bits.push(
      `<button type="button" class="a-btn secondary a-act" data-id="${id}" data-ch="${chEsc}" data-act="CANCEL">İptal</button>`,
    );
  }
  const step = primaryFlowStep(o);
  if (step?.kind === 'transition') {
    bits.push(
      `<button type="button" class="a-btn a-act" data-id="${id}" data-ch="${chEsc}" data-act="${esc(step.act)}">→ ${esc(step.targetLabel)}</button>`,
    );
  } else if (step?.kind === 'assign') {
    bits.push(
      `<select class="a-select a-courier-sel" data-id="${id}" aria-label="Kurye"><option value="">Kurye seç…</option></select>`,
    );
    bits.push(
      `<button type="button" class="a-btn a-assign" data-id="${id}">→ ${esc(step.targetLabel)}</button>`,
    );
  }
  return bits.join('');
}

async function fetchOrdersStaff() {
  const orders = await api('/orders?limit=80');
  return Array.isArray(orders) ? orders : [];
}

/** @param {HTMLElement} container */
async function rerenderStaffOrderContainers(container) {
  if (view === 'history') {
    if (historyUi.detailOrderId) {
      await renderOrderHistoryDetail(container, historyUi.detailOrderId);
    } else {
      await renderOrderHistory(container);
    }
  } else await renderOrders(container);
}

/** @param {number | string | undefined} kurus */
function formatTryFromKurus(kurus) {
  const n = Number(kurus) || 0;
  return `${(n / 100).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₺`;
}

/** @param {string | undefined} iso */
function formatDateTimeTr(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('tr-TR');
  } catch {
    return '—';
  }
}

/** @param {string | undefined} e164 */
function formatPhoneTrDisplay(e164) {
  if (!e164 || typeof e164 !== 'string') return '';
  const s = e164.replace(/\s/g, '');
  if (s.startsWith('+90') && s.length >= 13) {
    const rest = s.slice(3);
    return `0${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6, 8)} ${rest.slice(8, 10)}`;
  }
  return s;
}

/** @param {{ firstName?: string, lastName?: string, phoneE164?: string }} c */
function courierSelectDisplayText(c) {
  const fn = c.firstName != null ? String(c.firstName).trim() : '';
  const ln = c.lastName != null ? String(c.lastName).trim() : '';
  const full = [fn, ln].filter(Boolean).join(' ').trim();
  return full || (c.phoneE164 ? formatPhoneTrDisplay(c.phoneE164) || c.phoneE164 : '') || 'Kurye';
}

/** @param {object} o @returns {string} */
function liveOrderCardHtml(o) {
  const id = esc(idStr(o));
  const shortId = id.length >= 8 ? id.slice(-8) : id;
  const ch = o.channel;
  const chLabel = esc(channelLabelTr(ch));
  const stRaw = esc(o.status);
  const stLabel =
    ch === 'IN_PLACE'
      ? esc(inPlaceStatusTr(o.status))
      : esc(onlineStatusTr(o.status));
  const masa = ch === 'IN_PLACE' ? tableNumberCell(o) : '—';
  const itemsSummary = esc(orderItemsSummary(o));
  const addDisp = latestInPlaceAdditionDisplay(o);
  const sonEk =
    ch === 'IN_PLACE' && addDisp.text
      ? `<p class="a-muted a-order-card__son" title="${esc(addDisp.title)}">${esc(addDisp.text)}</p>`
      : '';
  const actions = orderFlowActionsInnerHtml(o);
  return `<article class="a-order-card">
    <div class="a-order-card__head">
      <code class="a-order-card__id">${shortId}</code>
      <span class="a-badge">${chLabel}</span>
    </div>
    <p class="a-order-card__meta"><strong>${masa}</strong></p>
    <p class="a-order-card__items">${itemsSummary}</p>
    ${sonEk}
    <p class="a-order-card__status"><span title="${stRaw}">${stLabel}</span></p>
    <div class="a-order-card__actions">${actions ? `<div class="a-order-card__flow">${actions}</div>` : '<span class="a-muted">İşlem yok</span>'}</div>
  </article>`;
}

/** @param {object} o @returns {string} */
function historyOrderRowHtml(o) {
  const rawId = idStr(o);
  const id = esc(rawId);
  const shortId = id.length >= 8 ? id.slice(-8) : id;
  const ch = o.channel;
  const chLabel = esc(channelLabelTr(ch));
  const stRaw = esc(o.status);
  const stLabel =
    ch === 'IN_PLACE'
      ? esc(inPlaceStatusTr(o.status))
      : esc(onlineStatusTr(o.status));
  const masa = ch === 'IN_PLACE' ? tableNumberCell(o) : '—';
  const itemsSummary = esc(orderItemsSummary(o));
  const when = o.updatedAt
    ? esc(
        new Date(o.updatedAt).toLocaleString('tr-TR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
      )
    : '—';
  return `<tr data-detail="${rawId}"><td><code>${shortId}</code></td><td><span class="a-badge">${chLabel}</span></td><td>${masa}</td><td>${itemsSummary}</td><td><span title="${stRaw}">${stLabel}</span></td><td class="a-muted">${when}</td><td><button type="button" class="a-btn secondary a-history-detail-btn" data-detail="${rawId}">Detay</button></td></tr>`;
}

function clearPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function stopOrdersRealtime() {
  if (stopOrdersWs) {
    stopOrdersWs();
    stopOrdersWs = null;
  }
  ordersWsLive = false;
}

function applyView(nextView) {
  historyUi.detailOrderId = null;
  if (nextView !== 'menu') menuUi = { sub: 'list', id: null, list: defaultMenuListUi() };
  view = nextView;
  const root = document.getElementById('root');
  if (root && screen === 'app') {
    root.querySelectorAll('[data-view]').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === view);
    });
  }
  renderMain().catch(console.error);
}

function startPoll() {
  clearPoll();
  if (screen !== 'app') return;
  pollTimer = setInterval(() => {
    if (ordersWsLive) return;
    if (view === 'orders' || view === 'history' || view === 'courier')
      renderMain();
  }, 8000);
}

async function renderLogin(root) {
  root.innerHTML = `
    <div class="a-login">
      <div class="a-brand" style="margin-bottom:8px"><span class="a-brand-logo" aria-hidden="true"></span>DAINO</div>
      <p class="a-muted">Operasyon paneli — yetkili telefon veya sahip girişi.</p>
      <div class="a-tabs" id="login-tabs">
        <button type="button" class="a-tab active" data-tab="otp">Personel (SMS)</button>
        <button type="button" class="a-tab" data-tab="owner">Sahip</button>
      </div>
      <div id="login-pane"></div>
      <p class="a-error" id="login-err"></p>
    </div>`;

  const pane = root.querySelector('#login-pane');
  const err = root.querySelector('#login-err');

  function showOtp() {
    err.textContent = '';
    pane.innerHTML = `
      <label class="a-muted">Telefon</label>
      <input class="a-input" id="otp-phone" placeholder="+905…" style="margin:8px 0" />
      <button type="button" class="a-btn" id="otp-send">Kod gönder</button>
      <div style="margin-top:16px">
        <label class="a-muted">Kod</label>
        <input class="a-input" id="otp-code" maxlength="6" placeholder="6 hane" style="margin:8px 0" />
        <button type="button" class="a-btn" id="otp-verify">Giriş</button>
      </div>`;
    pane.querySelector('#otp-send').onclick = async () => {
      err.textContent = '';
      try {
        await api('/auth/otp/request', {
          method: 'POST',
          body: JSON.stringify({
            phone: pane.querySelector('#otp-phone').value.trim(),
          }),
        });
      } catch (e) {
        err.textContent = e.message;
      }
    };
    pane.querySelector('#otp-verify').onclick = async () => {
      err.textContent = '';
      try {
        const { accessToken, refreshToken } = await api('/auth/otp/verify', {
          method: 'POST',
          body: JSON.stringify({
            phone: pane.querySelector('#otp-phone').value.trim(),
            code: pane.querySelector('#otp-code').value.trim(),
          }),
        });
        setToken(accessToken, refreshToken);
        screen = 'app';
        view = isCourier() ? 'courier' : 'orders';
        render();
      } catch (e) {
        err.textContent = e.message;
      }
    };
  }

  function showOwner() {
    err.textContent = '';
    pane.innerHTML = `
      <label class="a-muted">Telefon (OWNER_PHONE_E164)</label>
      <input class="a-input" id="ow-phone" style="margin:8px 0" />
      <label class="a-muted">Şifre</label>
      <input class="a-input" id="ow-pass" type="password" style="margin:8px 0" />
      <button type="button" class="a-btn" id="ow-go">Giriş</button>`;
    pane.querySelector('#ow-go').onclick = async () => {
      err.textContent = '';
      try {
        const { accessToken, refreshToken } = await api('/auth/owner/login', {
          method: 'POST',
          body: JSON.stringify({
            phone: pane.querySelector('#ow-phone').value.trim(),
            password: pane.querySelector('#ow-pass').value,
          }),
        });
        setToken(accessToken, refreshToken);
        screen = 'app';
        view = 'orders';
        render();
      } catch (e) {
        err.textContent = e.message;
      }
    };
  }

  showOtp();
  root.querySelectorAll('#login-tabs .a-tab').forEach((btn) => {
    btn.onclick = () => {
      root.querySelectorAll('#login-tabs .a-tab').forEach((b) =>
        b.classList.toggle('active', b === btn),
      );
      if (btn.dataset.tab === 'owner') showOwner();
      else showOtp();
    };
  });
}

function navButton(label, key) {
  const active = view === key ? 'active' : '';
  return `<button type="button" class="a-nav-btn ${active}" data-view="${key}">${esc(label)}</button>`;
}

async function renderOrders(container) {
  let orders = [];
  try {
    orders = await fetchOrdersStaff();
  } catch (e) {
    container.innerHTML = `<p class="a-error">${esc(e.message)}</p>`;
    return;
  }

  const live = orders.filter((o) => !isTerminalOrder(o));
  live.sort((a, b) => orderTimeMs(a, 'createdAt') - orderTimeMs(b, 'createdAt'));

  const cardsHtml =
    live.length > 0
      ? `<div class="a-order-cards">${live.map((o) => liveOrderCardHtml(o)).join('')}</div>`
      : `<div class="a-card a-muted">Aktif sipariş yok.</div>`;

  container.innerHTML = `
    <h1 class="a-h1">Siparişler</h1>
    <p class="a-muted">Canlı siparişler WebSocket ile güncellenir; bağlantı yoksa birkaç saniyede bir REST ile yenilenir.</p>
    <p class="a-muted" style="margin-top:-8px"><a class="a-inline-link" href="#" id="a-goto-history">Geçmiş siparişler</a></p>
    <h2 class="a-h2">Canlı siparişler</h2>
    ${cardsHtml}`;

  const histLink = container.querySelector('#a-goto-history');
  if (histLink) {
    histLink.onclick = (ev) => {
      ev.preventDefault();
      applyView('history');
    };
  }

  let couriers = [];
  try {
    couriers = await api('/admin/couriers');
  } catch {
    couriers = [];
  }
  container.querySelectorAll('.a-courier-sel').forEach((sel) => {
    couriers.forEach((c) => {
      const o = document.createElement('option');
      o.value = c._id;
      o.textContent = courierSelectDisplayText(c);
      if (c.phoneE164) o.title = String(c.phoneE164);
      sel.appendChild(o);
    });
  });

  container.querySelectorAll('.a-act').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const ch = btn.dataset.ch;
      const act = btn.dataset.act;
      const path =
        ch === 'IN_PLACE'
          ? `/orders/${id}/in-place/transition`
          : `/orders/${id}/online/transition`;
      try {
        await api(path, {
          method: 'POST',
          body: JSON.stringify({ action: act }),
        });
        await rerenderStaffOrderContainers(container);
      } catch (e) {
        alert(e.message);
      }
    };
  });

  container.querySelectorAll('.a-assign').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const sel = container.querySelector(`.a-courier-sel[data-id="${id}"]`);
      const courierUserId = sel?.value;
      if (!courierUserId) {
        alert('Kurye seçin.');
        return;
      }
      try {
        await api(`/orders/${id}/assign-courier`, {
          method: 'POST',
          body: JSON.stringify({ courierUserId }),
        });
        await rerenderStaffOrderContainers(container);
      } catch (e) {
        alert(e.message);
      }
    };
  });
}

async function renderOrderHistory(container) {
  const params = new URLSearchParams({
    page: String(historyUi.page),
    pageSize: String(historyUi.pageSize),
  });
  const qTrim = historyUi.q.trim();
  if (qTrim) params.set('q', qTrim);

  /** @type {{ items?: object[], total?: number, page?: number, pageSize?: number }} */
  let body;
  try {
    body = await api(`/orders/history?${params.toString()}`);
  } catch (e) {
    container.innerHTML = `<p class="a-error">${esc(e.message)}</p>`;
    return;
  }

  const items = Array.isArray(body.items) ? body.items : [];
  const total = Number(body.total) || 0;
  const page =
    typeof body.page === 'number' && Number.isFinite(body.page)
      ? body.page
      : historyUi.page;
  const pageSize =
    typeof body.pageSize === 'number' && Number.isFinite(body.pageSize)
      ? body.pageSize
      : historyUi.pageSize;
  historyUi.page = page;
  historyUi.pageSize = pageSize;

  const histNote = isCashierOnly()
    ? '<p class="a-muted">Yalnızca son 24 saatte tamamlanan veya iptal edilen siparişler listelenir.</p>'
    : '';

  const histRows = items.map((o) => historyOrderRowHtml(o)).join('');
  const emptyColspan = 7;
  const fromN = total === 0 ? 0 : page * pageSize + 1;
  const toN = Math.min(total, page * pageSize + items.length);
  const hasPrev = page > 0;
  const hasNext = page * pageSize + items.length < total;

  container.innerHTML = `
    <h1 class="a-h1">Geçmiş siparişler</h1>
    <p class="a-muted"><a class="a-inline-link" href="#" id="a-goto-live">Canlı siparişlere dön</a></p>
    ${histNote}
    <form class="a-history-toolbar" id="hist-search-form" role="search">
      <input class="a-input a-history-q" type="search" id="hist-q" name="q" placeholder="Sipariş no, ürün veya adres ara…" value="${esc(historyUi.q)}" autocomplete="off" />
      <button type="submit" class="a-btn" id="hist-submit">Ara</button>
    </form>
    <p class="a-muted" id="hist-range">${esc(`${fromN}–${toN} / ${total} kayıt`)}</p>
    <div style="overflow:auto;margin-top:8px">
      <table class="a-table">
        <thead><tr><th>ID</th><th>Kanal</th><th>Masa</th><th>Ürünler</th><th>Durum</th><th>Güncellendi</th><th></th></tr></thead>
        <tbody id="hist-tbody">${histRows || `<tr><td colspan="${emptyColspan}" class="a-muted">Kayıt yok</td></tr>`}</tbody>
      </table>
    </div>
    <div class="a-history-pager">
      <button type="button" class="a-btn secondary" id="hist-prev" ${hasPrev ? '' : 'disabled'}>Önceki</button>
      <span class="a-muted">Sayfa ${esc(String(page + 1))}</span>
      <button type="button" class="a-btn secondary" id="hist-next" ${hasNext ? '' : 'disabled'}>Sonraki</button>
    </div>`;

  container.querySelector('#a-goto-live')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    applyView('orders');
  });

  container.querySelector('#hist-search-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = /** @type {HTMLInputElement | null} */ (
      container.querySelector('#hist-q')
    );
    historyUi.q = input?.value?.trim() ?? '';
    historyUi.page = 0;
    renderMain().catch(console.error);
  });

  container.querySelector('#hist-prev')?.addEventListener('click', () => {
    if (historyUi.page <= 0) return;
    historyUi.page -= 1;
    renderMain().catch(console.error);
  });

  container.querySelector('#hist-next')?.addEventListener('click', () => {
    if (!hasNext) return;
    historyUi.page += 1;
    renderMain().catch(console.error);
  });

  container.querySelectorAll('.a-history-detail-btn').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const id = /** @type {HTMLButtonElement} */ (btn).dataset.detail;
      if (!id) return;
      historyUi.detailOrderId = id;
      renderMain().catch(console.error);
    });
  });
}

/** @param {object} it */
function orderItemOptionSelectionsText(it) {
  if (!it?.optionSelections?.length) return '';
  return it.optionSelections
    .map((g) => {
      const labs = (g.selectedChoices || [])
        .map((c) => {
          const base = c.label ? String(c.label) : '';
          if (!base) return '';
          const ex = Number(c.extraPriceKurus) || 0;
          if (ex <= 0) return base;
          return `${base} (+${formatTryFromKurus(ex)})`;
        })
        .filter(Boolean)
        .join(', ');
      if (!labs) return '';
      return `${g.groupLabel || g.groupId}: ${labs}`;
    })
    .filter(Boolean)
    .join(' · ');
}

/** @param {object} it */
function orderDetailItemRow(it) {
  const qty = Number(it.quantity) || 0;
  const unit = Number(it.unitPriceKurus) || 0;
  const line = qty * unit;
  const opt = orderItemOptionSelectionsText(it);
  const optHtml = opt
    ? `<div class="a-muted" style="font-size:0.82rem;margin-top:4px">${esc(opt)}</div>`
    : '';
  return `<tr><td>${esc(it.name)}${optHtml}</td><td>${esc(String(qty))}</td><td>${esc(formatTryFromKurus(unit))}</td><td>${esc(formatTryFromKurus(line))}</td></tr>`;
}

/** @param {object} h */
function orderHistoryDetailEntryRow(h) {
  const at = formatDateTimeTr(h.at);
  const from = h.from != null ? esc(String(h.from)) : '—';
  const to = h.to != null ? esc(String(h.to)) : '—';
  const note = h.note ? esc(String(h.note)) : '—';
  return `<tr><td class="a-muted">${esc(at)}</td><td>${from} → ${to}</td><td>${note}</td></tr>`;
}

/** @param {HTMLElement} container @param {string} orderId */
async function renderOrderHistoryDetail(container, orderId) {
  /** @type {object | null} */
  let o = null;
  try {
    o = await api(`/orders/${encodeURIComponent(orderId)}`);
  } catch (e) {
    container.innerHTML = `
      <p class="a-error">${esc(e.message)}</p>
      <p><button type="button" class="a-btn secondary" id="hist-det-fallback">Listeye dön</button></p>`;
    container.querySelector('#hist-det-fallback')?.addEventListener('click', () => {
      historyUi.detailOrderId = null;
      renderMain().catch(console.error);
    });
    return;
  }

  const rawId = idStr(o);
  const ch = o.channel;
  const chLabel = esc(channelLabelTr(ch));
  const stLabel =
    ch === 'IN_PLACE'
      ? esc(inPlaceStatusTr(o.status))
      : esc(onlineStatusTr(o.status));
  const masa = ch === 'IN_PLACE' ? tableNumberCell(o) : '—';
  const rec = o.deliveryRecipient;
  let recipientBlock = '';
  if (rec && typeof rec === 'object') {
    const fn = rec.firstName != null && String(rec.firstName).trim() ? esc(String(rec.firstName).trim()) : '—';
    const ln = rec.lastName != null && String(rec.lastName).trim() ? esc(String(rec.lastName).trim()) : '—';
    const phRaw = rec.phoneE164 != null && String(rec.phoneE164).trim() ? String(rec.phoneE164).trim() : '';
    const ph = phRaw ? esc(formatPhoneTrDisplay(phRaw)) : '—';
    if (fn !== '—' || ln !== '—' || ph !== '—') {
      recipientBlock = `<div class="a-card a-order-detail-block"><h2 class="a-h2" style="margin-top:0">Teslim alıcı</h2>
      <p><strong>Ad:</strong> ${fn}</p>
      <p><strong>Soyad:</strong> ${ln}</p>
      <p><strong>Telefon:</strong> ${ph}</p></div>`;
    }
  }
  const addr = o.deliveryAddress;
  let addrBlock = '';
  if (addr && typeof addr === 'object') {
    const rows = [];
    if (addr.label) rows.push(`<p><strong>Adres adı:</strong> ${esc(String(addr.label))}</p>`);
    if (addr.line1) rows.push(`<p><strong>Satır 1:</strong> ${esc(String(addr.line1))}</p>`);
    if (addr.line2) rows.push(`<p><strong>Satır 2:</strong> ${esc(String(addr.line2))}</p>`);
    if (addr.district) rows.push(`<p><strong>İlçe:</strong> ${esc(String(addr.district))}</p>`);
    if (addr.city) rows.push(`<p><strong>İl:</strong> ${esc(String(addr.city))}</p>`);
    if (addr.country) rows.push(`<p><strong>Ülke:</strong> ${esc(String(addr.country))}</p>`);
    if (rows.length) {
      addrBlock = `<div class="a-card a-order-detail-block"><h2 class="a-h2" style="margin-top:0">Teslimat adresi</h2>${rows.join('')}</div>`;
    }
  }
  const coll = o.collectionMethod
    ? esc(o.collectionMethod === 'POS' ? 'POS' : 'Nakit')
    : '—';

  const itemsRows = Array.isArray(o.items)
    ? o.items.map((it) => orderDetailItemRow(it)).join('')
    : '';

  const histSorted = Array.isArray(o.history)
    ? [...o.history].sort(
        (a, b) => orderTimeMs(a, 'at') - orderTimeMs(b, 'at'),
      )
    : [];
  const histRows = histSorted.map((h) => orderHistoryDetailEntryRow(h)).join('');

  container.innerHTML = `
    <h1 class="a-h1">Sipariş detayı</h1>
    <p class="a-muted"><button type="button" class="a-btn secondary" id="hist-det-back">← Geçmiş listesine dön</button></p>
    <div class="a-card a-order-detail-block">
      <div class="a-row">
        <div>
          <p class="a-muted" style="margin:0">Sipariş</p>
          <p style="margin:4px 0 0"><code>${esc(rawId)}</code></p>
        </div>
        <span class="a-badge">${chLabel}</span>
      </div>
      <p><strong>Durum:</strong> ${stLabel}</p>
      <p><strong>Masa / kanal:</strong> ${masa}</p>
      <p><strong>Oluşturulma:</strong> ${esc(formatDateTimeTr(o.createdAt))}</p>
      <p><strong>Son güncelleme:</strong> ${esc(formatDateTimeTr(o.updatedAt))}</p>
      <p><strong>Ödeme tipi (teslimat):</strong> ${coll}</p>
      <p><strong>Toplam:</strong> ${esc(formatTryFromKurus(o.totalKurus))}</p>
    </div>
    ${recipientBlock}
    ${addrBlock}
    <h2 class="a-h2">Ürünler</h2>
    <div style="overflow:auto">
      <table class="a-table">
        <thead><tr><th>Ürün</th><th>Adet</th><th>Birim</th><th>Satır</th></tr></thead>
        <tbody>${itemsRows || '<tr><td colspan="4" class="a-muted">—</td></tr>'}</tbody>
      </table>
    </div>
    <h2 class="a-h2">Durum geçmişi</h2>
    <div style="overflow:auto">
      <table class="a-table">
        <thead><tr><th>Zaman</th><th>Geçiş</th><th>Not</th></tr></thead>
        <tbody>${histRows || '<tr><td colspan="3" class="a-muted">—</td></tr>'}</tbody>
      </table>
    </div>`;

  container.querySelector('#hist-det-back')?.addEventListener('click', () => {
    historyUi.detailOrderId = null;
    renderMain().catch(console.error);
  });
}

async function renderCourier(container) {
  let cur = null;
  let hist = [];
  try {
    cur = await api('/courier/orders/current');
    hist = await api('/courier/orders/history?limit=30');
  } catch (e) {
    container.innerHTML = `<p class="a-error">${esc(e.message)}</p>`;
    return;
  }
  const curHtml = cur
    ? `<div class="a-card">
         <div class="a-row"><strong>Güncel</strong><span class="a-badge">${esc(cur.status)}</span></div>
         <p class="a-muted">Sipariş: <code>${esc(cur._id)}</code></p>
         <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
           <button type="button" class="a-btn" id="c-start">Yola çıktım</button>
           <button type="button" class="a-btn secondary" id="c-pos">Teslim + POS</button>
           <button type="button" class="a-btn secondary" id="c-cash">Teslim + nakit</button>
         </div>
       </div>`
    : `<div class="a-card a-muted">Atanmış aktif teslimat yok.</div>`;

  const histRows = (hist || [])
    .map(
      (o) =>
        `<tr><td><code>${esc(String(o._id).slice(-8))}</code></td><td>${esc(o.status)}</td></tr>`,
    )
    .join('');

  container.innerHTML = `
    <h1 class="a-h1">Kurye</h1>
    ${curHtml}
    <h2 class="a-h1" style="font-size:1.25rem;margin-top:24px">Geçmiş</h2>
    <table class="a-table"><thead><tr><th>ID</th><th>Durum</th></tr></thead>
    <tbody>${histRows || '<tr><td colspan="2" class="a-muted">—</td></tr>'}</tbody></table>`;

  const id = cur?._id;
  const q = (method, body) =>
    api(`/courier/orders/${id}${method}`, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });

  const btn = (sel, fn) => {
    const b = container.querySelector(sel);
    if (b) b.onclick = fn;
  };
  btn('#c-start', async () => {
    if (!id) return;
    try {
      await q('/start-delivery');
      await renderCourier(container);
    } catch (e) {
      alert(e.message);
    }
  });
  btn('#c-pos', async () => {
    if (!id) return;
    try {
      await q('/deliver', { collectionMethod: 'POS' });
      await renderCourier(container);
    } catch (e) {
      alert(e.message);
    }
  });
  btn('#c-cash', async () => {
    if (!id) return;
    try {
      await q('/deliver', { collectionMethod: 'CASH' });
      await renderCourier(container);
    } catch (e) {
      alert(e.message);
    }
  });
}

async function renderShop(container) {
  let s = { serviceEnabled: false };
  try {
    s = await api('/shop/settings');
  } catch (e) {
    container.innerHTML = `<p class="a-error">${esc(e.message)}</p>`;
    return;
  }
  container.innerHTML = `
    <h1 class="a-h1">Mağaza</h1>
    <div class="a-card">
      <div class="a-row">
        <span>Masadan sipariş (servis)</span>
        <button type="button" class="a-btn" id="svc-toggle">${s.serviceEnabled ? 'Açık → Kapat' : 'Kapalı → Aç'}</button>
      </div>
      <p class="a-muted">Kapalıyken QR menü self-servis mesajı gösterir; masa siparişi API ile engellenir.</p>
    </div>`;
  container.querySelector('#svc-toggle').onclick = async () => {
    try {
      await api('/shop/settings', {
        method: 'PATCH',
        body: JSON.stringify({ serviceEnabled: !s.serviceEnabled }),
      });
      await renderShop(container);
    } catch (e) {
      alert(e.message);
    }
  };
}

async function renderStaff(container) {
  let list = [];
  try {
    list = await api('/admin/staff');
  } catch (e) {
    container.innerHTML = `<p class="a-error">${esc(e.message)}</p>`;
    return;
  }
  container.innerHTML = `
    <h1 class="a-h1">Personel</h1>
    <div class="a-card">
      <label class="a-muted">İsim</label>
      <input class="a-input" id="st-fn" placeholder="Ad" />
      <label class="a-muted" style="display:block;margin-top:8px">Soyisim</label>
      <input class="a-input" id="st-ln" placeholder="Soyad" />
      <label class="a-muted" style="display:block;margin-top:8px">Telefon</label>
      <input class="a-input" id="st-phone" placeholder="+905…" />
      <label class="a-muted" style="display:block;margin-top:8px">Rol</label>
      <select class="a-select" id="st-role">
        <option value="CASHIER">CASHIER</option>
        <option value="COURIER">COURIER</option>
        <option value="ADMIN">ADMIN</option>
      </select>
      <button type="button" class="a-btn" style="margin-top:10px" id="st-add">Ekle</button>
    </div>
    <table class="a-table" style="margin-top:16px">
      <thead><tr><th>Ad Soyad</th><th>Telefon</th><th>Rol</th><th></th></tr></thead>
      <tbody id="st-tbody">
        ${list
          .map((u) => {
            const id = String(u._id ?? u.id ?? '');
            const fn = u.firstName ?? '';
            const ln = u.lastName ?? '';
            const display =
              [fn, ln].filter(Boolean).join(' ') || '—';
            return `<tr data-staff-id="${esc(id)}">
          <td class="st-name-cell">
            <span class="st-name-view">${esc(display)}</span>
            <span class="st-name-edit" style="display:none">
              <input class="a-input st-edit-fn" value="${esc(fn)}" placeholder="Ad" />
              <input class="a-input st-edit-ln" value="${esc(ln)}" placeholder="Soyad" style="margin-top:6px" />
            </span>
          </td>
          <td>${esc(u.phoneE164)}</td>
          <td>${esc(u.role)}</td>
          <td class="st-actions-cell">
            <button type="button" class="a-btn secondary st-edit">Düzenle</button>
            <button type="button" class="a-btn st-save" style="display:none">Kaydet</button>
            <button type="button" class="a-btn secondary st-cancel" style="display:none">İptal</button>
            <button type="button" class="a-btn secondary a-del" data-id="${esc(id)}">Sil</button>
          </td>
        </tr>`;
          })
          .join('')}
      </tbody>
    </table>`;

  const tbody = container.querySelector('#st-tbody');
  tbody.addEventListener('click', async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const tr = t.closest('tr[data-staff-id]');
    if (!tr) return;
    const staffId = tr.dataset.staffId;

    if (t.classList.contains('st-edit')) {
      tr.querySelector('.st-name-view').style.display = 'none';
      tr.querySelector('.st-name-edit').style.display = 'block';
      tr.querySelector('.st-edit').style.display = 'none';
      tr.querySelector('.st-save').style.display = 'inline-block';
      tr.querySelector('.st-cancel').style.display = 'inline-block';
      return;
    }
    if (t.classList.contains('st-cancel')) {
      await renderStaff(container);
      return;
    }
    if (t.classList.contains('st-save')) {
      const firstName = tr.querySelector('.st-edit-fn').value.trim();
      const lastName = tr.querySelector('.st-edit-ln').value.trim();
      if (firstName.length < 2 || lastName.length < 2) {
        alert('İsim ve soyisim en az 2 karakter olmalı.');
        return;
      }
      try {
        await api(`/admin/staff/${staffId}`, {
          method: 'PATCH',
          body: JSON.stringify({ firstName, lastName }),
        });
        await renderStaff(container);
      } catch (err) {
        alert(err.message);
      }
    }
  });

  container.querySelector('#st-add').onclick = async () => {
    const firstName = container.querySelector('#st-fn').value.trim();
    const lastName = container.querySelector('#st-ln').value.trim();
    if (firstName.length < 2 || lastName.length < 2) {
      alert('İsim ve soyisim en az 2 karakter olmalı.');
      return;
    }
    try {
      await api('/admin/staff', {
        method: 'POST',
        body: JSON.stringify({
          phone: container.querySelector('#st-phone').value.trim(),
          role: container.querySelector('#st-role').value,
          firstName,
          lastName,
        }),
      });
      await renderStaff(container);
    } catch (e) {
      alert(e.message);
    }
  };
  container.querySelectorAll('.a-del').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Silinsin mi?')) return;
      try {
        await api(`/admin/staff/${b.dataset.id}`, { method: 'DELETE' });
        await renderStaff(container);
      } catch (e) {
        alert(e.message);
      }
    };
  });
}

async function renderTables(container) {
  let list = [];
  try {
    list = await api('/admin/tables');
  } catch (e) {
    container.innerHTML = `<p class="a-error">${esc(e.message)}</p>`;
    return;
  }
  container.innerHTML = `
    <h1 class="a-h1">Masalar</h1>
    <div class="a-card">
      <label class="a-muted">Yeni masa numarası (0 değil)</label>
      <input class="a-input" type="number" id="tb-num" min="1" />
      <input class="a-input" id="tb-label" placeholder="Etiket (opsiyonel)" />
      <button type="button" class="a-btn" id="tb-add">Oluştur</button>
    </div>
    <table class="a-table">
      <thead><tr><th>No</th><th>Slug</th><th>URL</th><th>QR</th><th></th></tr></thead>
      <tbody>
        ${list
          .map(
            (t) => `<tr>
          <td>${esc(t.number)}</td>
          <td><code>${esc(t.publicSlug?.slice(0, 12))}…</code></td>
          <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis"><a href="${esc(t.menuUrl)}" target="_blank" rel="noopener">${esc(t.menuUrl)}</a></td>
          <td class="a-qr-cell"><button type="button" class="a-btn secondary a-dlqr" data-menu-url="${esc(t.menuUrl)}" data-num="${esc(String(t.number))}">Görseli indir</button></td>
          <td>
            ${t.isSystem ? '<span class="a-muted">sistem</span>' : `<button type="button" class="a-btn secondary a-regqr" data-id="${esc(String(t._id))}">QR yenile</button>
            <button type="button" class="a-btn secondary a-delt" data-id="${esc(String(t._id))}">Sil</button>`}
          </td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>`;

  container.querySelector('#tb-add').onclick = async () => {
    const number = Number(container.querySelector('#tb-num').value);
    const label = container.querySelector('#tb-label').value.trim();
    try {
      await api('/admin/tables', {
        method: 'POST',
        body: JSON.stringify({ number, label: label || undefined }),
      });
      await renderTables(container);
    } catch (e) {
      alert(e.message);
    }
  };
  container.querySelectorAll('.a-dlqr').forEach((b) => {
    b.onclick = () => {
      const menuUrl = b.dataset.menuUrl;
      if (!menuUrl) return;
      void downloadTableQrPng(menuUrl, b.dataset.num ?? '');
    };
  });
  container.querySelectorAll('.a-regqr').forEach((b) => {
    b.onclick = async () => {
      const ok = await showQrRegenerateTwoStepDialog();
      if (!ok) return;
      try {
        await api(`/admin/tables/${b.dataset.id}/regenerate-qr`, {
          method: 'POST',
        });
        await renderTables(container);
      } catch (e) {
        alert(e.message);
      }
    };
  });
  container.querySelectorAll('.a-delt').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Silinsin mi?')) return;
      try {
        await api(`/admin/tables/${b.dataset.id}`, { method: 'DELETE' });
        await renderTables(container);
      } catch (e) {
        alert(e.message);
      }
    };
  });
}

async function renderMenuAdmin(container) {
  const onBack = () => {
    menuUi = { ...menuUi, sub: 'list', id: null };
    renderMain().catch(console.error);
  };
  const reload = () => renderMain().catch(console.error);

  if (menuUi.sub === 'list') {
    await renderMenuList(container, {
      esc,
      listUi: menuUi.list,
      refresh: () => renderMain().catch(console.error),
      onNewCategory: () => {
        menuUi = { ...menuUi, sub: 'category-new', id: null };
        renderMain().catch(console.error);
      },
      onNewProduct: () => {
        menuUi = { ...menuUi, sub: 'product-new', id: null };
        renderMain().catch(console.error);
      },
      onEditCategory: (id) => {
        menuUi = { ...menuUi, sub: 'category-edit', id };
        renderMain().catch(console.error);
      },
      onEditProduct: (id) => {
        menuUi = { ...menuUi, sub: 'product-edit', id };
        renderMain().catch(console.error);
      },
    });
    return;
  }

  if (menuUi.sub === 'category-new') {
    await renderCategoryFormPage(container, {
      esc,
      mode: 'new',
      categoryId: null,
      onBack,
      reload,
    });
    return;
  }
  if (menuUi.sub === 'category-edit') {
    await renderCategoryFormPage(container, {
      esc,
      mode: 'edit',
      categoryId: menuUi.id,
      onBack,
      reload,
    });
    return;
  }
  if (menuUi.sub === 'product-new') {
    await renderProductFormPage(container, {
      esc,
      mode: 'new',
      productId: null,
      onBack,
      reload,
    });
    return;
  }
  if (menuUi.sub === 'product-edit') {
    await renderProductFormPage(container, {
      esc,
      mode: 'edit',
      productId: menuUi.id,
      onBack,
      reload,
    });
  }
}

async function renderMain() {
  const main = document.getElementById('a-main');
  if (!main) return;
  if (view === 'orders' && !isCourier()) await renderOrders(main);
  else if (view === 'history') {
    if (!isCashierPlus()) {
      view = 'orders';
      await renderMain();
    } else if (historyUi.detailOrderId) {
      await renderOrderHistoryDetail(main, historyUi.detailOrderId);
    } else {
      await renderOrderHistory(main);
    }
  } else if (view === 'courier' && isCourier()) await renderCourier(main);
  else if (view === 'courier' && !isCourier()) {
    view = 'orders';
    await renderMain();
  } else if (view === 'shop' && isCashierPlus()) await renderShop(main);
  else if (view === 'staff' && isAdmin()) await renderStaff(main);
  else if (view === 'tables' && isAdmin()) await renderTables(main);
  else if (view === 'menu' && isAdmin()) await renderMenuAdmin(main);
  else {
    const fallback = isCourier() ? 'courier' : 'orders';
    if (view !== fallback) {
      view = fallback;
      await renderMain();
    } else {
      main.innerHTML = '<p class="a-error">Görünüm yüklenemedi.</p>';
    }
  }
}

function renderApp(root) {
  clearPoll();
  stopOrdersRealtime();
  if (isCourier()) view = 'courier';
  const r = role();
  const sideNav = isCourier()
    ? `${navButton('Görevler', 'courier')}`
    : `${navButton('Siparişler', 'orders')}
       ${navButton('Geçmiş', 'history')}
       ${isCashierPlus() ? navButton('Mağaza', 'shop') : ''}
       ${isAdmin() ? navButton('Personel', 'staff') + navButton('Masalar', 'tables') + navButton('Menü', 'menu') : ''}`;

  root.innerHTML = `
    <div class="a-layout">
      <aside class="a-side">
        <div class="a-brand"><span class="a-brand-logo" aria-hidden="true"></span>DAINO</div>
        <p class="a-muted" style="margin-bottom:16px">${esc(r)}</p>
        ${sideNav}
        <button type="button" class="a-nav-btn" id="a-logout" style="margin-top:24px">Çıkış</button>
      </aside>
      <div>
        <div class="a-mnav" id="a-mnav"></div>
        <div class="a-main" id="a-main"></div>
      </div>
    </div>`;

  const mnav = root.querySelector('#a-mnav');
  mnav.innerHTML = sideNav;
  root.querySelectorAll('[data-view]').forEach((b) => {
    b.onclick = () => applyView(b.dataset.view);
  });
  root.querySelector('#a-logout').onclick = () => {
    setToken(null);
    screen = 'login';
    clearPoll();
    stopOrdersRealtime();
    render();
  };

  renderMain()
    .then(() => {
      stopOrdersWs = connectOrdersStaffRealtime({
        onOrdersPush: () => {
          if (
            screen === 'app' &&
            (view === 'orders' || view === 'history' || view === 'courier')
          ) {
            renderMain().catch(console.error);
          }
        },
        onConnectionChange: (open) => {
          ordersWsLive = Boolean(open);
        },
      });
      startPoll();
    })
    .catch(console.error);
}

function render() {
  const root = document.getElementById('root');
  const hasSession = Boolean(getToken() || getRefreshToken());
  screen = hasSession ? 'app' : 'login';
  if (screen === 'login') {
    clearPoll();
    stopOrdersRealtime();
    renderLogin(root);
  } else {
    renderApp(root);
  }
}

render();
