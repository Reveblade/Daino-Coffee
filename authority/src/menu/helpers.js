/** @param {unknown} x */
export function idStr(x) {
  return String(x?._id ?? x ?? '');
}

/**
 * @param {object} cat
 * @param {object[]} cats
 */
export function catPath(cat, cats) {
  const parts = [];
  let cur = cat;
  const seen = new Set();
  while (cur && !seen.has(idStr(cur))) {
    seen.add(idStr(cur));
    parts.unshift(cur.name);
    const pid = cur.parentId;
    cur = pid ? cats.find((c) => idStr(c) === idStr(pid)) : null;
  }
  return parts.join(' › ');
}

export function parseTryToKurus(s) {
  const n = parseFloat(String(s).trim().replace(',', '.'));
  if (Number.isNaN(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function randomProductOptionGroupId() {
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** @param {string} label @param {number} idx */
export function slugProductChoiceId(label, idx) {
  const base = String(label)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 28);
  return `${base || 'sec'}-${idx}`;
}

/** @returns {Promise<File | null>} */
export function pickImageFile() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = () => resolve(inp.files?.[0] ?? null);
    inp.click();
  });
}

/**
 * Self + alt kategoriler (üst seçiminde döngüyü önlemek için).
 * @param {string} categoryId
 * @param {object[]} cats
 */
export function blockedParentIdsForCategory(categoryId, cats) {
  const root = idStr(categoryId);
  const out = new Set([root]);
  let added = true;
  while (added) {
    added = false;
    for (const c of cats) {
      const cid = idStr(c);
      const pid = c.parentId ? idStr(c.parentId) : '';
      if (pid && out.has(pid) && !out.has(cid)) {
        out.add(cid);
        added = true;
      }
    }
  }
  return out;
}
