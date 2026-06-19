import { api } from '../../api.js';
import { idStr, catPath } from '../helpers.js';

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

/**
 * @param {HTMLElement} container
 * @param {object} ctx
 * @param {(s: string) => string} ctx.esc
 * @param {(opts: any) => string} ctx.buttonHtml
 * @param {(message: string, colspan: number) => string} ctx.emptyRowHtml
 * @param {(value: unknown) => string} ctx.errorMessage
 * @param {(opts: any) => Promise<unknown>} ctx.showConfirmDialog
 * @param {(message: string, tone?: 'success' | 'error' | 'info') => void} ctx.showToast
 * @param {(btn: HTMLElement | null | undefined, label: string, fn: () => Promise<unknown>) => Promise<unknown>} ctx.withButtonBusy
 * @param {object} ctx.listUi
 * @param {number} ctx.listUi.catPage
 * @param {number} ctx.listUi.catPageSize
 * @param {string} ctx.listUi.catQ
 * @param {number} ctx.listUi.prodPage
 * @param {number} ctx.listUi.prodPageSize
 * @param {string} ctx.listUi.prodQ
 * @param {() => void} ctx.refresh
 * @param {() => void} ctx.onNewCategory
 * @param {() => void} ctx.onNewProduct
 * @param {(id: string) => void} ctx.onEditCategory
 * @param {(id: string) => void} ctx.onEditProduct
 */
