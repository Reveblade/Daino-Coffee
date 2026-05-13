/**
 * Greedy line-breaking for the mission block; inter-word gaps (.mission-w-gap) flex to
 * absorb slack per line. Five pill slots sit between six phrase segments (same styling).
 */

/** Landscape-friendly Unsplash CDN URLs (beans, cups, brewing) — IDs verified to respond 200. */
const COFFEE_IMAGE_URLS = [
  'https://images.unsplash.com/photo-1447933601403-0c6688de566e?auto=format&fit=crop&w=720&q=80',
  'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=720&q=80',
  'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?auto=format&fit=crop&w=720&q=80',
  'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=720&q=80',
  'https://images.unsplash.com/photo-1497935586351-b67a49e012bf?auto=format&fit=crop&w=720&q=80',
  'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=720&q=80',
  'https://images.unsplash.com/photo-1504630083234-14187a9df0f5?auto=format&fit=crop&w=720&q=80',
  'https://images.unsplash.com/photo-1442512595331-e89e73853f31?auto=format&fit=crop&w=720&q=80',
  'https://images.unsplash.com/photo-1517487881594-2787fef5ebf7?auto=format&fit=crop&w=720&q=80',
];

const MISSION_PHRASES = [
  'Seçkin Arabica çekirdekleri',
  've taze öğütülmüş baharatlar',
  'ile inkâr edilemez',
  'derecede yoğun,',
  'aromatik bir kahve deneyimine',
  'ne dersiniz?',
];

export const MISSION_ARIA_LABEL = MISSION_PHRASES.join(' ');

function coffeeImageAtPillIndex(index) {
  return COFFEE_IMAGE_URLS[index % COFFEE_IMAGE_URLS.length];
}

function tokenize(phrases) {
  const tokens = [];
  phrases.forEach((phrase, idx) => {
    if (idx > 0) tokens.push({ type: 'pill' });
    phrase
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .forEach((text) => tokens.push({ type: 'word', text }));
  });
  return tokens;
}

function measureWordWidth(probe, word) {
  probe.textContent = word;
  return probe.getBoundingClientRect().width;
}

function breakIntoLines(tokens, availW, gapPx, pillMinPx, probe) {
  const lines = [];
  let cur = [];
  let lineW = 0;

  const flush = () => {
    if (cur.length) lines.push([...cur]);
    cur = [];
    lineW = 0;
  };

  for (const tok of tokens) {
    if (tok.type === 'word') {
      const w = measureWordWidth(probe, tok.text);
      const add = w + (cur.length ? gapPx : 0);
      if (lineW + add > availW + 0.5 && cur.length) flush();
      lineW += w + (cur.length ? gapPx : 0);
      cur.push(tok);
    } else {
      const add = pillMinPx + (cur.length ? gapPx : 0);
      if (lineW + add > availW + 0.5 && cur.length) flush();
      lineW += pillMinPx + (cur.length ? gapPx : 0);
      cur.push(tok);
    }
  }
  flush();
  return lines;
}

function makePill(imageUrl) {
  const p = document.createElement('span');
  p.className = 'mission-pill-slot img-slot img-slot--pill';
  p.setAttribute('aria-hidden', 'true');
  if (imageUrl) {
    const img = document.createElement('img');
    img.className = 'mission-pill-img';
    img.src = imageUrl;
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'eager';
    p.appendChild(img);
  }
  return p;
}

function renderLine(lineToks, pillPick) {
  const hasPill = lineToks.some((t) => t.type === 'pill');
  const row = document.createElement('div');
  row.className = `mission-line${hasPill ? ' mission-line--has-pill' : ' mission-line--words-only'}`;

  if (!hasPill) {
    lineToks.forEach((tok, i) => {
      const w = document.createElement('span');
      w.className = 'mission-w';
      w.textContent = tok.text;
      row.appendChild(w);
      if (i < lineToks.length - 1) {
        const sp = document.createElement('span');
        sp.className = 'mission-line-spacer';
        sp.setAttribute('aria-hidden', 'true');
        row.appendChild(sp);
      }
    });
    return row;
  }

  let run = [];
  const flushRun = () => {
    if (!run.length) return;
    const wrap = document.createElement('span');
    wrap.className = 'mission-run';
    run.forEach((t, j) => {
      const el = document.createElement('span');
      el.className = 'mission-w';
      el.textContent = t.text;
      wrap.appendChild(el);
      if (j < run.length - 1) {
        const g = document.createElement('span');
        g.className = 'mission-w-gap';
        g.setAttribute('aria-hidden', 'true');
        wrap.appendChild(g);
      }
    });
    row.appendChild(wrap);
    run = [];
  };

  for (const tok of lineToks) {
    if (tok.type === 'word') run.push(tok);
    else {
      flushRun();
      const url = coffeeImageAtPillIndex(pillPick.i);
      pillPick.i += 1;
      row.appendChild(makePill(url));
    }
  }
  flushRun();
  return row;
}

export function layoutMissionBlock(container) {
  if (!container) return;

  let probe = container.querySelector('.mission-measure-probe');
  if (!probe) {
    probe = document.createElement('span');
    probe.className = 'mission-measure-probe';
    probe.setAttribute('aria-hidden', 'true');
    container.appendChild(probe);
  }

  let pillProbe = container.querySelector('.mission-pill-size-probe');
  if (!pillProbe) {
    pillProbe = document.createElement('span');
    pillProbe.className = 'mission-pill-size-probe mission-pill-slot img-slot img-slot--pill';
    pillProbe.setAttribute('aria-hidden', 'true');
    container.appendChild(pillProbe);
  }

  const cs = getComputedStyle(container);
  probe.style.font = cs.font;

  const fontSize = parseFloat(cs.fontSize) || 22;
  /* Must match .mission-justified-root --mission-inline-gap (0.14em) and .mission-line--has-pill column-gap. */
  const gapPx = Math.max(4, fontSize * 0.14);
  const pillMinPx = Math.max(
    24,
    pillProbe.getBoundingClientRect().width || fontSize * 1.08,
  );

  const availW = Math.max(0, container.clientWidth - 2);
  if (availW < 40) return;

  const tokens = tokenize(MISSION_PHRASES);
  const lines = breakIntoLines(tokens, availW, gapPx, pillMinPx, probe);

  /** Clear user nodes but keep measurement probes (re-append after layout). */
  container
    .querySelectorAll(':scope > *:not(.mission-measure-probe):not(.mission-pill-size-probe)')
    .forEach((el) => el.remove());

  const pillPick = { i: 0 };
  for (const row of lines) container.appendChild(renderLine(row, pillPick));

  if (!container.contains(probe)) container.appendChild(probe);
  if (!container.contains(pillProbe)) container.appendChild(pillProbe);
}

export function bindMissionLayout(container) {
  if (!container) return undefined;

  const run = () => {
    layoutMissionBlock(container);
  };

  let ro;
  let raf;
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(run);
    });
  };

  run();
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(schedule);
    ro.observe(container);
  }
  window.addEventListener('resize', schedule, { passive: true });
  document.fonts?.ready?.then(schedule);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', schedule);
    ro?.disconnect();
  };
}
