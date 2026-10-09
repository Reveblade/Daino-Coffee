import { api, uploadAdminImage } from '../../api.js';
import { idStr, catPath, pickImageFile, blockedParentIdsForCategory } from '../helpers.js';

/**
 * @param {HTMLElement} container
 * @param {object} ctx
 * @param {(s: string) => string} ctx.esc
 * @param {(opts: any) => string} ctx.buttonHtml
 * @param {(value: unknown) => string} ctx.errorMessage
 * @param {(message: string, tone?: 'success' | 'error' | 'info') => void} ctx.showToast
 * @param {(btn: HTMLElement | null | undefined, label: string, fn: () => Promise<unknown>) => Promise<unknown>} ctx.withButtonBusy
 * @param {'new' | 'edit'} ctx.mode
 * @param {string | null} ctx.categoryId
 * @param {() => void} ctx.onBack
 * @param {() => void | Promise<void>} [ctx.reload]
 */
export async function renderCategoryFormPage(container, ctx) {
  const { esc, buttonHtml, errorMessage, showToast, withButtonBusy, mode, categoryId, onBack, reload } = ctx;

  let cats = [];
  try {
    cats = await api('/admin/menu/categories');
  } catch (e) {
    container.innerHTML = `<p class="a-error">${esc(e.message)}</p>
      <p>${buttonHtml({ label: 'Menü listesine', id: 'cf-back-err', variant: 'secondary', icon: 'arrow-left' })}</p>`;
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
        <p>${buttonHtml({ label: 'Menü listesine', id: 'cf-back-miss', variant: 'secondary', icon: 'arrow-left' })}</p>`;
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
        <p class="a-muted">${buttonHtml({ label: 'Menü listesi', variant: 'secondary', size: 'compact', icon: 'arrow-left', classes: 'a-cf-back' })}</p>
        <h1 class="a-h1 a-h1--flush">${mode === 'new' ? 'Yeni kategori' : 'Kategori düzenle'}</h1>
        <p class="a-muted">${mode === 'new' ? 'Hiyerarşi için üst kategori seçebilirsiniz; sıra değeri menüdeki görünümü etkiler.' : 'Ad, üst kategori, sıra ve görünürlük ayarlarını güncelleyin.'}</p>
      </div>
    </div>

    <div class="a-form-page-grid">
      <section class="a-card a-form-section">
        <h2 class="a-h2 a-h2--flush">Kategori bilgileri</h2>

        <label class="a-field-label">Görünen ad</label>
        <input class="a-input" id="cf-name" maxlength="120" value="${esc(name)}" placeholder="Örn. Sıcak içecekler" />

        <label class="a-field-label">Açıklama <span class="a-muted">(opsiyonel)</span></label>
        <textarea class="a-input" id="cf-desc" rows="3" placeholder="İç not veya kısa açıklama">${esc(desc)}</textarea>

        <label class="a-field-label">Üst kategori</label>
        <select class="a-select" id="cf-parent">${parentOpts}</select>

        <label class="a-field-label">Liste sırası</label>
        <input class="a-input a-field-narrow" id="cf-sort" type="number" value="${esc(String(sortIx))}" />

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
        <h2 class="a-h2 a-h2--flush">Kategori görseli</h2>
        <p class="a-muted">Kare veya yatay görsel önerilir. Boş bırakılabilir.</p>
        <div id="cf-img-preview" class="a-cat-img-preview">
          ${imgUrl ? `<img src="${esc(imgUrl)}" alt="" />` : '<span class="a-muted">Görsel yok</span>'}
        </div>
        <div class="a-action-row a-section-top">
          ${buttonHtml({ label: 'Görsel yükle', id: 'cf-upload', variant: 'secondary', icon: 'image-square' })}
          ${imgUrl ? buttonHtml({ label: 'Görseli kaldır', id: 'cf-clear-img', variant: 'danger', icon: 'trash' }) : ''}
        </div>
      </section>
    </div>

    <div class="a-form-actions">
      ${buttonHtml({ label: 'Vazgeç', variant: 'secondary', classes: 'a-cf-back', icon: 'x' })}
      ${buttonHtml({ label: mode === 'new' ? 'Kategoriyi oluştur' : 'Değişiklikleri kaydet', id: 'cf-save', icon: 'floppy-disk' })}
    </div>
    <p class="a-error" id="cf-err"></p>`;

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
      clr.className = 'a-btn a-btn--danger';
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
    await withButtonBusy(container.querySelector('#cf-upload'), 'Yükleniyor…', async () => {
      try {
        const up = await uploadAdminImage(file);
        setPreview(up.url);
        showToast('Görsel yüklendi.', 'success');
      } catch (e) {
        showToast(errorMessage(e), 'error');
      }
    });
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
      /** @type {HTMLElement | null} */ (container.querySelector('#cf-name'))?.focus();
      return;
    }

    const sortIndexVal = Number.isFinite(sortIndex) ? sortIndex : 0;

    await withButtonBusy(container.querySelector('#cf-save'), 'Kaydediliyor…', async () => {
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
          showToast('Kategori oluşturuldu.', 'success');
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
          showToast('Kategori kaydedildi.', 'success');
          if (reload) await reload();
          else onBack();
        }
      } catch (e) {
        errEl.textContent = errorMessage(e);
      }
    });
  });
}