export async function renderMenuList(container, ctx) {
  const {
    esc,
    buttonHtml,
    emptyRowHtml,
    errorMessage,
    showConfirmDialog,
    showToast,
    withButtonBusy,
    listUi,
    refresh,
    onNewCategory,
    onNewProduct,
    onEditCategory,
    onEditProduct,
  } = ctx;

  let catsForPath = [];
  try {
    catsForPath = await api('/admin/menu/categories');
  } catch (e) {
    container.innerHTML = `<p class="a-error">${esc(e.message)}</p>`;
    return;
  }
  if (!Array.isArray(catsForPath)) catsForPath = [];

  const catParams = new URLSearchParams({
    page: String(listUi.catPage),
    pageSize: String(listUi.catPageSize),
  });
  const catQTrim = listUi.catQ.trim();
  if (catQTrim) catParams.set('q', catQTrim);

  const prodParams = new URLSearchParams({
    page: String(listUi.prodPage),
    pageSize: String(listUi.prodPageSize),
  });
  const prodQTrim = listUi.prodQ.trim();
  if (prodQTrim) prodParams.set('q', prodQTrim);

  /** @type {unknown} */
  let catBody;
  /** @type {unknown} */
  let prodBody;
  try {
    [catBody, prodBody] = await Promise.all([
      api(`/admin/menu/categories?${catParams.toString()}`),
      api(`/admin/menu/products?${prodParams.toString()}`),
    ]);
  } catch (e) {
    container.innerHTML = `<p class="a-error">${esc(e.message)}</p>`;
    return;
  }

  const catPaged = parsePaged(catBody, listUi.catPageSize);
  const prodPaged = parsePaged(prodBody, listUi.prodPageSize);

  listUi.catPage = catPaged.page;
  listUi.catPageSize = catPaged.pageSize;
  listUi.prodPage = prodPaged.page;
  listUi.prodPageSize = prodPaged.pageSize;

  const maxCatPage =
    catPaged.total === 0 ? 0 : Math.max(0, Math.ceil(catPaged.total / listUi.catPageSize) - 1);
  if (listUi.catPage > maxCatPage && maxCatPage >= 0) {
    listUi.catPage = maxCatPage;
    return renderMenuList(container, ctx);
  }
  const maxProdPage =
    prodPaged.total === 0 ? 0 : Math.max(0, Math.ceil(prodPaged.total / listUi.prodPageSize) - 1);
  if (listUi.prodPage > maxProdPage && maxProdPage >= 0) {
    listUi.prodPage = maxProdPage;
    return renderMenuList(container, ctx);
  }

  const catsPage = catPaged.items;
  const prodsPage = prodPaged.items;
  const catTotal = catPaged.total;
  const prodTotal = prodPaged.total;

  const catsSorted = [...catsPage].sort((a, b) =>
    catPath(a, catsForPath).localeCompare(catPath(b, catsForPath), 'tr'),
  );

  const catRows = catsSorted
    .map((c) => {
      const id = esc(idStr(c));
      const thumb = c.imageUrl
        ? `<img src="${esc(c.imageUrl)}" alt="" class="a-menu-thumb" />`
        : '<span class="a-muted">—</span>';
      const active = c.isActive !== false;
      return `<tr>
        <td>${esc(catPath(c, catsForPath))}</td>
        <td class="a-cell-thumb">${thumb}</td>
        <td>${c.sortIndex ?? 0}</td>
        <td>${active ? 'aktif' : 'pasif'}</td>
        <td>
          <div class="a-table-actions">
            ${buttonHtml({ label: 'Düzenle', variant: 'secondary', size: 'compact', icon: 'pencil-simple', classes: 'a-menu-edit-cat', attrs: { 'data-id': id } })}
            ${buttonHtml({ label: 'Sil', variant: 'danger', size: 'compact', icon: 'trash', classes: 'a-menu-del-cat', attrs: { 'data-id': id } })}
          </div>
        </td>
      </tr>`;
    })
    .join('');

  const prodRows = [...prodsPage]
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'tr'))
    .map((p) => {
      const cat = catsForPath.find((c) => idStr(c) === idStr(p.categoryId));
      const cname = cat ? catPath(cat, catsForPath) : '—';
      const pid = esc(idStr(p));
      const avail = p.isAvailable !== false;
      const pthumb = p.images?.[0]?.url
        ? `<img src="${esc(p.images[0].url)}" alt="" class="a-menu-thumb" />`
        : '<span class="a-muted">—</span>';
      return `<tr>
        <td class="a-cell-thumb">${pthumb}</td>
        <td>${esc(p.name)}</td>
        <td class="a-muted a-cell-truncate">${esc(cname)}</td>
        <td>${(Number(p.priceKurus) / 100).toFixed(2)} ₺</td>
        <td>${avail ? 'satışta' : 'kapalı'}</td>
        <td>
          <div class="a-table-actions">
            ${buttonHtml({ label: 'Düzenle', variant: 'secondary', size: 'compact', icon: 'pencil-simple', classes: 'a-menu-edit-p', attrs: { 'data-id': pid } })}
            ${buttonHtml({ label: avail ? 'Kapat' : 'Aç', variant: 'secondary', size: 'compact', icon: avail ? 'eye-slash' : 'eye', classes: 'a-menu-toggle-p', attrs: { 'data-id': pid, 'data-avail': avail ? '1' : '0' } })}
            ${buttonHtml({ label: 'Sil', variant: 'danger', size: 'compact', icon: 'trash', classes: 'a-menu-del-p', attrs: { 'data-id': pid } })}
          </div>
        </td>
      </tr>`;
    })
    .join('');

  const catFrom = catTotal === 0 ? 0 : listUi.catPage * listUi.catPageSize + 1;
  const catTo = Math.min(catTotal, listUi.catPage * listUi.catPageSize + catsPage.length);
  const catHasPrev = listUi.catPage > 0;
  const catHasNext = listUi.catPage * listUi.catPageSize + catsPage.length < catTotal;

  const prodFrom = prodTotal === 0 ? 0 : listUi.prodPage * listUi.prodPageSize + 1;
  const prodTo = Math.min(prodTotal, listUi.prodPage * listUi.prodPageSize + prodsPage.length);
  const prodHasPrev = listUi.prodPage > 0;
  const prodHasNext = listUi.prodPage * listUi.prodPageSize + prodsPage.length < prodTotal;

  container.innerHTML = `
    <div class="a-page-head">
      <div>
        <h1 class="a-h1 a-h1--flush">Menü</h1>
        <p class="a-muted">Kategorileri ve ürünleri yönetin. Düzenlemeler ayrı sayfalarda açılır.</p>
      </div>
      <div class="a-page-head__actions">
        ${buttonHtml({ label: 'Yeni kategori', id: 'menu-goto-cat-new', variant: 'secondary', icon: 'folder-plus', classes: 'a-menu-head-btn' })}
        ${buttonHtml({ label: 'Yeni ürün', id: 'menu-goto-prod-new', icon: 'plus-circle', classes: 'a-menu-head-btn' })}
      </div>
    </div>

    <h2 class="a-h2">Kategoriler (${catTotal})</h2>
    <form class="a-history-toolbar" id="menu-cat-search" role="search">
      <input class="a-input a-history-q" type="search" id="menu-cat-q" name="q" placeholder="Kategori adı veya açıklama ara…" value="${esc(listUi.catQ)}" autocomplete="off" />
      ${buttonHtml({ label: 'Ara', type: 'submit', icon: 'magnifying-glass' })}
    </form>
    <p class="a-muted" id="menu-cat-range">${esc(`${catFrom}–${catTo} / ${catTotal} kayıt`)}</p>
    <div class="a-table-wrap">
      <table class="a-table">
        <thead><tr><th>Kategori</th><th>Görsel</th><th>Sıra</th><th>Durum</th><th></th></tr></thead>
        <tbody>${catRows || emptyRowHtml('Kategori kaydı yok', 5)}</tbody>
      </table>
    </div>
    <div class="a-history-pager">
      ${buttonHtml({ label: 'Önceki', id: 'menu-cat-prev', variant: 'secondary', icon: 'caret-left', disabled: !catHasPrev })}
      <span class="a-muted">Sayfa ${esc(String(listUi.catPage + 1))}</span>
      ${buttonHtml({ label: 'Sonraki', id: 'menu-cat-next', variant: 'secondary', icon: 'caret-right', disabled: !catHasNext })}
    </div>

    <h2 class="a-h2">Ürünler (${prodTotal})</h2>
    <form class="a-history-toolbar" id="menu-prod-search" role="search">
      <input class="a-input a-history-q" type="search" id="menu-prod-q" name="q" placeholder="Ürün veya kategori adı ara…" value="${esc(listUi.prodQ)}" autocomplete="off" />
      ${buttonHtml({ label: 'Ara', type: 'submit', icon: 'magnifying-glass' })}
    </form>
    <p class="a-muted" id="menu-prod-range">${esc(`${prodFrom}–${prodTo} / ${prodTotal} kayıt`)}</p>
    <div class="a-table-wrap">
      <table class="a-table">
        <thead><tr><th>Görsel</th><th>Ad</th><th>Kategori</th><th>Fiyat</th><th>Durum</th><th></th></tr></thead>
        <tbody>${prodRows || emptyRowHtml('Ürün kaydı yok', 6)}</tbody>
      </table>
    </div>
    <div class="a-history-pager">
      ${buttonHtml({ label: 'Önceki', id: 'menu-prod-prev', variant: 'secondary', icon: 'caret-left', disabled: !prodHasPrev })}
      <span class="a-muted">Sayfa ${esc(String(listUi.prodPage + 1))}</span>
      ${buttonHtml({ label: 'Sonraki', id: 'menu-prod-next', variant: 'secondary', icon: 'caret-right', disabled: !prodHasNext })}
    </div>`;

  container.querySelector('#menu-goto-cat-new')?.addEventListener('click', onNewCategory);
  container.querySelector('#menu-goto-prod-new')?.addEventListener('click', onNewProduct);

  container.querySelector('#menu-cat-search')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = /** @type {HTMLInputElement | null} */ (container.querySelector('#menu-cat-q'));
    listUi.catQ = input?.value?.trim() ?? '';
    listUi.catPage = 0;
    refresh();
  });

  container.querySelector('#menu-cat-prev')?.addEventListener('click', () => {
    if (listUi.catPage <= 0) return;
    listUi.catPage -= 1;
    refresh();
  });
  container.querySelector('#menu-cat-next')?.addEventListener('click', () => {
    if (!catHasNext) return;
    listUi.catPage += 1;
    refresh();
  });

  container.querySelector('#menu-prod-search')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = /** @type {HTMLInputElement | null} */ (container.querySelector('#menu-prod-q'));
    listUi.prodQ = input?.value?.trim() ?? '';
    listUi.prodPage = 0;
    refresh();
  });

  container.querySelector('#menu-prod-prev')?.addEventListener('click', () => {
    if (listUi.prodPage <= 0) return;
    listUi.prodPage -= 1;
    refresh();
  });
  container.querySelector('#menu-prod-next')?.addEventListener('click', () => {
    if (!prodHasNext) return;
    listUi.prodPage += 1;
    refresh();
  });

  container.querySelectorAll('.a-menu-edit-cat').forEach((b) => {
    b.addEventListener('click', () => onEditCategory(/** @type {HTMLButtonElement} */ (b).dataset.id || ''));
  });
  container.querySelectorAll('.a-menu-edit-p').forEach((b) => {
    b.addEventListener('click', () => onEditProduct(/** @type {HTMLButtonElement} */ (b).dataset.id || ''));
  });

  container.querySelectorAll('.a-menu-del-cat').forEach((b) => {
    b.addEventListener('click', async () => {
      const ok = await showConfirmDialog({
        title: 'Kategori silinsin mi?',
        message: 'Alt kategori veya ürün varsa silinmez. Uygunsa kategori kalıcı olarak kaldırılır.',
        confirmLabel: 'Sil',
        variant: 'danger',
      });
      if (!ok) return;
      await withButtonBusy(/** @type {HTMLElement} */ (b), 'Siliniyor…', async () => {
        try {
          await api(`/admin/menu/categories/${b.dataset.id}`, { method: 'DELETE' });
          showToast('Kategori silindi.', 'success');
          await renderMenuList(container, ctx);
        } catch (e) {
          showToast(errorMessage(e), 'error');
        }
      });
    });
  });

  container.querySelectorAll('.a-menu-del-p').forEach((b) => {
    b.addEventListener('click', async () => {
      const ok = await showConfirmDialog({
        title: 'Ürün silinsin mi?',
        message: 'Ürün menüden kalıcı olarak kaldırılır.',
        confirmLabel: 'Sil',
        variant: 'danger',
      });
      if (!ok) return;
      await withButtonBusy(/** @type {HTMLElement} */ (b), 'Siliniyor…', async () => {
        try {
          await api(`/admin/menu/products/${b.dataset.id}`, { method: 'DELETE' });
          showToast('Ürün silindi.', 'success');
          await renderMenuList(container, ctx);
        } catch (e) {
          showToast(errorMessage(e), 'error');
        }
      });
    });
  });

  container.querySelectorAll('.a-menu-toggle-p').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const el = /** @type {HTMLButtonElement} */ (btn);
      const next = el.dataset.avail !== '1';
      await withButtonBusy(el, 'Güncelleniyor…', async () => {
        try {
          await api(`/admin/menu/products/${el.dataset.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ isAvailable: next }),
          });
          showToast(next ? 'Ürün satışa açıldı.' : 'Ürün satışa kapatıldı.', 'success');
          await renderMenuList(container, ctx);
        } catch (e) {
          showToast(errorMessage(e), 'error');
        }
      });
    });
  });
}
