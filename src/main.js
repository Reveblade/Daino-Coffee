import { api, decodeJwt, getToken, setToken } from './api.js';

/** @type {'login' | 'app'} */
let screen = 'login';
/** @type {string} */
let view = 'orders';
let pollTimer = null;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function startPoll() {
  clearPoll();
  if (screen !== 'app') return;
  pollTimer = setInterval(() => {
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
      const ch = esc(o.channel);
      const st = esc(o.status);
      let actions = '';
      if (o.channel === 'IN_PLACE') {
        actions = `
          <button class="a-btn secondary a-act" data-id="${id}" data-ch="IN_PLACE" data-act="START">Hazırla</button>
          <button class="a-btn secondary a-act" data-id="${id}" data-ch="IN_PLACE" data-act="READY">Hazır</button>
          <button class="a-btn secondary a-act" data-id="${id}" data-ch="IN_PLACE" data-act="AWAIT_PAYMENT">Ödeme bekliyor</button>
          <button class="a-btn secondary a-act" data-id="${id}" data-ch="IN_PLACE" data-act="MARK_PAID">Ödendi</button>
          <button class="a-btn secondary a-act" data-id="${id}" data-ch="IN_PLACE" data-act="CANCEL">İptal</button>`;
      } else {
        actions = `
          <button class="a-btn secondary a-act" data-id="${id}" data-ch="ONLINE" data-act="CONFIRM">Onayla</button>
          <button class="a-btn secondary a-act" data-id="${id}" data-ch="ONLINE" data-act="START_PREP">Hazırlık</button>
          <button class="a-btn secondary a-act" data-id="${id}" data-ch="ONLINE" data-act="READY_HANDOFF">Teslime hazır</button>
          <button class="a-btn secondary a-act" data-id="${id}" data-ch="ONLINE" data-act="MARK_PAID">Nakit ödeme onayı</button>
          <button class="a-btn secondary a-act" data-id="${id}" data-ch="ONLINE" data-act="CANCEL">İptal</button>
          <span class="a-muted">Kurye:</span>
          <select class="a-select a-courier-sel" data-id="${id}" style="max-width:160px;display:inline-block;width:auto"></select>
          <button class="a-btn a-assign" data-id="${id}">Kurye ata</button>`;
      }
      return `<tr><td><code>${id.slice(-8)}</code></td><td><span class="a-badge">${ch}</span></td><td>${st}</td><td style="text-align:right;white-space:nowrap">${actions}</td></tr>`;
    })
    .join('');

  container.innerHTML = `
    <h1 class="a-h1">Siparişler</h1>
    <p class="a-muted">Liste birkaç saniyede bir yenilenebilir; ayrıca sayfayı yenileyin.</p>
    <div style="overflow:auto">
      <table class="a-table">
        <thead><tr><th>ID</th><th>Kanal</th><th>Durum</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4" class="a-muted">Kayıt yok</td></tr>'}</tbody>
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
      <thead><tr><th>No</th><th>Slug</th><th>URL</th><th></th></tr></thead>
      <tbody>
        ${list
          .map(
            (t) => `<tr>
          <td>${esc(t.number)}</td>
          <td><code>${esc(t.publicSlug?.slice(0, 12))}…</code></td>
          <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis"><a href="${esc(t.menuUrl)}" target="_blank" rel="noopener">${esc(t.menuUrl)}</a></td>
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
  container.querySelectorAll('.a-regqr').forEach((b) => {
    b.onclick = async () => {
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

async function renderMenuReadonly(container) {
  let cats = [];
  let prods = [];
  try {
    cats = await api('/admin/menu/categories');
    prods = await api('/admin/menu/products');
  } catch (e) {
    container.innerHTML = `<p class="a-error">${esc(e.message)}</p>`;
    return;
  }
  container.innerHTML = `
    <h1 class="a-h1">Menü (özet)</h1>
    <p class="a-muted">Ürün ve kategori yönetimi REST ile yapılır; burada salt okunur liste.</p>
    <p><strong>${prods.length}</strong> ürün, <strong>${cats.length}</strong> kategori.</p>
    <ul style="margin:12px 0;padding-left:18px;max-height:50vh;overflow:auto">
      ${prods
        .slice(0, 80)
        .map(
          (p) =>
            `<li>${esc(p.name)} — ${(p.priceKurus / 100).toFixed(2)} ₺ — ${p.isAvailable ? 'satışta' : 'kapalı'}</li>`,
        )
        .join('')}
    </ul>`;
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
  else if (view === 'menu' && isAdmin()) await renderMenuReadonly(main);
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
  if (isCourier()) view = 'courier';
  const r = role();
  const sideNav = isCourier()
    ? `${navButton('Görevler', 'courier')}`
    : `${navButton('Siparişler', 'orders')}
       ${isCashierPlus() ? navButton('Mağaza', 'shop') : ''}
       ${isAdmin() ? navButton('Personel', 'staff') + navButton('Masalar', 'tables') + navButton('Menü özeti', 'menu') : ''}`;

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
  mnav.querySelectorAll('[data-view]').forEach((b) => {
    b.onclick = () => {
      view = b.dataset.view;
      render();
    };
  });
  root.querySelectorAll('.a-side [data-view]').forEach((b) => {
    b.onclick = () => {
      view = b.dataset.view;
      render();
    };
  });
  root.querySelector('#a-logout').onclick = () => {
    setToken(null);
    screen = 'login';
    clearPoll();
    render();
  };

  renderMain().then(() => startPoll());
}

function render() {
  const root = document.getElementById('root');
  if (!getToken()) screen = 'login';
  if (screen === 'login') {
    clearPoll();
    renderLogin(root);
  } else {
    renderApp(root);
  }
}

render();
