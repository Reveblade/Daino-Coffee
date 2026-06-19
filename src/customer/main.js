import '@phosphor-icons/web/regular';
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
/** @type {string | null} */
let activeCartStorageKey = null;
/** QR menü: seçili kategori zinciri (köke göre id dizisi); boş = kök kategoriler. */
let menuBrowseStack = [];

/** Public URL prefix for the ordering app (nginx + Vite dev rewrite). */
const ORDER_APP_BASE = '/siparis';
const CART_STORAGE_PREFIX = 'daino:customer-cart:v1:';

/** `/siparis/hesap` alt sekmesi */
let accountTab = 'hesabim';

const ACCOUNT_TABS = new Set(['hesabim', 'profilim', 'adreslerim', 'siparislerim']);
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? '';
const GOOGLE_MAPS_MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID?.trim() ?? '';

/** @type {Promise<any> | null} */
let googleMapsLoadPromise = null;

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
function customerHasAddress(me) {
  if (!me || me.role !== 'CUSTOMER') return true;
  if (typeof me.hasAddress === 'boolean') return me.hasAddress;
  return Array.isArray(me.addresses) && me.addresses.length > 0;
}

/** @param {any | null | undefined} me */
function customerAccountComplete(me) {
  if (!me || me.role !== 'CUSTOMER') return true;
  if (typeof me.accountComplete === 'boolean') return me.accountComplete;
  return customerProfileComplete(me) && customerHasAddress(me);
}

/** @param {any | null | undefined} me */
function webCustomerAccountLocked(me) {
  return !!me && !tableSlug && me.role === 'CUSTOMER' && !customerAccountComplete(me);
}

