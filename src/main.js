import './style.css';
import { bindMissionLayout, MISSION_ARIA_LABEL } from './mission-layout.js';
import geyikUrl from '../assets/geyik.svg?url';
import heroUrl from '../assets/kahve1.svg?url';
import roastLightUrl from '../assets/roast-light.jpg?url';
import roastMediumUrl from '../assets/roast-medium.jpg?url';
import roastMediumDarkUrl from '../assets/roast-medium-dark.jpg?url';
import roastDarkUrl from '../assets/roast-dark.jpg?url';

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

const nav = document.querySelector('nav');
function updateNavScrolled() {
  if (!nav) return;
  nav.classList.toggle('nav-scrolled', window.scrollY > 8);
}
window.addEventListener('scroll', updateNavScrolled, { passive: true });
updateNavScrolled();

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
    syncNavHeightCssVar();
  });
}

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
