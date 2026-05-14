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
        <td style="text-align:center;width:64px">${thumb}</td>
        <td>${c.sortIndex ?? 0}</td>
        <td>${active ? 'aktif' : 'pasif'}</td>
        <td style="white-space:nowrap">
          <button type="button" class="a-btn secondary a-menu-edit-cat" data-id="${id}">Düzenle</button>
          <button type="button" class="a-btn secondary a-menu-del-cat" data-id="${id}">Sil</button>
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
        <td style="text-align:center;width:64px">${pthumb}</td>
        <td>${esc(p.name)}</td>
        <td class="a-muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(cname)}</td>
        <td>${(Number(p.priceKurus) / 100).toFixed(2)} ₺</td>
        <td>${avail ? 'satışta' : 'kapalı'}</td>
        <td style="white-space:nowrap">
          <button type="button" class="a-btn secondary a-menu-edit-p" data-id="${pid}">Düzenle</button>
          <button type="button" class="a-btn secondary a-menu-toggle-p" data-id="${pid}" data-avail="${avail ? '1' : '0'}">${avail ? 'Kapat' : 'Aç'}</button>
          <button type="button" class="a-btn secondary a-menu-del-p" data-id="${pid}">Sil</button>
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
        <h1 class="a-h1" style="margin-bottom:4px">Menü</h1>
        <p class="a-muted" style="margin:0">Kategorileri ve ürünleri yönetin. Düzenlemeler ayrı sayfalarda açılır.</p>
      </div>
      <div class="a-page-head__actions">
        <button type="button" class="a-btn secondary" id="menu-goto-cat-new">Yeni kategori</button>
        <button type="button" class="a-btn" id="menu-goto-prod-new">Yeni ürün</button>
      </div>
    </div>

    <h2 class="a-h2">Kategoriler (${catTotal})</h2>
    <form class="a-history-toolbar" id="menu-cat-search" role="search">
      <input class="a-input a-history-q" type="search" id="menu-cat-q" name="q" placeholder="Kategori adı veya açıklama ara…" value="${esc(listUi.catQ)}" autocomplete="off" />
      <button type="submit" class="a-btn">Ara</button>
    </form>
    <p class="a-muted" id="menu-cat-range">${esc(`${catFrom}–${catTo} / ${catTotal} kayıt`)}</p>
    <div style="overflow:auto;margin-bottom:24px">
      <table class="a-table">
        <thead><tr><th>Kategori</th><th>Görsel</th><th>Sıra</th><th>Durum</th><th></th></tr></thead>
        <tbody>${catRows || '<tr><td colspan="5" class="a-muted">Kayıt yok</td></tr>'}</tbody>
      </table>
    </div>
    <div class="a-history-pager" style="margin-bottom:28px">
      <button type="button" class="a-btn secondary" id="menu-cat-prev" ${catHasPrev ? '' : 'disabled'}>Önceki</button>
      <span class="a-muted">Sayfa ${esc(String(listUi.catPage + 1))}</span>
      <button type="button" class="a-btn secondary" id="menu-cat-next" ${catHasNext ? '' : 'disabled'}>Sonraki</button>
    </div>

    <h2 class="a-h2">Ürünler (${prodTotal})</h2>
    <form class="a-history-toolbar" id="menu-prod-search" role="search">
      <input class="a-input a-history-q" type="search" id="menu-prod-q" name="q" placeholder="Ürün veya kategori adı ara…" value="${esc(listUi.prodQ)}" autocomplete="off" />
      <button type="submit" class="a-btn">Ara</button>
    </form>
    <p class="a-muted" id="menu-prod-range">${esc(`${prodFrom}–${prodTo} / ${prodTotal} kayıt`)}</p>
    <div style="overflow:auto">
      <table class="a-table">
        <thead><tr><th>Görsel</th><th>Ad</th><th>Kategori</th><th>Fiyat</th><th>Durum</th><th></th></tr></thead>
        <tbody>${prodRows || '<tr><td colspan="6" class="a-muted">Kayıt yok</td></tr>'}</tbody>
      </table>
    </div>
    <div class="a-history-pager">
      <button type="button" class="a-btn secondary" id="menu-prod-prev" ${prodHasPrev ? '' : 'disabled'}>Önceki</button>
      <span class="a-muted">Sayfa ${esc(String(listUi.prodPage + 1))}</span>
      <button type="button" class="a-btn secondary" id="menu-prod-next" ${prodHasNext ? '' : 'disabled'}>Sonraki</button>
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
      if (!confirm('Bu kategori silinsin mi? (Alt kategori veya ürün varsa silinmez.)')) return;
      try {
        await api(`/admin/menu/categories/${b.dataset.id}`, { method: 'DELETE' });
        await renderMenuList(container, ctx);
      } catch (e) {
        alert(e.message);
      }
    });
  });

  container.querySelectorAll('.a-menu-del-p').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('Bu ürün silinsin mi?')) return;
      try {
        await api(`/admin/menu/products/${b.dataset.id}`, { method: 'DELETE' });
        await renderMenuList(container, ctx);
      } catch (e) {
        alert(e.message);
      }
    });
  });

  container.querySelectorAll('.a-menu-toggle-p').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const el = /** @type {HTMLButtonElement} */ (btn);
      const next = el.dataset.avail !== '1';
      try {
        await api(`/admin/menu/products/${el.dataset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isAvailable: next }),
        });
        await renderMenuList(container, ctx);
      } catch (e) {
        alert(e.message);
      }
    });
  });
}
