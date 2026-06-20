/**
 * Fixed art-directed line maps for the mission block. Resize only changes scale:
 * words do not reflow between lines inside the desktop or mobile states.
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

const MISSION_WORDS = [
  'Seçkin',
  'Arabica',
  'çekirdekleri',
  've',
  'taze',
  'öğütülmüş',
  'baharatlar',
  'ile',
  'inkâr',
  'edilemez',
  'derecede',
  'yoğun,',
  'aromatik',
  'bir',
  'kahve',
  'deneyimine',
  'ne',
  'dersiniz?',
];

export const MISSION_ARIA_LABEL = MISSION_WORDS.join(' ');

const DESKTOP_FONT_REM = 3.55;
const NATURAL_FONT_MIN_REM = 1.45;
const NATURAL_FONT_FLUID_VW = 3.4;
const NATURAL_FONT_FLUID_REM = 0.75;
const MOBILE_FONT_MIN_REM = 1.75;
const MOBILE_FONT_FLUID_VW = 5.6;
const MOBILE_FONT_FLUID_REM = 0.45;
const MOBILE_FONT_MAX_REM = 2.85;
const MIN_FITTED_FONT_PX = 8;
const MOBILE_QUERY = '(max-width: 700px)';

const pill = { type: 'pill' };
const words = (...items) => items.map((text) => ({ type: 'word', text }));

const DESKTOP_LINES = [
  [...words('Seçkin'), pill, ...words('Arabica'), pill, ...words('çekirdekleri')],
  [...words('ve', 'taze'), pill, ...words('öğütülmüş')],
  [...words('baharatlar'), pill, ...words('ile', 'inkâr')],
  [...words('edilemez'), pill, ...words('derecede', 'yoğun,'), pill],
  [...words('aromatik'), pill, ...words('bir'), pill, ...words('kahve')],
  [...words('deneyimine'), pill, ...words('ne', 'dersiniz?')],
];

const MOBILE_LINES = [
  [...words('Seçkin'), pill, ...words('Arabica')],
  [...words('çekirdekleri'), pill],
  [...words('ve'), pill, ...words('taze')],
  [...words('öğütülmüş'), pill],
  [...words('baharatlar'), pill],
  [...words('ile'), pill, ...words('inkâr')],
  [...words('edilemez'), pill],
  [...words('derecede'), pill],
  [...words('yoğun,'), pill],
  [...words('aromatik'), pill],
  [...words('bir'), pill, ...words('kahve')],
  [...words('deneyimine'), pill],
  [...words('ne'), pill, ...words('dersiniz?')],
];

function coffeeImageAtPillIndex(index) {
  return COFFEE_IMAGE_URLS[index % COFFEE_IMAGE_URLS.length];
}

function measureWordWidth(probe, word) {
  probe.textContent = word;
  return probe.getBoundingClientRect().width;
}

function measureTokenWidth(token, pillMinPx, probe) {
  return token.type === 'word' ? measureWordWidth(probe, token.text) : pillMinPx;
}

function measureLineWidth(tokens, gapPx, pillMinPx, probe) {
  if (!tokens.length) return 0;
  const tokenWidth = tokens.reduce((total, token) => total + measureTokenWidth(token, pillMinPx, probe), 0);
  return tokenWidth + gapPx * (tokens.length - 1);
}

function measureWidestLine(lines, gapPx, pillMinPx, probe) {
  return lines.reduce((widest, line) => Math.max(widest, measureLineWidth(line, gapPx, pillMinPx, probe)), 0);
}

function rootFontSizePx() {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function naturalMissionFontSizePx() {
  const rem = rootFontSizePx();
  if (currentLineMap() === MOBILE_LINES) {
    return clampNumber(
      window.innerWidth * (MOBILE_FONT_FLUID_VW / 100) + MOBILE_FONT_FLUID_REM * rem,
      MOBILE_FONT_MIN_REM * rem,
      MOBILE_FONT_MAX_REM * rem,
    );
  }

  return clampNumber(
    window.innerWidth * (NATURAL_FONT_FLUID_VW / 100) + NATURAL_FONT_FLUID_REM * rem,
    NATURAL_FONT_MIN_REM * rem,
    DESKTOP_FONT_REM * rem,
  );
}

function syncProbeFont(probe, cs, fontSizePx = undefined) {
  probe.style.font = cs.font;
  probe.style.fontVariationSettings = cs.fontVariationSettings;
  probe.style.letterSpacing = cs.letterSpacing;
  if (fontSizePx !== undefined) probe.style.fontSize = `${fontSizePx}px`;
}

function currentLineMap() {
  return window.matchMedia?.(MOBILE_QUERY).matches ? MOBILE_LINES : DESKTOP_LINES;
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
  row.className = [
    'mission-line',
    hasPill ? 'mission-line--has-pill' : 'mission-line--words-only',
  ]
    .filter(Boolean)
    .join(' ');

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

  const availW = Math.max(0, container.clientWidth - 2);
  if (availW < 40) return;

  const lines = currentLineMap();
  container.dataset.missionLayout = lines === MOBILE_LINES ? 'mobile' : 'desktop';

  const naturalFontSize = naturalMissionFontSizePx();
  container.style.fontSize = `${naturalFontSize}px`;

  let cs = getComputedStyle(container);
  syncProbeFont(probe, cs);
  let fontSize = naturalFontSize;
  let gapPx = Math.max(4, fontSize * 0.14);
  let pillMinPx = Math.max(
    24,
    pillProbe.getBoundingClientRect().width || fontSize * 1.08,
  );
  let widestLine = measureWidestLine(lines, gapPx, pillMinPx, probe);

  if (widestLine > availW) {
    fontSize = Math.max(MIN_FITTED_FONT_PX, fontSize * (availW / widestLine));
    container.style.fontSize = `${fontSize}px`;
    cs = getComputedStyle(container);
    syncProbeFont(probe, cs);
    gapPx = Math.max(4, fontSize * 0.14);
    pillMinPx = Math.max(
      24,
      pillProbe.getBoundingClientRect().width || fontSize * 1.08,
    );
    widestLine = measureWidestLine(lines, gapPx, pillMinPx, probe);
  }

  if (widestLine > availW) {
    fontSize = Math.max(MIN_FITTED_FONT_PX, fontSize * (availW / widestLine));
    container.style.fontSize = `${fontSize}px`;
    cs = getComputedStyle(container);
    syncProbeFont(probe, cs);
    gapPx = Math.max(4, fontSize * 0.14);
    pillMinPx = Math.max(
      24,
      pillProbe.getBoundingClientRect().width || fontSize * 1.08,
    );
  }

  /** Clear rendered nodes but keep measurement probes for the next layout pass. */
  container
    .querySelectorAll(':scope > *:not(.mission-measure-probe):not(.mission-pill-size-probe)')
    .forEach((el) => el.remove());

  const pillPick = { i: 0 };
  lines.forEach((row) => {
    container.appendChild(renderLine(row, pillPick));
  });

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
