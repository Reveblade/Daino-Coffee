import { api, formatTry, getToken, setToken } from './api.js';

/** @type {{ categories: any[], products: any[] } | null} */
let menuCache = null;
/** @type {any | null} */
let shopCache = null;
/** @type {any | null} */
let tableMeta = null;
/** @type {string | null} */
let tableSlug = null;
/** @type {{ productId: string, name: string, unitPriceKurus: number, qty: number }[]} */
let cart = [];

/** Public URL prefix for the ordering app (nginx + Vite dev rewrite). */
const ORDER_APP_BASE = '/siparis';

function normalizePathname() {
  const p = window.location.pathname.replace(/\/+$/, '');
  return p === '' ? '/' : p;
}

function menuHomeHref() {
  if (tableSlug) return `${ORDER_APP_BASE}/masa/${encodeURIComponent(tableSlug)}`;
  const q = new URLSearchParams(window.location.search);
  const t = q.get('t');
  if (t) return `${ORDER_APP_BASE}?${new URLSearchParams({ t }).toString()}`;
  return ORDER_APP_BASE;
}

function parseRoute() {
  tableSlug = null;
  const path = normalizePathname();
  const base = ORDER_APP_BASE.replace(/\/+$/, '');

  if (path === base) {
    const q = new URLSearchParams(window.location.search);
    if (q.get('t')) tableSlug = q.get('t');
    return 'menu';
  }

  const masaPrefix = `${base}/masa/`;
  if (path.startsWith(masaPrefix)) {
    const rest = path.slice(masaPrefix.length).split('/').filter(Boolean)[0];
    if (rest) tableSlug = decodeURIComponent(rest);
    return 'menu';
  }

  if (path === `${base}/hesap`) return 'account';
  if (path === `${base}/sepet`) return 'cart';

  // Legacy: built customer.html entry + hash routes
  if (path.endsWith('/customer.html')) {
    const h = window.location.hash.replace(/^#\/?/, '');
    const parts = h.split('/').filter(Boolean);
    if (parts[0] === 'masa' && parts[1]) {
      tableSlug = parts[1];
      return 'menu';
    }
    if (parts[0] === 'hesap') return 'account';
    if (parts[0] === 'sepet') return 'cart';
    const q = new URLSearchParams(window.location.search);
    if (q.get('t')) {
      tableSlug = q.get('t');
      return 'menu';
    }
    return 'menu';
  }

  const h = window.location.hash.replace(/^#\/?/, '');
  const hp = h.split('/').filter(Boolean);
  if (hp[0] === 'masa' && hp[1]) {
    tableSlug = hp[1];
    return 'menu';
  }
  if (hp[0] === 'hesap') return 'account';
  if (hp[0] === 'sepet') return 'cart';

  const q = new URLSearchParams(window.location.search);
  if (q.get('t')) {
    tableSlug = q.get('t');
    return 'menu';
  }
  return 'menu';
}

function setRoute(route) {
  let nextPath;
  if (route === 'menu' && tableSlug) {
    nextPath = `${ORDER_APP_BASE}/masa/${encodeURIComponent(tableSlug)}`;
  } else if (route === 'account') {
    nextPath = `${ORDER_APP_BASE}/hesap`;
  } else if (route === 'cart') {
    nextPath = `${ORDER_APP_BASE}/sepet`;
  } else {
    const q = new URLSearchParams(window.location.search);
    const t = q.get('t');
    nextPath = t ? `${ORDER_APP_BASE}?${new URLSearchParams({ t }).toString()}` : ORDER_APP_BASE;
  }
  const cur = window.location.pathname + window.location.search;
  if (nextPath !== cur) history.pushState({}, '', nextPath);
  render().catch(console.error);
}

/** One-time upgrade from customer.html#/… to /siparis/… in the address bar. */
function migrateLegacyCustomerUrl() {
  const path = normalizePathname();
  if (!path.endsWith('/customer.html')) return;

  const h = window.location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean);
  const q = new URLSearchParams(window.location.search);
  const t = q.get('t');

  let target = ORDER_APP_BASE;
  if (parts[0] === 'masa' && parts[1]) {
    target = `${ORDER_APP_BASE}/masa/${encodeURIComponent(parts[1])}`;
  } else if (parts[0] === 'hesap') {
    target = `${ORDER_APP_BASE}/hesap`;
  } else if (parts[0] === 'sepet') {
    target = `${ORDER_APP_BASE}/sepet`;
  } else if (t) {
    target = `${ORDER_APP_BASE}?${new URLSearchParams({ t }).toString()}`;
  }

  history.replaceState({}, '', target);
}

/**
 * @param {string} tag
 * @param {Record<string, unknown>} [props]
 * @param {(Node|string|null|undefined)[]} [kids]
 */
function el(tag, props = {}, kids = []) {
  const n = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (v === undefined || v === null || v === false) return;
    if (k === 'class' || k === 'className') {
      n.className = String(v);
      return;
    }
    if (k === 'text') {
      n.textContent = String(v);
      return;
    }
    if (k === 'style' && typeof v === 'string') {
      n.style.cssText = v;
      return;
    }
    if (typeof v === 'function' && k.startsWith('on')) {
      n.addEventListener(k.slice(2).toLowerCase(), v);
      return;
    }
    if (k === 'disabled' && v === true) {
      n.disabled = true;
      return;
    }
    if (v === true) {
      n.setAttribute(k, '');
      return;
    }
    n.setAttribute(k, String(v));
  });
  kids.flat().forEach((c) => {
    if (c != null) n.append(c);
  });
  return n;
}

