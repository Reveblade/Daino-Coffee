import './style.css';
import '@phosphor-icons/web/regular';
import { bindMissionLayout, MISSION_ARIA_LABEL } from './mission-layout.js';
import geyikUrl from '../assets/geyik.svg?url';
import heroUrl from '../assets/kahve1.svg?url';
import roastLightUrl from '../assets/roast-light.jpg?url';
import roastMediumUrl from '../assets/roast-medium.jpg?url';
import roastMediumDarkUrl from '../assets/roast-medium-dark.jpg?url';
import roastDarkUrl from '../assets/roast-dark.jpg?url';
import { DRINKS } from './drink-data.js';

document.documentElement.style.setProperty('--page-loader-deer-mask', `url("${geyikUrl}")`);

document.querySelectorAll('.hero-glass-img').forEach((img) => {
  img.src = heroUrl;
});

const roastThumbSrc = {
  light: roastLightUrl,
  medium: roastMediumUrl,
  'medium-dark': roastMediumDarkUrl,
  dark: roastDarkUrl,
};

function hydrateRoastThumbs() {
  document.querySelectorAll('#roastList .roast-item[data-roast]').forEach((item) => {
    const key = item.dataset.roast;
    const url = roastThumbSrc[key];
    const slot = item.querySelector('.roast-slot');
    if (!slot || !url) return;
    slot.textContent = '';
    const img = document.createElement('img');
    img.className = 'roast-thumb';
    img.src = url;
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'lazy';
    img.setAttribute('aria-hidden', 'true');
    img.width = 128;
    img.height = 128;
    slot.appendChild(img);
  });
}
hydrateRoastThumbs();

function createDrinkCard(drink) {
  const card = document.createElement('a');
  card.href = drink.href;
  card.className = 'coffee-cell coffee-cell-link';

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = drink.name;

  const ring = document.createElement('div');
  ring.className = 'coffee-photo-ring';

  const img = document.createElement('img');
  img.src = drink.image;
  img.alt = drink.alt;
  img.width = 800;
  img.height = 800;
  img.decoding = 'async';
  img.loading = 'lazy';

  ring.append(img);
  card.append(label, ring);
  return card;
}

function createDrinkPlaceholder() {
  const card = document.createElement('div');
  card.className = 'coffee-cell coffee-cell-placeholder';
  card.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = '\u00a0';

  const ring = document.createElement('div');
  ring.className = 'coffee-photo-ring';

  card.append(label, ring);
  return card;
}

function hydrateDrinkCarousel() {
  const grid = document.querySelector('[data-drink-carousel-grid]');
  if (!grid) return;

  const carousel = grid.closest('.drink-carousel');
  const prev = document.querySelector('[data-drink-carousel-prev]');
  const next = document.querySelector('[data-drink-carousel-next]');
  const status = document.querySelector('[data-drink-carousel-status]');
  const mobileCarouselMedia = window.matchMedia?.('(max-width: 560px)');
  const getPageSize = () => (mobileCarouselMedia?.matches ? 6 : 9);
  const autoplayDelay = 3600;
  let pageSize = getPageSize();
  let pageCount = Math.ceil(DRINKS.length / pageSize);
  let page = 0;
  let autoplayTimer;

  const updatePageMetrics = () => {
    pageSize = getPageSize();
    pageCount = Math.ceil(DRINKS.length / pageSize);
    page = Math.min(page, pageCount - 1);
  };

  const renderPage = (direction = 'next') => {
    updatePageMetrics();
    grid.classList.remove('is-animating', 'is-animating-next', 'is-animating-prev');
    grid.innerHTML = '';
    const start = page * pageSize;
    const visible = DRINKS.slice(start, start + pageSize);
    visible.forEach((drink) => grid.append(createDrinkCard(drink)));
    for (let i = visible.length; i < pageSize; i += 1) {
      grid.append(createDrinkPlaceholder());
    }
    if (status) status.textContent = `${page + 1} / ${pageCount}`;

    if (!prefersReducedMotion()) {
      void grid.offsetWidth;
      grid.classList.add('is-animating', `is-animating-${direction}`);
    }
  };

  const showPage = (nextPage, direction) => {
    page = (nextPage + pageCount) % pageCount;
    renderPage(direction);
  };

  const stopAutoplay = () => {
    window.clearInterval(autoplayTimer);
  };

  const startAutoplay = () => {
    if (pageCount <= 1 || prefersReducedMotion()) return;
    stopAutoplay();
    autoplayTimer = window.setInterval(() => showPage(page + 1, 'next'), autoplayDelay);
  };

  const restartAutoplay = () => {
    stopAutoplay();
    startAutoplay();
  };

  prev?.addEventListener('click', () => {
    showPage(page - 1, 'prev');
    restartAutoplay();
  });
  next?.addEventListener('click', () => {
    showPage(page + 1, 'next');
    restartAutoplay();
  });

  grid.addEventListener('animationend', () => {
    grid.classList.remove('is-animating', 'is-animating-next', 'is-animating-prev');
  });
  carousel?.addEventListener('mouseenter', stopAutoplay);
  carousel?.addEventListener('mouseleave', startAutoplay);
  carousel?.addEventListener('focusin', stopAutoplay);
  carousel?.addEventListener('focusout', startAutoplay);
  mobileCarouselMedia?.addEventListener('change', () => {
    const firstVisibleItem = page * pageSize;
    updatePageMetrics();
    page = Math.min(Math.floor(firstVisibleItem / pageSize), pageCount - 1);
    renderPage();
    restartAutoplay();
  });

  renderPage();
  startAutoplay();
}

