import { api, formatTry, getRefreshToken, getToken, setToken } from './api.js';
import { connectStoreRealtime } from './realtime.js';
import geyikBrandUrl from '../../assets/geyik.svg?url';

/** @type {{ categories: any[], products: any[] } | null} */
let menuCache = null;
/** @type {any | null} */
let shopCache = null;
/** @type {any | null} */
let tableMeta = null;
/** @type {string | null} */
let tableSlug = null;
/** Slug for which `tableMeta` was last loaded (avoids refetch on every render). */
let tableMetaSlug = null;
/** @type {{ productId: string, name: string, unitPriceKurus: number, qty: number, optionsPayload?: { groupId: string, selectedChoiceIds: string[] }[], optionsSummary?: string }[]} */
let cart = [];
/** QR menü: seçili kategori zinciri (köke göre id dizisi); boş = kök kategoriler. */
let menuBrowseStack = [];

/** Public URL prefix for the ordering app (nginx + Vite dev rewrite). */
const ORDER_APP_BASE = '/siparis';

/** `/siparis/hesap` alt sekmesi */
let accountTab = 'hesabim';

const ACCOUNT_TABS = new Set(['hesabim', 'profilim', 'adreslerim', 'siparislerim']);

/** @param {string} tab */
function accountPath(tab) {
  if (tab === 'hesabim') return `${ORDER_APP_BASE}/hesap`;
  return `${ORDER_APP_BASE}/hesap/${tab}`;
}

/** @param {string} role */
function roleLabelTr(role) {
  const m = {
    CUSTOMER: 'Müşteri',
    CASHIER: 'Kasiyer',
    COURIER: 'Kurye',
    ADMIN: 'Yönetici',
    ADMIN_OWNER: 'İşletme sahibi',
  };
  return m[role] ?? role;
}

/** @param {any | null | undefined} me */
function customerProfileComplete(me) {
  if (!me || me.role !== 'CUSTOMER') return true;
  if (typeof me.profileComplete === 'boolean') return me.profileComplete;
  const fn = (me.firstName && String(me.firstName).trim()) || '';
  const ln = (me.lastName && String(me.lastName).trim()) || '';
  return fn.length >= 2 && ln.length >= 2;
}

/** @param {any | null | undefined} me */
function webCustomerProfileLocked(me) {
  return !!me && !tableSlug && me.role === 'CUSTOMER' && !customerProfileComplete(me);
}

/** @param {{ status: string }} o */
function onlineOrderStatusTr(o) {
  const m = {
    PLACED: 'Alındı',
    CONFIRMED: 'Onaylandı',
    IN_PROGRESS: 'Hazırlanıyor',
    READY_FOR_HANDOFF: 'Teslime hazır',
    ASSIGNED: 'Kurye atandı',
    OUT_FOR_DELIVERY: 'Yolda',
    DELIVERED: 'Teslim edildi',
    AWAITING_CASHIER_PAYMENT: 'Ödeme bekleniyor',
    PAID: 'Ödendi',
    CANCELLED: 'İptal',
  };
  return m[o.status] ?? o.status;
}

function normalizePathname() {
  const p = window.location.pathname.replace(/\/+$/, '');
  return p === '' ? '/' : p;
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
    const segs = path.slice(masaPrefix.length).split('/').filter(Boolean);
    if (segs.length >= 2 && segs[1].toLowerCase() === 'ozet') {
      tableSlug = decodeURIComponent(segs[0]);
      return 'cart';
    }
    if (segs[0]) tableSlug = decodeURIComponent(segs[0]);
    return 'menu';
  }

  if (path === `${base}/hesap`) {
    accountTab = 'hesabim';
    return 'account';
  }
  const accPrefix = `${base}/hesap/`;
  if (path.startsWith(accPrefix)) {
    const rest = path.slice(accPrefix.length).split('/').filter(Boolean)[0];
    accountTab = ACCOUNT_TABS.has(rest) ? rest : 'hesabim';
    return 'account';
  }
  if (path === `${base}/sepet`) return 'cart';

  // Legacy: built customer.html entry + hash routes
  if (path.endsWith('/customer.html')) {
    const h = window.location.hash.replace(/^#\/?/, '');
    const parts = h.split('/').filter(Boolean);
    if (parts[0] === 'masa' && parts[1]) {
      tableSlug = parts[1];
      if (parts[2] === 'sepet' || parts[2] === 'ozet') return 'cart';
      return 'menu';
    }
    if (parts[0] === 'hesap') {
      accountTab = ACCOUNT_TABS.has(parts[1]) ? parts[1] : 'hesabim';
      return 'account';
    }
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
    if (hp[2] === 'sepet' || hp[2] === 'ozet') return 'cart';
    return 'menu';
  }
  if (hp[0] === 'hesap') {
    accountTab = ACCOUNT_TABS.has(hp[1]) ? hp[1] : 'hesabim';
    return 'account';
  }
  if (hp[0] === 'sepet') return 'cart';

  const q = new URLSearchParams(window.location.search);
  if (q.get('t')) {
    tableSlug = q.get('t');
    return 'menu';
  }
  return 'menu';
}

