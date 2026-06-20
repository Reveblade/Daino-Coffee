import '@phosphor-icons/web/regular';
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
import {
  buttonHtml,
  emptyRowHtml,
  errorMessage,
  escapeHtml as esc,
  iconHtml,
  showConfirmDialog,
  showToast,
  withButtonBusy,
} from './ui.js';

/** @type {'login' | 'app'} */
let screen = 'login';
/** @type {string} */
let view = 'orders';
/** @type {(() => void) | null} */
let stopOrdersWs = null;
/** @type {Map<string, { additionCount: number }>} */
let staffOrderAlertSnapshot = new Map();
let staffOrderAlertSnapshotReady = false;

/** Geçmiş liste / detay (sayfa yeniden çizilince korunur). */
let historyUi = {
  /** @type {string | null} */
  detailOrderId: null,
  page: 0,
  /** @type {string} */
  q: '',
  /** @type {string} */
  tableNumber: '',
  pageSize: 20,
};

/** Kurye geçmiş sekmesi (aktif görevden ayrı tutulur). */
let courierHistoryUi = {
  /** @type {string | null} */
  detailOrderId: null,
  page: 0,
  pageSize: 10,
};

let staffUi = {
  /** @type {'list' | 'new'} */
  sub: 'list',
  page: 0,
  pageSize: 20,
};

let customerUi = {
  page: 0,
  pageSize: 20,
  q: '',
};

let tablesUi = {
  /** @type {'list' | 'new'} */
  sub: 'list',
  page: 0,
  pageSize: 20,
};

