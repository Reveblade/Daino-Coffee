import {
  api,
  decodeJwt,
  getRefreshToken,
  getToken,
  setToken,
  uploadAdminImage,
} from './api.js';
import { connectOrdersStaffRealtime } from './orders-realtime.js';

/** @type {'login' | 'app'} */
let screen = 'login';
/** @type {string} */
let view = 'orders';
let pollTimer = null;
/** @type {(() => void) | null} */
let stopOrdersWs = null;
/** True while staff orders WebSocket is connected (disables fast HTTP polling). */
let ordersWsLive = false;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function idStr(x) {
  return String(x?._id ?? x ?? '');
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
    ? meta.map((a) => `${a.quantity}×${a.name}`).join(', ')
    : '';
  const full = adds
    .slice(-5)
    .map((h) => {
      const m = h?.metadata?.addedItems;
      return Array.isArray(m) ? m.map((a) => `${a.quantity}×${a.name}`).join(', ') : '';
    })
    .filter(Boolean)
    .join(' → ');
  const short = line.length > 52 ? `${line.slice(0, 49)}…` : line;
  return { text: short, title: full || line };
}

/** @param {string} url @param {string | number} tableNumber */
async function downloadQrImage(url, tableNumber) {
  const name = `masa-${tableNumber}-qr.png`;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(String(res.status));
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
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
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

function catPath(cat, cats) {
  const parts = [];
  let cur = cat;
  const seen = new Set();
  while (cur && !seen.has(idStr(cur))) {
    seen.add(idStr(cur));
    parts.unshift(cur.name);
    const pid = cur.parentId;
    cur = pid ? cats.find((c) => idStr(c) === idStr(pid)) : null;
  }
  return parts.join(' › ');
}

function parseTryToKurus(s) {
  const n = parseFloat(String(s).trim().replace(',', '.'));
  if (Number.isNaN(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** @returns {Promise<File | null>} */
function pickImageFile() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = () => resolve(inp.files?.[0] ?? null);
    inp.click();
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
    if (view === 'orders' || view === 'courier') renderMain();
  }, 8000);
}

async function renderLogin(root) {
  root.innerHTML = `
    <div class="a-login">
      <div class="a-brand" style="margin-bottom:8px">DAINO</div>
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
    orders = await api('/orders?limit=80');
  } catch (e) {
    container.innerHTML = `<p class="a-error">${esc(e.message)}</p>`;
    return;
  }
  if (!Array.isArray(orders)) orders = [];

  const rows = orders
    .map((o) => {
      const id = esc(o._id);
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
          ? `<span class="a-muted" title="${esc(addDisp.title)}">${esc(addDisp.text)}</span>`
          : '—';
      let actions = '';
      if (o.channel === 'IN_PLACE') {
        actions = inPlaceActions(o.status)
          .map(
            ({ act, label }) =>
              `<button type="button" class="a-btn secondary a-act" data-id="${id}" data-ch="IN_PLACE" data-act="${esc(act)}">${esc(label)}</button>`,
          )
          .join(' ');
      } else {
        actions = onlineStaffActions(o.status)
          .map(
            ({ act, label }) =>
              `<button type="button" class="a-btn secondary a-act" data-id="${id}" data-ch="ONLINE" data-act="${esc(act)}">${esc(label)}</button>`,
          )
          .join(' ');
        if (o.status === 'READY_FOR_HANDOFF') {
          actions += `
          <span class="a-muted">Kurye:</span>
          <select class="a-select a-courier-sel" data-id="${id}" style="max-width:160px;display:inline-block;width:auto"></select>
          <button type="button" class="a-btn a-assign" data-id="${id}">Kurye ata</button>`;
        }
      }
      return `<tr><td><code>${id.slice(-8)}</code></td><td><span class="a-badge">${chLabel}</span></td><td>${masa}</td><td>${itemsSummary}</td><td>${sonEk}</td><td><span title="${stRaw}">${stLabel}</span></td><td style="text-align:right;white-space:nowrap">${actions}</td></tr>`;
    })
    .join('');

  container.innerHTML = `
    <h1 class="a-h1">Siparişler</h1>
    <p class="a-muted">Liste WebSocket ile anlık güncellenir; bağlantı yoksa birkaç saniyede bir REST ile yenilenir.</p>
    <div style="overflow:auto">
      <table class="a-table">
        <thead><tr><th>ID</th><th>Kanal</th><th>Masa</th><th>Ürünler</th><th>Son ek</th><th>Durum</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="a-muted">Kayıt yok</td></tr>'}</tbody>
      </table>
    </div>`;

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
      o.textContent = `${c.phoneE164} (${c.role})`;
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
        await renderOrders(container);
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
      if (!courierUserId) return;
      try {
        await api(`/orders/${id}/assign-courier`, {
          method: 'POST',
          body: JSON.stringify({ courierUserId }),
        });
        await renderOrders(container);
      } catch (e) {
        alert(e.message);
      }
    };
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
      <label class="a-muted">Telefon</label>
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
      <thead><tr><th>Telefon</th><th>Rol</th><th></th></tr></thead>
      <tbody>
        ${list
          .map(
            (u) => `<tr>
          <td>${esc(u.phoneE164)}</td>
          <td>${esc(u.role)}</td>
          <td><button type="button" class="a-btn secondary a-del" data-id="${esc(String(u._id))}">Sil</button></td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>`;

  container.querySelector('#st-add').onclick = async () => {
    try {
      await api('/admin/staff', {
        method: 'POST',
        body: JSON.stringify({
          phone: container.querySelector('#st-phone').value.trim(),
          role: container.querySelector('#st-role').value,
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
          <td class="a-qr-cell">${
            t.qrImageUrl
              ? `<div class="a-qr-wrap">
            <img class="a-qr-thumb" src="${esc(t.qrImageUrl)}" alt="" width="72" height="72" />
            <button type="button" class="a-btn secondary a-dlqr" data-url="${esc(t.qrImageUrl)}" data-num="${esc(String(t.number))}">Görseli indir</button>
          </div>`
              : '<span class="a-muted">—</span>'
          }</td>
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
      const { url, num } = b.dataset;
      if (!url) return;
      void downloadQrImage(url, num ?? '');
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
  let cats = [];
  let prods = [];
  try {
    cats = await api('/admin/menu/categories');
    prods = await api('/admin/menu/products');
  } catch (e) {
    container.innerHTML = `<p class="a-error">${esc(e.message)}</p>`;
    return;
  }
  if (!Array.isArray(cats)) cats = [];
  if (!Array.isArray(prods)) prods = [];

  const catsSorted = [...cats].sort((a, b) =>
    catPath(a, cats).localeCompare(catPath(b, cats), 'tr'),
  );
  const catOpts = catsSorted
    .map(
      (c) =>
        `<option value="${esc(idStr(c))}">${esc(catPath(c, cats))}</option>`,
    )
    .join('');
  const parentOpts =
    `<option value="">— Üst kategori yok —</option>` +
    catsSorted
      .map(
        (c) =>
          `<option value="${esc(idStr(c))}">${esc(catPath(c, cats))}</option>`,
      )
      .join('');

  const catRows = catsSorted
    .map((c) => {
      const id = esc(idStr(c));
      const thumb = c.imageUrl
        ? `<img src="${esc(c.imageUrl)}" alt="" class="a-menu-thumb" />`
        : '<span class="a-muted">—</span>';
      return `<tr>
        <td>${esc(catPath(c, cats))}</td>
        <td style="text-align:center;width:64px">${thumb}</td>
        <td>${c.sortIndex ?? 0}</td>
        <td style="white-space:nowrap">
          <button type="button" class="a-btn secondary a-menu-cat-img" data-id="${id}">Kategori görseli</button>
          <button type="button" class="a-btn secondary a-menu-del-cat" data-id="${id}">Sil</button>
        </td>
      </tr>`;
    })
    .join('');

  const prodRows = [...prods]
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'tr'))
    .map((p) => {
      const cat = cats.find((c) => idStr(c) === idStr(p.categoryId));
      const cname = cat ? catPath(cat, cats) : '—';
      const pid = esc(idStr(p));
      const avail = p.isAvailable !== false;
      const pthumb = p.images?.[0]?.url
        ? `<img src="${esc(p.images[0].url)}" alt="" class="a-menu-thumb" />`
        : '<span class="a-muted">—</span>';
      return `<tr>
        <td style="text-align:center;width:64px">${pthumb}</td>
        <td>${esc(p.name)}</td>
        <td class="a-muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(cname)}</td>
        <td>${(Number(p.priceKurus) / 100).toFixed(2)} ₺</td>
        <td>${avail ? 'satışta' : 'kapalı'}</td>
        <td style="white-space:nowrap">
          <button type="button" class="a-btn secondary a-menu-prod-img" data-id="${pid}">Ürün görseli</button>
          <button type="button" class="a-btn secondary a-menu-toggle-p" data-id="${pid}">${avail ? 'Kapat' : 'Aç'}</button>
          <button type="button" class="a-btn secondary a-menu-del-p" data-id="${pid}">Sil</button>
        </td>
      </tr>`;
    })
    .join('');

  container.innerHTML = `
    <h1 class="a-h1">Menü</h1>
    <p class="a-muted">Kategori ve ürün ekleyin; alt kategori için üst kategori seçin. Fiyatı Türk Lirası olarak girin (ör. 45,50).</p>

    <div class="a-card" style="margin-bottom:16px">
      <strong>Yeni kategori</strong>
      <label class="a-muted" style="display:block;margin-top:8px">Ad</label>
      <input class="a-input" id="menu-cat-name" placeholder="Örn. İçecekler" />
      <label class="a-muted" style="display:block;margin-top:8px">Açıklama (opsiyonel)</label>
      <input class="a-input" id="menu-cat-desc" placeholder="" />
      <label class="a-muted" style="display:block;margin-top:8px">Üst kategori (alt kategori için)</label>
      <select class="a-select" id="menu-cat-parent">${parentOpts}</select>
      <label class="a-muted" style="display:block;margin-top:8px">Sıra</label>
      <input class="a-input" id="menu-cat-sort" type="number" value="0" style="max-width:120px" />
      <button type="button" class="a-btn" style="margin-top:10px" id="menu-cat-add">Kategori ekle</button>
    </div>

    <div class="a-card" style="margin-bottom:16px">
      <strong>Yeni ürün</strong>
      <label class="a-muted" style="display:block;margin-top:8px">Kategori</label>
      <select class="a-select" id="menu-prod-cat">${catOpts}</select>
      <label class="a-muted" style="display:block;margin-top:8px">Ad</label>
      <input class="a-input" id="menu-prod-name" placeholder="Ürün adı" />
      <label class="a-muted" style="display:block;margin-top:8px">Açıklama (opsiyonel)</label>
      <input class="a-input" id="menu-prod-desc" placeholder="" />
      <label class="a-muted" style="display:block;margin-top:8px">Fiyat (₺)</label>
      <input class="a-input" id="menu-prod-price" placeholder="12,50" style="max-width:160px" />
      <label class="a-muted" style="display:block;margin-top:8px">Sıra</label>
      <input class="a-input" id="menu-prod-sort" type="number" value="0" style="max-width:120px" />
      <button type="button" class="a-btn" style="margin-top:10px" id="menu-prod-add">Ürün ekle</button>
    </div>

    <h2 class="a-h1" style="font-size:1.15rem">Kategoriler (${cats.length})</h2>
    <div style="overflow:auto;margin-bottom:24px">
      <table class="a-table">
        <thead><tr><th>Kategori</th><th>Görsel</th><th>Sıra</th><th></th></tr></thead>
        <tbody>${catRows || '<tr><td colspan="4" class="a-muted">Kayıt yok</td></tr>'}</tbody>
      </table>
    </div>

    <h2 class="a-h1" style="font-size:1.15rem">Ürünler (${prods.length})</h2>
    <div style="overflow:auto">
      <table class="a-table">
        <thead><tr><th>Görsel</th><th>Ad</th><th>Kategori</th><th>Fiyat</th><th>Durum</th><th></th></tr></thead>
        <tbody>${prodRows || '<tr><td colspan="6" class="a-muted">Kayıt yok</td></tr>'}</tbody>
      </table>
    </div>`;

  container.querySelector('#menu-cat-add').onclick = async () => {
    const name = container.querySelector('#menu-cat-name').value.trim();
    if (!name) {
      alert('Kategori adı gerekli.');
      return;
    }
    const description =
      container.querySelector('#menu-cat-desc').value.trim() || undefined;
    const parentVal = container.querySelector('#menu-cat-parent').value.trim();
    const sortIndex = Number(container.querySelector('#menu-cat-sort').value);
    try {
      await api('/admin/menu/categories', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description,
          parentId: parentVal || undefined,
          sortIndex: Number.isFinite(sortIndex) ? sortIndex : 0,
        }),
      });
      await renderMenuAdmin(container);
    } catch (e) {
      alert(e.message);
    }
  };

  container.querySelector('#menu-prod-add').onclick = async () => {
    const categoryId = container.querySelector('#menu-prod-cat').value;
    const name = container.querySelector('#menu-prod-name').value.trim();
    const description =
      container.querySelector('#menu-prod-desc').value.trim() || undefined;
    const kurus = parseTryToKurus(container.querySelector('#menu-prod-price').value);
    const sortIndex = Number(container.querySelector('#menu-prod-sort').value);
    if (!categoryId) {
      alert('Kategori seçin.');
      return;
    }
    if (!name) {
      alert('Ürün adı gerekli.');
      return;
    }
    if (kurus === null) {
      alert('Geçerli bir fiyat girin.');
      return;
    }
    try {
      await api('/admin/menu/products', {
        method: 'POST',
        body: JSON.stringify({
          categoryId,
          name,
          description,
          priceKurus: kurus,
          sortIndex: Number.isFinite(sortIndex) ? sortIndex : 0,
        }),
      });
      await renderMenuAdmin(container);
    } catch (e) {
      alert(e.message);
    }
  };

  container.querySelectorAll('.a-menu-cat-img').forEach((b) => {
    b.onclick = async () => {
      const file = await pickImageFile();
      if (!file) return;
      try {
        const up = await uploadAdminImage(file);
        await api(`/admin/menu/categories/${b.dataset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ imageUrl: up.url }),
        });
        await renderMenuAdmin(container);
      } catch (e) {
        alert(e.message);
      }
    };
  });

  container.querySelectorAll('.a-menu-prod-img').forEach((b) => {
    b.onclick = async () => {
      const file = await pickImageFile();
      if (!file) return;
      const row = prods.find((p) => idStr(p) === b.dataset.id);
      try {
        const up = await uploadAdminImage(file);
        const prev = Array.isArray(row?.images) ? [...row.images] : [];
        await api(`/admin/menu/products/${b.dataset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            images: [...prev, { url: up.url, publicId: up.publicId }],
          }),
        });
        await renderMenuAdmin(container);
      } catch (e) {
        alert(e.message);
      }
    };
  });

  container.querySelectorAll('.a-menu-del-cat').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Bu kategori silinsin mi? (Alt kategori veya ürün varsa silinmez.)')) return;
      try {
        await api(`/admin/menu/categories/${b.dataset.id}`, { method: 'DELETE' });
        await renderMenuAdmin(container);
      } catch (e) {
        alert(e.message);
      }
    };
  });

  container.querySelectorAll('.a-menu-del-p').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Bu ürün silinsin mi?')) return;
      try {
        await api(`/admin/menu/products/${b.dataset.id}`, { method: 'DELETE' });
        await renderMenuAdmin(container);
      } catch (e) {
        alert(e.message);
      }
    };
  });

  container.querySelectorAll('.a-menu-toggle-p').forEach((b) => {
    b.onclick = async () => {
      const row = prods.find((p) => idStr(p) === b.dataset.id);
      const next = !(row && row.isAvailable !== false);
      try {
        await api(`/admin/menu/products/${b.dataset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isAvailable: next }),
        });
        await renderMenuAdmin(container);
      } catch (e) {
        alert(e.message);
      }
    };
  });
}

async function renderMain() {
  const main = document.getElementById('a-main');
  if (!main) return;
  if (view === 'orders' && !isCourier()) await renderOrders(main);
  else if (view === 'courier' && isCourier()) await renderCourier(main);
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
       ${isCashierPlus() ? navButton('Mağaza', 'shop') : ''}
       ${isAdmin() ? navButton('Personel', 'staff') + navButton('Masalar', 'tables') + navButton('Menü', 'menu') : ''}`;

  root.innerHTML = `
    <div class="a-layout">
      <aside class="a-side">
        <div class="a-brand">DAINO</div>
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
          if (screen === 'app' && (view === 'orders' || view === 'courier')) {
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