async function loadShop() {
  shopCache = await api('/shop/settings');
  return shopCache;
}

async function loadTablePublic() {
  if (!tableSlug) {
    tableMeta = null;
    return null;
  }
  try {
    tableMeta = await api(`/tables/public/${encodeURIComponent(tableSlug)}`);
  } catch {
    tableMeta = { found: false };
  }
  return tableMeta;
}

async function loadMenu() {
  menuCache = await api('/menu');
  return menuCache;
}

function cartCount() {
  return cart.reduce((s, i) => s + i.qty, 0);
}

function cartTotal() {
  return cart.reduce((s, i) => s + i.unitPriceKurus * i.qty, 0);
}

function addToCart(p) {
  const ex = cart.find((c) => c.productId === String(p._id));
  if (ex) ex.qty += 1;
  else
    cart.push({
      productId: String(p._id),
      name: p.name,
      unitPriceKurus: p.priceKurus,
      qty: 1,
    });
}

function buildCategoryTree(categories) {
  const byParent = new Map();
  for (const c of categories) {
    const pid = c.parentId ? String(c.parentId) : '';
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(c);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
  }
  return byParent;
}

function renderMenu(root) {
  const shop = shopCache;
  const menu = menuCache;
  const isTable = !!tableSlug;
  const noTable = tableMeta && tableMeta.found === false;
  const storefront = tableMeta?.isStorefront === true;
  const serviceOff = shop && !shop.acceptsOrders;
  const blockOrders = isTable && (noTable || storefront || serviceOff);

  if (noTable) {
    root.append(
      el('div', { class: 'c-banner c-banner--warn' }, [
        'Masa bağlantısı geçersiz veya kapalı.',
      ]),
    );
  } else if (isTable && storefront) {
    root.append(
      el('div', { class: 'c-banner c-banner--warn' }, [
        'Mağaza vitrin menüsü: buradan sipariş verilemez (self-servis).',
      ]),
    );
  } else if (isTable && serviceOff) {
    root.append(
      el('div', { class: 'c-banner c-banner--warn' }, [
        'Self-servis modundayız; masadan sipariş alınmıyor. Menüyü inceleyebilirsiniz.',
      ]),
    );
  } else if (isTable) {
    root.append(
      el('div', { class: 'c-banner' }, [
        `Masa menüsü${tableMeta?.number != null ? ` (no ${tableMeta.number})` : ''}. Servis açık — sipariş verebilirsiniz.`,
      ]),
    );
  } else {
    root.append(
      el('div', { class: 'c-banner' }, [
        'Web siparişi: hesabınıza adres ekleyin. Ödeme teslimatta (nakit veya POS).',
      ]),
    );
  }

  const tree = buildCategoryTree(menu.categories);
  const roots = tree.get('') ?? [];

  function productsForCat(catId) {
    return menu.products.filter((p) => String(p.categoryId) === String(catId));
  }

  const sections = [];
  function walk(cat, depth) {
    const prods = productsForCat(cat._id);
    const subs = tree.get(String(cat._id)) ?? [];
    if (prods.length || subs.length) {
      sections.push(
        el('section', { class: 'c-cat' }, [
          el('h3', {
            class: 'c-cat-name',
            text: `${'· '.repeat(depth)}${cat.name}`,
          }),
          ...prods.map((p) =>
            el('div', { class: 'c-card' }, [
              p.images?.[0]?.url
                ? el('img', { src: p.images[0].url, alt: '' })
                : el('div'),
              el('div', { class: 'c-card-body' }, [
                el('p', { class: 'c-card-title', text: p.name }),
                p.description
                  ? el('p', { class: 'c-card-desc', text: p.description })
                  : null,
                el('div', { class: 'c-row' }, [
                  el('span', { class: 'c-price', text: formatTry(p.priceKurus) }),
                  el(
                    'button',
                    {
                      class: 'c-btn c-btn--sm',
                      disabled: blockOrders,
                      onclick: () => {
                        if (blockOrders) return;
                        addToCart(p);
                        render();
                      },
                    },
                    ['Sepete'],
                  ),
                ]),
              ]),
            ]),
          ),
        ]),
      );
    }
    for (const s of subs) walk(s, depth + 1);
  }
  for (const r of roots) walk(r, 0);

  root.append(
    el('h2', { class: 'c-section-title', text: 'MENÜ' }),
    ...sections,
  );
}