/** @param {string} value */
function normalizeCustomerPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  while (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  if (digits.startsWith('90')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  if (digits.length === 10 && digits.startsWith('5')) {
    return `+90${digits}`;
  }
  return '';
}

/** @param {string[]} groups */
function joinPhoneGroups(groups) {
  return groups.filter(Boolean).join(' ');
}

/** @param {string} nationalDigits */
function formatNationalPhone(nationalDigits) {
  const d = nationalDigits.slice(0, 10);
  return joinPhoneGroups([d.slice(0, 3), d.slice(3, 6), d.slice(6, 8), d.slice(8, 10)]);
}

/** @param {string} value */
function formatCustomerPhoneInput(value) {
  const raw = String(value || '').trimStart();
  let digits = raw.replace(/\D/g, '');
  while (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  const wantsInternational = raw.startsWith('+') || digits.startsWith('90');

  if (wantsInternational) {
    const national = digits.startsWith('90') ? digits.slice(2) : digits;
    return `+90${national ? ` ${formatNationalPhone(national)}` : ''}`;
  }

  if (digits.startsWith('0')) {
    return `0${digits.length > 1 ? ` ${formatNationalPhone(digits.slice(1))}` : ''}`;
  }

  return formatNationalPhone(digits);
}

function loadGoogleMaps() {
  if (!GOOGLE_MAPS_API_KEY) return Promise.resolve(null);
  if (window.google?.maps?.places) return Promise.resolve(window.google);
  if (googleMapsLoadPromise) return googleMapsLoadPromise;

  googleMapsLoadPromise = new Promise((resolve, reject) => {
    const cbName = `__dainoMapsReady_${Date.now()}`;
    const script = document.createElement('script');
    window[cbName] = () => {
      delete window[cbName];
      resolve(window.google);
    };
    script.onerror = () => {
      delete window[cbName];
      googleMapsLoadPromise = null;
      reject(new Error('Google Maps yüklenemedi.'));
    };
    const params = new URLSearchParams({
      key: GOOGLE_MAPS_API_KEY,
      libraries: 'places,marker',
      callback: cbName,
      language: 'tr',
      region: 'TR',
      v: 'weekly',
      loading: 'async',
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    document.head.append(script);
  });

  return googleMapsLoadPromise;
}

/** @param {any[]} components */
function findAddressComponent(components, type) {
  const component = components.find((c) => Array.isArray(c.types) && c.types.includes(type));
  return component?.long_name ?? component?.longText ?? '';
}

/** @param {any} place */
function addressFromGooglePlace(place) {
  const components = place?.address_components ?? place?.addressComponents ?? [];
  const streetNumber = findAddressComponent(components, 'street_number');
  const route = findAddressComponent(components, 'route');
  const neighborhood =
    findAddressComponent(components, 'neighborhood') ||
    findAddressComponent(components, 'sublocality') ||
    findAddressComponent(components, 'sublocality_level_1');
  const district =
    findAddressComponent(components, 'administrative_area_level_2') ||
    findAddressComponent(components, 'locality');
  const city =
    findAddressComponent(components, 'administrative_area_level_1') ||
    findAddressComponent(components, 'locality');
  const line1 =
    joinPhoneGroups([neighborhood, joinPhoneGroups([route, streetNumber])]) ||
    place?.formatted_address ||
    '';
  const location = place?.geometry?.location ?? place?.location;

  return {
    line1,
    district,
    city,
    formattedAddress: place?.formatted_address || place?.formattedAddress || '',
    placeId: place?.place_id || place?.id || '',
    lat: typeof location?.lat === 'function' ? location.lat() : undefined,
    lng: typeof location?.lng === 'function' ? location.lng() : undefined,
  };
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

/** @param {unknown} value */
function blankLineText(value) {
  const text = value == null ? '' : String(value).trim();
  return text && text.toLowerCase() !== 'null' ? text : ' ';
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

function cartStorageKey() {
  return `${CART_STORAGE_PREFIX}${tableSlug ? `table:${tableSlug}` : 'web'}`;
}

/** @param {unknown} value */
function normalizeSavedCart(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((line) => {
      if (!line || typeof line !== 'object') return null;
      const item = /** @type {any} */ (line);
      const productId = String(item.productId || '').trim();
      const name = String(item.name || '').trim();
      const unitPriceKurus = Number(item.unitPriceKurus);
      const qty = Math.max(1, Math.floor(Number(item.qty) || 0));
      if (!productId || !name || !Number.isFinite(unitPriceKurus) || qty < 1) return null;
      const optionsPayload = Array.isArray(item.optionsPayload) ? item.optionsPayload : [];
      const optionsSummary = typeof item.optionsSummary === 'string' ? item.optionsSummary : '';
      return { productId, name, unitPriceKurus, qty, optionsPayload, optionsSummary };
    })
    .filter(Boolean);
}

function loadCartForCurrentRoute() {
  const key = cartStorageKey();
  if (activeCartStorageKey === key) return;
  activeCartStorageKey = key;
  try {
    cart = normalizeSavedCart(JSON.parse(localStorage.getItem(key) || '[]'));
  } catch {
    cart = [];
  }
}

function persistCart() {
  const key = activeCartStorageKey || cartStorageKey();
  activeCartStorageKey = key;
  try {
    if (cart.length) localStorage.setItem(key, JSON.stringify(cart));
    else localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in private mode; the in-memory cart still works.
  }
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
  persistCart();
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
            el('p', {
              class: 'c-menu-prod-rowcard-desc',
              text: blankLineText(p.description),
            }),
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
    browse.append(
      el('p', {
        class: 'c-muted c-menu-home-lead',
        text: 'Kategori seçerek ürünleri inceleyebilirsiniz.',
      }),
    );
    if (eligible.length) {
      browse.append(el('h3', { class: 'c-menu-subheading', text: 'Kategoriler' }));
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
      el('div', { class: 'c-menu-heading-row' }, [
        el(
          'button',
          {
            type: 'button',
            class: 'c-menu-back-btn c-btn c-btn--ghost c-btn--sm',
            onclick: () => {
              menuBrowseStack.pop();
              render().catch(console.error);
            },
          },
          ['← Geri'],
        ),
        el('h2', { class: 'c-section-title c-menu-browse-title', text: cur.name }),
      ]),
      el('p', {
        class: 'c-muted c-menu-browse-lead',
        text: blankLineText(cur.description),
      }),
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
  const locked = webCustomerAccountLocked(me);
  const shown = locked ? tabs.filter((t) => t.id === 'hesabim') : tabs;
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
 * @param {{ buttonLabel?: string, onSaved?: () => void }} [opts]
 */
function appendAddressForm(panel, opts = {}) {
  const err = el('p', { class: 'c-error' });
  /** @type {{ formattedAddress?: string, placeId?: string, lat?: number, lng?: number } | null} */
  let selectedLocation = null;
  let mapSelectionRequired = false;
  const label = el('input', {
    class: 'c-input',
    placeholder: 'Etiket (örn. Ev)',
    autocomplete: 'address-line1',
  });
  const line1 = el('input', {
    class: 'c-input',
    placeholder: 'Adres satırı',
    autocomplete: 'street-address',
  });
  const district = el('input', {
    class: 'c-input',
    placeholder: 'İlçe',
    autocomplete: 'address-level2',
  });
  const city = el('input', {
    class: 'c-input',
    placeholder: 'Şehir',
    autocomplete: 'address-level1',
  });
  const mapSearch = el('input', {
    class: 'c-input c-map-search',
    placeholder: 'Konum ara (örn. mahalle, sokak, bina)',
    autocomplete: 'off',
  });
  const mapCanvas = el('div', { class: 'c-map-canvas', 'aria-label': 'Adres konumu haritası' });
  const mapStatus = el('p', {
    class: 'c-muted c-map-status',
    text: GOOGLE_MAPS_API_KEY
      ? 'Harita yükleniyor...'
      : 'Google Maps API anahtarı tanımlı değil; adresi manuel girebilirsiniz.',
  });
  if (!GOOGLE_MAPS_API_KEY) {
    /** @type {HTMLInputElement} */ (mapSearch).disabled = true;
    mapSearch.style.display = 'none';
    mapCanvas.style.display = 'none';
  }

  function applyPickedAddress(picked) {
    selectedLocation = {
      formattedAddress: picked.formattedAddress,
      placeId: picked.placeId,
      lat: picked.lat,
      lng: picked.lng,
    };
    if (picked.line1) /** @type {HTMLInputElement} */ (line1).value = picked.line1;
    if (picked.district) /** @type {HTMLInputElement} */ (district).value = picked.district;
    if (picked.city) /** @type {HTMLInputElement} */ (city).value = picked.city;
    mapStatus.textContent = picked.formattedAddress
      ? `Seçilen konum: ${picked.formattedAddress}`
      : 'Konum seçildi.';
  }

  function initAddressMap() {
    if (!GOOGLE_MAPS_API_KEY) return;

    loadGoogleMaps()
      .then((google) => {
        if (!google) return;
        mapSelectionRequired = true;
        const defaultCenter = { lat: 41.0082, lng: 28.9784 };
        const mapOptions = {
          center: defaultCenter,
          zoom: 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        };
        if (GOOGLE_MAPS_MAP_ID) mapOptions.mapId = GOOGLE_MAPS_MAP_ID;

        const map = new google.maps.Map(mapCanvas, mapOptions);
        const AdvancedMarkerElement = GOOGLE_MAPS_MAP_ID
          ? google.maps.marker?.AdvancedMarkerElement
          : null;
        const marker = AdvancedMarkerElement
          ? new AdvancedMarkerElement({
              map,
              position: defaultCenter,
              title: 'Teslimat noktası',
              gmpDraggable: true,
            })
          : new google.maps.Marker({
              map,
              position: defaultCenter,
              draggable: true,
            });
        const geocoder = new google.maps.Geocoder();

        function setMarkerPosition(position) {
          if (typeof marker.setPosition === 'function') marker.setPosition(position);
          else marker.position = position;
        }

        function reversePick(latLng) {
          setMarkerPosition(latLng);
          map.panTo(latLng);
          geocoder.geocode({ location: latLng }, (results, status) => {
            if (status === 'OK' && results?.[0]) {
              applyPickedAddress(addressFromGooglePlace(results[0]));
            } else {
              selectedLocation = {
                lat: typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat,
                lng: typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng,
              };
              mapStatus.textContent = 'Konum seçildi; adres satırını manuel tamamlayın.';
            }
          });
        }

        function bindLegacyAutocomplete() {
          const autocomplete = new google.maps.places.Autocomplete(mapSearch, {
            componentRestrictions: { country: 'tr' },
            fields: ['address_components', 'formatted_address', 'geometry', 'place_id'],
          });

          autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace();
            const location = place?.geometry?.location;
            if (!location) {
              mapStatus.textContent = 'Konum bulunamadı, lütfen daha net bir adres arayın.';
              return;
            }
            map.setCenter(location);
            map.setZoom(16);
            setMarkerPosition(location);
            applyPickedAddress(addressFromGooglePlace(place));
          });
        }

        if (google.maps.places?.PlaceAutocompleteElement) {
          const placeAutocomplete = new google.maps.places.PlaceAutocompleteElement({
            includedRegionCodes: ['tr'],
          });
          placeAutocomplete.className = 'c-map-search';
          placeAutocomplete.setAttribute('aria-label', 'Konum ara');
          mapSearch.replaceWith(placeAutocomplete);
          placeAutocomplete.addEventListener('gmp-select', async (event) => {
            try {
              const place = event.placePrediction?.toPlace();
              if (!place) {
                mapStatus.textContent = 'Konum bulunamadı, lütfen daha net bir adres arayın.';
                return;
              }
              await place.fetchFields({
                fields: ['addressComponents', 'formattedAddress', 'location', 'id', 'viewport'],
              });
              const location = place.location;
              if (!location) {
                mapStatus.textContent = 'Konum bulunamadı, lütfen daha net bir adres arayın.';
                return;
              }
              if (place.viewport) map.fitBounds(place.viewport);
              else {
                map.setCenter(location);
                map.setZoom(16);
              }
              setMarkerPosition(location);
              applyPickedAddress(addressFromGooglePlace(place));
            } catch {
              mapStatus.textContent = 'Konum bilgisi alınamadı, lütfen tekrar deneyin.';
            }
          });
        } else {
          bindLegacyAutocomplete();
        }
        map.addListener('click', (event) => {
          if (event.latLng) reversePick(event.latLng);
        });
        marker.addListener('dragend', (event) => {
          if (event.latLng) reversePick(event.latLng);
        });
        mapStatus.textContent = 'Adresinizi arayın veya haritada pini teslimat noktasına taşıyın.';
      })
      .catch(() => {
        mapSelectionRequired = false;
        mapStatus.textContent = 'Harita yüklenemedi; adresi manuel girebilirsiniz.';
      });
  }

  panel.append(
    el('label', { class: 'c-label', text: 'Haritadan konum seç' }),
    mapSearch,
    mapCanvas,
    mapStatus,
    el('label', { class: 'c-label', text: 'Adres adı' }),
    label,
    el('label', { class: 'c-label', text: 'Adres' }),
    line1,
    el('label', { class: 'c-label', text: 'İlçe' }),
    district,
    el('label', { class: 'c-label', text: 'Şehir' }),
    city,
    err,
    el(
      'button',
      {
        class: 'c-btn',
        onclick: async () => {
          err.textContent = '';
          const payload = {
            label: /** @type {HTMLInputElement} */ (label).value.trim(),
            line1: /** @type {HTMLInputElement} */ (line1).value.trim(),
            district: /** @type {HTMLInputElement} */ (district).value.trim(),
            city: /** @type {HTMLInputElement} */ (city).value.trim(),
            formattedAddress: selectedLocation?.formattedAddress,
            placeId: selectedLocation?.placeId,
            lat: selectedLocation?.lat,
            lng: selectedLocation?.lng,
          };
          if (payload.label.length < 2 || payload.line1.length < 5 || payload.city.length < 2) {
            err.textContent = 'Adres adı, adres satırı ve şehir alanlarını eksiksiz girin.';
            return;
          }
          if (mapSelectionRequired && (payload.lat === undefined || payload.lng === undefined)) {
            err.textContent = 'Lütfen haritadan teslimat konumunu seçin.';
            return;
          }
          try {
            await api('/users/addresses', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
            if (opts.onSaved) opts.onSaved();
            else {
              setRoute('account', 'adreslerim');
              render();
            }
          } catch (e) {
            err.textContent = e.message || 'Adres eklenemedi';
          }
        },
      },
      [opts.buttonLabel || 'Adres kaydet'],
    ),
  );
  initAddressMap();
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
  appendAddressForm(panel);
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
 * @param {HTMLElement} root
 * @param {any} me
 */
function renderAccountCompletionFlow(root, me) {
  const needsProfile = !customerProfileComplete(me);
  const needsAddress = !customerHasAddress(me);
  const shell = el('div', { class: 'c-complete-shell' });
  const panel = el('div', { class: 'c-complete-panel' });

  shell.append(
    el('p', { class: 'c-auth-eyebrow', text: 'Hesap kurulumu' }),
    el('h2', { class: 'c-section-title c-complete-title', text: 'Siparişe hazır olmanız için son adımlar' }),
    el('p', {
      class: 'c-muted c-complete-lead',
      text: 'Web siparişlerinde teslimatı doğru hazırlayabilmemiz için isim, soyisim ve en az bir teslimat adresi gerekiyor.',
    }),
    el('div', { class: 'c-complete-steps', 'aria-label': 'Tamamlama adımları' }, [
      el('span', {
        class: needsProfile ? 'c-complete-step c-complete-step--active' : 'c-complete-step',
        text: customerProfileComplete(me) ? 'Profil tamam' : '1. Profil',
      }),
      el('span', {
        class: !needsProfile && needsAddress
          ? 'c-complete-step c-complete-step--active'
          : 'c-complete-step',
        text: customerHasAddress(me) ? 'Adres tamam' : '2. Adres',
      }),
    ]),
    panel,
    el(
      'button',
      {
        class: 'c-link c-complete-logout',
        onclick: () => {
          setToken(null);
          render();
        },
      },
      ['Çıkış yap'],
    ),
  );
  root.append(shell);

  if (needsProfile) {
    const err = el('p', { class: 'c-error' });
    const fn = el('input', {
      class: 'c-input',
      placeholder: 'İsim',
      value: me.firstName ?? '',
      autocomplete: 'given-name',
    });
    const ln = el('input', {
      class: 'c-input',
      placeholder: 'Soyisim',
      value: me.lastName ?? '',
      autocomplete: 'family-name',
    });
    panel.append(
      el('h3', { class: 'c-cat-name', text: 'Önce adınızı tamamlayın' }),
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
              render();
            } catch (e) {
              err.textContent = e.message || 'Kaydedilemedi';
            }
          },
        },
        [needsAddress ? 'Kaydet ve adrese geç' : 'Kaydet'],
      ),
    );
    fn.focus();
    return;
  }

  if (needsAddress) {
    panel.append(
      el('h3', { class: 'c-cat-name', text: 'İlk teslimat adresinizi ekleyin' }),
      el('p', {
        class: 'c-muted',
        style: 'margin-top:-4px;margin-bottom:12px;line-height:1.45',
        text: 'Daha sonra Hesap > Adreslerim bölümünden yeni adres ekleyebilir veya silebilirsiniz.',
      }),
    );
    appendAddressForm(panel, {
      buttonLabel: 'Adresi kaydet ve tamamla',
      onSaved: () => setRoute('account', 'hesabim'),
    });
  }
}

/**
 * Phone OTP girişi — hesap sayfasında ortalanmış kart içinde (modal yok).
 * @param {HTMLElement} container
 * @param {{ onSuccess?: () => void }} [opts]
 */
function mountCustomerPhoneAuth(container, opts = {}) {
  const onSuccess = opts.onSuccess || (() => render().catch(console.error));
  let phone = '';
  let resendAvailableAt = 0;
  /** @type {number | undefined} */
  let resendTimer;

  const RESEND_WAIT_SECONDS = 30;
  const brandLogoStyle = `mask-image:url("${geyikBrandUrl}");-webkit-mask-image:url("${geyikBrandUrl}")`;

  function clearResendTimer() {
    if (resendTimer) {
      window.clearInterval(resendTimer);
      resendTimer = undefined;
    }
  }

  /**
   * @param {string} eyebrow
   * @param {string} title
   * @param {string} lead
   * @param {(HTMLElement | string | null)[]} children
   */
  function renderAuthShell(eyebrow, title, lead, children) {
    container.innerHTML = '';
    container.append(
      el('div', { class: 'c-auth-card__glow', 'aria-hidden': 'true' }),
      el('div', { class: 'c-auth-brandmark', 'aria-hidden': 'true' }, [
        el('span', { class: 'c-brand-logo', style: brandLogoStyle }),
      ]),
      el('p', { class: 'c-auth-eyebrow', text: eyebrow }),
      el('h2', { class: 'c-auth-title', text: title }),
      el('p', { class: 'c-auth-lead', text: lead }),
      ...children,
    );
  }

  async function requestCode(phoneValue) {
    await api('/auth/otp/request', {
      method: 'POST',
      body: JSON.stringify({ phone: phoneValue }),
    });
    resendAvailableAt = Date.now() + RESEND_WAIT_SECONDS * 1000;
  }

  function viewPhone() {
    clearResendTimer();
    const err = el('p', { class: 'c-error c-auth-err' });
    const phoneInput = el('input', {
      class: 'c-input c-auth-input c-auth-input-phone',
      placeholder: '5xx xxx xx xx',
      type: 'tel',
      autocomplete: 'tel',
      inputmode: 'tel',
      value: formatCustomerPhoneInput(phone),
      oninput: (event) => {
        const input = /** @type {HTMLInputElement} */ (event.currentTarget);
        input.value = formatCustomerPhoneInput(input.value);
      },
    });
    const submitBtn = el(
      'button',
      {
        type: 'submit',
        class: 'c-btn c-auth-primary',
      },
      ['Kodu gönder'],
    );
    const form = el(
      'form',
      {
        class: 'c-auth-form',
        onsubmit: async (event) => {
          event.preventDefault();
          const normalizedPhone = normalizeCustomerPhone(
            /** @type {HTMLInputElement} */ (phoneInput).value,
          );
          err.textContent = '';

          if (!normalizedPhone) {
            err.textContent = 'Lütfen geçerli bir cep telefonu girin: 5xx xxx xx xx.';
            return;
          }

          phone = normalizedPhone;
          submitBtn.disabled = true;
          submitBtn.textContent = 'Kod gönderiliyor...';
          try {
            await requestCode(phone);
            viewCode();
          } catch (e) {
            err.textContent = /** @type {Error} */ (e).message;
            submitBtn.disabled = false;
            submitBtn.textContent = 'Kodu gönder';
          }
        },
      },
      [
        el('label', { class: 'c-auth-label', for: 'customer-phone', text: 'Telefon numarası' }),
        phoneInput,
        err,
        submitBtn,
        el('p', {
          class: 'c-auth-note',
          text: 'Şifre gerekmez. Size tek kullanımlık SMS kodu göndereceğiz.',
        }),
      ],
    );
    phoneInput.id = 'customer-phone';

    renderAuthShell(
      'Güvenli müşteri girişi',
      'Daino hesabınıza giriş yapın',
      'Siparişlerinizi takip etmek ve web siparişlerinizi tamamlamak için telefon numaranızla devam edin.',
      [
        form,
        el('div', { class: 'c-auth-benefits', 'aria-label': 'Giriş avantajları' }, [
          el('span', { text: 'SMS ile hızlı giriş' }),
          el('span', { text: 'Sipariş geçmişi' }),
        ]),
      ],
    );
    phoneInput.focus();
  }

  function viewCode() {
    clearResendTimer();
    const err2 = el('p', { class: 'c-error c-auth-err' });
    const status = el('p', { class: 'c-auth-note c-auth-resend-status' });
    const codeInput = el('input', {
      class: 'c-input c-auth-input c-auth-input-code',
      placeholder: '6 haneli kod',
      maxlength: '6',
      inputmode: 'numeric',
      autocomplete: 'one-time-code',
      oninput: (event) => {
        const input = /** @type {HTMLInputElement} */ (event.currentTarget);
        input.value = input.value.replace(/\D/g, '').slice(0, 6);
      },
    });
    const verifyBtn = el(
      'button',
      {
        type: 'submit',
        class: 'c-btn c-auth-primary',
      },
      ['Giriş yap'],
    );
    const resendBtn = el(
      'button',
      {
        type: 'button',
        class: 'c-link c-auth-resend',
        onclick: async () => {
          if (Date.now() < resendAvailableAt) return;

          err2.textContent = '';
          resendBtn.disabled = true;
          resendBtn.textContent = 'Gönderiliyor...';
          try {
            await requestCode(phone);
            status.textContent = 'Yeni kod gönderildi.';
            updateResendState();
          } catch (e) {
            err2.textContent = /** @type {Error} */ (e).message;
            updateResendState();
          }
        },
      },
      ['Kodu tekrar gönder'],
    );

    function updateResendState() {
      const remaining = Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000));
      if (remaining > 0) {
        resendBtn.disabled = true;
        resendBtn.textContent = `Tekrar gönder (${remaining} sn)`;
        if (!status.textContent || status.textContent === 'Yeni kod gönderildi.') {
          status.textContent = `Kod gelmediyse ${remaining} saniye sonra tekrar gönderebilirsiniz.`;
        }
        return;
      }

      resendBtn.disabled = false;
      resendBtn.textContent = 'Kodu tekrar gönder';
      status.textContent = 'Kod gelmediyse yeniden SMS gönderebilirsiniz.';
      clearResendTimer();
    }

    const form = el(
      'form',
      {
        class: 'c-auth-form',
        onsubmit: async (event) => {
          event.preventDefault();
          const code = (/** @type {HTMLInputElement} */ (codeInput).value ?? '').trim();
          err2.textContent = '';

          if (!/^\d{6}$/.test(code)) {
            err2.textContent = 'Lütfen 6 haneli SMS kodunu girin.';
            return;
          }

          verifyBtn.disabled = true;
          verifyBtn.textContent = 'Kontrol ediliyor...';
          try {
            const { accessToken, refreshToken } = await api('/auth/otp/verify', {
              method: 'POST',
              body: JSON.stringify({
                phone,
                code,
              }),
            });
            clearResendTimer();
            setToken(accessToken, refreshToken);
            onSuccess();
          } catch (e) {
            err2.textContent = /** @type {Error} */ (e).message;
            verifyBtn.disabled = false;
            verifyBtn.textContent = 'Giriş yap';
          }
        },
      },
      [
        el('div', { class: 'c-auth-phone-row' }, [
          el('span', { text: formatCustomerPhoneInput(phone) }),
          el(
            'button',
            { type: 'button', class: 'c-link', onclick: viewPhone },
            ['Değiştir'],
          ),
        ]),
        el('label', { class: 'c-auth-label', for: 'customer-code', text: 'SMS kodu' }),
        codeInput,
        err2,
        verifyBtn,
      ],
    );
    codeInput.id = 'customer-code';

    renderAuthShell(
      'Telefon doğrulama',
      'SMS kodunu girin',
      'Size gönderdiğimiz tek kullanımlık kodla hesabınıza güvenli şekilde giriş yapabilirsiniz.',
      [
        form,
        el('div', { class: 'c-auth-secondary-row' }, [
          status,
          resendBtn,
        ]),
      ],
    );

    updateResendState();
    resendTimer = window.setInterval(updateResendState, 1000);
    codeInput.focus();
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
    const card = el('div', { class: 'c-auth-card' });
    mountCustomerPhoneAuth(card, { onSuccess: () => render().catch(console.error) });
    root.append(
      el('div', { class: 'c-auth-page' }, [card]),
    );
    return;
  }
  const apply = (me) => {
    root.innerHTML = '';
    if (webCustomerAccountLocked(me)) {
      renderAccountCompletionFlow(root, me);
      return;
    }
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
                  persistCart();
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
  const webAccountBlock =
    !isTable &&
    !!tok &&
    me?.role === 'CUSTOMER' &&
    !customerAccountComplete(me);

  root.append(
    el('div', { class: 'c-row', style: 'margin-top:16px' }, [
      el('span', { class: 'c-price', text: `Toplam: ${formatTry(cartTotal())}` }),
      el(
        'button',
        {
          class: 'c-btn',
          disabled: isTable ? !canOrderTable : !tok || !canOrderOnline || webAccountBlock,
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

  if (!isTable && webAccountBlock) {
    root.append(
      el('p', {
        class: 'c-muted',
        style: 'margin-top:10px',
        text: 'Web siparişi için önce hesap bilgilerinizi ve teslimat adresinizi tamamlayın.',
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
      persistCart();
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
      if (!customerAccountComplete(me)) {
        alert('Önce hesap bilgilerinizi ve teslimat adresinizi tamamlayın.');
        setRoute('account', 'hesabim');
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
      persistCart();
      alert('Siparişiniz alındı.');
    }
    render();
  } catch (e) {
    alert(e.message || 'Sipariş başarısız');
  }
}

/** @param {string} name */
function phosphorIcon(name) {
  return el('i', {
    class: `ph ph-${name} c-icon`,
    'aria-hidden': 'true',
  });
}

function topbarChannelLabel() {
  if (!tableSlug) return 'Web';
  if (tableMeta?.found === false) return 'Masa';

  const number = Number(tableMeta?.number);
  if (!Number.isFinite(number)) return 'Masa';
  return number === 0 ? 'Menü' : `Masa ${number}`;
}

function renderTopbar(me) {
  const route = parseRoute();
  const lock = webCustomerAccountLocked(me);
  const goMenu = () => {
    if (lock) {
      setRoute('account', 'hesabim');
      return;
    }
    setRoute('menu');
  };
  const goCart = () => {
    if (lock) {
      setRoute('account', 'hesabim');
      return;
    }
    setRoute('cart');
  };
  const goAccount = () => setRoute('account', 'hesabim');
  const hasSession = !!(getToken() || getRefreshToken());
  const isLoginScreen = route === 'account' && !hasSession;
  const nCart = cartCount();
  const cartLabel = tableSlug
    ? `Özet${nCart ? `, ${nCart} ürün` : ''}`
    : `Sepet${nCart ? `, ${nCart} ürün` : ''}`;
  const channelLabel = topbarChannelLabel();
  const profileBtn = hasSession
    ? el(
        'button',
        {
          type: 'button',
          class: 'c-btn c-btn--ghost c-topbar-iconbtn',
          'aria-label': 'Hesap',
          title: 'Hesap',
          onclick: goAccount,
        },
        [phosphorIcon('user-circle')],
      )
    : el(
        'button',
        {
          type: 'button',
          class: 'c-btn c-btn--ghost c-topbar-iconbtn',
          'aria-label': 'Giriş yap',
          title: 'Giriş yap',
          onclick: goAccount,
        },
        [phosphorIcon('sign-in')],
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
      el('span', { class: 'c-badge', text: channelLabel }),
      route === 'menu' || isLoginScreen
        ? null
        : el(
            'button',
            {
              type: 'button',
              class: 'c-btn c-btn--ghost c-topbar-iconbtn',
              'aria-label': 'Ürünler',
              title: 'Ürünler',
              onclick: goMenu,
            },
            [phosphorIcon('list-bullets')],
          ),
      isLoginScreen ? null : profileBtn,
      el(
        'button',
        {
          type: 'button',
          class: 'c-btn c-btn--ghost c-topbar-iconbtn c-topbar-cartbtn',
          'aria-label': cartLabel,
          title: cartLabel,
          onclick: goCart,
        },
        [
          phosphorIcon(tableSlug ? 'receipt' : 'shopping-cart-simple'),
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
  if (webCustomerAccountLocked(me)) return null;
  if (!cart.length) return null;
  const isTable = !!tableSlug;
  const lock = webCustomerAccountLocked(me);
  return el('div', { class: 'c-cart-bar' }, [
    el('span', { class: 'c-cart-total', text: formatTry(cartTotal()) }),
    el(
      'button',
      {
        class: 'c-btn c-btn--sm',
        onclick: () => {
          if (lock) {
            setRoute('account', 'hesabim');
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
  loadCartForCurrentRoute();
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
    !customerAccountComplete(meSnapshot);
  if (webIncomplete) {
    if (route === 'menu' || route === 'cart') {
      accountTab = 'hesabim';
      history.replaceState({}, '', accountPath('hesabim'));
      route = 'account';
    } else if (
      route === 'account' &&
      accountTab !== 'hesabim'
    ) {
      accountTab = 'hesabim';
      history.replaceState({}, '', accountPath('hesabim'));
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