hydrateDrinkCarousel();

const nav = document.querySelector('nav');
function updateNavScrolled() {
  if (!nav) return;
  nav.classList.toggle('nav-scrolled', window.scrollY > 8);
}
window.addEventListener('scroll', updateNavScrolled, { passive: true });
updateNavScrolled();

const NAV_AUTO_HIDE_DELAY = 1000;
const NAV_REVEAL_ZONE = 72;
const NAV_AUTO_HIDE_QUERY = '(min-width: 901px) and (hover: hover) and (pointer: fine)';
const navAutoHideMedia = window.matchMedia?.(NAV_AUTO_HIDE_QUERY);
let navHideTimer;

function isAtPageTop() {
  return window.scrollY <= 8;
}

function canAutoHideNav() {
  return navAutoHideMedia?.matches ?? false;
}

function setNavHidden(hidden) {
  if (!canAutoHideNav()) {
    nav?.classList.remove('nav-hidden');
    return;
  }
  if (!nav || isAtPageTop() || menu?.classList.contains('open') || nav.matches(':hover, :focus-within')) return;
  nav.classList.toggle('nav-hidden', hidden);
}

function scheduleNavHide() {
  if (!nav) return;
  window.clearTimeout(navHideTimer);
  if (!canAutoHideNav() || isAtPageTop()) {
    nav.classList.remove('nav-hidden');
    return;
  }
  navHideTimer = window.setTimeout(() => setNavHidden(true), NAV_AUTO_HIDE_DELAY);
}

function revealNav() {
  if (!nav) return;
  window.clearTimeout(navHideTimer);
  nav.classList.remove('nav-hidden');
}

function syncNavHeightCssVar() {
  if (!nav) return;
  document.documentElement.style.setProperty('--nav-height', `${nav.offsetHeight}px`);
}
syncNavHeightCssVar();
window.addEventListener('resize', syncNavHeightCssVar);
document.fonts?.ready?.then(syncNavHeightCssVar);
if (typeof ResizeObserver !== 'undefined' && nav) {
  new ResizeObserver(syncNavHeightCssVar).observe(nav);
}

const ham = document.getElementById('hamburger');
const menu = document.getElementById('mobileMenu');
if (ham && menu) {
  ham.addEventListener('click', () => {
    menu.classList.toggle('open');
    nav?.classList.toggle('nav-menu-open', menu.classList.contains('open'));
    if (menu.classList.contains('open')) {
      revealNav();
    } else {
      scheduleNavHide();
    }
    syncNavHeightCssVar();
  });
}

navAutoHideMedia?.addEventListener?.('change', () => {
  revealNav();
  scheduleNavHide();
});

