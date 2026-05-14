import { randomProductOptionGroupId, slugProductChoiceId, parseTryToKurus } from './helpers.js';

/**
 * @param {any[]} groups
 */
function cloneGroups(groups) {
  return Array.isArray(groups) ? JSON.parse(JSON.stringify(groups)) : [];
}

/**
 * @param {HTMLElement} wrap
 * @param {{ id: string; label: string; extraPriceKurus?: number }[]} choices
 */
function renderChoiceRows(wrap, choices) {
  const host = wrap.querySelector('.a-pog-choices-host');
  if (!host) return;
  host.innerHTML = '';
  const list = choices.length ? choices : [{ id: '', label: '', extraPriceKurus: 0 }];
  list.forEach((ch, idx) => {
    const row = document.createElement('div');
    row.className = 'a-pog-choice-row';
    row.dataset.choiceId = ch.id || '';
    row.style.cssText =
      'display:grid;grid-template-columns:1fr minmax(88px,110px) auto;gap:8px;align-items:center;margin-bottom:8px';
    const labInp = document.createElement('input');
    labInp.type = 'text';
    labInp.className = 'a-input a-pog-clabel';
    labInp.placeholder = `Seçenek ${idx + 1}`;
    labInp.value = ch.label ?? '';
    const priceInp = document.createElement('input');
    priceInp.type = 'text';
    priceInp.className = 'a-input a-pog-cprice';
    priceInp.placeholder = '0';
    priceInp.title = 'Ek fiyat (₺), boş = 0';
    const ex = Number(ch.extraPriceKurus) || 0;
    priceInp.value =
      ex > 0
        ? (ex / 100).toLocaleString('tr-TR', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          })
        : '';
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'a-btn secondary a-pog-rm-choice';
    rm.textContent = 'Satırı kaldır';
    rm.addEventListener('click', () => {
      row.remove();
      const h = wrap.querySelector('.a-pog-choices-host');
      if (h && !h.querySelector('.a-pog-choice-row')) {
        renderChoiceRows(wrap, [{ id: '', label: '', extraPriceKurus: 0 }]);
      }
    });
    row.append(labInp, priceInp, rm);
    host.appendChild(row);
  });
}

/**
 * Seçenek grupları: her seçenek ayrı satır (ad + ek ₺), dinamik satır ekleme.
 * @param {HTMLElement} panel
 * @param {any[]} initialGroups
 * @param {string} productNameHint
 */