function defaultMenuListUi() {
  return {
    section: 'categories',
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

function channelLabelTr(ch) {
  if (ch === 'IN_PLACE') return 'Servis';
  if (ch === 'ONLINE') return 'Kurye';
  return String(ch ?? '');
}

/** @param {string | null | undefined} r */
function roleLabelTr(r) {
  const m = {
    CASHIER: 'Kasiyer',
    COURIER: 'Kurye',
    ADMIN: 'Yönetici',
    ADMIN_OWNER: 'Sahip',
    CUSTOMER: 'Müşteri',
  };
  return m[r] ?? String(r ?? '');
}

/**
 * @param {unknown} body
 * @param {number} fallbackPageSize
 */
function parsePaged(body, fallbackPageSize) {
  if (Array.isArray(body)) {
    return {
      items: body,
      total: body.length,
      page: 0,
      pageSize: fallbackPageSize,
    };
  }
  const o = /** @type {{ items?: unknown[]; total?: unknown; page?: unknown; pageSize?: unknown }} */ (
    body && typeof body === 'object' ? body : {}
  );
  const items = Array.isArray(o.items) ? o.items : [];
  return {
    items,
    total: Number(o.total) || 0,
    page: typeof o.page === 'number' && Number.isFinite(o.page) ? o.page : 0,
    pageSize:
      typeof o.pageSize === 'number' && Number.isFinite(o.pageSize)
        ? o.pageSize
        : fallbackPageSize,
  };
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
      { act: 'CANCEL', label: 'İptal Et' },
    ];
  if (st === 'IN_PROGRESS')
    return [
      { act: 'READY', label: 'Masaya Teslim Ettim' },
      { act: 'CANCEL', label: 'İptal Et' },
    ];
  if (st === 'READY')
    return [
      { act: 'AWAIT_PAYMENT', label: 'Ödemeyi Aldım' },
      { act: 'MARK_PAID', label: 'Ödemeyi Aldım' },
      { act: 'CANCEL', label: 'İptal Et' },
    ];
  if (st === 'AWAITING_PAYMENT')
    return [
      { act: 'MARK_PAID', label: 'Ödemeyi Aldım' },
      { act: 'CANCEL', label: 'İptal Et' },
    ];
  return [];
}

/** @param {string} st @returns {{ act: string, label: string }[]} */
function onlineStaffActions(st) {
  if (st === 'PAID' || st === 'CANCELLED') return [];
  if (st === 'PLACED')
    return [
      { act: 'CONFIRM', label: 'Siparişi Onayla' },
      { act: 'CANCEL', label: 'İptal Et' },
    ];
  if (st === 'CONFIRMED')
    return [
      { act: 'START_PREP', label: 'Hazırla' },
      { act: 'CANCEL', label: 'İptal Et' },
    ];
  if (st === 'IN_PROGRESS')
    return [
      { act: 'READY_HANDOFF', label: 'Paketle' },
      { act: 'CANCEL', label: 'İptal Et' },
    ];
  if (st === 'READY_FOR_HANDOFF')
    return [{ act: 'CANCEL', label: 'İptal Et' }];
  if (st === 'AWAITING_CASHIER_PAYMENT')
    return [
      { act: 'MARK_PAID', label: 'Ödemeyi Aldım' },
      { act: 'CANCEL', label: 'İptal Et' },
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
  for (const i of o.items) units += Number(i.quantity ?? i.qty) || 0;
  const lines = o.items.length;
  const addCount = Array.isArray(o.history)
    ? o.history.filter((h) => h?.note === 'IN_PLACE_ITEMS_ADDED').length
    : 0;
  const extra =
    o.channel === 'IN_PLACE' && addCount > 0 ? ` · ${addCount} ek` : '';
  return `${lines} kalem, ${units} adet${extra}`;
}

/** @param {object} it */
function orderItemQty(it) {
  return Number(it?.quantity ?? it?.qty) || 0;
}

/** @param {object} it */
function liveOrderItemLineHtml(it) {
  const qty = orderItemQty(it);
  const opt = orderItemOptionSelectionsText(it);
  const optHtml = opt ? `<span class="a-order-card__item-options">${esc(opt)}</span>` : '';
  return `<li><strong>${esc(String(qty))}×</strong><span>${esc(it?.name ?? 'Ürün')}</span>${optHtml}</li>`;
}

/** @param {object} item */
function additionItemLineHtml(item) {
  const qty = Number(item?.quantity) || 0;
  const opt = item?.optionsLine
    ? `<span class="a-order-card__item-options">${esc(item.optionsLine)}</span>`
    : '';
  return `<li><strong>${esc(String(qty))}×</strong><span>${esc(item?.name ?? 'Ürün')}</span>${opt}</li>`;
}

/** @param {object} h */
function additionEntryItemsHtml(h) {
  const items = h?.metadata?.addedItems;
  if (!Array.isArray(items) || !items.length) return '';
  return items.map((item) => additionItemLineHtml(item)).join('');
}

/** @param {object} o */
function pendingInPlaceAdditionsHtml(o) {
  const pending = pendingInPlaceAdditionEntries(o);
  if (!pending.length) return '';
  const rows = pending.map((h) => additionEntryItemsHtml(h)).filter(Boolean).join('');
  if (!rows) return '';
  return `<section class="a-order-card__pending-additions">
    <div class="a-order-card__pending-head">
      <span>Teslim bekleyen ekler</span>
      <strong>${esc(String(pending.length))} ek</strong>
    </div>
    <ul class="a-order-card__item-list">${rows}</ul>
  </section>`;
}

/** @param {object} o */
function liveOrderItemsHtml(o) {
  if (!Array.isArray(o.items) || !o.items.length) {
    return '<p class="a-muted a-order-card__items">Ürün bilgisi yok.</p>';
  }
  return `<ul class="a-order-card__item-list">${o.items.map((it) => liveOrderItemLineHtml(it)).join('')}</ul>`;
}

/** @param {object} o */
function liveOrderDeliveryHtml(o) {
  if (o.channel !== 'ONLINE') return '';
  const rec = o.deliveryRecipient;
  const addr = o.deliveryAddress;
  const recipientBits = [];
  if (rec && typeof rec === 'object') {
    const fullName = [rec.firstName, rec.lastName]
      .map((x) => String(x ?? '').trim())
      .filter(Boolean)
      .join(' ');
    if (fullName) recipientBits.push(fullName);
    if (rec.phoneE164) recipientBits.push(formatPhoneTrDisplay(String(rec.phoneE164)));
  }
  const addressBits = [];
  if (addr && typeof addr === 'object') {
    if (addr.label) addressBits.push(String(addr.label));
    if (addr.line1) addressBits.push(String(addr.line1));
    if (addr.line2) addressBits.push(String(addr.line2));
    const districtCity = [addr.district, addr.city]
      .map((x) => String(x ?? '').trim())
      .filter(Boolean)
      .join(' / ');
    if (districtCity) addressBits.push(districtCity);
  }
  if (!recipientBits.length && !addressBits.length) return '';
  return `<div class="a-order-card__delivery">
    ${recipientBits.length ? `<p><strong>Alıcı:</strong> ${esc(recipientBits.join(' · '))}</p>` : ''}
    ${addressBits.length ? `<p><strong>Adres:</strong> ${esc(addressBits.join(', '))}</p>` : ''}
  </div>`;
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
    showToast(e instanceof Error ? e.message : 'QR oluşturulamadı', 'error');
  }
}

/** Two explicit steps for irreversible QR regeneration. */
async function showQrRegenerateTwoStepDialog() {
  const first = await showConfirmDialog({
    title: 'QR yenileme',
    message: 'QR kodu ve menü bağlantısı yenilenecek. Daha önce yazdırılmış QR kodları artık çalışmaz.',
    confirmLabel: 'Devam et',
  });
  if (!first) return false;
  return showConfirmDialog({
    title: 'Son onay',
    message: 'QR ve masa bağlantısı kalıcı olarak değişecek. Bu işlem geri alınamaz.',
    confirmLabel: "QR'ı yenile",
    variant: 'danger',
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

/** @param {object} h */
function historyTimeMs(h) {
  const v = h?.at;
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** @param {object} o */
function inPlaceAdditionEntries(o) {
  if (o?.channel !== 'IN_PLACE' || !Array.isArray(o.history)) return [];
  return o.history.filter((h) => h?.note === 'IN_PLACE_ITEMS_ADDED');
}

/** @param {object} o */
function inPlaceAdditionCount(o) {
  return inPlaceAdditionEntries(o).length;
}

/** @param {object} o */
function orderAttentionTimeMs(o) {
  const addAt = inPlaceAdditionEntries(o).reduce(
    (mx, h) => Math.max(mx, historyTimeMs(h)),
    0,
  );
  return Math.max(orderTimeMs(o, 'createdAt'), addAt);
}

/** @param {object} o */
function pendingInPlaceAdditionEntries(o) {
  if (o?.channel !== 'IN_PLACE' || o?.status !== 'IN_PROGRESS') return [];
  const hist = Array.isArray(o.history) ? o.history : [];
  let lastDeliveredIdx = -1;
  hist.forEach((h, idx) => {
    if (
      h?.to === 'READY' ||
      h?.to === 'AWAITING_PAYMENT' ||
      h?.note === 'READY' ||
      h?.note === 'AWAIT_PAYMENT'
    ) {
      lastDeliveredIdx = idx;
    }
  });
  return hist
    .slice(lastDeliveredIdx + 1)
    .filter((h) => h?.note === 'IN_PLACE_ITEMS_ADDED');
}

/** @param {object} o */
function staffActionsList(o) {
  return o.channel === 'IN_PLACE'
    ? inPlaceActions(o.status)
    : onlineStaffActions(o.status);
}

/** @param {object} o */
function canCancelOrder(o) {
  if (isTerminalOrder(o)) return false;
  return isAdmin() || staffActionsList(o).some((a) => a.act === 'CANCEL');
}

/** @param {object} o */
function canAdminCompleteOrder(o) {
  return isAdmin() && !isTerminalOrder(o);
}

/**
 * Tek ana ileri adım (buton etiketinde durum adı yerine eylem var).
 * @param {object} o
 * @returns {{ kind: 'transition', act: string, actionLabel: string } | { kind: 'assign', actionLabel: string } | null}
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
        actionLabel: 'Hazırla',
      };
    if (st === 'IN_PROGRESS')
      return {
        kind: 'transition',
        act: 'READY',
        actionLabel: 'Masaya Teslim Ettim',
      };
    if (st === 'READY')
      return {
        kind: 'transition',
        act: 'AWAIT_PAYMENT',
        actionLabel: 'Ödemeyi Aldım',
      };
    if (st === 'AWAITING_PAYMENT')
      return {
        kind: 'transition',
        act: 'MARK_PAID',
        actionLabel: 'Ödemeyi Aldım',
      };
    return null;
  }
  if (st === 'PLACED')
    return {
      kind: 'transition',
      act: 'CONFIRM',
      actionLabel: 'Siparişi Onayla',
    };
  if (st === 'CONFIRMED')
    return {
      kind: 'transition',
      act: 'START_PREP',
      actionLabel: 'Hazırla',
    };
  if (st === 'IN_PROGRESS')
    return {
      kind: 'transition',
      act: 'READY_HANDOFF',
      actionLabel: 'Paketle',
    };
  if (st === 'READY_FOR_HANDOFF')
    return { kind: 'assign', actionLabel: 'Kuryeye Ata' };
  if (st === 'AWAITING_CASHIER_PAYMENT')
    return {
      kind: 'transition',
      act: 'MARK_PAID',
      actionLabel: 'Ödemeyi Aldım',
    };
  return null;
}

/** @param {object} o */
function liveOrderEmphasisLabel(o) {
  const step = primaryFlowStep(o);
  if (step) return step.actionLabel;
  if (o?.status === 'PAID') return 'Ödeme Alındı';
  if (o?.status === 'CANCELLED') return 'Reddedildi';
  return o?.channel === 'IN_PLACE'
    ? inPlaceStatusTr(o.status)
    : onlineStatusTr(o.status);
}

/** @param {object} o */
function cashierWorkState(o) {
  const st = o?.status;
  const isPosPayment = o?.collectionMethod === 'POS';
  if (o?.channel === 'IN_PLACE') {
    if (st === 'PLACED') {
      return {
        tone: 'action',
        priority: 0,
        label: 'Kasiyer aksiyonu',
        note: 'Masa siparişini hazırlamaya başla.',
      };
    }
    if (st === 'IN_PROGRESS') {
      return {
        tone: 'action',
        priority: 0,
        label: 'Kasiyer aksiyonu',
        note: 'Ürünleri masaya teslim et.',
      };
    }
    if (st === 'READY') {
      return {
        tone: 'payment',
        priority: 1,
        label: 'Ürün teslim edildi',
        note: 'Hazırlık bitti, sadece ödeme akışı kaldı.',
      };
    }
    if (st === 'AWAITING_PAYMENT') {
      return {
        tone: 'payment',
        priority: 1,
        label: 'Ödeme bekliyor',
        note: 'Masaya teslim edilmiş sipariş.',
      };
    }
  }

  if (st === 'PLACED') {
    return {
      tone: 'action',
      priority: 0,
      label: 'Kasiyer aksiyonu',
      note: 'Online siparişi onayla.',
    };
  }
  if (st === 'CONFIRMED') {
    return {
      tone: 'action',
      priority: 0,
      label: 'Kasiyer aksiyonu',
      note: 'Hazırlama sürecini başlat.',
    };
  }
  if (st === 'IN_PROGRESS') {
    return {
      tone: 'action',
      priority: 0,
      label: 'Kasiyer aksiyonu',
      note: 'Siparişi kuryeye teslim edilecek hale getir.',
    };
  }
  if (st === 'READY_FOR_HANDOFF') {
    return {
      tone: 'action',
      priority: 0,
      label: 'Kasiyer aksiyonu',
      note: 'Kurye seç ve teslimata aktar.',
    };
  }
  if (st === 'AWAITING_CASHIER_PAYMENT') {
    return {
      tone: 'payment',
      priority: 1,
      label: 'Ödeme bekliyor',
      note: isPosPayment
        ? 'POS tahsilatı yapıldı, kasiyer fişi onaylamalı.'
        : 'Teslimat tamamlandı, kasiyer ödemeyi kapatmalı.',
    };
  }
  if (st === 'ASSIGNED') {
    return {
      tone: 'passive',
      priority: 2,
      label: 'Kuryede',
      note: 'Ürün hazırlama veya kurye verme aksiyonu yok.',
    };
  }
  if (st === 'OUT_FOR_DELIVERY') {
    return {
      tone: 'passive',
      priority: 2,
      label: 'Yolda',
      note: 'Kurye teslimatı sürdürüyor.',
    };
  }
  if (st === 'DELIVERED') {
    return {
      tone: 'passive',
      priority: 2,
      label: 'Teslim edildi',
      note: 'Ürün aksiyonu tamamlandı.',
    };
  }
  return {
    tone: 'passive',
    priority: 2,
    label: 'Takip',
    note: 'Kasiyer için aktif ürün aksiyonu yok.',
  };
}

/** @param {object} o @returns {string} */
function orderFlowActionsInnerHtml(o) {
  const id = esc(idStr(o));
  const chEsc = esc(o.channel);
  const flow = [];
  const admin = [];
  const step = primaryFlowStep(o);
  const adminHasComplete = canAdminCompleteOrder(o);
  const markPaidLabel = o.collectionMethod === 'POS' ? 'Fiş aldım' : 'Ödemeyi Aldım';
  if (step?.kind === 'transition' && !(adminHasComplete && step.act === 'MARK_PAID')) {
    flow.push(
      buttonHtml({
        label: step.act === 'MARK_PAID' ? markPaidLabel : step.actionLabel,
        size: 'compact',
        classes: 'a-act',
        attrs: { 'data-id': id, 'data-ch': chEsc, 'data-act': step.act },
      }),
    );
  } else if (step?.kind === 'assign') {
    flow.push(
      `<select class="a-select a-courier-sel" data-id="${id}" aria-label="Kurye"><option value="">Kurye seç…</option></select>`,
    );
    flow.push(
      buttonHtml({
        label: step.actionLabel,
        size: 'compact',
        classes: 'a-assign',
        attrs: { 'data-id': id },
      }),
    );
  }
  if (adminHasComplete) {
    const completeLabel = step?.act === 'MARK_PAID' ? markPaidLabel : 'Siparişi Tamamla';
    admin.push(
      buttonHtml({
        label: completeLabel,
        variant: 'secondary',
        size: 'compact',
        icon: 'check-circle',
        classes: 'a-act',
        attrs: {
          'data-id': id,
          'data-ch': chEsc,
          'data-act': 'COMPLETE',
          'data-collection-method': o.collectionMethod ?? '',
        },
      }),
    );
  }
  if (canCancelOrder(o)) {
    admin.push(
      buttonHtml({
        label: 'İptal Et',
        variant: 'danger',
        size: 'compact',
        icon: 'x-circle',
        classes: 'a-act',
        attrs: { 'data-id': id, 'data-ch': chEsc, 'data-act': 'CANCEL' },
      }),
    );
  }
  const sections = [];
  if (flow.length) {
    sections.push(`<div class="a-order-card__flow">${flow.join('')}</div>`);
  }
  if (admin.length) {
    sections.push(
      `<div class="a-order-card__admin-actions"><span>Diğer işlemler</span>${admin.join('')}</div>`,
    );
  }
  return sections.join('');
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

/** @param {string} text */
async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

/** @param {string | undefined} iso */
function formatTimeTr(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('tr-TR', {
      hour: '2-digit',
      minute: '2-digit',
    });
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

/** @param {unknown[]} couriers */
function uniqueCouriersById(couriers) {
  const seen = new Set();
  return couriers.filter((c) => {
    const id = c?._id != null ? String(c._id) : '';
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** @param {object} o @returns {string} */
function liveOrderCardHtml(o) {
  const rawId = idStr(o);
  const id = esc(rawId);
  const shortId = id.length >= 8 ? id.slice(-8) : id;
  const ch = o.channel;
  const chLabel = esc(channelLabelTr(ch));
  const stRaw = esc(o.status);
  const stLabel = esc(liveOrderEmphasisLabel(o));
  const masa = ch === 'IN_PLACE' ? tableNumberCell(o) : '—';
  const itemsSummary = esc(orderItemsSummary(o));
  const itemsHtml = liveOrderItemsHtml(o);
  const deliveryHtml = liveOrderDeliveryHtml(o);
  const pendingAdditionsHtml = pendingInPlaceAdditionsHtml(o);
  const createdAt = esc(formatTimeTr(o.createdAt));
  const total = esc(formatTryFromKurus(o.totalKurus));
  const collectionMethod = o.collectionMethod
    ? `<span><small>Tahsilat</small><strong>${esc(o.collectionMethod === 'POS' ? 'POS' : 'Nakit')}</strong></span>`
    : '';
  const addDisp = latestInPlaceAdditionDisplay(o);
  const sonEk =
    ch === 'IN_PLACE' && addDisp.text
      ? `<p class="a-muted a-order-card__son" title="${esc(addDisp.title)}">${esc(addDisp.text)}</p>`
      : '';
  const actions = orderFlowActionsInnerHtml(o);
  const work = cashierWorkState(o);
  const workTone = esc(work.tone);
  const workLabel = esc(work.label);
  const workNote = esc(work.note);
  return `<article class="a-order-card a-order-card--${workTone}">
    <div class="a-order-card__head">
      <div>
        <span class="a-order-card__eyebrow">Sipariş</span>
        <div class="a-order-card__code-row">
          <code class="a-order-card__id">${shortId}</code>
          ${buttonHtml({
            label: 'Kopyala',
            variant: 'ghost',
            size: 'compact',
            icon: 'copy',
            classes: 'a-copy-order-id',
            attrs: { 'data-copy-order-id': rawId },
          })}
        </div>
      </div>
      <span class="a-order-card__status a-order-card__status--${workTone}" title="${stRaw}">${stLabel}</span>
    </div>
    <div class="a-order-card__work a-order-card__work--${workTone}">
      <span>${workLabel}</span>
      <p>${workNote}</p>
    </div>
    <div class="a-order-card__meta-grid">
      <span><small>Kanal</small><strong>${chLabel}</strong></span>
      <span><small>${ch === 'IN_PLACE' ? 'Masa' : 'Saat'}</small><strong>${ch === 'IN_PLACE' ? masa : createdAt}</strong></span>
      <span><small>Toplam</small><strong>${total}</strong></span>
      ${collectionMethod}
    </div>
    <p class="a-order-card__items"><strong>${itemsSummary}</strong></p>
    ${itemsHtml}
    ${pendingAdditionsHtml}
    ${deliveryHtml}
    ${sonEk}
    <div class="a-order-card__actions">${actions || '<span class="a-muted">İşlem yok</span>'}</div>
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
  return `<tr data-detail="${rawId}"><td><code>${shortId}</code></td><td><span class="a-badge">${chLabel}</span></td><td>${masa}</td><td>${itemsSummary}</td><td><span title="${stRaw}">${stLabel}</span></td><td class="a-muted">${when}</td><td><div class="a-table-actions">${buttonHtml({ label: 'Detay', variant: 'secondary', size: 'compact', icon: 'info', classes: 'a-history-detail-btn', attrs: { 'data-detail': rawId } })}</div></td></tr>`;
}

function stopOrdersRealtime() {
  if (stopOrdersWs) {
    stopOrdersWs();
    stopOrdersWs = null;
  }
}

/** @param {object[]} orders */
function makeStaffOrderAlertSnapshot(orders) {
  const next = new Map();
  orders.filter((o) => !isTerminalOrder(o)).forEach((o) => {
    next.set(idStr(o), { additionCount: inPlaceAdditionCount(o) });
  });
  return next;
}

/** @param {object[]} orders */
function rememberStaffOrderAlertSnapshot(orders) {
  staffOrderAlertSnapshot = makeStaffOrderAlertSnapshot(orders);
  staffOrderAlertSnapshotReady = true;
}

function playStaffOrderNotification() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.34);
    setTimeout(() => ctx.close().catch(() => {}), 650);
  } catch {
    /* Browser may block audio until the panel receives a user gesture. */
  }
}

/** @param {object[]} orders */
function notifyInterestingStaffOrderChanges(orders) {
  const next = makeStaffOrderAlertSnapshot(orders);
  if (!staffOrderAlertSnapshotReady) {
    staffOrderAlertSnapshot = next;
    staffOrderAlertSnapshotReady = true;
    return;
  }
  let hasNewOrder = false;
  let hasAddition = false;
  for (const [id, cur] of next.entries()) {
    const prev = staffOrderAlertSnapshot.get(id);
    if (!prev) {
      hasNewOrder = true;
      continue;
    }
    if (cur.additionCount > prev.additionCount) {
      hasAddition = true;
    }
  }
  staffOrderAlertSnapshot = next;
  if (!hasNewOrder && !hasAddition) return;
  playStaffOrderNotification();
  const msg = hasNewOrder && hasAddition
    ? 'Yeni sipariş ve masa eki geldi.'
    : hasNewOrder
      ? 'Yeni sipariş geldi.'
      : 'Masaya yeni ek geldi.';
  showToast(msg, 'success');
}

function applyView(nextView) {
  historyUi.detailOrderId = null;
  if (nextView !== 'courier-history') courierHistoryUi.detailOrderId = null;
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

async function renderLogin(root) {
  root.innerHTML = `
    <div class="a-login">
      <aside class="a-login-hero">
        <div class="a-brand a-h1--flush"><span class="a-brand-logo" aria-hidden="true"></span>DAINO</div>
        <p class="a-login-kicker">Authority Panel</p>
        <h1 class="a-login-title">Operasyon merkezine güvenli giriş</h1>
        <p class="a-login-copy">Personel hesabı için SMS doğrulama, sahip hesabı için yetkili şifre kontrolü kullanılır.</p>
        <div class="a-login-security-grid" aria-label="Güvenlik özellikleri">
          <span><i class="ph ph-shield-check" aria-hidden="true"></i> Rol bazlı erişim</span>
          <span><i class="ph ph-device-mobile" aria-hidden="true"></i> Tek kullanımlık kod</span>
          <span><i class="ph ph-timer" aria-hidden="true"></i> Süreli oturum</span>
          <span><i class="ph ph-lock-key" aria-hidden="true"></i> Sahip şifresi</span>
        </div>
      </aside>
      <div class="a-login-panel">
        <div class="a-login-steps" id="login-steps" aria-label="Giriş aşamaları">
          <span class="active" data-step="credentials">1. Bilgiler</span>
          <span data-step="verify">2. Doğrulama</span>
        </div>
        <div id="login-pane"></div>
        <p class="a-error" id="login-err"></p>
      </div>
    </div>`;

  const pane = root.querySelector('#login-pane');
  const err = root.querySelector('#login-err');
  const steps = root.querySelector('#login-steps');
  const state = {
    method: 'staff',
    step: 'credentials',
    phone: '',
    password: '',
    code: '',
  };

  function syncCredentialsFromDom() {
    state.phone = pane.querySelector('#auth-phone')?.value.trim() ?? state.phone;
    state.password = pane.querySelector('#auth-password')?.value ?? state.password;
  }

  function setError(message = '') {
    err.textContent = message;
  }

  function enterApp(tokens, nextView) {
    setToken(tokens.accessToken, tokens.refreshToken);
    screen = 'app';
    view = nextView;
    render();
  }

  function updateSteps() {
    steps?.querySelectorAll('[data-step]').forEach((step) => {
      const isCredentials = step.dataset.step === 'credentials';
      step.classList.toggle('active', state.step === step.dataset.step);
      step.classList.toggle('done', state.step === 'verify' && isCredentials);
    });
  }

  function credentialHtml() {
    const isOwner = state.method === 'owner';
    return `
      <div class="a-login-pane-head">
        <p class="a-login-kicker">Giriş yöntemi</p>
        <h2>Hesap türünü seç</h2>
        <p class="a-muted">Telefon numaranı gir; personel hesabında ikinci adımda SMS kodunu doğrulayacaksın.</p>
      </div>
      <div class="a-login-methods" role="group" aria-label="Giriş yöntemi">
        <button type="button" class="a-login-method ${state.method === 'staff' ? 'active' : ''}" data-method="staff">
          <i class="ph ph-identification-card" aria-hidden="true"></i>
          <strong>Personel 2FA</strong>
          <span>SMS kodu ile iki aşamalı giriş</span>
        </button>
        <button type="button" class="a-login-method ${isOwner ? 'active' : ''}" data-method="owner">
          <i class="ph ph-crown-simple" aria-hidden="true"></i>
          <strong>Sahip</strong>
          <span>Telefon ve yönetici şifresi</span>
        </button>
      </div>
      <label class="a-field-label" for="auth-phone">Yetkili telefon</label>
      <input class="a-input a-login-field" id="auth-phone" placeholder="+905…" autocomplete="tel" inputmode="tel" value="${esc(state.phone)}" />
      <div class="a-login-owner-fields ${isOwner ? '' : 'is-hidden'}">
        <label class="a-field-label" for="auth-password">Sahip şifresi</label>
        <input class="a-input a-login-field" id="auth-password" type="password" autocomplete="current-password" placeholder="En az 8 karakter" value="${esc(state.password)}" />
      </div>
      <div class="a-login-actions">
        ${buttonHtml({ label: isOwner ? 'Sahip girişi' : 'Kod gönder', id: 'auth-next', icon: isOwner ? 'sign-in' : 'paper-plane-tilt' })}
      </div>
      <div class="a-login-hints">
        <span><i class="ph ph-key" aria-hidden="true"></i> Kodu kimseyle paylaşma</span>
        <span><i class="ph ph-bell-ringing" aria-hidden="true"></i> SMS bildirimi aktif olmalı</span>
      </div>`;
  }

  function codeDigitsHtml() {
    return Array.from({ length: 6 }, (_, index) => {
      const value = state.code[index] ?? '';
      return `<input class="a-login-otp-input" data-otp-index="${index}" maxlength="1" inputmode="numeric" autocomplete="${index === 0 ? 'one-time-code' : 'off'}" aria-label="Kod hanesi ${index + 1}" value="${esc(value)}" />`;
    }).join('');
  }

  function keypadHtml() {
    return ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Temizle', '0', 'Sil']
      .map((key) => `<button type="button" class="a-login-key" data-key="${esc(key)}">${esc(key)}</button>`)
      .join('');
  }

  function verifyHtml() {
    const maskedPhone = state.phone || '+905…';
    return `
      <div class="a-login-pane-head">
        <p class="a-login-kicker">SMS doğrulama</p>
        <h2>6 haneli kodu gir</h2>
        <p class="a-muted">${esc(maskedPhone)} numarasına gönderilen tek kullanımlık kodu kullan.</p>
      </div>
      <div class="a-login-otp" id="otp-digits">${codeDigitsHtml()}</div>
      <div class="a-login-keypad" aria-label="Kod tuş takımı">${keypadHtml()}</div>
      <div class="a-login-actions a-login-actions--split">
        ${buttonHtml({ label: 'Geri dön', id: 'auth-back', variant: 'secondary' })}
        ${buttonHtml({ label: 'Kodu doğrula', id: 'auth-verify', icon: 'shield-check' })}
      </div>
      <div class="a-login-subactions">
        <button type="button" id="auth-resend">Kodu tekrar gönder</button>
        <span>Deneme hakkını korumak için kodu dikkatli gir.</span>
      </div>`;
  }

  function setCode(nextCode) {
    state.code = nextCode.replace(/\D/g, '').slice(0, 6);
    const box = pane.querySelector('#otp-digits');
    if (box) box.innerHTML = codeDigitsHtml();
    bindOtpInputs();
    const nextInput =
      pane.querySelector(`[data-otp-index="${Math.min(state.code.length, 5)}"]`) ??
      pane.querySelector('[data-otp-index="5"]');
    if (nextInput instanceof HTMLElement) nextInput.focus();
  }

  function bindOtpInputs() {
    pane.querySelectorAll('.a-login-otp-input').forEach((input) => {
      input.addEventListener('input', () => {
        const digits = [...pane.querySelectorAll('.a-login-otp-input')]
          .map((el) => el.value.replace(/\D/g, '').slice(-1))
          .join('');
        setCode(digits);
      });
      input.addEventListener('paste', (event) => {
        const text = event.clipboardData?.getData('text') ?? '';
        if (text) {
          event.preventDefault();
          setCode(text);
        }
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Backspace' && !input.value) {
          setCode(state.code.slice(0, -1));
        }
      });
    });
  }

  async function requestStaffCode(btn) {
    err.textContent = '';
    syncCredentialsFromDom();
    if (!state.phone) {
      setError('Telefon numarası girin.');
      return;
    }
    await withButtonBusy(btn, 'Kod gönderiliyor…', async () => {
      try {
        await api('/auth/otp/request', {
          method: 'POST',
          body: JSON.stringify({ phone: state.phone }),
        });
        state.step = 'verify';
        state.code = '';
        showToast('Doğrulama kodu gönderildi.', 'success');
        renderPane();
      } catch (e) {
        setError(errorMessage(e));
      }
    });
  }

  async function verifyStaffCode(btn) {
    setError('');
    if (state.code.length !== 6) {
      setError('6 haneli doğrulama kodunu girin.');
      return;
    }
    await withButtonBusy(btn, 'Doğrulanıyor…', async () => {
      try {
        const tokens = await api('/auth/otp/verify', {
          method: 'POST',
          body: JSON.stringify({
            phone: state.phone,
            code: state.code,
          }),
        });
        enterApp(tokens, isCourier() ? 'courier' : 'orders');
      } catch (e) {
        setError(errorMessage(e));
      }
    });
  }

  async function ownerLogin(btn) {
    setError('');
    syncCredentialsFromDom();
    if (!state.phone || !state.password) {
      setError('Telefon ve şifre alanlarını doldurun.');
      return;
    }
    await withButtonBusy(btn, 'Giriş yapılıyor…', async () => {
      try {
        const tokens = await api('/auth/owner/login', {
          method: 'POST',
          body: JSON.stringify({
            phone: state.phone,
            password: state.password,
          }),
        });
        enterApp(tokens, 'orders');
      } catch (e) {
        setError(errorMessage(e));
      }
    });
  }

  function bindCredentials() {
    pane.onkeydown = null;
    pane.querySelectorAll('[data-method]').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncCredentialsFromDom();
        state.method = btn.dataset.method === 'owner' ? 'owner' : 'staff';
        setError('');
        renderPane();
      });
    });
    pane.querySelector('#auth-next')?.addEventListener('click', (event) => {
      const btn = /** @type {HTMLElement} */ (event.currentTarget);
      if (state.method === 'owner') ownerLogin(btn);
      else requestStaffCode(btn);
    });
    pane.querySelector('#auth-phone')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') pane.querySelector('#auth-next')?.click();
    });
    pane.querySelector('#auth-password')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') pane.querySelector('#auth-next')?.click();
    });
  }

  function bindVerify() {
    bindOtpInputs();
    pane.querySelectorAll('[data-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key ?? '';
        if (key === 'Sil') setCode(state.code.slice(0, -1));
        else if (key === 'Temizle') setCode('');
        else setCode(`${state.code}${key}`);
      });
    });
    pane.querySelector('#auth-back')?.addEventListener('click', () => {
      state.step = 'credentials';
      setError('');
      renderPane();
    });
    pane.querySelector('#auth-resend')?.addEventListener('click', (event) => {
      requestStaffCode(/** @type {HTMLElement} */ (event.currentTarget));
    });
    pane.querySelector('#auth-verify')?.addEventListener('click', (event) => {
      verifyStaffCode(/** @type {HTMLElement} */ (event.currentTarget));
    });
    pane.onkeydown = (event) => {
      if (event.key === 'Enter') pane.querySelector('#auth-verify')?.click();
    };
  }

  function renderPane() {
    updateSteps();
    pane.innerHTML = state.step === 'verify' ? verifyHtml() : credentialHtml();
    if (state.step === 'verify') {
      bindVerify();
      /** @type {HTMLElement | null} */ (pane.querySelector('[data-otp-index="0"]'))?.focus();
    } else {
      bindCredentials();
      /** @type {HTMLElement | null} */ (pane.querySelector('#auth-phone'))?.focus();
    }
  }

  renderPane();
}

function navButton(label, key) {
  const active = view === key ? 'active' : '';
  const icons = {
    orders: 'receipt',
    history: 'clock-counter-clockwise',
    shop: 'storefront',
    staff: 'users-three',
    customers: 'user-list',
    tables: 'qr-code',
    menu: 'fork-knife',
    courier: 'scooter',
    'courier-history': 'clock-counter-clockwise',
  };
  const icon = icons[key] ? `<i class="ph ph-${esc(icons[key])}" aria-hidden="true"></i>` : '';
  return `<button type="button" class="a-nav-btn ${active}" data-view="${key}">${icon}<span>${esc(label)}</span></button>`;
}

async function renderOrders(container) {
  let orders = [];
  try {
    orders = await fetchOrdersStaff();
  } catch (e) {
    container.innerHTML = `<p class="a-error">${esc(e.message)}</p>`;
    return;
  }
  rememberStaffOrderAlertSnapshot(orders);

  const live = orders.filter((o) => !isTerminalOrder(o));
  live.sort((a, b) => {
    const priorityDiff = cashierWorkState(a).priority - cashierWorkState(b).priority;
    return priorityDiff || orderAttentionTimeMs(b) - orderAttentionTimeMs(a);
  });

  const cardsHtml =
    live.length > 0
      ? `<div class="a-order-cards">${live.map((o) => liveOrderCardHtml(o)).join('')}</div>`
      : `<div class="a-card a-muted">Aktif sipariş yok.</div>`;

  container.innerHTML = `
    <h1 class="a-h1">CANLI SİPARİŞLER</h1>
    ${cardsHtml}`;

  const histLink = container.querySelector('#a-goto-history');
  if (histLink) {
    histLink.onclick = (ev) => {
      ev.preventDefault();
      applyView('history');
    };
  }

  container.querySelectorAll('.a-copy-order-id').forEach((btn) => {
    btn.onclick = async () => {
      const orderId = btn.dataset.copyOrderId;
      if (!orderId) return;
      try {
        await copyTextToClipboard(orderId);
        showToast('Sipariş kodu kopyalandı.', 'success');
      } catch {
        showToast('Sipariş kodu kopyalanamadı.', 'error');
      }
    };
  });

  let couriers = [];
  try {
    couriers = await api('/admin/couriers');
  } catch {
    couriers = [];
  }
  const uniqueCouriers = uniqueCouriersById(couriers);
  container.querySelectorAll('.a-courier-sel').forEach((sel) => {
    [...sel.querySelectorAll('option:not([value=""])')].forEach((o) => o.remove());
    uniqueCouriers.forEach((c) => {
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
      const collectionMethod = btn.dataset.collectionMethod;
      if (act === 'CANCEL') {
        const ok = await showConfirmDialog({
          title: 'Sipariş iptal edilsin mi?',
          message: 'Bu sipariş iptal durumuna alınacak. İşlem geçmişte görünecek.',
          confirmLabel: 'İptal et',
          variant: 'danger',
        });
        if (!ok) return;
      }
      if (act === 'COMPLETE') {
        const isPosPayment = collectionMethod === 'POS';
        const ok = await showConfirmDialog({
          title: isPosPayment ? 'Fiş alındı mı?' : 'Sipariş tamamlansın mı?',
          message: isPosPayment
            ? 'Bu POS tahsilatı onaylanacak ve sipariş geçmişte görünecek.'
            : 'Bu sipariş ödendi/tamamlandı durumuna alınacak ve geçmişte görünecek.',
          confirmLabel: isPosPayment ? 'Fiş aldım' : 'Tamamla',
        });
        if (!ok) return;
      }
      const path =
        ch === 'IN_PLACE'
          ? `/orders/${id}/in-place/transition`
          : `/orders/${id}/online/transition`;
      await withButtonBusy(/** @type {HTMLElement} */ (btn), 'İşleniyor…', async () => {
        try {
          await api(path, {
            method: 'POST',
            body: JSON.stringify({ action: act }),
          });
          showToast('Sipariş güncellendi.', 'success');
          await rerenderStaffOrderContainers(container);
        } catch (e) {
          showToast(errorMessage(e), 'error');
        }
      });
    };
  });

  container.querySelectorAll('.a-assign').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const sel = container.querySelector(`.a-courier-sel[data-id="${id}"]`);
      const courierUserId = sel?.value;
      if (!courierUserId) {
        showToast('Kurye seçin.', 'error');
        sel?.focus();
        return;
      }
      await withButtonBusy(/** @type {HTMLElement} */ (btn), 'Atanıyor…', async () => {
        try {
          await api(`/orders/${id}/assign-courier`, {
            method: 'POST',
            body: JSON.stringify({ courierUserId }),
          });
          showToast('Kurye atandı.', 'success');
          await rerenderStaffOrderContainers(container);
        } catch (e) {
          showToast(errorMessage(e), 'error');
        }
      });
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
  const tableNumberTrim = historyUi.tableNumber.trim();
  if (tableNumberTrim) params.set('tableNumber', tableNumberTrim);

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
    <div class="a-list-page">
      <h1 class="a-h1">Geçmiş siparişler</h1>
      ${histNote}
      <form class="a-history-toolbar" id="hist-search-form" role="search">
        <input class="a-input a-history-q" type="search" id="hist-q" name="q" placeholder="Sipariş no, ürün veya adres ara…" value="${esc(historyUi.q)}" autocomplete="off" />
        <input class="a-input a-history-table" type="number" min="0" step="1" inputmode="numeric" id="hist-table-number" name="tableNumber" placeholder="Masa no" value="${esc(historyUi.tableNumber)}" autocomplete="off" />
        ${buttonHtml({ label: 'Ara', id: 'hist-submit', type: 'submit', icon: 'magnifying-glass' })}
      </form>
      <p class="a-muted" id="hist-range">${esc(`${fromN}–${toN} / ${total} kayıt`)}</p>
      <div class="a-table-wrap">
        <table class="a-table">
          <thead><tr><th>ID</th><th>Kanal</th><th>Masa</th><th>Ürünler</th><th>Durum</th><th>Güncellendi</th><th></th></tr></thead>
          <tbody id="hist-tbody">${histRows || emptyRowHtml('Kayıt yok', emptyColspan)}</tbody>
        </table>
      </div>
      <div class="a-history-pager">
        ${buttonHtml({ label: 'Önceki', id: 'hist-prev', variant: 'secondary', icon: 'caret-left', disabled: !hasPrev })}
        <span class="a-muted">Sayfa ${esc(String(page + 1))}</span>
        ${buttonHtml({ label: 'Sonraki', id: 'hist-next', variant: 'secondary', icon: 'caret-right', disabled: !hasNext })}
      </div>
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
    const tableInput = /** @type {HTMLInputElement | null} */ (
      container.querySelector('#hist-table-number')
    );
    historyUi.q = input?.value?.trim() ?? '';
    historyUi.tableNumber = tableInput?.value?.trim() ?? '';
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
    ? `<div class="a-muted a-option-note">${esc(opt)}</div>`
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

/**
 * @param {HTMLElement} container
 * @param {string} orderId
 * @param {{ detailState?: { detailOrderId: string | null }, backView?: string, backLabel?: string }} [opts]
 */
async function renderOrderHistoryDetail(container, orderId, opts = {}) {
  const detailState = opts.detailState ?? historyUi;
  const backView = opts.backView ?? 'history';
  const backLabel = opts.backLabel ?? 'Geçmiş listesine dön';
  /** @type {object | null} */
  let o = null;
  try {
    o = await api(`/orders/${encodeURIComponent(orderId)}`);
  } catch (e) {
    container.innerHTML = `
      <p class="a-error">${esc(e.message)}</p>
      <p>${buttonHtml({ label: 'Listeye dön', id: 'hist-det-fallback', variant: 'secondary', icon: 'arrow-left' })}</p>`;
    container.querySelector('#hist-det-fallback')?.addEventListener('click', () => {
      detailState.detailOrderId = null;
      view = backView;
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
      recipientBlock = `<div class="a-card a-order-detail-block"><h2 class="a-h2 a-h2--flush">Teslim alıcı</h2>
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
      addrBlock = `<div class="a-card a-order-detail-block"><h2 class="a-h2 a-h2--flush">Teslimat adresi</h2>${rows.join('')}</div>`;
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
    <p class="a-muted">${buttonHtml({ label: backLabel, id: 'hist-det-back', variant: 'secondary', icon: 'arrow-left' })}</p>
    <div class="a-card a-order-detail-block">
      <div class="a-row">
        <div>
          <p class="a-muted a-tight">Sipariş</p>
          <p class="a-detail-id"><code>${esc(rawId)}</code></p>
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
    <div class="a-table-wrap">
      <table class="a-table">
        <thead><tr><th>Ürün</th><th>Adet</th><th>Birim</th><th>Satır</th></tr></thead>
        <tbody>${itemsRows || emptyRowHtml('Ürün yok', 4)}</tbody>
      </table>
    </div>
    <h2 class="a-h2">Durum geçmişi</h2>
    <div class="a-table-wrap">
      <table class="a-table">
        <thead><tr><th>Zaman</th><th>Geçiş</th><th>Not</th></tr></thead>
        <tbody>${histRows || emptyRowHtml('Durum geçmişi yok', 3)}</tbody>
      </table>
    </div>`;

  container.querySelector('#hist-det-back')?.addEventListener('click', () => {
    detailState.detailOrderId = null;
    view = backView;
    renderMain().catch(console.error);
  });
}

/** @param {object} o */
function courierRecipientLine(o) {
  const rec = o?.deliveryRecipient;
  if (!rec || typeof rec !== 'object') return 'Alıcı bilgisi yok';
  const fullName = [rec.firstName, rec.lastName]
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .join(' ');
  const phone = rec.phoneE164 ? formatPhoneTrDisplay(String(rec.phoneE164)) : '';
  return [fullName, phone].filter(Boolean).join(' · ') || 'Alıcı bilgisi yok';
}

/** @param {object} o */
function courierPhoneActionHtml(o) {
  const phone = o?.deliveryRecipient?.phoneE164;
  if (!phone) return '';
  return `<a class="a-btn a-btn--secondary a-courier-phone" href="tel:${esc(String(phone))}"><i class="ph ph-phone" aria-hidden="true"></i><span>Ara</span></a>`;
}

/** @param {object} o */
function courierAddressMapQuery(o) {
  const addr = o?.deliveryAddress;
  if (!addr || typeof addr !== 'object') return '';
  const lat = Number(addr.lat);
  const lng = Number(addr.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return `${lat},${lng}`;
  return [addr.formattedAddress, addr.line1, addr.line2, addr.district, addr.city, addr.country]
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

/** @param {object} o */
function courierAddressMapUrl(o) {
  const query = courierAddressMapQuery(o);
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : '';
}

/** @param {object} o */
function courierMapInlineLinkHtml(o) {
  const href = courierAddressMapUrl(o);
  if (!href) return '';
  return `<a class="a-courier-map-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">GOOGLE MAPS'TE AÇ</a>`;
}

/** @param {object} o */
function courierMapPreviewHtml(o) {
  const query = courierAddressMapQuery(o);
  if (!query) {
    return `<div class="a-courier-map-preview a-courier-map-preview--empty" role="status">${iconHtml('map-pin')}<span>Konum bulunamadı</span></div>`;
  }
  const src = `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
  return `<div class="a-courier-map-preview"><iframe title="Teslimat adresi harita önizlemesi" src="${esc(src)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>`;
}

/** @param {object} o */
function courierAddressLine(o) {
  const addr = o?.deliveryAddress;
  if (!addr || typeof addr !== 'object') return 'Teslimat adresi yok';
  const districtCity = [addr.district, addr.city]
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .join(' / ');
  return [addr.label, addr.line1, addr.line2, districtCity]
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .join(', ') || 'Teslimat adresi yok';
}

/** @param {object} o */
function courierTaskHtml(o) {
  const rawId = idStr(o);
  const shortId = rawId.length >= 8 ? rawId.slice(-8) : rawId;
  const status = o?.status;
  const isPickup = status === 'ASSIGNED';
  const isDelivery = status === 'OUT_FOR_DELIVERY';
  const itemsHtml = liveOrderItemsHtml(o);
  const recipient = esc(courierRecipientLine(o));
  const address = esc(courierAddressLine(o));
  const mapPreview = courierMapPreviewHtml(o);
  const mapLink = courierMapInlineLinkHtml(o);
  const mapLinkRow = mapLink ? `<div class="a-courier-map-link-row">${mapLink}</div>` : '';
  const phoneAction = courierPhoneActionHtml(o);
  const total = esc(formatTryFromKurus(o?.totalKurus));
  const createdAt = esc(formatDateTimeTr(o?.createdAt));
  const stateHtml = isPickup
    ? `<section class="a-courier-state-card">
        <span class="a-courier-step__kicker">Şu anki görev</span>
        <h2>Ürünleri teslim al</h2>
        <p class="a-muted">Dükkandan aşağıdaki ürünleri eksiksiz aldığını kontrol et. Hazır olduğunda yola çık.</p>
        <div class="a-courier-step__panel">
          ${itemsHtml}
          <div class="a-courier-step__actions">
            ${buttonHtml({ label: 'Yola çıktım', id: 'c-start', icon: 'navigation-arrow' })}
          </div>
        </div>
      </section>`
    : isDelivery
      ? `<section class="a-courier-state-card">
          <span class="a-courier-step__kicker">Şu anki görev</span>
          <h2>Adrese teslim et</h2>
          <p class="a-muted">Adrese ulaştığında müşteriyi ara, ödemeyi seç ve teslimi onayla.</p>
          <div class="a-courier-step__panel">
            <div class="a-courier-destination">
              <p><strong>Alıcı</strong><span>${recipient}</span></p>
              <div class="a-courier-address-block">
                <strong>Adres</strong>
                <span>${address}</span>
                ${mapLinkRow}
                ${mapPreview}
              </div>
            </div>
            <div class="a-courier-step__actions">
              ${phoneAction}
              ${buttonHtml({ label: 'Teslim ettim', id: 'c-deliver', variant: 'secondary', icon: 'check-circle' })}
            </div>
          </div>
        </section>`
      : `<section class="a-courier-state-card">
          <span class="a-courier-step__kicker">Takip</span>
          <h2>Görev güncelleniyor</h2>
          <p class="a-muted">Bu teslimat için aktif kurye aksiyonu bulunamadı.</p>
        </section>`;

  return `<article class="a-courier-mission">
    <div class="a-courier-hero">
      <span class="a-order-card__eyebrow">Aktif görev</span>
      <div class="a-row">
        <h1 class="a-h1">Teslimat görevi</h1>
        <span class="a-badge">${esc(onlineStatusTr(status))}</span>
      </div>
      <p class="a-muted">Sipariş <code>${esc(shortId)}</code> · ${total} · ${createdAt}</p>
    </div>
    ${stateHtml}
  </article>`;
}

/** @param {string} total */
function showCourierDeliverDialog(total) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = document.createElement('div');
    overlay.className = 'a-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'a-courier-deliver-title');
    overlay.innerHTML = `
      <div class="a-dialog">
        <h2 class="a-dialog-title" id="a-courier-deliver-title">Teslimatı tamamla</h2>
        <p class="a-dialog-msg">Tahsilat yöntemini seçin.</p>
        <div class="a-courier-deliver-total">
          <span>Toplam</span>
          <strong>${esc(total)}</strong>
        </div>
        <div class="a-courier-deliver-options">
          ${buttonHtml({ label: 'POS', variant: 'secondary', icon: 'credit-card', attrs: { 'data-method': 'POS' } })}
          ${buttonHtml({ label: 'Nakit', variant: 'secondary', icon: 'money', attrs: { 'data-method': 'CASH' } })}
        </div>
        <div class="a-dialog-actions">
          ${buttonHtml({ label: 'Vazgeç', variant: 'secondary', attrs: { 'data-act': 'cancel' } })}
        </div>
      </div>`;

    const finish = (value) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      previousFocus?.focus();
      resolve(value);
    };

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
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
      if (e.target === overlay) finish(null);
    });
    overlay.querySelector('[data-act="cancel"]')?.addEventListener('click', () => finish(null));
    overlay.querySelectorAll('[data-method]').forEach((btn) => {
      btn.addEventListener('click', () => finish(/** @type {HTMLButtonElement} */ (btn).dataset.method ?? null));
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => /** @type {HTMLElement | null} */ (overlay.querySelector('[data-method]'))?.focus());
  });
}

async function renderCourier(container) {
  let cur = null;
  try {
    cur = await api('/courier/orders/current');
  } catch (e) {
    container.innerHTML = `<p class="a-error">${esc(e.message)}</p>`;
    return;
  }

  container.innerHTML = cur
    ? courierTaskHtml(cur)
    : `<h1 class="a-h1">Görevler</h1>
       <div class="a-card a-empty-state">Atanmış aktif teslimat yok. Yeni görev geldiğinde bu ekran otomatik güncellenir.</div>`;

  const id = cur?._id;
  const q = (method, body) =>
    api(`/courier/orders/${id}${method}`, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });

  container.querySelector('#c-start')?.addEventListener('click', async () => {
    if (!id) return;
    try {
      await withButtonBusy(container.querySelector('#c-start'), 'Güncelleniyor…', async () => {
        await q('/start-delivery');
        showToast('Teslimat yola çıktı olarak işaretlendi.', 'success');
        await renderCourier(container);
      });
    } catch (e) {
      showToast(errorMessage(e), 'error');
    }
  });

  const deliver = async () => {
    if (!id) return;
    const collectionMethod = await showCourierDeliverDialog(formatTryFromKurus(cur?.totalKurus));
    if (!collectionMethod) return;
    try {
      await withButtonBusy(container.querySelector('#c-deliver'), 'Tamamlanıyor…', async () => {
        await q('/deliver', { collectionMethod });
        showToast('Teslimat tamamlandı.', 'success');
        await renderCourier(container);
      });
    } catch (e) {
      showToast(errorMessage(e), 'error');
    }
  };

  container.querySelector('#c-deliver')?.addEventListener('click', deliver);
}

/** @param {object} o */
function courierHistoryRowHtml(o) {
  const rawId = idStr(o);
  const shortId = rawId.length >= 8 ? rawId.slice(-8) : rawId;
  const updatedAt = formatDateTimeTr(o?.updatedAt);
  const recipient = courierRecipientLine(o);
  return `<tr>
    <td><code>${esc(shortId)}</code></td>
    <td>${esc(recipient)}</td>
    <td class="a-muted">${esc(updatedAt)}</td>
    <td><div class="a-table-actions">${buttonHtml({ label: 'İncele', variant: 'secondary', size: 'compact', icon: 'info', classes: 'a-courier-history-detail', attrs: { 'data-detail': rawId } })}</div></td>
  </tr>`;
}

async function renderCourierHistory(container) {
  if (courierHistoryUi.detailOrderId) {
    await renderOrderHistoryDetail(container, courierHistoryUi.detailOrderId, {
      detailState: courierHistoryUi,
      backView: 'courier-history',
      backLabel: 'Kurye geçmişine dön',
    });
    return;
  }

  const params = new URLSearchParams({
    page: String(courierHistoryUi.page),
    pageSize: String(courierHistoryUi.pageSize),
  });

  /** @type {{ items?: object[], total?: number, page?: number, pageSize?: number } | object[]} */
  let body;
  try {
    body = await api(`/courier/orders/history?${params.toString()}`);
  } catch (e) {
    container.innerHTML = `<p class="a-error">${esc(e.message)}</p>`;
    return;
  }

  const items = Array.isArray(body) ? body : Array.isArray(body.items) ? body.items : [];
  const total = Array.isArray(body) ? items.length : Number(body.total) || 0;
  const page = Array.isArray(body) ? courierHistoryUi.page : Number(body.page) || 0;
  const pageSize = Array.isArray(body) ? courierHistoryUi.pageSize : Number(body.pageSize) || courierHistoryUi.pageSize;
  courierHistoryUi.page = page;
  courierHistoryUi.pageSize = pageSize;

  const fromN = total === 0 ? 0 : page * pageSize + 1;
  const toN = Math.min(total, page * pageSize + items.length);
  const hasPrev = page > 0;
  const hasNext = page * pageSize + items.length < total;
  const rows = items.map((o) => courierHistoryRowHtml(o)).join('');

  container.innerHTML = `
    <div class="a-list-page">
      <h1 class="a-h1">Geçmiş görevler</h1>
      <p class="a-muted">Tamamlanan veya iptal edilen teslimatların sayfalı listesi.</p>
      <p class="a-muted">${esc(`${fromN}–${toN} / ${total} kayıt`)}</p>
      <div class="a-table-wrap">
        <table class="a-table">
          <thead><tr><th>ID</th><th>Alıcı</th><th>Tarih</th><th></th></tr></thead>
          <tbody>${rows || emptyRowHtml('Kayıt yok', 4)}</tbody>
        </table>
      </div>
      <div class="a-history-pager">
        ${buttonHtml({ label: 'Önceki', id: 'courier-hist-prev', variant: 'secondary', icon: 'caret-left', disabled: !hasPrev })}
        <span class="a-muted">Sayfa ${esc(String(page + 1))}</span>
        ${buttonHtml({ label: 'Sonraki', id: 'courier-hist-next', variant: 'secondary', icon: 'caret-right', disabled: !hasNext })}
      </div>
    </div>`;

  container.querySelector('#courier-hist-prev')?.addEventListener('click', () => {
    if (courierHistoryUi.page <= 0) return;
    courierHistoryUi.page -= 1;
    renderMain().catch(console.error);
  });

  container.querySelector('#courier-hist-next')?.addEventListener('click', () => {
    if (!hasNext) return;
    courierHistoryUi.page += 1;
    renderMain().catch(console.error);
  });

  container.querySelectorAll('.a-courier-history-detail').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = /** @type {HTMLButtonElement} */ (btn).dataset.detail;
      if (!id) return;
      courierHistoryUi.detailOrderId = id;
      renderMain().catch(console.error);
    });
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
  const serviceEnabled = Boolean(s.serviceEnabled);
  container.innerHTML = `
    <h1 class="a-h1">Mağaza</h1>
    <div class="a-card a-shop-service-card">
      <div class="a-shop-service-copy">
        <span class="a-shop-service-title">Masadan sipariş (servis)</span>
        <p class="a-muted">Kapalıyken QR menü self-servis mesajı gösterir; masa siparişi API ile engellenir.</p>
      </div>
      <div class="a-shop-service-control">
        <span class="a-service-status a-service-status--${serviceEnabled ? 'on' : 'off'}" aria-label="Servis ${serviceEnabled ? 'açık' : 'kapalı'}">
          <span class="a-service-status__light" aria-hidden="true"></span>
        </span>
        ${buttonHtml({
          label: serviceEnabled ? 'Kapat' : 'Aç',
          id: 'svc-toggle',
          variant: serviceEnabled ? 'danger' : 'primary',
          classes: 'a-shop-service-toggle',
          attrs: { 'aria-label': `Servisi ${serviceEnabled ? 'kapat' : 'aç'}` },
        })}
      </div>
    </div>`;
  container.querySelector('#svc-toggle').onclick = async () => {
    await withButtonBusy(container.querySelector('#svc-toggle'), 'Güncelleniyor…', async () => {
      try {
        await api('/shop/settings', {
          method: 'PATCH',
          body: JSON.stringify({ serviceEnabled: !serviceEnabled }),
        });
        showToast('Mağaza ayarı güncellendi.', 'success');
        await renderShop(container);
      } catch (e) {
        showToast(errorMessage(e), 'error');
      }
    });
  };
}

async function renderStaffNewPage(container) {
  const onBack = () => {
    staffUi = { ...staffUi, sub: 'list' };
    renderMain().catch(console.error);
  };

  container.innerHTML = `
    <div class="a-page-head">
      <div>
        <p class="a-muted">${buttonHtml({ label: 'Personel listesi', variant: 'secondary', size: 'compact', icon: 'arrow-left', classes: 'a-staff-back' })}</p>
        <h1 class="a-h1 a-h1--flush">Yeni personel</h1>
        <p class="a-muted">Panel erişimi için personel bilgilerini ve rolünü tanımlayın.</p>
      </div>
    </div>

    <section class="a-card a-form-section">
      <h2 class="a-h2 a-h2--flush">Personel bilgileri</h2>
      <label class="a-field-label">İsim</label>
      <input class="a-input" id="st-fn" placeholder="Ad" />
      <label class="a-field-label">Soyisim</label>
      <input class="a-input" id="st-ln" placeholder="Soyad" />
      <label class="a-field-label">Telefon</label>
      <input class="a-input" id="st-phone" placeholder="+905…" />
      <label class="a-field-label">Rol</label>
      <select class="a-select" id="st-role">
        <option value="CASHIER">${roleLabelTr('CASHIER')}</option>
        <option value="COURIER">${roleLabelTr('COURIER')}</option>
        <option value="ADMIN">${roleLabelTr('ADMIN')}</option>
      </select>
    </section>

    <div class="a-form-actions">
      ${buttonHtml({ label: 'Vazgeç', variant: 'secondary', classes: 'a-staff-back', icon: 'x' })}
      ${buttonHtml({ label: 'Personeli ekle', id: 'st-add', icon: 'user-plus' })}
    </div>`;

  container.querySelectorAll('.a-staff-back').forEach((b) => {
    b.addEventListener('click', onBack);
  });

  container.querySelector('#st-add')?.addEventListener('click', async () => {
    const firstName = /** @type {HTMLInputElement} */ (container.querySelector('#st-fn')).value.trim();
    const lastName = /** @type {HTMLInputElement} */ (container.querySelector('#st-ln')).value.trim();
    if (firstName.length < 2 || lastName.length < 2) {
      showToast('İsim ve soyisim en az 2 karakter olmalı.', 'error');
      /** @type {HTMLElement | null} */ (container.querySelector(firstName.length < 2 ? '#st-fn' : '#st-ln'))?.focus();
      return;
    }
    await withButtonBusy(container.querySelector('#st-add'), 'Ekleniyor…', async () => {
      try {
        await api('/admin/staff', {
          method: 'POST',
          body: JSON.stringify({
            phone: /** @type {HTMLInputElement} */ (container.querySelector('#st-phone')).value.trim(),
            role: /** @type {HTMLSelectElement} */ (container.querySelector('#st-role')).value,
            firstName,
            lastName,
          }),
        });
        showToast('Personel eklendi.', 'success');
        staffUi = { ...staffUi, sub: 'list', page: 0 };
        renderMain().catch(console.error);
      } catch (e) {
        showToast(errorMessage(e), 'error');
      }
    });
  });
}

async function renderStaff(container) {
  if (staffUi.sub === 'new') {
    await renderStaffNewPage(container);
    return;
  }

  const params = new URLSearchParams({
    page: String(staffUi.page),
    pageSize: String(staffUi.pageSize),
  });
  let paged;
  try {
    paged = parsePaged(await api(`/admin/staff?${params.toString()}`), staffUi.pageSize);
  } catch (e) {
    container.innerHTML = `<p class="a-error">${esc(e.message)}</p>`;
    return;
  }
  staffUi.page = paged.page;
  staffUi.pageSize = paged.pageSize;
  const maxPage =
    paged.total === 0 ? 0 : Math.max(0, Math.ceil(paged.total / staffUi.pageSize) - 1);
  if (staffUi.page > maxPage && maxPage >= 0) {
    staffUi.page = maxPage;
    return renderStaff(container);
  }
  const list = paged.items;
  const staffFrom = paged.total === 0 ? 0 : staffUi.page * staffUi.pageSize + 1;
  const staffTo = Math.min(paged.total, staffUi.page * staffUi.pageSize + list.length);
  const staffHasPrev = staffUi.page > 0;
  const staffHasNext = staffUi.page * staffUi.pageSize + list.length < paged.total;
  container.innerHTML = `
    <div class="a-page-head">
      <div>
        <h1 class="a-h1 a-h1--flush">Personel</h1>
      </div>
      <div class="a-page-head__actions">
        ${buttonHtml({ label: 'Yeni personel', id: 'st-goto-new', icon: 'user-plus' })}
      </div>
    </div>
    <p class="a-muted">${esc(`${staffFrom}–${staffTo} / ${paged.total} kayıt`)}</p>
    <div class="a-table-wrap a-staff-table"><table class="a-table">
      <thead><tr><th>Ad Soyad</th><th>Telefon</th><th>Rol</th><th></th></tr></thead>
      <tbody id="st-tbody">
        ${list.length ? list
          .map((u) => {
            const id = String(u._id ?? u.id ?? '');
            const fn = u.firstName ?? '';
            const ln = u.lastName ?? '';
            const display =
              [fn, ln].filter(Boolean).join(' ') || '—';
            return `<tr data-staff-id="${esc(id)}">
          <td class="st-name-cell">
            <span class="st-name-view">${esc(display)}</span>
            <span class="st-name-edit">
              <input class="a-input st-edit-fn" value="${esc(fn)}" placeholder="Ad" />
              <input class="a-input st-edit-ln a-login-field" value="${esc(ln)}" placeholder="Soyad" />
            </span>
          </td>
          <td>${esc(u.phoneE164)}</td>
          <td>${esc(roleLabelTr(u.role))}</td>
          <td class="st-actions-cell">
            <div class="a-table-actions">
              ${buttonHtml({ label: 'Düzenle', variant: 'secondary', size: 'compact', icon: 'pencil-simple', classes: 'st-edit' })}
              ${buttonHtml({ label: 'Kaydet', size: 'compact', icon: 'check', classes: 'st-save' })}
              ${buttonHtml({ label: 'İptal', variant: 'secondary', size: 'compact', icon: 'x', classes: 'st-cancel' })}
              ${buttonHtml({ label: 'Sil', variant: 'danger', size: 'compact', icon: 'trash', classes: 'a-del', attrs: { 'data-id': id } })}
            </div>
          </td>
        </tr>`;
          })
          .join('') : emptyRowHtml('Personel kaydı yok', 4)}
      </tbody>
    </table></div>
    <div class="a-history-pager">
      ${buttonHtml({ label: 'Önceki', id: 'st-prev', variant: 'secondary', icon: 'caret-left', disabled: !staffHasPrev })}
      <span class="a-muted">Sayfa ${esc(String(staffUi.page + 1))}</span>
      ${buttonHtml({ label: 'Sonraki', id: 'st-next', variant: 'secondary', icon: 'caret-right', disabled: !staffHasNext })}
    </div>`;

  const tbody = container.querySelector('#st-tbody');
  container.querySelector('#st-goto-new')?.addEventListener('click', () => {
    staffUi = { ...staffUi, sub: 'new' };
    renderMain().catch(console.error);
  });
  tbody.addEventListener('click', async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const tr = t.closest('tr[data-staff-id]');
    if (!tr) return;
    const staffId = tr.dataset.staffId;

    if (t.classList.contains('st-edit')) {
      tr.classList.add('is-editing');
      /** @type {HTMLElement | null} */ (tr.querySelector('.st-edit-fn'))?.focus();
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
        showToast('İsim ve soyisim en az 2 karakter olmalı.', 'error');
        /** @type {HTMLElement | null} */ (tr.querySelector(firstName.length < 2 ? '.st-edit-fn' : '.st-edit-ln'))?.focus();
        return;
      }
      await withButtonBusy(t, 'Kaydediliyor…', async () => {
        try {
          await api(`/admin/staff/${staffId}`, {
            method: 'PATCH',
            body: JSON.stringify({ firstName, lastName }),
          });
          showToast('Personel güncellendi.', 'success');
          await renderStaff(container);
        } catch (err) {
          showToast(errorMessage(err), 'error');
        }
      });
    }
  });

  container.querySelector('#st-prev')?.addEventListener('click', () => {
    if (staffUi.page <= 0) return;
    staffUi.page -= 1;
    renderStaff(container).catch(console.error);
  });
  container.querySelector('#st-next')?.addEventListener('click', () => {
    if (!staffHasNext) return;
    staffUi.page += 1;
    renderStaff(container).catch(console.error);
  });
  container.querySelectorAll('.a-del').forEach((b) => {
    b.onclick = async () => {
      const ok = await showConfirmDialog({
        title: 'Personel silinsin mi?',
        message: 'Bu personel panel erişimini kaybedecek.',
        confirmLabel: 'Sil',
        variant: 'danger',
      });
      if (!ok) return;
      await withButtonBusy(/** @type {HTMLElement} */ (b), 'Siliniyor…', async () => {
        try {
          await api(`/admin/staff/${b.dataset.id}`, { method: 'DELETE' });
          showToast('Personel silindi.', 'success');
          await renderStaff(container);
        } catch (e) {
          showToast(errorMessage(e), 'error');
        }
      });
    };
  });
}