function renderAccount(root) {
  const tok = getToken();
  if (!tok) {
    root.append(
      el('p', { class: 'c-muted', text: 'Telefon ile giriş yapın.' }),
      el(
        'button',
        { class: 'c-btn', onclick: () => openAuthModal() },
        ['Giriş / Kayıt'],
      ),
    );
    return;
  }
  api('/users/me')
    .then((me) => {
      root.innerHTML = '';
      const wrap = el('div', { class: 'c-stack' });
      wrap.append(
        el('p', { class: 'c-muted', text: `${me.phoneE164} · ${me.role}` }),
        el('h3', { class: 'c-cat-name', text: 'Adreslerim' }),
      );
      if (me.addresses?.length) {
        me.addresses.forEach((a) => {
          wrap.append(
            el('div', { class: 'c-address-item' }, [
              `${a.label}: ${a.line1}${a.district ? `, ${a.district}` : ''} — ${a.city}`,
            ]),
          );
        });
      } else {
        wrap.append(el('p', { class: 'c-muted', text: 'Kayıtlı adres yok.' }));
      }
      wrap.append(
        el('h3', {
          class: 'c-cat-name',
          style: 'margin-top:16px',
          text: 'Yeni adres',
        }),
      );
      const label = el('input', {
        class: 'c-input',
        placeholder: 'Etiket (örn. Ev)',
      });
      const line1 = el('input', {
        class: 'c-input',
        placeholder: 'Adres satırı',
      });
      const district = el('input', { class: 'c-input', placeholder: 'İlçe' });
      const city = el('input', { class: 'c-input', placeholder: 'Şehir' });
      wrap.append(label, line1, district, city);
      wrap.append(
        el(
          'button',
          {
            class: 'c-btn',
            onclick: async () => {
              await api('/users/addresses', {
                method: 'POST',
                body: JSON.stringify({
                  label: label.value,
                  line1: line1.value,
                  district: district.value,
                  city: city.value,
                }),
              });
              setRoute('account');
              render();
            },
          },
          ['Adres kaydet'],
        ),
        el(
          'button',
          {
            class: 'c-btn c-btn--ghost',
            style: 'margin-top:12px',
            onclick: () => {
              setToken(null);
              render();
            },
          },
          ['Çıkış'],
        ),
      );
      root.append(wrap);
    })
    .catch(() => {
      root.append(el('p', { class: 'c-error', text: 'Profil yüklenemedi.' }));
    });
}

