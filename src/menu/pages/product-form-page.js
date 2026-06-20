import { api, uploadAdminImage } from '../../api.js';
import { idStr, catPath, parseTryToKurus, pickImageFile } from '../helpers.js';
import {
  PRODUCT_DESCRIPTION_MAX_LENGTH,
  PRODUCT_NAME_MAX_LENGTH,
  PRODUCT_PRICE_MAX_KURUS,
  formatKurusLimit,
} from '../limits.js';
import { mountProductOptionGroupsForm } from '../product-option-groups.js';

/**
 * @param {HTMLElement} container
 * @param {object} ctx
 * @param {(s: string) => string} ctx.esc
 * @param {(opts: any) => string} ctx.buttonHtml
 * @param {(value: unknown) => string} ctx.errorMessage
 * @param {(message: string, tone?: 'success' | 'error' | 'info') => void} ctx.showToast
 * @param {(btn: HTMLElement | null | undefined, label: string, fn: () => Promise<unknown>) => Promise<unknown>} ctx.withButtonBusy
 * @param {'new' | 'edit'} ctx.mode
 * @param {string | null} ctx.productId
 * @param {() => void} ctx.onBack
 * @param {() => void | Promise<void>} [ctx.reload] Düzenleme kaydından sonra formu yenilemek için
 */