async function renderCustomers(container) {
  const params = new URLSearchParams({
    page: String(customerUi.page),
    pageSize: String(customerUi.pageSize),
  });
  const qTrim = customerUi.q.trim();
  if (qTrim) params.set('q', qTrim);
  let paged;
  try {
    paged = parsePaged(await api(`/admin/customers?${params.toString()}`), customerUi.pageSize);
  } catch (e) {
    container.innerHTML = `<p class="a-error">${esc(e.message)}</p>`;
    return;
  }
  customerUi.page = paged.page;
  customerUi.pageSize = paged.pageSize;
  const maxPage =
    paged.total === 0 ? 0 : Math.max(0, Math.ceil(paged.total / customerUi.pageSize) - 1);
  if (customerUi.page > maxPage && maxPage >= 0) {
    customerUi.page = maxPage;
    return renderCustomers(container);
  }
  const list = paged.items;
  const customerFrom = paged.total === 0 ? 0 : customerUi.page * customerUi.pageSize + 1;
  const customerTo = Math.min(paged.total, customerUi.page * customerUi.pageSize + list.length);
  const customerHasPrev = customerUi.page > 0;
  const customerHasNext = customerUi.page * customerUi.pageSize + list.length < paged.total;
  const rows = list
    .map((u) => {
      const id = String(u._id ?? u.id ?? '');
      const fn = u.firstName ?? '';
      const ln = u.lastName ?? '';
      const display = [fn, ln].filter(Boolean).join(' ') || '—';
      const active = u.isActive !== false;
      const addressCount = Array.isArray(u.addresses) ? u.addresses.length : 0;
      const created = u.createdAt ? formatDateTimeTr(u.createdAt) : '—';
      const action = active
        ? buttonHtml({
            label: 'Engelle',
            variant: 'danger',
            size: 'compact',
            icon: 'prohibit',
            classes: 'a-customer-status',
            attrs: { 'data-id': id, 'data-active': 'false' },
          })
        : buttonHtml({
            label: 'Aktif et',
            variant: 'secondary',
            size: 'compact',
            icon: 'check-circle',
            classes: 'a-customer-status',
            attrs: { 'data-id': id, 'data-active': 'true' },
          });
      return `<tr>
        <td>${esc(display)}</td>
        <td>${esc(formatPhoneTrDisplay(u.phoneE164))}</td>
        <td>${esc(String(addressCount))}</td>
        <td class="a-muted">${esc(created)}</td>
        <td><span class="a-badge">${active ? 'Aktif' : 'Engelli'}</span></td>
        <td><div class="a-table-actions">${action}</div></td>
      </tr>`;
    })
    .join('');

  container.innerHTML = `
    <div class="a-list-page">
      <h1 class="a-h1">Müşteriler</h1>
      <form class="a-history-toolbar" id="cust-search-form" role="search">
        <input class="a-input a-history-q" type="search" id="cust-q" name="q" placeholder="Ad, soyad veya telefon ara…" value="${esc(customerUi.q)}" autocomplete="off" />
        ${buttonHtml({ label: 'Ara', id: 'cust-submit', type: 'submit', icon: 'magnifying-glass' })}
      </form>
      <p class="a-muted">${esc(`${customerFrom}–${customerTo} / ${paged.total} kayıt`)}</p>
      <div class="a-table-wrap"><table class="a-table">
        <thead><tr><th>Ad Soyad</th><th>Telefon</th><th>Adres</th><th>Kayıt</th><th>Durum</th><th></th></tr></thead>
        <tbody>${rows || emptyRowHtml('Müşteri kaydı yok', 6)}</tbody>
      </table></div>
      <div class="a-history-pager">
        ${buttonHtml({ label: 'Önceki', id: 'cust-prev', variant: 'secondary', icon: 'caret-left', disabled: !customerHasPrev })}
        <span class="a-muted">Sayfa ${esc(String(customerUi.page + 1))}</span>
        ${buttonHtml({ label: 'Sonraki', id: 'cust-next', variant: 'secondary', icon: 'caret-right', disabled: !customerHasNext })}
      </div>
    </div>`;

  container.querySelector('#cust-search-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = /** @type {HTMLInputElement | null} */ (
      container.querySelector('#cust-q')
    );
    customerUi.q = input?.value?.trim() ?? '';
    customerUi.page = 0;
    renderCustomers(container).catch(console.error);
  });
  container.querySelector('#cust-prev')?.addEventListener('click', () => {
    if (customerUi.page <= 0) return;
    customerUi.page -= 1;
    renderCustomers(container).catch(console.error);
  });
  container.querySelector('#cust-next')?.addEventListener('click', () => {
    if (!customerHasNext) return;
    customerUi.page += 1;
    renderCustomers(container).catch(console.error);
  });
  container.querySelectorAll('.a-customer-status').forEach((b) => {
    b.addEventListener('click', async () => {
      const nextActive = b.dataset.active === 'true';
      const ok = await showConfirmDialog({
        title: nextActive ? 'Müşteri aktif edilsin mi?' : 'Müşteri engellensin mi?',
        message: nextActive
          ? 'Bu müşteri tekrar giriş yapıp sipariş verebilecek.'
          : 'Bu müşteri giriş yapamayacak ve sipariş veremeyecek.',
        confirmLabel: nextActive ? 'Aktif et' : 'Engelle',
        variant: nextActive ? 'primary' : 'danger',
      });
      if (!ok) return;
      await withButtonBusy(/** @type {HTMLElement} */ (b), 'Güncelleniyor…', async () => {
        try {
          await api(`/admin/customers/${b.dataset.id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ isActive: nextActive }),
          });
          showToast(nextActive ? 'Müşteri aktif edildi.' : 'Müşteri engellendi.', 'success');
          await renderCustomers(container);
        } catch (e) {
          showToast(errorMessage(e), 'error');
        }
      });
    });
  });
}

async function renderTableNewPage(container) {
  const onBack = () => {
    tablesUi = { ...tablesUi, sub: 'list' };
    renderMain().catch(console.error);
  };

  container.innerHTML = `
    <div class="a-page-head">
      <div>
        <p class="a-muted">${buttonHtml({ label: 'Masa listesi', variant: 'secondary', size: 'compact', icon: 'arrow-left', classes: 'a-table-back' })}</p>
        <h1 class="a-h1 a-h1--flush">Yeni masa</h1>
        <p class="a-muted">Masa numarası ve isteğe bağlı etiket tanımlayın; QR bağlantısı otomatik oluşturulur.</p>
      </div>
    </div>

    <section class="a-card a-form-section">
      <h2 class="a-h2 a-h2--flush">Masa bilgileri</h2>
      <label class="a-field-label">Masa numarası (0 değil)</label>
      <input class="a-input a-field-narrow" type="number" id="tb-num" min="1" placeholder="No" />
      <label class="a-field-label">Etiket <span class="a-muted">(opsiyonel)</span></label>
      <input class="a-input" id="tb-label" placeholder="Örn. Bahçe" />
    </section>

    <div class="a-form-actions">
      ${buttonHtml({ label: 'Vazgeç', variant: 'secondary', classes: 'a-table-back', icon: 'x' })}
      ${buttonHtml({ label: 'Masayı oluştur', id: 'tb-add', icon: 'plus-circle' })}
    </div>`;

  container.querySelectorAll('.a-table-back').forEach((b) => {
    b.addEventListener('click', onBack);
  });

  container.querySelector('#tb-add')?.addEventListener('click', async () => {
    const number = Number(/** @type {HTMLInputElement} */ (container.querySelector('#tb-num')).value);
    const label = /** @type {HTMLInputElement} */ (container.querySelector('#tb-label')).value.trim();
    if (!Number.isFinite(number) || number <= 0) {
      showToast('Geçerli bir masa numarası girin.', 'error');
      /** @type {HTMLElement | null} */ (container.querySelector('#tb-num'))?.focus();
      return;
    }
    await withButtonBusy(container.querySelector('#tb-add'), 'Oluşturuluyor…', async () => {
      try {
        await api('/admin/tables', {
          method: 'POST',
          body: JSON.stringify({ number, label: label || undefined }),
        });
        showToast('Masa oluşturuldu.', 'success');
        tablesUi = { ...tablesUi, sub: 'list', page: 0 };
        renderMain().catch(console.error);
      } catch (e) {
        showToast(errorMessage(e), 'error');
      }
    });
  });
}

async function renderTables(container) {
  if (tablesUi.sub === 'new') {
    await renderTableNewPage(container);
    return;
  }

  const params = new URLSearchParams({
    page: String(tablesUi.page),
    pageSize: String(tablesUi.pageSize),
  });
  let paged;
  try {
    paged = parsePaged(await api(`/admin/tables?${params.toString()}`), tablesUi.pageSize);
  } catch (e) {
    container.innerHTML = `<p class="a-error">${esc(e.message)}</p>`;
    return;
  }
  tablesUi.page = paged.page;
  tablesUi.pageSize = paged.pageSize;
  const maxPage =
    paged.total === 0 ? 0 : Math.max(0, Math.ceil(paged.total / tablesUi.pageSize) - 1);
  if (tablesUi.page > maxPage && maxPage >= 0) {
    tablesUi.page = maxPage;
    return renderTables(container);
  }
  const list = paged.items;
  const tablesFrom = paged.total === 0 ? 0 : tablesUi.page * tablesUi.pageSize + 1;
  const tablesTo = Math.min(paged.total, tablesUi.page * tablesUi.pageSize + list.length);
  const tablesHasPrev = tablesUi.page > 0;
  const tablesHasNext = tablesUi.page * tablesUi.pageSize + list.length < paged.total;
  container.innerHTML = `
    <div class="a-page-head">
      <div>
        <h1 class="a-h1 a-h1--flush">Masalar</h1>
      </div>
      <div class="a-page-head__actions">
        ${buttonHtml({ label: 'Yeni masa', id: 'tb-goto-new', icon: 'plus-circle' })}
      </div>
    </div>
    <p class="a-muted">${esc(`${tablesFrom}–${tablesTo} / ${paged.total} kayıt`)}</p>
    <div class="a-table-wrap"><table class="a-table">
      <thead><tr><th>No</th><th>Slug</th><th>URL</th><th>QR</th><th></th></tr></thead>
      <tbody>
        ${list.length ? list
          .map(
            (t) => `<tr>
          <td>${esc(t.number)}</td>
          <td><code>${esc(t.publicSlug?.slice(0, 12))}…</code></td>
          <td class="a-cell-truncate"><a href="${esc(t.menuUrl)}" target="_blank" rel="noopener">${esc(t.menuUrl)}</a></td>
          <td class="a-qr-cell">${buttonHtml({ label: 'Görseli indir', variant: 'secondary', size: 'compact', icon: 'download-simple', classes: 'a-dlqr', attrs: { 'data-menu-url': t.menuUrl, 'data-num': String(t.number) } })}</td>
          <td>
            <div class="a-table-actions">
              ${t.isSystem ? '<span class="a-muted">sistem</span>' : `${buttonHtml({ label: 'QR yenile', variant: 'secondary', size: 'compact', icon: 'arrows-clockwise', classes: 'a-regqr', attrs: { 'data-id': String(t._id) } })}
              ${buttonHtml({ label: 'Sil', variant: 'danger', size: 'compact', icon: 'trash', classes: 'a-delt', attrs: { 'data-id': String(t._id) } })}`}
            </div>
          </td>
        </tr>`,
          )
          .join('') : emptyRowHtml('Masa kaydı yok', 5)}
      </tbody>
    </table></div>
    <div class="a-history-pager">
      ${buttonHtml({ label: 'Önceki', id: 'tb-prev', variant: 'secondary', icon: 'caret-left', disabled: !tablesHasPrev })}
      <span class="a-muted">Sayfa ${esc(String(tablesUi.page + 1))}</span>
      ${buttonHtml({ label: 'Sonraki', id: 'tb-next', variant: 'secondary', icon: 'caret-right', disabled: !tablesHasNext })}
    </div>`;

  container.querySelector('#tb-goto-new')?.addEventListener('click', () => {
    tablesUi = { ...tablesUi, sub: 'new' };
    renderMain().catch(console.error);
  });
  container.querySelectorAll('.a-dlqr').forEach((b) => {
    b.onclick = () => {
      const menuUrl = b.dataset.menuUrl;
      if (!menuUrl) return;
      void downloadTableQrPng(menuUrl, b.dataset.num ?? '');
    };
  });
  container.querySelector('#tb-prev')?.addEventListener('click', () => {
    if (tablesUi.page <= 0) return;
    tablesUi.page -= 1;
    renderTables(container).catch(console.error);
  });
  container.querySelector('#tb-next')?.addEventListener('click', () => {
    if (!tablesHasNext) return;
    tablesUi.page += 1;
    renderTables(container).catch(console.error);
  });
  container.querySelectorAll('.a-regqr').forEach((b) => {
    b.onclick = async () => {
      const ok = await showQrRegenerateTwoStepDialog();
      if (!ok) return;
      await withButtonBusy(/** @type {HTMLElement} */ (b), 'Yenileniyor…', async () => {
        try {
          await api(`/admin/tables/${b.dataset.id}/regenerate-qr`, {
            method: 'POST',
          });
          showToast('QR yenilendi.', 'success');
          await renderTables(container);
        } catch (e) {
          showToast(errorMessage(e), 'error');
        }
      });
    };
  });
  container.querySelectorAll('.a-delt').forEach((b) => {
    b.onclick = async () => {
      const ok = await showConfirmDialog({
        title: 'Masa silinsin mi?',
        message: 'Bu masa ve bağlantısı panelden kaldırılacak.',
        confirmLabel: 'Sil',
        variant: 'danger',
      });
      if (!ok) return;
      await withButtonBusy(/** @type {HTMLElement} */ (b), 'Siliniyor…', async () => {
        try {
          await api(`/admin/tables/${b.dataset.id}`, { method: 'DELETE' });
          showToast('Masa silindi.', 'success');
          await renderTables(container);
        } catch (e) {
          showToast(errorMessage(e), 'error');
        }
      });
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
      buttonHtml,
      emptyRowHtml,
      errorMessage,
      showConfirmDialog,
      showToast,
      withButtonBusy,
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
      buttonHtml,
      errorMessage,
      showToast,
      withButtonBusy,
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
      buttonHtml,
      errorMessage,
      showToast,
      withButtonBusy,
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
      buttonHtml,
      errorMessage,
      showToast,
      withButtonBusy,
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
      buttonHtml,
      errorMessage,
      showToast,
      withButtonBusy,
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
  else if (view === 'courier-history' && isCourier()) await renderCourierHistory(main);
  else if (view === 'courier' && !isCourier()) {
    view = 'orders';
    await renderMain();
  } else if (view === 'courier-history' && !isCourier()) {
    view = 'orders';
    await renderMain();
  } else if (view === 'shop' && isCashierPlus()) await renderShop(main);
  else if (view === 'staff' && isAdmin()) await renderStaff(main);
  else if (view === 'customers' && isAdmin()) await renderCustomers(main);
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
  stopOrdersRealtime();
  if (isCourier()) view = 'courier';
  const r = role();
  const sideNav = isCourier()
    ? `${navButton('Görevler', 'courier')}
       ${navButton('Geçmiş', 'courier-history')}`
    : `${navButton('Siparişler', 'orders')}
       ${navButton('Geçmiş', 'history')}
       ${isCashierPlus() ? navButton('Mağaza', 'shop') : ''}
       ${isAdmin() ? navButton('Personel', 'staff') + navButton('Müşteriler', 'customers') + navButton('Masalar', 'tables') + navButton('Menü', 'menu') : ''}`;

  root.innerHTML = `
    <div class="a-layout">
      <aside class="a-side" id="a-side" aria-label="Authority menüsü">
        <div class="a-brand"><span class="a-brand-logo" aria-hidden="true"></span>DAINO</div>
        <p class="a-muted a-role-note">${esc(roleLabelTr(r))}</p>
        ${sideNav}
        <button type="button" class="a-nav-btn a-logout" data-logout><i class="ph ph-sign-out" aria-hidden="true"></i><span>Çıkış</span></button>
      </aside>
      <button type="button" class="a-side-scrim" id="a-side-scrim" aria-label="Menüyü kapat"></button>
      <div class="a-content-shell">
        <div class="a-mnav" id="a-mnav"></div>
        <div class="a-main" id="a-main"></div>
      </div>
    </div>`;

  const layout = root.querySelector('.a-layout');
  const menuToggle = buttonHtml({
    label: 'Menü',
    variant: 'secondary',
    icon: 'list',
    classes: 'a-mnav__toggle',
    attrs: {
      id: 'a-side-toggle',
      'aria-controls': 'a-side',
      'aria-expanded': 'false',
    },
  });
  const mobileLogout = buttonHtml({
    label: 'Çıkış',
    variant: 'secondary',
    icon: 'sign-out',
    classes: 'a-mnav__logout',
    attrs: { 'data-logout': true },
  });
  const mnav = root.querySelector('#a-mnav');
  mnav.innerHTML = `${menuToggle}${mobileLogout}`;
  const sideToggle = root.querySelector('#a-side-toggle');
  const setSideOpen = (open) => {
    layout.classList.toggle('a-layout--side-open', open);
    sideToggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  sideToggle?.addEventListener('click', () => setSideOpen(!layout.classList.contains('a-layout--side-open')));
  root.querySelector('#a-side-scrim')?.addEventListener('click', () => setSideOpen(false));
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setSideOpen(false);
  });
  root.querySelectorAll('[data-view]').forEach((b) => {
    b.onclick = () => {
      setSideOpen(false);
      applyView(b.dataset.view);
    };
  });
  const logout = () => {
    setToken(null);
    screen = 'login';
    stopOrdersRealtime();
    render();
  };
  root.querySelectorAll('[data-logout]').forEach((b) => {
    b.addEventListener('click', logout);
  });

  renderMain()
    .then(() => {
      stopOrdersWs = connectOrdersStaffRealtime({
        onOrdersPush: async () => {
          if (
            screen === 'app' &&
            (view === 'orders' || view === 'history' || view === 'courier' || view === 'courier-history')
          ) {
            try {
              notifyInterestingStaffOrderChanges(await fetchOrdersStaff());
            } catch {
              /* Render below will surface fetch errors in the active view. */
            }
            renderMain().catch(console.error);
          }
        },
      });
    })
    .catch(console.error);
}

function render() {
  const root = document.getElementById('root');
  const hasSession = Boolean(getToken() || getRefreshToken());
  screen = hasSession ? 'app' : 'login';
  if (screen === 'login') {
    stopOrdersRealtime();
    renderLogin(root);
  } else {
    renderApp(root);
  }
}

render();
