import { api, uploadAdminImage } from '../../api.js';
import { idStr, catPath, pickImageFile, blockedParentIdsForCategory } from '../helpers.js';

/**
 * @param {HTMLElement} container
 * @param {object} ctx
 * @param {(s: string) => string} ctx.esc
 * @param {'new' | 'edit'} ctx.mode
 * @param {string | null} ctx.categoryId
 * @param {() => void} ctx.onBack
 * @param {() => void | Promise<void>} [ctx.reload]
 */
export async function renderCategoryFormPage(container, ctx) {
  const { esc, mode, categoryId, onBack, reload } = ctx;

  let cats = [];
  try {
    cats = await api('/admin/menu/categories');
  } catch (e) {
    container.innerHTML = `<p class="a-error">${esc(e.message)}</p>
      <p><button type="button" class="a-btn secondary" id="cf-back-err">← Menü listesine</button></p>`;
    container.querySelector('#cf-back-err')?.addEventListener('click', onBack);
    return;
  }
  if (!Array.isArray(cats)) cats = [];

  const catsSorted = [...cats].sort((a, b) =>
    catPath(a, cats).localeCompare(catPath(b, cats), 'tr'),
  );

  /** @type {object | null} */
  let category = null;
  if (mode === 'edit') {
    category = cats.find((c) => idStr(c) === categoryId) ?? null;
    if (!category) {
      container.innerHTML = `<p class="a-error">Kategori bulunamadı.</p>
        <p><button type="button" class="a-btn secondary" id="cf-back-miss">← Menü listesine</button></p>`;
      container.querySelector('#cf-back-miss')?.addEventListener('click', onBack);
      return;
    }
  }

  const blocked =
    mode === 'edit' && categoryId ? blockedParentIdsForCategory(categoryId, cats) : new Set();

  const parentOpts =
    `<option value="">— Üst kategori yok (kök) —</option>` +
    catsSorted
      .filter((c) => !blocked.has(idStr(c)))
      .map(
        (c) =>
          `<option value="${esc(idStr(c))}">${esc(catPath(c, cats))}</option>`,
      )
      .join('');

  const name = category?.name ?? '';
  const desc = category?.description ?? '';
  const sortIx = category?.sortIndex ?? 0;
  const active = mode === 'edit' && category ? category.isActive !== false : true;
  const imgUrl = category?.imageUrl ?? '';
  const parentVal = category?.parentId ? idStr(category.parentId) : '';

  container.innerHTML = `
    <div class="a-page-head">
      <div>
        <p class="a-muted" style="margin:0 0 4px"><button type="button" class="a-btn secondary a-cf-back">← Menü listesi</button></p>
        <h1 class="a-h1" style="margin-top:4px">${mode === 'new' ? 'Yeni kategori' : 'Kategori düzenle'}</h1>
        <p class="a-muted" style="margin:0">${mode === 'new' ? 'Hiyerarşi için üst kategori seçebilirsiniz; sıra değeri menüdeki görünümü etkiler.' : 'Ad, üst kategori, sıra ve görünürlük ayarlarını güncelleyin.'}</p>
      </div>
    </div>

    <div class="a-form-page-grid">
      <section class="a-card a-form-section">
        <h2 class="a-h2" style="margin-top:0">Kategori bilgileri</h2>

        <label class="a-field-label">Görünen ad</label>
        <input class="a-input" id="cf-name" maxlength="120" value="${esc(name)}" placeholder="Örn. Sıcak içecekler" />

        <label class="a-field-label">Açıklama <span class="a-muted">(opsiyonel)</span></label>
        <textarea class="a-input" id="cf-desc" rows="3" placeholder="İç not veya kısa açıklama">${esc(desc)}</textarea>

        <label class="a-field-label">Üst kategori</label>
        <select class="a-select" id="cf-parent">${parentOpts}</select>

        <label class="a-field-label">Liste sırası</label>
        <input class="a-input" id="cf-sort" type="number" value="${esc(String(sortIx))}" style="max-width:160px" />

        ${
          mode === 'edit'
            ? `<label class="a-check">
          <input type="checkbox" id="cf-active" ${active ? 'checked' : ''} />
          <span>Aktif (menüde göster)</span>
        </label>`
            : ''
        }
      </section>

      <section class="a-card a-form-section">
        <h2 class="a-h2" style="margin-top:0">Kategori görseli</h2>
        <p class="a-muted">Kare veya yatay görsel önerilir. Boş bırakılabilir.</p>
        <div id="cf-img-preview" class="a-cat-img-preview">
          ${imgUrl ? `<img src="${esc(imgUrl)}" alt="" />` : '<span class="a-muted">Görsel yok</span>'}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button type="button" class="a-btn secondary" id="cf-upload">Görsel yükle</button>
          ${imgUrl ? '<button type="button" class="a-btn secondary" id="cf-clear-img">Görseli kaldır</button>' : ''}
        </div>
      </section>
    </div>

    <div class="a-form-actions">
      <button type="button" class="a-btn secondary a-cf-back">Vazgeç</button>
      <button type="button" class="a-btn" id="cf-save">${mode === 'new' ? 'Kategoriyi oluştur' : 'Değişiklikleri kaydet'}</button>
    </div>
    <p class="a-error" id="cf-err" style="margin-top:12px"></p>`;

  const selParent = /** @type {HTMLSelectElement} */ (container.querySelector('#cf-parent'));
  if (selParent && parentVal) selParent.value = parentVal;

  let currentImageUrl = imgUrl || '';

  container.querySelectorAll('.a-cf-back').forEach((b) => {
    b.addEventListener('click', onBack);
  });

  const preview = /** @type {HTMLElement} */ (container.querySelector('#cf-img-preview'));
  function setPreview(url) {
    currentImageUrl = url;
    preview.innerHTML = url
      ? `<img src="${esc(url)}" alt="" />`
      : '<span class="a-muted">Görsel yok</span>';
    const row = container.querySelector('#cf-clear-img');
    if (row) row.remove();
    if (url) {
      const clr = document.createElement('button');
      clr.type = 'button';
      clr.className = 'a-btn secondary';
      clr.id = 'cf-clear-img';
      clr.textContent = 'Görseli kaldır';
      clr.addEventListener('click', () => setPreview(''));
      const wrap = container.querySelector('#cf-upload')?.parentElement;
      wrap?.appendChild(clr);
    }
  }

  container.querySelector('#cf-upload')?.addEventListener('click', async () => {
    const file = await pickImageFile();
    if (!file) return;
    try {
      const up = await uploadAdminImage(file);
      setPreview(up.url);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  });

  container.querySelector('#cf-clear-img')?.addEventListener('click', () => setPreview(''));

  const errEl = /** @type {HTMLElement} */ (container.querySelector('#cf-err'));
  container.querySelector('#cf-save')?.addEventListener('click', async () => {
    errEl.textContent = '';
    const nameVal = /** @type {HTMLInputElement} */ (container.querySelector('#cf-name')).value.trim();
    const description =
      /** @type {HTMLTextAreaElement} */ (container.querySelector('#cf-desc')).value.trim() ||
      undefined;
    const parentRaw = selParent?.value?.trim() ?? '';
    const sortIndex = Number(
      /** @type {HTMLInputElement} */ (container.querySelector('#cf-sort')).value,
    );
    const activeEl = /** @type {HTMLInputElement | null} */ (container.querySelector('#cf-active'));
    const isActive = mode === 'edit' ? activeEl?.checked ?? true : true;

    if (!nameVal) {
      errEl.textContent = 'Kategori adı gerekli.';
      return;
    }

    const sortIndexVal = Number.isFinite(sortIndex) ? sortIndex : 0;

    try {
      if (mode === 'new') {
        await api('/admin/menu/categories', {
          method: 'POST',
          body: JSON.stringify({
            name: nameVal,
            description,
            parentId: parentRaw || undefined,
            sortIndex: sortIndexVal,
            imageUrl: currentImageUrl || undefined,
          }),
        });
        onBack();
      } else {
        await api(`/admin/menu/categories/${encodeURIComponent(categoryId ?? '')}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: nameVal,
            description,
            parentId: parentRaw || undefined,
            sortIndex: sortIndexVal,
            isActive,
            imageUrl: currentImageUrl ? currentImageUrl : '',
          }),
        });
        alert('Kaydedildi.');
        if (reload) await reload();
        else onBack();
      }
    } catch (e) {
      errEl.textContent = e instanceof Error ? e.message : String(e);
    }
  });
}