function setRoute(route, tab) {
  if (route === 'menu') {
    menuBrowseStack = [];
  }
  if (route === 'account' && tab && ACCOUNT_TABS.has(tab)) {
    accountTab = tab;
  }
  let nextPath;
  if (route === 'menu' && tableSlug) {
    nextPath = `${ORDER_APP_BASE}/masa/${encodeURIComponent(tableSlug)}`;
  } else if (route === 'account') {
    nextPath = accountPath(accountTab);
  } else if (route === 'cart') {
    nextPath = tableSlug
      ? `${ORDER_APP_BASE}/masa/${encodeURIComponent(tableSlug)}/ozet`
      : `${ORDER_APP_BASE}/sepet`;
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
    if (parts[2] === 'sepet' || parts[2] === 'ozet') {
      target = `${ORDER_APP_BASE}/masa/${encodeURIComponent(parts[1])}/ozet`;
    } else {
      target = `${ORDER_APP_BASE}/masa/${encodeURIComponent(parts[1])}`;
    }
  } else if (parts[0] === 'hesap') {
    const tab = ACCOUNT_TABS.has(parts[1]) ? parts[1] : 'hesabim';
    target = accountPath(tab);
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

/** @param {any} line */
function cartLineKey(line) {
  const o = line.optionsPayload ?? [];
  return `${line.productId}__${JSON.stringify(o)}`;
}

function cartLineOptionExtrasKurus(groups, payload) {
  if (!payload?.length) return 0;
  const gmap = new Map(groups.map((g) => [g.id, g]));
  let sum = 0;
  for (const e of payload) {
    const g = gmap.get(e.groupId);
    if (!g) continue;
    for (const id of e.selectedChoiceIds ?? []) {
      const ch = g.choices?.find((c) => c.id === id);
      if (ch) sum += Number(ch.extraPriceKurus) || 0;
    }
  }
  return sum;
}

/** @param {any} ch */
function choiceLabelWithExtra(ch) {
  const lab = ch?.label ?? '';
  const ex = Number(ch?.extraPriceKurus) || 0;
  if (ex <= 0) return lab;
  return `${lab} (+${formatTry(ex)})`;
}

/**
 * @param {any[]} groups
 * @param {{ groupId: string, selectedChoiceIds: string[] }[]} payload
 */
function summarizeOptionsFromProduct(groups, payload) {
  if (!groups?.length || !payload?.length) return '';
  const gmap = new Map(groups.map((g) => [g.id, g]));
  const parts = [];
  for (const e of payload) {
    const g = gmap.get(e.groupId);
    if (!g) continue;
    const ids = e.selectedChoiceIds ?? [];
    const labels = ids
      .map((id) => {
        const ch = g.choices?.find((c) => c.id === id);
        return ch ? choiceLabelWithExtra(ch) : '';
      })
      .filter(Boolean);
    if (labels.length) parts.push(`${g.label}: ${labels.join(', ')}`);
  }
  return parts.join(' · ');
}

/**
 * @param {any} it
 */
function customerOrderItemLine(it) {
  let s = `${it.name} ×${it.quantity}`;
  if (!it?.optionSelections?.length) return s;
  const ox = it.optionSelections
    .map((g) => {
      const labs = (g.selectedChoices || [])
        .map((c) => {
          const ex = Number(c.extraPriceKurus) || 0;
          const base = c.label || '';
          if (ex <= 0) return base;
          return `${base} (+${formatTry(ex)})`;
        })
        .filter(Boolean)
        .join(', ');
      return labs ? `${g.groupLabel || g.groupId}: ${labs}` : '';
    })
    .filter(Boolean)
    .join(' · ');
  return ox ? `${s} (${ox})` : s;
}

/**
 * @param {any} product
 * @param {(line: object) => void} onPick
 */
function openProductOptionsModal(product, onPick) {
  const groups = product.optionGroups ?? [];
  const overlay = el('div', { class: 'c-modal-back' });
  const modal = el('div', { class: 'c-modal c-opt-modal' });

  for (const g of groups) {
    const gid = g.id;
    if (g.kind === 'SELECTABLE') {
      modal.append(
        el('fieldset', { class: 'c-opt-fieldset' }, [
          el('legend', { class: 'c-opt-legend', text: g.label }),
          ...(g.choices ?? []).map((ch) =>
            el('label', { class: 'c-opt-row' }, [
              el('input', {
                type: 'checkbox',
                name: `og-${gid}`,
                value: ch.id,
              }),
              ` ${choiceLabelWithExtra(ch)}`,
            ]),
          ),
        ]),
      );
    } else {
      modal.append(
        el('fieldset', { class: 'c-opt-fieldset' }, [
          el('legend', { class: 'c-opt-legend', text: g.label }),
          el(
            'select',
            {
              class: 'c-input c-opt-select',
              name: `og-${gid}`,
            },
            [
              el('option', { value: '', text: '— İsteğe bağlı —' }),
              ...(g.choices ?? []).map((ch) =>
                el('option', { value: ch.id, text: choiceLabelWithExtra(ch) }),
              ),
            ],
          ),
        ]),
      );
    }
  }

  modal.append(
    el('div', { class: 'c-opt-actions' }, [
      el(
        'button',
        {
          type: 'button',
          class: 'c-btn c-btn--ghost',
          onclick: () => overlay.remove(),
        },
        ['İptal'],
      ),
      el(
        'button',
        {
          type: 'button',
          class: 'c-btn',
          onclick: () => {
            /** @type {{ groupId: string, selectedChoiceIds: string[] }[]} */
            const payload = [];
            for (const g of groups) {
              if (g.kind === 'SELECTABLE') {
                const checked = modal.querySelectorAll(
                  `input[name="og-${g.id}"]:checked`,
                );
                const ids = [...checked].map(
                  (n) => /** @type {HTMLInputElement} */ (n).value,
                );
                if (ids.length)
                  payload.push({ groupId: g.id, selectedChoiceIds: ids });
              } else {
                const sel = modal.querySelector(`select[name="og-${g.id}"]`);
                const v = sel?.value?.trim?.() ?? '';
                if (v) payload.push({ groupId: g.id, selectedChoiceIds: [v] });
              }
            }
            const summary = summarizeOptionsFromProduct(groups, payload);
            const extras = cartLineOptionExtrasKurus(groups, payload);
            onPick({
              productId: String(product._id),
              name: product.name,
              unitPriceKurus: product.priceKurus + extras,
              qty: 1,
              optionsPayload: payload,
              optionsSummary: summary,
            });
            overlay.remove();
            render().catch(console.error);
          },
        },
        ['Sepete ekle'],
      ),
    ]),
  );

  overlay.append(
    el('div', { class: 'c-modal-wrap' }, [
      el('h2', { class: 'c-modal-title', text: product.name }),
      modal,
    ]),
  );
  document.body.append(overlay);
}

function mergeCartLine(line) {
  const k = cartLineKey(line);
  const ex = cart.find((c) => cartLineKey(c) === k);
  if (ex) ex.qty += line.qty;
  else cart.push(line);
}

function addProductChoiceToCart(p) {
  const groups = p.optionGroups ?? [];
  if (!groups.length) {
    mergeCartLine({
      productId: String(p._id),
      name: p.name,
      unitPriceKurus: p.priceKurus,
      qty: 1,
      optionsPayload: [],
      optionsSummary: '',
    });
    render().catch(console.error);
    return;
  }
  openProductOptionsModal(p, mergeCartLine);
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

  function sortProds(arr) {
    return [...arr].sort(
      (a, b) =>
        (a.sortIndex ?? 0) - (b.sortIndex ?? 0) ||
        String(a.name).localeCompare(String(b.name), 'tr'),
    );
  }

  /** @param {any} cat */
  function catHasMenuContent(cat) {
    if (sortProds(productsForCat(cat._id)).length) return true;
    const subs = tree.get(String(cat._id)) ?? [];
    for (const s of subs) {
      if (catHasMenuContent(s)) return true;
    }
    return false;
  }

  /** @param {any[]} cats @param {(cat: any) => void} onPick */
  function renderCategoryGrid(cats, onPick) {
    return el(
      'div',
      { class: 'c-menu-cat-grid' },
      cats.map((cat) =>
        el(
          'button',
          {
            type: 'button',
            class: 'c-menu-cat-tile',
            onclick: () => onPick(cat),
          },
          [
            cat.imageUrl
              ? el('div', { class: 'c-menu-cat-tile-img' }, [
                  el('img', { src: cat.imageUrl, alt: '' }),
                ])
              : el('div', {
                  class: 'c-menu-cat-tile-img c-menu-cat-tile-img--empty',
                  'aria-hidden': 'true',
                }),
            el('span', { class: 'c-menu-cat-tile-name', text: cat.name }),
          ],
        ),
      ),
    );
  }

  /** @param {any[]} prods */
  function renderProductList(prods) {
    const sorted = sortProds(prods);
    return el(
      'div',
      { class: 'c-menu-prod-list' },
      sorted.map((p) =>
        el('article', { class: 'c-menu-prod-rowcard' }, [
          p.images?.[0]?.url
            ? el('div', { class: 'c-menu-prod-rowcard-img' }, [
                el('img', { src: p.images[0].url, alt: '' }),
              ])
            : el('div', {
                class: 'c-menu-prod-rowcard-img c-menu-prod-rowcard-img--empty',
                'aria-hidden': 'true',
              }),
          el('div', { class: 'c-menu-prod-rowcard-body' }, [
            el('p', { class: 'c-menu-prod-rowcard-title', text: p.name }),
            p.description
              ? el('p', { class: 'c-menu-prod-rowcard-desc', text: p.description })
              : null,
            el('div', { class: 'c-menu-prod-rowcard-foot' }, [
              el('span', { class: 'c-price', text: formatTry(p.priceKurus) }),
              el(
                'button',
                {
                  class: 'c-btn c-btn--sm',
                  disabled: blockOrders,
                  onclick: () => {
                    if (blockOrders) return;
                    addProductChoiceToCart(p);
                    render();
                  },
                },
                [isTable ? 'Ekle' : 'Sepete'],
              ),
            ]),
          ]),
        ]),
      ),
    );
  }

  const browse = el('div', { class: 'c-menu-browse' });

  if (menuBrowseStack.length === 0) {
    const eligible = roots.filter((c) => catHasMenuContent(c));
    browse.append(el('h2', { class: 'c-section-title', text: 'MENÜ' }));
    if (eligible.length) {
      browse.append(
        renderCategoryGrid(eligible, (cat) => {
          menuBrowseStack = [String(cat._id)];
          render().catch(console.error);
        }),
      );
    } else {
      browse.append(
        el('p', { class: 'c-muted', text: 'Menüde kategori yok.' }),
      );
    }
  } else {
    const curId = menuBrowseStack[menuBrowseStack.length - 1];
    const cur = menu.categories.find((c) => String(c._id) === curId);
    if (!cur) {
      menuBrowseStack = [];
      render().catch(console.error);
      return;
    }
    const subs = tree.get(String(cur._id)) ?? [];
    const prods = sortProds(productsForCat(cur._id));

    browse.append(
      el('div', { class: 'c-menu-toolbar' }, [
        el(
          'button',
          {
            type: 'button',
            class: 'c-btn c-btn--ghost c-btn--sm',
            onclick: () => {
              menuBrowseStack.pop();
              render().catch(console.error);
            },
          },
          ['← Geri'],
        ),
      ]),
      el('h2', { class: 'c-section-title c-menu-browse-title', text: cur.name }),
      cur.description
        ? el('p', {
            class: 'c-muted c-menu-browse-lead',
            text: cur.description,
          })
        : null,
    );

    if (subs.length) {
      browse.append(
        el('h3', { class: 'c-menu-subheading', text: 'Alt kategoriler' }),
      );
      browse.append(
        renderCategoryGrid(subs, (cat) => {
          menuBrowseStack.push(String(cat._id));
          render().catch(console.error);
        }),
      );
    }

    if (prods.length) {
      browse.append(el('h3', { class: 'c-menu-subheading', text: 'Ürünler' }));
      browse.append(renderProductList(prods));
    }

    if (!subs.length && !prods.length) {
      browse.append(
        el('p', { class: 'c-muted', text: 'Bu kategoride içerik yok.' }),
      );
    }
  }

  root.append(browse);
}

function renderAccountNav(me) {
  const tabs = [
    { id: 'hesabim', label: 'Hesabım' },
    { id: 'profilim', label: 'Profilim' },
    { id: 'adreslerim', label: 'Adreslerim' },
    { id: 'siparislerim', label: 'Siparişlerim' },
  ];
  const locked = webCustomerProfileLocked(me);
  const shown = locked ? tabs.filter((t) => t.id === 'hesabim' || t.id === 'profilim') : tabs;
  return el(
    'nav',
    { class: 'c-account-nav', 'aria-label': 'Hesap bölümleri' },
    shown.map((t) =>
      el(
        'button',
        {
          type: 'button',
          class:
            accountTab === t.id
              ? 'c-account-tab c-account-tab--active'
              : 'c-account-tab',
          onclick: () => setRoute('account', t.id),
        },
        [t.label],
      ),
    ),
  );
}

/**
 * @param {HTMLElement} panel
 * @param {any} me
 */
function renderAccountHesabim(panel, me) {
  const fullName = [me.firstName, me.lastName].filter(Boolean).join(' ').trim();
  panel.append(
    el('p', {
      class: 'c-account-greeting',
      text: fullName ? `Merhaba, ${fullName}` : 'Merhaba',
    }),
    el('p', {
      class: 'c-muted',
      text: `${me.phoneE164} · ${roleLabelTr(me.role)}`,
    }),
    el('p', {
      class: 'c-muted',
      style: 'margin-top:12px;line-height:1.5',
      text: 'Teslimat adresleri ve web siparişleriniz için sol menüden ilgili sekmeyi açabilirsiniz.',
    }),
    el(
      'button',
      {
        class: 'c-btn c-btn--ghost',
        style: 'margin-top:16px;align-self:flex-start',
        onclick: () => {
          setToken(null);
          render();
        },
      },
      ['Çıkış yap'],
    ),
  );
}

/**
 * @param {HTMLElement} panel
 * @param {any} me
 */
function renderAccountProfilim(panel, me) {
  const err = el('p', { class: 'c-error', id: 'profil-err' });
  const fn = el('input', {
    class: 'c-input',
    id: 'profil-fn',
    placeholder: 'İsim',
    value: me.firstName ?? '',
  });
  const ln = el('input', {
    class: 'c-input',
    id: 'profil-ln',
    placeholder: 'Soyisim',
    value: me.lastName ?? '',
  });
  const lead =
    me.role === 'CUSTOMER' && !customerProfileComplete(me)
      ? el('p', {
          class: 'c-error',
          style: 'margin-bottom:14px;line-height:1.45',
          text: 'Web siparişi ve kayıtlı adres eklemek için isim ve soyisim zorunludur (en az 2 karakter). Kaydettikten sonra diğer hesap sekmeleri açılır.',
        })
      : el('p', {
          class: 'c-muted',
          style: 'margin-bottom:12px',
          text: 'Telefon numaranız giriş için kullanılır; burada ad ve soyadınızı güncelleyebilirsiniz.',
        });
  panel.append(
    lead,
    el('label', { class: 'c-label', text: 'İsim' }),
    fn,
    el('label', { class: 'c-label', text: 'Soyisim' }),
    ln,
    err,
    el(
      'button',
      {
        class: 'c-btn',
        onclick: async () => {
          err.textContent = '';
          const firstName = /** @type {HTMLInputElement} */ (fn).value.trim();
          const lastName = /** @type {HTMLInputElement} */ (ln).value.trim();
          if (firstName.length < 2 || lastName.length < 2) {
            err.textContent = 'İsim ve soyisim en az 2 karakter olmalı.';
            return;
          }
          try {
            await api('/users/me', {
              method: 'PATCH',
              body: JSON.stringify({ firstName, lastName }),
            });
            setRoute('account', 'profilim');
            render();
          } catch (e) {
            err.textContent = e.message || 'Kaydedilemedi';
          }
        },
      },
      ['Kaydet'],
    ),
  );
}

/**
 * @param {HTMLElement} panel
 * @param {any} me
 */
function renderAccountAdreslerim(panel, me) {
  if (me.role !== 'CUSTOMER') {
    panel.append(
      el('p', {
        class: 'c-muted',
        text: 'Kayıtlı adresler yalnızca müşteri hesapları içindir.',
      }),
    );
    return;
  }
  panel.append(el('h3', { class: 'c-cat-name', text: 'Kayıtlı adresler' }));
  if (me.addresses?.length) {
    me.addresses.forEach((a, idx) => {
      panel.append(
        el('div', { class: 'c-address-row' }, [
          el('div', { class: 'c-address-row-text' }, [
            `${a.label}: ${a.line1}${a.district ? `, ${a.district}` : ''} — ${a.city}`,
          ]),
          el(
            'button',
            {
              type: 'button',
              class: 'c-btn c-btn--ghost c-btn--sm',
              onclick: async () => {
                if (!confirm('Bu adres silinsin mi?')) return;
                try {
                  await api(`/users/addresses/${idx}`, { method: 'DELETE' });
                  render();
                } catch (e) {
                  alert(e.message || 'Silinemedi');
                }
              },
            },
            ['Sil'],
          ),
        ]),
      );
    });
  } else {
    panel.append(el('p', { class: 'c-muted', text: 'Kayıtlı adres yok.' }));
  }
  panel.append(
    el('h3', {
      class: 'c-cat-name',
      style: 'margin-top:20px',
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
  panel.append(label, line1, district, city);
  panel.append(
    el(
      'button',
      {
        class: 'c-btn',
        onclick: async () => {
          try {
            await api('/users/addresses', {
              method: 'POST',
              body: JSON.stringify({
                label: label.value,
                line1: line1.value,
                district: district.value,
                city: city.value,
              }),
            });
            setRoute('account', 'adreslerim');
            render();
          } catch (e) {
            alert(e.message || 'Adres eklenemedi');
          }
        },
      },
      ['Adres kaydet'],
    ),
  );
}

/**
 * @param {HTMLElement} panel
 * @param {any} me
 */
function renderAccountSiparislerim(panel, me) {
  if (me.role !== 'CUSTOMER') {
    panel.append(
      el('p', {
        class: 'c-muted',
        text: 'Web sipariş geçmişi yalnızca müşteri hesabıyla görüntülenebilir.',
      }),
    );
    return;
  }
  const loading = el('p', { class: 'c-muted', text: 'Siparişler yükleniyor…' });
  panel.append(loading);
  Promise.all([api('/orders'), api('/orders/history?page=0&pageSize=20')])
    .then(([active, hist]) => {
      panel.innerHTML = '';
      const act = Array.isArray(active) ? active : [];
      const items = hist?.items ?? [];
      panel.append(el('h3', { class: 'c-cat-name', text: 'Devam eden siparişler' }));
      if (!act.length) {
        panel.append(el('p', { class: 'c-muted', text: 'Aktif web siparişiniz yok.' }));
      } else {
        act.forEach((o) => {
          const lines = (o.items || []).map((it) => customerOrderItemLine(it)).join(', ');
          panel.append(
            el('div', { class: 'c-order-card' }, [
              el('div', { class: 'c-order-card-head' }, [
                el('span', { class: 'c-order-id', text: `#${String(o._id).slice(-6)}` }),
                el('span', { class: 'c-order-status', text: onlineOrderStatusTr(o) }),
              ]),
              el('p', { class: 'c-muted', style: 'margin:6px 0', text: lines }),
              el('p', {
                class: 'c-price',
                text: formatTry(o.totalKurus ?? 0),
              }),
            ]),
          );
        });
      }
      panel.append(
        el('h3', {
          class: 'c-cat-name',
          style: 'margin-top:22px',
          text: 'Geçmiş siparişler',
        }),
      );
      if (!items.length) {
        panel.append(el('p', { class: 'c-muted', text: 'Henüz tamamlanan sipariş yok.' }));
      } else {
        items.forEach((o) => {
          const lines = (o.items || []).map((it) => customerOrderItemLine(it)).join(', ');
          panel.append(
            el('div', { class: 'c-order-card' }, [
              el('div', { class: 'c-order-card-head' }, [
                el('span', { class: 'c-order-id', text: `#${String(o._id).slice(-6)}` }),
                el('span', { class: 'c-order-status', text: onlineOrderStatusTr(o) }),
              ]),
              el('p', { class: 'c-muted', style: 'margin:6px 0', text: lines }),
              el('p', {
                class: 'c-price',
                text: formatTry(o.totalKurus ?? 0),
              }),
            ]),
          );
        });
      }
    })
    .catch(() => {
      panel.innerHTML = '';
      panel.append(el('p', { class: 'c-error', text: 'Siparişler yüklenemedi.' }));
    });
}

/**
 * Phone OTP girişi — hesap sayfasında ortalanmış kart içinde (modal yok).
 * @param {HTMLElement} container
 * @param {{ onSuccess?: () => void }} [opts]
 */
function mountCustomerPhoneAuth(container, opts = {}) {
  const onSuccess = opts.onSuccess || (() => render().catch(console.error));
  let phone = '';

  function viewPhone() {
    container.innerHTML = '';
    const err = el('p', { class: 'c-error c-auth-err' });
    container.append(
      el('h2', { text: 'Giriş' }),
      el('p', {
        class: 'c-muted',
        text: 'Türk cep: 5xx…, 05xx…, 90… veya +90… (boşluk/tire olabilir).',
      }),
      el('input', {
        class: 'c-input c-auth-input-phone',
        placeholder: 'örn. 5551112233 veya 0555…',
        type: 'tel',
        autocomplete: 'tel',
      }),
      err,
      el(
        'button',
        {
          type: 'button',
          class: 'c-btn',
          onclick: async () => {
            const inp = /** @type {HTMLInputElement | null} */ (
              container.querySelector('.c-auth-input-phone')
            );
            phone = (inp?.value ?? '').trim();
            err.textContent = '';
            try {
              await api('/auth/otp/request', {
                method: 'POST',
                body: JSON.stringify({ phone }),
              });
              viewCode();
            } catch (e) {
              err.textContent = /** @type {Error} */ (e).message;
            }
          },
        },
        ['Kod gönder'],
      ),
      el(
        'button',
        {
          type: 'button',
          class: 'c-link',
          style: 'margin-top:12px',
          onclick: () => setRoute('menu'),
        },
        ['Ürünlere dön'],
      ),
    );
  }

  function viewCode() {
    container.innerHTML = '';
    const err2 = el('p', { class: 'c-error c-auth-err' });
    container.append(
      el('h2', { text: 'SMS kodu' }),
      el('p', {
        class: 'c-muted',
        style: 'margin-bottom:8px',
        text: 'Hesap telefon numaranızla oluşturulur. İsim ve soyisim, girişten sonra Hesap > Profilim’den zorunludur (web siparişi için).',
      }),
      el('input', {
        class: 'c-input c-auth-input-code',
        placeholder: '6 haneli kod',
        maxlength: '6',
        inputmode: 'numeric',
        autocomplete: 'one-time-code',
      }),
      err2,
      el(
        'button',
        {
          type: 'button',
          class: 'c-btn',
          onclick: async () => {
            const codeInp = /** @type {HTMLInputElement | null} */ (
              container.querySelector('.c-auth-input-code')
            );
            const code = (codeInp?.value ?? '').trim();
            err2.textContent = '';
            try {
              const { accessToken, refreshToken } = await api('/auth/otp/verify', {
                method: 'POST',
                body: JSON.stringify({
                  phone,
                  code,
                }),
              });
              setToken(accessToken, refreshToken);
              onSuccess();
            } catch (e) {
              err2.textContent = /** @type {Error} */ (e).message;
            }
          },
        },
        ['Doğrula'],
      ),
      el(
        'button',
        { type: 'button', class: 'c-link', onclick: viewPhone },
        ['Telefonu değiştir'],
      ),
    );
  }

  viewPhone();
}

/**
 * @param {HTMLElement} root
 * @param {any | null | undefined} precookedMe already fetched in `render()` (optional)
 */
function renderAccount(root, precookedMe) {
  const tok = getToken() || getRefreshToken();
  if (!tok) {
    const card = el('div', { class: 'c-modal c-auth-card' });
    mountCustomerPhoneAuth(card, { onSuccess: () => render().catch(console.error) });
    root.append(
      el('div', { class: 'c-auth-page' }, [card]),
    );
    return;
  }
  const apply = (me) => {
    root.innerHTML = '';
    const shell = el('div', { class: 'c-account-shell c-stack' });
    shell.append(
      el('h2', {
        class: 'c-section-title',
        style: 'margin-bottom:4px',
        text: 'Hesabınız',
      }),
    );
    shell.append(renderAccountNav(me));
    const panel = el('div', { class: 'c-account-panel' });
    shell.append(panel);
    root.append(shell);
    if (accountTab === 'hesabim') renderAccountHesabim(panel, me);
    else if (accountTab === 'profilim') renderAccountProfilim(panel, me);
    else if (accountTab === 'adreslerim') renderAccountAdreslerim(panel, me);
    else renderAccountSiparislerim(panel, me);
  };
  if (precookedMe) {
    apply(precookedMe);
  } else {
    api('/users/me')
      .then(apply)
      .catch(() => {
        root.append(el('p', { class: 'c-error', text: 'Profil yüklenemedi.' }));
      });
  }
}

function renderCart(root, me) {
  const isTable = !!tableSlug;
  if (!cart.length) {
    root.append(
      el('p', {
        class: 'c-muted',
        text: isTable ? 'Henüz ürün seçmediniz.' : 'Sepet boş.',
      }),
    );
    return;
  }
  if (isTable) {
    root.append(
      el('h2', {
        class: 'c-section-title',
        text: 'Sipariş özeti',
      }),
      el('p', {
        class: 'c-muted',
        style: 'margin-bottom:12px',
        text: 'Bu sayfa yalnızca dükkan içi masa siparişi içindir; web teslimatı ile karışmaz.',
      }),
    );
  }
  root.append(
    ...cart.map((c, idx) =>
      el('div', { class: 'c-card' }, [
        el('div', { class: 'c-card-body' }, [
          el('p', { class: 'c-card-title', text: c.name }),
          c.optionsSummary
            ? el('p', { class: 'c-muted c-card-opts', text: c.optionsSummary })
            : null,
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

  const tok = getToken() || getRefreshToken();
  const noTable = tableMeta && tableMeta.found === false;
  const storefront = tableMeta?.isStorefront === true;
  const serviceOff = shopCache && !shopCache.acceptsOrders;
  const canOrderTable =
    isTable && !noTable && !storefront && !serviceOff && tableMeta?.found;
  const canOrderOnline = !isTable;
  const webProfileBlock =
    !isTable &&
    !!tok &&
    me?.role === 'CUSTOMER' &&
    !customerProfileComplete(me);

  root.append(
    el('div', { class: 'c-row', style: 'margin-top:16px' }, [
      el('span', { class: 'c-price', text: `Toplam: ${formatTry(cartTotal())}` }),
      el(
        'button',
        {
          class: 'c-btn',
          disabled: isTable ? !canOrderTable : !tok || !canOrderOnline || webProfileBlock,
          onclick: () => submitOrder(),
        },
        [isTable ? 'Masaya sipariş ver' : 'Online sipariş ver'],
      ),
    ]),
  );

  if (!tok && !isTable) {
    root.append(
      el('p', { class: 'c-error', text: 'Sipariş için giriş yapın.' }),
      el(
        'button',
        {
          type: 'button',
          class: 'c-btn c-btn--ghost',
          onclick: () => {
            setRoute('account', 'hesabim');
            render().catch(console.error);
          },
        },
        ['Giriş'],
      ),
    );
  }

  if (!isTable && webProfileBlock) {
    root.append(
      el('p', {
        class: 'c-muted',
        style: 'margin-top:10px',
        text: 'Web siparişi için önce Hesap > Profilim’den isim ve soyisim girin.',
      }),
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
  const items = cart.map((c) => ({
    productId: c.productId,
    quantity: c.qty,
    ...(c.optionsPayload?.length ? { options: c.optionsPayload } : {}),
  }));
  try {
    if (tableSlug) {
      const res = await api('/orders/in-place', {
        method: 'POST',
        body: JSON.stringify({ tableSlug, items }),
      });
      cart = [];
      alert(
        res?.augmented
          ? 'Seçtikleriniz mevcut masanın siparişine eklendi.'
          : 'Siparişiniz alındı.',
      );
    } else {
      const tok = getToken() || getRefreshToken();
      if (!tok) {
        setRoute('account', 'hesabim');
        render().catch(console.error);
        return;
      }
      const me = await api('/users/me');
      if (!customerProfileComplete(me)) {
        alert('Önce Hesap > Profilim bölümünden isim ve soyisim girin.');
        setRoute('account', 'profilim');
        render();
        return;
      }
      if (!me.addresses?.length) {
        alert('Önce hesabınızdan adres ekleyin.');
        setRoute('account', 'adreslerim');
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
      cart = [];
      alert('Siparişiniz alındı.');
    }
    render();
  } catch (e) {
    alert(e.message || 'Sipariş başarısız');
  }
}

/** @param {string} innerSvg path/circle elements only */
function customerTopbarSvg(innerSvg) {
  const template = document.createElement('template');
  template.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${innerSvg}</svg>`;
  const svg = template.content.firstElementChild;
  return /** @type {SVGElement} */ (svg);
}

function renderTopbar(me) {
  parseRoute();
  const lock = webCustomerProfileLocked(me);
  const goMenu = () => {
    if (lock) {
      setRoute('account', 'profilim');
      return;
    }
    setRoute('menu');
  };
  const goCart = () => {
    if (lock) {
      setRoute('account', 'profilim');
      return;
    }
    setRoute('cart');
  };
  const goAccount = () => setRoute('account', 'hesabim');
  const hasSession = !!(getToken() || getRefreshToken());
  const nCart = cartCount();
  const cartLabel = tableSlug
    ? `Özet${nCart ? `, ${nCart} ürün` : ''}`
    : `Sepet${nCart ? `, ${nCart} ürün` : ''}`;
  const cartIcon = customerTopbarSvg(
    '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  );
  const profileIcon = customerTopbarSvg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>');
  const profileBtn = hasSession
    ? el(
        'button',
        {
          type: 'button',
          class: 'c-btn c-btn--ghost c-btn--sm',
          'aria-label': 'Hesap',
          onclick: goAccount,
        },
        [profileIcon],
      )
    : el(
        'button',
        {
          type: 'button',
          class: 'c-btn c-btn--ghost c-btn--sm',
          'aria-label': 'Giriş yap',
          onclick: goAccount,
        },
        ['Giriş Yap'],
      );
  const brandLogoStyle = `mask-image:url("${geyikBrandUrl}");-webkit-mask-image:url("${geyikBrandUrl}")`;
  return el('header', { class: 'c-topbar' }, [
    el(
      'a',
      {
        href: '/',
        class: 'c-brand',
      },
      [
        el('span', {
          class: 'c-brand-logo',
          'aria-hidden': 'true',
          style: brandLogoStyle,
        }),
        'DAINO',
      ],
    ),
    el('div', { class: 'c-topbar-actions' }, [
      tableSlug
        ? el('span', { class: 'c-badge', text: 'Masa' })
        : el('span', { class: 'c-badge', text: 'Web' }),
      el(
        'button',
        { type: 'button', class: 'c-btn c-btn--ghost c-btn--sm', onclick: goMenu },
        ['Ürünler'],
      ),
      profileBtn,
      el(
        'button',
        {
          type: 'button',
          class: 'c-btn c-btn--ghost c-btn--sm c-topbar-cartbtn',
          'aria-label': cartLabel,
          title: cartLabel,
          onclick: goCart,
        },
        [
          cartIcon,
          nCart > 0
            ? el('span', { class: 'c-topbar-badge', text: nCart > 99 ? '99+' : String(nCart) })
            : null,
        ],
      ),
    ]),
  ]);
}

function renderCartBar(me) {
  if (parseRoute() === 'cart') return null;
  if (webCustomerProfileLocked(me)) return null;
  if (!cart.length) return null;
  const isTable = !!tableSlug;
  const lock = webCustomerProfileLocked(me);
  return el('div', { class: 'c-cart-bar' }, [
    el('span', { class: 'c-cart-total', text: formatTry(cartTotal()) }),
    el(
      'button',
      {
        class: 'c-btn c-btn--sm',
        onclick: () => {
          if (lock) {
            setRoute('account', 'profilim');
            return;
          }
          setRoute('cart');
        },
      },
      [isTable ? 'Özete git' : 'Sepete git'],
    ),
  ]);
}

async function render() {
  const app = document.getElementById('app');
  if (!app) return;
  let route = parseRoute();
  const tok = getToken() || getRefreshToken();
  /** @type {any | null} */
  let meSnapshot = null;
  if (tok) {
    try {
      meSnapshot = await api('/users/me');
    } catch {
      meSnapshot = null;
    }
  }
  const webIncomplete =
    !tableSlug &&
    meSnapshot?.role === 'CUSTOMER' &&
    !customerProfileComplete(meSnapshot);
  if (webIncomplete) {
    if (route === 'menu' || route === 'cart') {
      accountTab = 'profilim';
      history.replaceState({}, '', accountPath('profilim'));
      route = 'account';
    } else if (
      route === 'account' &&
      accountTab !== 'profilim' &&
      accountTab !== 'hesabim'
    ) {
      accountTab = 'profilim';
      history.replaceState({}, '', accountPath('profilim'));
    }
  }

  if (!tableSlug) {
    tableMeta = null;
    tableMetaSlug = null;
  } else if (tableMetaSlug !== tableSlug) {
    tableMeta = null;
    tableMetaSlug = tableSlug;
  }

  if (!shopCache) {
    await loadShop().catch(() => {});
  }
  if (route === 'menu' && tableSlug && !tableMeta) {
    await loadTablePublic().catch(() => {});
  }
  if (route === 'cart' && tableSlug && !tableMeta) {
    await loadTablePublic().catch(() => {});
  }
  if (!menuCache) {
    await loadMenu().catch((e) => {
      console.error(e);
    });
  }

  // Clear only after awaits: overlapping `render()` calls used to clear-then-yield;
  // a second run could append without clearing again → duplicated shell (topbar + main + bar).
  app.innerHTML = '';
  app.append(renderTopbar(meSnapshot));
  const main = el('main', { class: 'c-main' });
  if (route === 'menu' && menuCache) renderMenu(main);
  else if (route === 'account') renderAccount(main, meSnapshot || undefined);
  else if (route === 'cart') renderCart(main, meSnapshot);
  else main.append(el('p', { class: 'c-error', text: 'Menü yüklenemedi.' }));
  app.append(main);
  const bar = renderCartBar(meSnapshot);
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

connectStoreRealtime((patch) => {
  if (patch.menu) menuCache = null;
  if (patch.shop) shopCache = null;
  render().catch(console.error);
});

render().catch(console.error);