export function mountProductOptionGroupsForm(panel, initialGroups, productNameHint) {
  let groups = cloneGroups(initialGroups);

  function collectFromPanel() {
    const next = [];
    panel.querySelectorAll('.a-prod-opt-group').forEach((wrap) => {
      const id = wrap.getAttribute('data-group-id') || '';
      const old = groups.find((g) => g.id === id) || {};
      const choiceRows = [];
      wrap.querySelectorAll('.a-pog-choice-row').forEach((row) => {
        const cid = row.dataset.choiceId || '';
        const label = row.querySelector('.a-pog-clabel')?.value ?? '';
        const priceRaw = row.querySelector('.a-pog-cprice')?.value ?? '';
        const kurus = parseTryToKurus(priceRaw);
        choiceRows.push({
          id: cid,
          label,
          extraPriceKurus: kurus === null ? 0 : kurus,
          _priceRaw: priceRaw,
        });
      });
      next.push({
        id: id || randomProductOptionGroupId(),
        label: wrap.querySelector('.a-pog-label')?.value ?? '',
        kind: wrap.querySelector('.a-pog-kind')?.value ?? 'SINGLE',
        choices: old.choices ?? [],
        _choiceRows: choiceRows,
      });
    });
    groups = next;
  }

  function renderInner() {
    panel.innerHTML = '';
    const title = document.createElement('h2');
    title.className = 'a-h2';
    title.style.marginTop = '0';
    title.textContent = 'Seçenek grupları';
    panel.appendChild(title);
    const lead = document.createElement('p');
    lead.className = 'a-muted';
    lead.textContent = `İsteğe bağlı. ${productNameHint ? `Ürün: ${productNameHint}. ` : ''}Her satır bir seçenek; ek fiyat ürün birim fiyatına eklenir.`;
    panel.appendChild(lead);

    const list = document.createElement('div');
    list.id = 'a-pog-list';
    for (const g of groups) {
      const gid = String(g.id);
      const wrap = document.createElement('div');
      wrap.className = 'a-prod-opt-group a-card';
      wrap.dataset.groupId = gid;
      wrap.style.cssText = 'padding:12px;margin-bottom:10px';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px';
      const inpLabel = document.createElement('input');
      inpLabel.type = 'text';
      inpLabel.className = 'a-input a-pog-label';
      inpLabel.placeholder = 'Grup başlığı (örn. Ekstralar, Süt)';
      inpLabel.value = g.label ?? '';
      inpLabel.style.cssText = 'flex:1;min-width:160px';
      const selKind = document.createElement('select');
      selKind.className = 'a-select a-pog-kind';
      selKind.style.maxWidth = '200px';
      [['SELECTABLE', 'Çoklu seçim'], ['SINGLE', 'Tek seçim']].forEach(([v, t]) => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = t;
        if (g.kind === v) o.selected = true;
        selKind.appendChild(o);
      });
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'a-btn secondary a-pog-remove';
      rm.textContent = 'Grubu kaldır';
      rm.dataset.groupId = gid;
      row.append(inpLabel, selKind, rm);

      const headRow = document.createElement('div');
      headRow.className = 'a-muted';
      headRow.style.cssText =
        'display:grid;grid-template-columns:1fr minmax(88px,110px) auto;gap:8px;font-size:0.78rem;margin:10px 0 4px;text-transform:uppercase;letter-spacing:0.04em';
      headRow.innerHTML =
        '<span>Seçenek adı</span><span>Ek (₺)</span><span></span>';

      const host = document.createElement('div');
      host.className = 'a-pog-choices-host';

      const addChoice = document.createElement('button');
      addChoice.type = 'button';
      addChoice.className = 'a-btn secondary';
      addChoice.style.marginTop = '6px';
      addChoice.textContent = 'Seçenek satırı ekle';
      addChoice.addEventListener('click', () => {
        const h = wrap.querySelector('.a-pog-choices-host');
        if (!h) return;
        const row = document.createElement('div');
        row.className = 'a-pog-choice-row';
        row.dataset.choiceId = '';
        row.style.cssText =
          'display:grid;grid-template-columns:1fr minmax(88px,110px) auto;gap:8px;align-items:center;margin-bottom:8px';
        const labInp = document.createElement('input');
        labInp.type = 'text';
        labInp.className = 'a-input a-pog-clabel';
        labInp.placeholder = 'Yeni seçenek';
        const priceInp = document.createElement('input');
        priceInp.type = 'text';
        priceInp.className = 'a-input a-pog-cprice';
        priceInp.placeholder = '0';
        priceInp.title = 'Ek fiyat (₺)';
        const rmC = document.createElement('button');
        rmC.type = 'button';
        rmC.className = 'a-btn secondary a-pog-rm-choice';
        rmC.textContent = 'Satırı kaldır';
        rmC.addEventListener('click', () => {
          row.remove();
          if (!h.querySelector('.a-pog-choice-row')) {
            renderChoiceRows(wrap, [{ id: '', label: '', extraPriceKurus: 0 }]);
          }
        });
        row.append(labInp, priceInp, rmC);
        h.appendChild(row);
      });

      wrap.append(row, headRow, host, addChoice);
      list.appendChild(wrap);

      const existing = Array.isArray(g.choices) ? [...g.choices] : [];
      if (Array.isArray(g._choiceRows) && g._choiceRows.length) {
        const rebuilt = g._choiceRows.map((r) => ({
          id: String(r.id || '').trim(),
          label: r.label,
          extraPriceKurus: r.extraPriceKurus ?? 0,
        }));
        renderChoiceRows(wrap, rebuilt);
      } else {
        renderChoiceRows(wrap, existing);
      }

      rm.addEventListener('click', () => {
        collectFromPanel();
        groups = groups.filter((x) => x.id !== gid);
        renderInner();
      });
    }
    panel.appendChild(list);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'a-btn secondary';
    addBtn.textContent = 'Grup ekle';
    addBtn.addEventListener('click', () => {
      collectFromPanel();
      groups.push({
        id: randomProductOptionGroupId(),
        label: '',
        kind: 'SINGLE',
        choices: [],
      });
      renderInner();
    });
    actions.appendChild(addBtn);
    panel.appendChild(actions);
  }

  renderInner();

  return {
    buildPayload() {
      collectFromPanel();
      const built = [];
      for (const g of groups) {
        const label = String(g.label || '').trim();
        const kind = g.kind === 'SELECTABLE' || g.kind === 'SINGLE' ? g.kind : 'SINGLE';
        const rows = Array.isArray(g._choiceRows) ? g._choiceRows : [];
        const nonEmpty = rows.filter((r) => String(r.label || '').trim());
        if (!label && !nonEmpty.length) continue;
        if (!label) {
          return { ok: false, message: 'Grup başlığı boş olamaz.' };
        }
        if (!nonEmpty.length) {
          return {
            ok: false,
            message: `"${label}" için en az bir seçenek satırı ekleyin veya grubu kaldırın.`,
          };
        }
        const choices = [];
        const usedIds = new Set();
        for (let i = 0; i < nonEmpty.length; i++) {
          const r = nonEmpty[i];
          const lab = String(r.label || '').trim();
          const rawP = String(r._priceRaw ?? '').trim();
          let extraPriceKurus = 0;
          if (rawP) {
            const p = parseTryToKurus(rawP);
            if (p === null) {
              return {
                ok: false,
                message: `"${label}" / "${lab}" için geçerli bir ek fiyat (₺) girin.`,
              };
            }
            extraPriceKurus = p;
          }
          let cid = String(r.id || '').trim();
          if (!cid || usedIds.has(cid)) {
            cid = slugProductChoiceId(lab, i);
          }
          if (usedIds.has(cid)) {
            cid = `${cid}-${i}`;
          }
          usedIds.add(cid);
          choices.push({
            id: cid,
            label: lab,
            extraPriceKurus,
          });
        }
        built.push({
          id: String(g.id || '').trim() || randomProductOptionGroupId(),
          label,
          kind,
          choices,
        });
      }
      return { ok: true, optionGroups: built };
    },
  };
}
