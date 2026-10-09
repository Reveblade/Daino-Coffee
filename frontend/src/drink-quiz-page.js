import './style.css';
import '@phosphor-icons/web/regular';
import { DRINKS, orderHrefForDrink } from './drink-data.js';
import geyikUrl from '../assets/geyik.svg?url';

document.documentElement.style.setProperty('--page-loader-deer-mask', `url("${geyikUrl}")`);

const QUESTIONS = [
  {
    name: 'base',
    icon: 'coffee',
    title: 'İçeceğin ana karakteri ne olsun?',
    options: [
      { value: 'black', label: 'Sade kahve karakteri net olsun', icon: 'coffee' },
      { value: 'milk', label: 'Espresso sütle yumuşasın', icon: 'drop-half-bottom' },
      { value: 'tea', label: 'Bitkisel ve çay bazlı olsun', icon: 'plant' },
      { value: 'water', label: 'Meyveli ve ferah bir baz olsun', icon: 'drop' },
    ],
  },
  {
    name: 'flavor',
    icon: 'cookie',
    title: 'Baskın aroma hangi yönde olsun?',
    options: [
      { value: 'chocolate', label: 'Kakao ve bitter çikolata', icon: 'cookie' },
      { value: 'caramel', label: 'Karamel ve bal tatlılığı', icon: 'drop-half' },
      { value: 'bitter', label: 'Kavruk, yoğun ve hafif acı', icon: 'fire' },
      { value: 'fruit', label: 'Meyvemsi, canlı ve hafif ekşi', icon: 'orange-slice' },
    ],
  },
  {
    name: 'sweetness',
    icon: 'sparkle',
    title: 'Tatlılık seviyen ne olsun?',
    options: [
      { value: 'unsweet', label: 'Sade, şekersiz ve temiz', icon: 'sparkle' },
      { value: 'balanced', label: 'Orta karar, dengeli tatlılık', icon: 'scales' },
      { value: 'sweet', label: 'Belirgin tatlı ve keyifli', icon: 'cake' },
    ],
  },
  {
    name: 'body',
    icon: 'bowl-steam',
    title: 'Doku ve gövde tercihin hangisi?',
    options: [
      { value: 'dense', label: 'Kısa fincan, yoğun ve tok', icon: 'bowl-steam' },
      { value: 'creamy', label: 'Kremamsı, yuvarlak ve sütlü', icon: 'cloud' },
      { value: 'light', label: 'Hafif, akışkan ve ferah', icon: 'drop' },
    ],
  },
  {
    name: 'temperature',
    icon: 'snowflake',
    title: 'Servis modu nasıl olsun?',
    options: [
      { value: 'hot', label: 'Sıcak, klasik ve sakin', icon: 'thermometer-hot' },
      { value: 'cold', label: 'Buzlu, serin ve kahveli', icon: 'snowflake' },
      { value: 'refreshing', label: 'Kafeinsiz veya kahve dışı ferahlık', icon: 'sun-horizon' },
    ],
  },
];

const startPanel = document.querySelector('[data-quiz-start-panel]');
const startButton = document.querySelector('[data-quiz-start]');
const form = document.querySelector('[data-drink-quiz]');
const stepSlot = document.querySelector('[data-quiz-step]');
const prevButton = document.querySelector('[data-quiz-prev]');
const nextButton = document.querySelector('[data-quiz-next]');
const progressText = document.querySelector('[data-quiz-progress-text]');
const progressBar = document.querySelector('[data-quiz-progress-bar]');
const result = document.querySelector('[data-drink-quiz-result]');
const previewGrid = document.querySelector('[data-drink-preview-grid]');
const miniOrbit = document.querySelector('.drink-quiz-mini-orbit');

let currentStep = 0;
const answers = new Map();