export async function renderProductFormPage(container, ctx) {
  const { esc, buttonHtml, errorMessage, showToast, withButtonBusy, mode, productId, onBack, reload } = ctx;

  let cats = [];
  let prods = [];
  try {
    cats = await api('/admin/menu/categories');
    prods = await api('/admin/menu/products');
  } catch (e) {
    container.innerHTML = `<p class="a-error">${esc(e.message)}</p>
      <p>${buttonHtml({ label: 'Menü listesine', id: 'pf-back-err', variant: 'secondary', icon: 'arrow-left' })}</p>`;
    container.querySelector('#pf-back-err')?.addEventListener('click', onBack);
    return;
  }
  if (!Array.isArray(cats)) cats = [];
  if (!Array.isArray(prods)) prods = [];

  const catsSorted = [...cats].sort((a, b) =>
    catPath(a, cats).localeCompare(catPath(b, cats), 'tr'),
  );

  if (!catsSorted.length) {
    container.innerHTML = `
      <p class="a-muted">${buttonHtml({ label: 'Menü listesi', id: 'pf-back-nc', variant: 'secondary', icon: 'arrow-left' })}</p>
      <p class="a-error">Önce en az bir kategori oluşturmalısınız.</p>`;
    container.querySelector('#pf-back-nc')?.addEventListener('click', onBack);
    return;
  }

  const catOpts = catsSorted
    .map(
      (c) =>
        `<option value="${esc(idStr(c))}">${esc(catPath(c, cats))}</option>`,
    )
    .join('');

  /** @type {object | null} */
  let product = null;
  if (mode === 'edit') {
    product = prods.find((p) => idStr(p) === productId) ?? null;
    if (!product) {
      container.innerHTML = `<p class="a-error">Ürün bulunamadı.</p>
        <p>${buttonHtml({ label: 'Menü listesine', id: 'pf-back-miss', variant: 'secondary', icon: 'arrow-left' })}</p>`;
      container.querySelector('#pf-back-miss')?.addEventListener('click', onBack);
      return;
    }
  }

  const initialCat = product ? idStr(product.categoryId) : catOpts ? catsSorted[0]?._id : '';
  const priceTry =
    product && product.priceKurus != null
      ? (Number(product.priceKurus) / 100).toLocaleString('tr-TR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : '';
  const desc = product?.description ?? '';
  const name = product?.name ?? '';
  const sortIx = product?.sortIndex ?? 0;
  const avail = product ? product.isAvailable !== false : true;
  const images = Array.isArray(product?.images) ? [...product.images] : [];

  container.innerHTML = `
    <div class="a-page-head">
      <div>
        <p class="a-muted">${buttonHtml({ label: 'Menü listesi', variant: 'secondary', size: 'compact', icon: 'arrow-left', classes: 'a-pf-back' })}</p>
        <h1 class="a-h1 a-h1--flush">${mode === 'new' ? 'Yeni ürün' : 'Ürün düzenle'}</h1>
        <p class="a-muted">${mode === 'new' ? 'Kategori, fiyat ve isteğe bağlı seçenek gruplarını tanımlayın.' : 'Tüm alanları güncelleyebilirsiniz; kayıt anında menü canlıya yansır.'}</p>
      </div>
    </div>

    <div class="a-form-page-grid">
      <section class="a-card a-form-section">
        <h2 class="a-h2 a-h2--flush">Temel bilgiler</h2>
        <label class="a-field-label">Kategori</label>
        <select class="a-select a-pf-cat" id="pf-cat">${catOpts}</select>

        <label class="a-field-label">Ürün adı <span class="a-muted">(en fazla ${PRODUCT_NAME_MAX_LENGTH} karakter)</span></label>
        <input class="a-input" id="pf-name" maxlength="${PRODUCT_NAME_MAX_LENGTH}" value="${esc(name)}" placeholder="Örn. Filtre kahve" />

        <label class="a-field-label">Açıklama <span class="a-muted">(opsiyonel, en fazla ${PRODUCT_DESCRIPTION_MAX_LENGTH} karakter)</span></label>
        <textarea class="a-input" id="pf-desc" rows="4" maxlength="${PRODUCT_DESCRIPTION_MAX_LENGTH}" placeholder="Müşteri menüsünde görünen kısa açıklama">${esc(desc)}</textarea>

        <div class="a-form-row">
          <div class="a-form-row__item">
            <label class="a-field-label">Fiyat (₺) <span class="a-muted">(en fazla ${formatKurusLimit(PRODUCT_PRICE_MAX_KURUS)} ₺)</span></label>
            <input class="a-input" id="pf-price" inputmode="decimal" maxlength="9" placeholder="45,50" value="${esc(priceTry)}" />
          </div>
          <div class="a-form-row__item">
            <label class="a-field-label">Liste sırası</label>
            <input class="a-input" id="pf-sort" type="number" value="${esc(String(sortIx))}" />
          </div>
        </div>

        <label class="a-check">
          <input type="checkbox" id="pf-avail" ${avail ? 'checked' : ''} />
          <span>Satışta (müşteri menüsünde görünsün)</span>
        </label>
      </section>

      <section class="a-card a-form-section">
        <h2 class="a-h2 a-h2--flush">Görseller</h2>
        <p class="a-muted">Birden fazla görsel ekleyebilirsiniz. İlk görsel liste önizlemesinde kullanılır.</p>
        <div id="pf-images" class="a-image-strip"></div>
        ${buttonHtml({ label: 'Görsel yükle', id: 'pf-add-img', variant: 'secondary', icon: 'image-square' })}
      </section>
    </div>

    <section class="a-card a-form-section a-section-top">
      <div id="pf-options-root"></div>
    </section>

    <div class="a-form-actions">
      ${buttonHtml({ label: 'Vazgeç', variant: 'secondary', classes: 'a-pf-back', icon: 'x' })}
      ${buttonHtml({ label: mode === 'new' ? 'Ürünü oluştur' : 'Değişiklikleri kaydet', id: 'pf-save', icon: 'floppy-disk' })}
    </div>
    <p class="a-error" id="pf-err"></p>`;

  const selCat = /** @type {HTMLSelectElement} */ (container.querySelector('#pf-cat'));
  if (selCat && initialCat) selCat.value = initialCat;

  const optRoot = /** @type {HTMLElement} */ (container.querySelector('#pf-options-root'));
  const optEditor = mountProductOptionGroupsForm(
    optRoot,
    product?.optionGroups ?? [],
    String(product?.name ?? ''),
  );

  const imgHost = /** @type {HTMLElement} */ (container.querySelector('#pf-images'));
  let localImages = images.map((im) => ({ url: im.url, publicId: im.publicId }));

  function renderImages() {
    imgHost.innerHTML = localImages
      .map(
        (im, idx) => `
      <div class="a-image-tile" data-idx="${idx}">
        <img src="${esc(im.url)}" alt="" />
        ${buttonHtml({ label: 'Kaldır', variant: 'danger', size: 'compact', icon: 'trash', classes: 'a-pf-rm-img', attrs: { 'data-idx': idx } })}
      </div>`,
      )
      .join('');
    imgHost.querySelectorAll('.a-pf-rm-img').forEach((b) => {
      b.addEventListener('click', () => {
        const idx = Number(/** @type {HTMLButtonElement} */ (b).dataset.idx);
        if (!Number.isFinite(idx)) return;
        localImages.splice(idx, 1);
        renderImages();
      });
    });
  }
  renderImages();

  container.querySelectorAll('.a-pf-back').forEach((b) => {
    b.addEventListener('click', onBack);
  });

  container.querySelector('#pf-add-img')?.addEventListener('click', async () => {
    const file = await pickImageFile();
    if (!file) return;
    await withButtonBusy(container.querySelector('#pf-add-img'), 'Yükleniyor…', async () => {
      try {
        const up = await uploadAdminImage(file);
        localImages.push({ url: up.url, publicId: up.publicId });
        renderImages();
        showToast('Görsel yüklendi.', 'success');
      } catch (e) {
        showToast(errorMessage(e), 'error');
      }
    });
  });

  const errEl = /** @type {HTMLElement} */ (container.querySelector('#pf-err'));
  container.querySelector('#pf-save')?.addEventListener('click', async () => {
    errEl.textContent = '';
    const categoryId = selCat?.value?.trim() ?? '';
    const nameVal = /** @type {HTMLInputElement} */ (container.querySelector('#pf-name')).value.trim();
    const description =
      /** @type {HTMLTextAreaElement} */ (container.querySelector('#pf-desc')).value.trim() ||
      undefined;
    const kurus = parseTryToKurus(
      /** @type {HTMLInputElement} */ (container.querySelector('#pf-price')).value,
    );
    const sortIndex = Number(
      /** @type {HTMLInputElement} */ (container.querySelector('#pf-sort')).value,
    );
    const isAvailable = /** @type {HTMLInputElement} */ (container.querySelector('#pf-avail')).checked;

    if (!categoryId) {
      errEl.textContent = 'Kategori seçin.';
      selCat?.focus();
      return;
    }
    if (!nameVal) {
      errEl.textContent = 'Ürün adı gerekli.';
      /** @type {HTMLElement | null} */ (container.querySelector('#pf-name'))?.focus();
      return;
    }
    if (nameVal.length > PRODUCT_NAME_MAX_LENGTH) {
      errEl.textContent = `Ürün adı en fazla ${PRODUCT_NAME_MAX_LENGTH} karakter olabilir.`;
      /** @type {HTMLElement | null} */ (container.querySelector('#pf-name'))?.focus();
      return;
    }
    if (description && description.length > PRODUCT_DESCRIPTION_MAX_LENGTH) {
      errEl.textContent = `Açıklama en fazla ${PRODUCT_DESCRIPTION_MAX_LENGTH} karakter olabilir.`;
      /** @type {HTMLElement | null} */ (container.querySelector('#pf-desc'))?.focus();
      return;
    }
    if (kurus === null) {
      errEl.textContent = 'Geçerli bir fiyat girin.';
      /** @type {HTMLElement | null} */ (container.querySelector('#pf-price'))?.focus();
      return;
    }
    if (kurus > PRODUCT_PRICE_MAX_KURUS) {
      errEl.textContent = `Fiyat ${formatKurusLimit(PRODUCT_PRICE_MAX_KURUS)} ₺ değerini aşamaz.`;
      /** @type {HTMLElement | null} */ (container.querySelector('#pf-price'))?.focus();
      return;
    }

    const og = optEditor.buildPayload();
    if (!og.ok) {
      errEl.textContent = og.message;
      return;
    }

    const body = {
      categoryId,
      name: nameVal,
      description,
      priceKurus: kurus,
      sortIndex: Number.isFinite(sortIndex) ? sortIndex : 0,
      images: localImages,
      optionGroups: og.optionGroups,
    };

    await withButtonBusy(container.querySelector('#pf-save'), 'Kaydediliyor…', async () => {
      try {
        if (mode === 'new') {
          await api('/admin/menu/products', {
            method: 'POST',
            body: JSON.stringify(body),
          });
          showToast('Ürün oluşturuldu.', 'success');
          onBack();
        } else {
          await api(`/admin/menu/products/${encodeURIComponent(productId ?? '')}`, {
            method: 'PATCH',
            body: JSON.stringify({
              name: body.name,
              description: body.description,
              priceKurus: body.priceKurus,
              sortIndex: body.sortIndex,
              categoryId: body.categoryId,
              images: body.images,
              isAvailable,
              optionGroups: body.optionGroups,
            }),
          });
          errEl.textContent = '';
          showToast('Ürün kaydedildi.', 'success');
          if (reload) await reload();
          else onBack();
        }
      } catch (e) {
        errEl.textContent = errorMessage(e);
      }
    });
  });
}