function renderCart(root) {
  if (!cart.length) {
    root.append(el('p', { class: 'c-muted', text: 'Sepet boş.' }));
    return;
  }
  root.append(
    ...cart.map((c, idx) =>
      el('div', { class: 'c-card' }, [
        el('div', { class: 'c-card-body' }, [
          el('p', { class: 'c-card-title', text: c.name }),
          el('div', { class: 'c-row' }, [
            el('span', { text: `${c.qty} × ${formatTry(c.unitPriceKurus)}` }),
            el(
              'button',
              {
                class: 'c-btn c-btn--ghost c-btn--sm',
                onclick: () => {
                  cart.splice(idx, 1);
                  render();
                },
              },
              ['Sil'],
            ),
          ]),
        ]),
      ]),
    ),
  );

  const tok = getToken();
  const isTable = !!tableSlug;
  const noTable = tableMeta && tableMeta.found === false;
  const storefront = tableMeta?.isStorefront === true;
  const serviceOff = shopCache && !shopCache.acceptsOrders;
  const canOrderTable =
    isTable && !noTable && !storefront && !serviceOff && tableMeta?.found;
  const canOrderOnline = !isTable;

  root.append(
    el('div', { class: 'c-row', style: 'margin-top:16px' }, [
      el('span', { class: 'c-price', text: `Toplam: ${formatTry(cartTotal())}` }),
      el(
        'button',
        {
          class: 'c-btn',
          disabled: !tok || (!canOrderTable && !canOrderOnline),
          onclick: () => submitOrder(),
        },
        [isTable ? 'Masaya sipariş ver' : 'Online sipariş ver'],
      ),
    ]),
  );

  if (!tok) {
    root.append(
      el('p', { class: 'c-error', text: 'Sipariş için giriş yapın.' }),
      el(
        'button',
        { class: 'c-btn c-btn--ghost', onclick: () => openAuthModal() },
        ['Giriş'],
      ),
    );
  }

  if (isTable && !canOrderTable) {
    root.append(
      el(
        'p',
        {
          class: 'c-error',
          text: 'Bu bağlantıdan sipariş verilemiyor (servis kapalı veya vitrin menüsü).',
        },
      ),
    );
  }
}

async function submitOrder() {
  const tok = getToken();
  if (!tok) return openAuthModal();
  const items = cart.map((c) => ({
    productId: c.productId,
    quantity: c.qty,
  }));
  try {
    if (tableSlug) {
      await api('/orders/in-place', {
        method: 'POST',
        body: JSON.stringify({ tableSlug, items }),
      });
    } else {
      const me = await api('/users/me');
      if (!me.addresses?.length) {
        alert('Önce hesabınızdan adres ekleyin.');
        setRoute('account');
        render();
        return;
      }
      const ix = Number(
        prompt(`Teslimat adresi indeksi (0–${me.addresses.length - 1}):`, '0'),
      );
      if (Number.isNaN(ix)) return;
      await api('/orders/online', {
        method: 'POST',
        body: JSON.stringify({ items, addressIndex: ix }),
      });
    }
    cart = [];
    alert('Siparişiniz alındı.');
    render();
  } catch (e) {
    alert(e.message || 'Sipariş başarısız');
  }
}