function createIcon(name, className) {
  const icon = document.createElement('i');
  icon.className = `ph ph-${name} ${className}`;
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

function setNavButton(button, label, iconName, iconPosition = 'after') {
  if (!button) return;
  const text = document.createElement('span');
  text.textContent = label;
  button.replaceChildren(
    ...(iconPosition === 'before'
      ? [createIcon(iconName, 'drink-quiz-nav-icon'), text]
      : [text, createIcon(iconName, 'drink-quiz-nav-icon')]),
  );
}

function createPreviewCard(drink) {
  const card = document.createElement('a');
  card.href = drink.href;
  card.className = 'drink-quiz-preview-card';

  const img = document.createElement('img');
  img.src = drink.image;
  img.alt = drink.alt;
  img.width = 800;
  img.height = 800;
  img.decoding = 'async';
  img.loading = 'lazy';

  const label = document.createElement('span');
  label.textContent = drink.name;

  card.append(img, label);
  return card;
}

function hydratePreviewCycle() {
  if (!previewGrid || DRINKS.length === 0) return;

  const pageSize = 4;
  const pageCount = Math.ceil(DRINKS.length / pageSize);
  let page = 0;

  const renderPage = () => {
    previewGrid.classList.remove('is-cycling');
    previewGrid.innerHTML = '';
    for (let i = 0; i < pageSize; i += 1) {
      const drink = DRINKS[(page * pageSize + i) % DRINKS.length];
      previewGrid.append(createPreviewCard(drink));
    }
    requestAnimationFrame(() => previewGrid.classList.add('is-cycling'));
  };

  renderPage();
  window.setInterval(() => {
    page = (page + 1) % pageCount;
    renderPage();
  }, 3600);
}

function selectedValues() {
  return new Set([...answers.values()]);
}

function bestMatch() {
  const selected = selectedValues();
  return DRINKS.map((drink) => ({
    drink,
    score: drink.tags.reduce((total, tag) => total + (selected.has(tag) ? 1 : 0), 0),
  })).sort((a, b) => b.score - a.score || a.drink.name.localeCompare(b.drink.name, 'tr'))[0]?.drink ?? DRINKS[0];
}

function renderStep() {
  const question = QUESTIONS[currentStep];
  const saved = answers.get(question.name);
  stepSlot.innerHTML = '';

  const fieldset = document.createElement('fieldset');
  fieldset.className = 'drink-quiz-question drink-quiz-question--step';

  const legend = document.createElement('legend');
  legend.append(createIcon(question.icon, 'drink-quiz-step-icon'), document.createTextNode(question.title));
  fieldset.append(legend);

  const options = document.createElement('div');
  options.className = 'drink-quiz-options';

  question.options.forEach((option) => {
    const label = document.createElement('label');
    label.className = option.value === saved ? 'drink-quiz-option is-selected' : 'drink-quiz-option';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = question.name;
    input.value = option.value;
    input.checked = option.value === saved;

    const text = document.createElement('span');
    text.textContent = option.label;

    input.addEventListener('change', () => {
      answers.set(question.name, option.value);
      options.querySelectorAll('.drink-quiz-option').forEach((item) => {
        item.classList.remove('is-selected', 'is-choosing');
      });
      label.classList.add('is-selected');
      void label.offsetWidth;
      label.classList.add('is-choosing');
      nextButton.disabled = false;
    });

    label.append(input, createIcon(option.icon, 'drink-quiz-option-icon'), text);
    options.append(label);
  });

  fieldset.append(options);
  stepSlot.append(fieldset);

  progressText.textContent = `${currentStep + 1} / ${QUESTIONS.length}`;
  progressBar.style.width = `${((currentStep + 1) / QUESTIONS.length) * 100}%`;
  miniOrbit?.style.setProperty('--drink-quiz-mini-orbit-rotate', `${currentStep * 72}deg`);
  prevButton.hidden = false;
  setNavButton(prevButton, 'Geri', 'arrow-left', 'before');
  setNavButton(
    nextButton,
    currentStep === QUESTIONS.length - 1 ? 'Sonucu göster' : 'İleri',
    currentStep === QUESTIONS.length - 1 ? 'sparkle' : 'arrow-right',
  );
  nextButton.disabled = !answers.has(question.name);

  stepSlot.classList.remove('is-animating');
  requestAnimationFrame(() => stepSlot.classList.add('is-animating'));
}

function showResult() {
  const match = bestMatch();
  form.hidden = true;
  result.hidden = false;
  result.innerHTML = `
    <div class="drink-quiz-result-media">
      <img src="${match.image}" alt="${match.alt}" width="800" height="800" decoding="async">
    </div>
    <p class="drink-quiz-result-kicker">Senin favori içeceğin şu olmalı:</p>
    <h3>${match.name}</h3>
    <p>${match.tags.includes('milk') ? 'Yumuşak ve dengeli' : 'Net karakterli'} bir profil; seçtiğin tat, gövde ve servis tercihlerine en yakın seçenek.</p>
    <div class="drink-quiz-result-actions">
      <a class="drink-detail-cta drink-quiz-result-action drink-quiz-result-action--light" href="${match.href}"><span>İçeceği incele</span><i class="ph ph-arrow-right" aria-hidden="true"></i></a>
      <a class="drink-detail-cta drink-quiz-result-action drink-quiz-result-action--dark" href="${orderHrefForDrink(match)}"><span>Sipariş ver</span><i class="ph ph-shopping-bag" aria-hidden="true"></i></a>
      <button type="button" class="drink-detail-cta drink-quiz-result-action drink-quiz-result-action--light drink-quiz-result-action--wide" data-quiz-restart><span>Yeniden başla</span><i class="ph ph-arrow-clockwise" aria-hidden="true"></i></button>
    </div>
  `;
  result.querySelector('[data-quiz-restart]')?.addEventListener('click', () => {
    answers.clear();
    currentStep = 0;
    result.hidden = true;
    form.hidden = true;
    startPanel.hidden = false;
  });
}

startButton?.addEventListener('click', () => {
  startPanel.hidden = true;
  form.hidden = false;
  renderStep();
});

prevButton?.addEventListener('click', () => {
  if (currentStep === 0) {
    form.hidden = true;
    startPanel.hidden = false;
    return;
  }
  currentStep -= 1;
  renderStep();
});

nextButton?.addEventListener('click', () => {
  if (!answers.has(QUESTIONS[currentStep].name)) return;
  if (currentStep === QUESTIONS.length - 1) {
    showResult();
    return;
  }
  currentStep += 1;
  renderStep();
});

form?.addEventListener('submit', (event) => {
  event.preventDefault();
});

hydratePreviewCycle();