if (nav && canAutoHideNav()) {
  window.addEventListener(
    'pointermove',
    (event) => {
      if (event.clientY <= NAV_REVEAL_ZONE || nav.matches(':hover')) {
        revealNav();
        scheduleNavHide();
      }
    },
    { passive: true },
  );
  nav.addEventListener('focusin', revealNav);
  nav.addEventListener('focusout', scheduleNavHide);
  window.addEventListener(
    'scroll',
    () => {
      if (isAtPageTop()) {
        revealNav();
      } else {
        scheduleNavHide();
      }
    },
    { passive: true },
  );
  scheduleNavHide();
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
}

/** In-page nav: smooth scroll without leaving `#fragment` in the address bar. */
function scrollToIdWithoutHash(id) {
  const el = document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView({
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    block: 'start',
  });
  const path = `${window.location.pathname}${window.location.search}`;
  if (window.location.hash) {
    history.replaceState(null, '', path);
  }
  return true;
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || !href.startsWith('#') || href === '#') return;
  const id = href.slice(1);
  if (!document.getElementById(id)) return;
  e.preventDefault();
  scrollToIdWithoutHash(id);
  if (menu?.classList.contains('open')) {
    menu.classList.remove('open');
    nav?.classList.remove('nav-menu-open');
    syncNavHeightCssVar();
  }
});

(() => {
  const id = window.location.hash?.slice(1);
  if (!id || !document.getElementById(id)) return;
  const path = `${window.location.pathname}${window.location.search}`;
  history.replaceState(null, '', path);
  window.requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
  });
})();

/** Tile HTML until the row covers the band, then mirror for translateX(-50%) seam. */
function buildMarqueeTrack(track) {
  const band = track?.closest('.diag-band');
  if (!track || !band) return;
  if (!track.dataset.marqueeTemplate) {
    track.dataset.marqueeTemplate = track.innerHTML.trim();
  }
  const template = track.dataset.marqueeTemplate;
  if (!template) return;

  const minRun = Math.max(band.clientWidth, band.offsetWidth, 400) * 1.2;
  track.innerHTML = template;
  let guard = 0;
  while (track.scrollWidth < minRun && guard++ < 120) {
    track.insertAdjacentHTML('beforeend', template);
  }
  track.innerHTML += track.innerHTML;
}

function scheduleMarqueeFill() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelectorAll('.diag-marquee').forEach(buildMarqueeTrack);
    });
  });
}

scheduleMarqueeFill();

if (typeof ResizeObserver !== 'undefined') {
  const marqueeRo = new ResizeObserver(scheduleMarqueeFill);
  document.querySelectorAll('.diag-band').forEach((band) => marqueeRo.observe(band));
}

window.addEventListener('load', scheduleMarqueeFill, { once: true });
document.fonts?.ready?.then(scheduleMarqueeFill);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', scheduleMarqueeFill);
}
[80, 240].forEach((ms) => setTimeout(scheduleMarqueeFill, ms));

/** Back strip uses top:% of photo; hero clip used % of hero → gap. Align clip to strip top edge in viewport px. */
function rotationRadFromTransform(strip) {
  const tr = getComputedStyle(strip).transform;
  if (!tr || tr === 'none') {
    const tilt = getComputedStyle(document.documentElement).getPropertyValue('--hero-back-strip-tilt');
    return ((parseFloat(tilt) || -3.5) * Math.PI) / 180;
  }
  const m = new DOMMatrix(tr);
  return Math.atan2(m.b, m.a);
}

function syncHeroGreenClip() {
  const hero = document.querySelector('.hero');
  const strip = hero?.querySelector('.diag-band--a.diag-band--back');
  if (!hero || !strip) return;

  const hr = hero.getBoundingClientRect();
  const sr = strip.getBoundingClientRect();
  if (sr.width < 2 || sr.height < 2) return;

  const θ = rotationRadFromTransform(strip);
  const cos = Math.cos(θ);
  const sin = Math.sin(θ);
  const cx = sr.left + sr.width / 2;
  const cy = sr.top + sr.height / 2;
  const half = strip.offsetHeight / 2;
  const Tx = cx + half * sin;
  const Ty = cy - half * cos;

  const yAtViewportX = (vx) => {
    if (Math.abs(cos) < 1e-5) return Ty + ((vx - Tx) / sin) * cos;
    const t = (vx - Tx) / cos;
    return Ty + t * sin;
  };

  const padTop = hr.top + hero.clientTop;
  const padLeft = hr.left + hero.clientLeft;
  const innerRight = padLeft + hero.clientWidth;

  const yLeft = yAtViewportX(padLeft);
  const yRight = yAtViewportX(innerRight);

  const bl = Math.max(0, Math.ceil(yLeft - padTop));
  const br = Math.max(0, Math.ceil(yRight - padTop));

  hero.style.setProperty('--hero-clip-bl', `${bl}px`);
  hero.style.setProperty('--hero-clip-br', `${br}px`);
}