function openAuthModal() {
  const back = el('div', { class: 'c-modal-back' });
  const modal = el('div', { class: 'c-modal' });
  let phone = '';

  function close() {
    back.remove();
  }
  back.addEventListener('click', (e) => {
    if (e.target === back) close();
  });

  function viewPhone() {
    modal.innerHTML = '';
    const err = el('p', { class: 'c-error', id: 'auth-err' });
    modal.append(
      el('h2', { text: 'Giriş' }),
      el('p', {
        class: 'c-muted',
        text: 'Türk cep: 5xx…, 05xx…, 90… veya +90… (boşluk/tire olabilir).',
      }),
      el('input', {
        class: 'c-input',
        placeholder: 'örn. 5551112233 veya 0555…',
        id: 'ph',
      }),
      err,
      el(
        'button',
        {
          class: 'c-btn',
          onclick: async () => {
            phone = /** @type {HTMLInputElement} */ (modal.querySelector('#ph'))
              .value.trim();
            err.textContent = '';
            try {
              await api('/auth/otp/request', {
                method: 'POST',
                body: JSON.stringify({ phone }),
              });
              viewCode();
            } catch (e) {
              err.textContent = e.message;
            }
          },
        },
        ['Kod gönder'],
      ),
      el('button', { class: 'c-link', onclick: close }, ['Kapat']),
    );
  }

  function viewCode() {
    modal.innerHTML = '';
    const err2 = el('p', { class: 'c-error', id: 'auth-err2' });
    modal.append(
      el('h2', { text: 'SMS kodu' }),
      el('input', {
        class: 'c-input',
        placeholder: '6 haneli kod',
        id: 'cd',
        maxlength: '6',
      }),
      err2,
      el(
        'button',
        {
          class: 'c-btn',
          onclick: async () => {
            const code = /** @type {HTMLInputElement} */ (
              modal.querySelector('#cd')
            ).value.trim();
            try {
              const { accessToken, refreshToken } = await api(
                '/auth/otp/verify',
                {
                  method: 'POST',
                  body: JSON.stringify({ phone, code }),
                },
              );
              setToken(accessToken, refreshToken);
              close();
              render();
            } catch (e) {
              err2.textContent = e.message;
            }
          },
        },
        ['Doğrula'],
      ),
      el('button', { class: 'c-link', onclick: viewPhone }, ['Telefonu değiştir']),
    );
  }

  viewPhone();
  back.append(modal);
  document.body.append(back);
}

function renderTopbar() {
  parseRoute();
  return el('header', { class: 'c-topbar' }, [
    el('a', {
      href: menuHomeHref(),
      class: 'c-brand',
      text: 'DAINO',
      onclick: (e) => {
        if (e.button !== 0) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        parseRoute();
        setRoute('menu');
      },
    }),
    el('div', { class: 'c-topbar-actions' }, [
      tableSlug
        ? el('span', { class: 'c-badge', text: 'Masa' })
        : el('span', { class: 'c-badge', text: 'Web' }),
      el(
        'button',
        { class: 'c-btn c-btn--ghost c-btn--sm', onclick: () => setRoute('account') },
        ['Hesap'],
      ),
      el(
        'button',
        { class: 'c-btn c-btn--sm', onclick: () => setRoute('cart') },
        [`Sepet (${cartCount()})`],
      ),
    ]),
  ]);
}

function renderCartBar() {
  if (parseRoute() === 'cart') return null;
  if (!cart.length) return null;
  return el('div', { class: 'c-cart-bar' }, [
    el('span', { class: 'c-cart-total', text: formatTry(cartTotal()) }),
    el(
      'button',
      { class: 'c-btn c-btn--sm', onclick: () => setRoute('cart') },
      ['Sepete git'],
    ),
  ]);
}

async function render() {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = '';
  const route = parseRoute();
  await loadShop().catch(() => {});
  if (route === 'menu') await loadTablePublic().catch(() => {});
  if (!menuCache || route === 'menu') {
    await loadMenu().catch((e) => {
      console.error(e);
    });
  }

  app.append(renderTopbar());
  const main = el('main', { class: 'c-main' });
  if (route === 'menu' && menuCache) renderMenu(main);
  else if (route === 'account') renderAccount(main);
  else if (route === 'cart') renderCart(main);
  else main.append(el('p', { class: 'c-error', text: 'Menü yüklenemedi.' }));
  app.append(main);
  const bar = renderCartBar();
  if (bar) app.append(bar);
}

window.addEventListener('popstate', () => {
  render().catch(console.error);
});

window.addEventListener('hashchange', () => {
  if (normalizePathname().endsWith('/customer.html')) {
    render().catch(console.error);
  }
});

migrateLegacyCustomerUrl();
render().catch(console.error);