function scheduleHeroGreenClip() {
  requestAnimationFrame(() => {
    requestAnimationFrame(syncHeroGreenClip);
  });
}

if (typeof ResizeObserver !== 'undefined') {
  const hero = document.querySelector('.hero');
  if (hero) {
    const ro = new ResizeObserver(scheduleHeroGreenClip);
    ro.observe(hero);
    const stage = hero.querySelector('.hero-stage');
    if (stage) ro.observe(stage);
    const photo = hero.querySelector('.hero-glass-photo');
    if (photo) ro.observe(photo);
    const img = hero.querySelector('.hero-glass-img');
    if (img) ro.observe(img);
  }
}
scheduleHeroGreenClip();
window.addEventListener('resize', scheduleHeroGreenClip);

const heroGlassImg = document.querySelector('.hero-glass-img');
if (heroGlassImg) {
  const bump = scheduleHeroGreenClip;
  if (heroGlassImg.complete) bump();
  else heroGlassImg.addEventListener('load', bump, { once: true });
  const decodeP = heroGlassImg.decode?.();
  if (decodeP) decodeP.then(bump).catch(bump);
}

window.addEventListener('load', scheduleHeroGreenClip, { once: true });
document.fonts?.ready?.then(scheduleHeroGreenClip);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', scheduleHeroGreenClip);
}
[80, 240].forEach((ms) => setTimeout(scheduleHeroGreenClip, ms));

const missionJustified = document.getElementById('missionJustified');
if (missionJustified) {
  missionJustified.setAttribute('aria-label', MISSION_ARIA_LABEL);
  bindMissionLayout(missionJustified);
}

const CUSTOMER_TOKEN_KEY = 'daino_customer_token';
const CUSTOMER_REFRESH_KEY = 'daino_customer_refresh';

function hasCustomerSession() {
  return Boolean(
    localStorage.getItem(CUSTOMER_TOKEN_KEY) || localStorage.getItem(CUSTOMER_REFRESH_KEY),
  );
}

document.querySelectorAll('[data-customer-auth-cta]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    window.location.href = hasCustomerSession() ? '/siparis' : '/siparis/hesap';
  });
});

const list = document.getElementById('roastList');
if (list) {
  list.querySelectorAll('.roast-item').forEach((item) => {
    item.addEventListener('click', () => {
      list.querySelectorAll('.roast-item').forEach((i) => i.classList.remove('active'));
      item.classList.add('active');
    });
  });
}

function whenWindowLoad() {
  return new Promise((resolve) => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', () => resolve(), { once: true });
  });
}

function whenImageReady(img) {
  if (!img?.src || img.complete) return Promise.resolve();
  return new Promise((resolve) => {
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => resolve(), { once: true });
  });
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    }),
  ]);
}

(async function dismissPageLoader() {
  const loader = document.getElementById('page-loader');
  const html = document.documentElement;
  if (!loader) return;

  // Do not wait for lazy below-the-fold images (e.g. roast thumbs): they may never
  // start loading while a full-screen overlay is up, which deadlocks the loader.
  await withTimeout(
    Promise.all([
      whenWindowLoad(),
      document.fonts?.ready ?? Promise.resolve(),
      whenImageReady(document.querySelector('.hero-glass-img')),
    ]),
    12000,
  );

  loader.classList.add('page-loader--exiting');
  html.classList.remove('page-loader-locked');
  loader.setAttribute('aria-busy', 'false');

  const remove = () => {
    loader.remove();
  };

  loader.addEventListener('transitionend', remove, { once: true });
  window.setTimeout(remove, 900);
})();
