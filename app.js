'use strict';

// ---------- утилиты ----------
const KEY = 'focus90:v1';
const DRAFT_KEY = 'focus90:draft';
const THEME_KEY = 'focus90:theme';
const DAY = 864e5;
const PARK_DAYS = 30;
const CYCLE_DAYS = 90;

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);
const weekKey = (d = new Date()) => dateKey(addDays(d, -((new Date(d).getDay() + 6) % 7)));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtLong = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const plural = (n, one, few, many) => {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
};
const nDays = (n) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
const lines = (s) => String(s || '').split('\n').map((l) => l.trim()).filter(Boolean);
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// Заголовок, который при входе на экран проявляется по словам.
const words = (t) => esc(t).split(' ').map((w, i) => `<span class="w" style="--w:${i}">${w}</span>`).join(' ');
const H = (t) => `<h2 class="h">${words(t)}</h2>`;
const PLAY = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 5v14l12-7z" fill="currentColor"/></svg>';

// ---------- хранилище ----------
const fresh = () => ({ v: 1, items: [], focus: null, history: [], weeks: {}, days: {}, reviews: [], lastReview: 0, timer: null });

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...fresh(), ...JSON.parse(raw) };
      s.items.forEach((i) => { i.scores ||= { imp: 0, energy: 0, real: 0 }; });
      return s;
    }
  } catch {}
  return fresh();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { toast('Не получилось сохранить на устройстве'); }
}
function readTheme() { try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch { return 'auto'; } }
function readDraft() { try { return localStorage.getItem(DRAFT_KEY) || ''; } catch { return ''; } }
function writeDraft(v) { try { v ? localStorage.setItem(DRAFT_KEY, v) : localStorage.removeItem(DRAFT_KEY); } catch {} }

let S = load();
const ui = { tab: 'today', seg: 'park', undo: null, draft: readDraft(), review: null, day: dateKey(), theme: readTheme() };
let installPrompt = null;

function commit() { save(); render(); }

// ---------- выборки ----------
const bucket = (b) => S.items.filter((i) => i.bucket === b);
const byMoved = (list) => list.slice().sort((a, b) => b.movedAt - a.movedAt);
const findItem = (id) => S.items.find((i) => i.id === id);
const isRipe = (i) => Date.now() - i.movedAt >= PARK_DAYS * DAY;
const score = (i) => i.scores.imp * i.scores.energy * i.scores.real;
const isRated = (i) => score(i) > 0;
const weekTasks = (k = weekKey()) => S.weeks[k]?.tasks || [];
const today = () => S.days[dateKey()];
const focusLen = () => S.focus.days || CYCLE_DAYS;
const focusDay = () => daysBetween(S.focus.start, Date.now()) + 1;
const last7 = () => Array.from({ length: 7 }, (_, i) => !!S.days[dateKey(addDays(new Date(), i - 6))]?.done);

function addItems(texts, b = 'inbox') {
  const now = Date.now();
  for (const text of texts) S.items.push({ id: uid(), text, bucket: b, at: now, movedAt: now, scores: { imp: 0, energy: 0, real: 0 }, regret: false });
}
function move(item, b) { item.bucket = b; item.movedAt = Date.now(); }

function reviewDue() {
  if (!S.focus) return false;
  const since = Date.now() - Math.max(S.lastReview || 0, S.focus.start);
  const wd = new Date().getDay();
  return since > 7 * DAY || ((wd === 0 || wd === 6) && since > 2 * DAY);
}
// В выходные обзор планирует следующую неделю, в будни — текущую.
function reviewTarget() {
  const wd = new Date().getDay();
  return wd === 0 || wd === 6 ? weekKey(addDays(new Date(), 7)) : weekKey();
}

// ---------- экраны ----------
const views = { today: viewToday, sort: viewSort, focus: viewFocus, lists: viewLists };
const TABS = Object.keys(views);

function render() {
  const view = $('#view');
  view.innerHTML = views[ui.tab]();
  // Blur Fade и Number Ticker — только при входе на экран, а не на каждую отметку.
  if (ui.shown !== ui.tab) {
    ui.shown = ui.tab;
    [...view.children].forEach((c, i) => c.style.setProperty('--d', i));
    view.classList.remove('enter');
    void view.offsetWidth;
    view.classList.add('enter');
    clearTimeout(ui.enterT);
    ui.enterT = setTimeout(() => view.classList.remove('enter'), 2200);
    if (!reduceMotion()) view.querySelectorAll('[data-count]').forEach(countUp);
  }
  document.querySelectorAll('.tab').forEach((t) => {
    if (t.dataset.tab === ui.tab) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  // Линза дока переезжает к активной вкладке и на ходу чуть растягивается, как капля.
  const i = TABS.indexOf(ui.tab);
  if (ui.lens !== i) {
    $('#dock').style.setProperty('--i', i);
    const lens = $('.lens');
    if (ui.lens !== undefined) { lens.classList.remove('moving'); void lens.offsetWidth; lens.classList.add('moving'); }
    ui.lens = i;
  }
  // Фоновый свет отражает состояние: спокойный → тёплый фокус → «расцвет», когда главное дня сделано.
  $('#aurora').dataset.mood = !S.focus ? 'calm' : today()?.done ? 'done' : 'focus';
  const n = bucket('inbox').length;
  const badge = $('#inboxBadge');
  badge.textContent = n;
  badge.hidden = !n;
  updateTimer();
}

function viewToday() {
  const out = [`<p class="eyebrow">${esc(cap(fmtLong.format(new Date())))}</p>`];
  if (!S.focus) return out.concat(`<div class="mt"></div>`, heroCard()).join('');
  out.push(H('Сегодня'));
  out.push(focusCard(), reviewDue() ? reviewBanner() : '', todayCard(), weekCard());
  return out.join('');
}

function heroCard() {
  const inbox = bucket('inbox').length, cands = bucket('candidate').length;
  const stage = !S.items.length ? 0 : inbox ? 1 : 2;
  const steps = [
    ['Выгрузи всё из головы', 'Дела, идеи, обещания, тревоги — минут на 30.'],
    ['Разложи по 4 корзинам', 'Кандидат, обязательство, парковка, отпустить.'],
    ['Выбери один фокус на 90 дней', 'Оцени кандидатов и начни с шага на 15 минут.'],
  ];
  const [tab, label] = stage === 0 ? ['sort', 'Начать выгрузку']
    : stage === 1 ? ['sort', `Разобрать ${inbox}`]
    : cands ? ['focus', 'Выбрать фокус'] : ['sort', 'Выгрузить ещё'];
  const title = S.history.length ? 'Новый цикл. Что дальше?' : 'Ясность начинается с выгрузки';
  const sub = stage === 2 && !cands
    ? 'Кандидатов в фокус нет. Добавь мысли или верни созревшую идею с парковки.'
    : 'Хаос в голове — не проблема характера. Это незаписанный список. Три шага:';
  return `<section class="card hero beam">
    <h1>${words(title)}</h1>
    <p class="hint">${sub}</p>
    <ol class="steps">${steps.map(([b, s], i) => `<li class="${i < stage ? 'done' : i === stage ? 'now' : ''}"><span class="n">${i < stage ? '✓' : i + 1}</span><div><b>${b}</b><span>${s}</span></div></li>`).join('')}</ol>
    <button class="btn primary block" data-act="tab" data-tab="${tab}">${label}</button>
  </section>`;
}

// Кольцо прогресса в духе колец активности. id градиента у каждого кольца свой.
function ring(pct, { id, cls = '', inner, label, attr = '' }) {
  return `<div class="ring ${cls}" role="img" aria-label="${label}">
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--g1)"/><stop offset=".55" style="stop-color:var(--g2)"/><stop offset="1" style="stop-color:var(--g3)"/></linearGradient></defs>
      <circle class="track" cx="60" cy="60" r="52"/>
      <circle class="bar" cx="60" cy="60" r="52" pathLength="100" stroke="url(#${id})" stroke-dasharray="${Math.min(100, pct).toFixed(2)} 100" ${attr}/>
    </svg>
    <div class="ring-num">${inner}</div>
  </div>`;
}

function focusCard() {
  const f = S.focus, d = focusDay(), len = focusLen(), over = d > len;
  return `<section class="card focus-card beam">
    <div class="focus-top">
      ${ring((d / len) * 100, { id: 'gFocus', cls: over ? 'ok' : '', inner: `<b data-count="${d}">${d}</b><span>из ${len}</span>`, label: `День ${d} из ${len}` })}
      <div>
        <p class="label">${over ? 'Цикл окончен' : `Фокус · до ${fmtShort.format(f.end)}`}</p>
        <h1 class="focus-title">${esc(f.title)}</h1>
      </div>
    </div>
    <p class="done-when"><span>Готово, когда</span>${esc(f.doneWhen)}</p>
    ${over ? `<button class="btn primary hero-btn block" data-act="finish">Подвести итог цикла</button>` : ''}
  </section>`;
}

const reviewBanner = () => `<button class="banner" data-act="review"><span><b>Недельный обзор</b><span class="sub">20 минут: что сделано, что отпустить, 3 задачи на неделю</span></span><span class="arr" aria-hidden="true">→</span></button>`;

function todayCard() {
  const t = today();
  if (!t) {
    const sugg = weekTasks().filter((x) => !x.done).map((x) => x.text);
    return `<section class="card">
      <p class="label">Главное сегодня</p>
      <p class="hint">Одно дело для фокуса. Сделай его первым — в первые 60–90 минут дня, без телефона.</p>
      <form class="inline-form" data-form="day"><input type="text" name="text" placeholder="Что одно сделать сегодня?" enterkeyhint="done" autocomplete="off" required><button class="btn primary">OK</button></form>
      ${sugg.length ? `<div class="chips">${sugg.map((s) => `<button class="chip" data-act="day-pick" data-text="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
      ${streak()}
    </section>`;
  }
  return `<section class="card">
    <p class="label">Главное сегодня</p>
    <button class="check big" role="checkbox" aria-checked="${!!t.done}" data-act="day-toggle"><span class="box"></span><span class="txt">${esc(t.text)}</span></button>
    ${t.done
      ? `<p class="hint ok-text">Сделано. Всё остальное сегодня — бонус.</p>`
      : `<div class="row mt"><button class="btn primary" data-act="timer" data-min="15">${PLAY} 15 минут</button><button class="btn ghost" data-act="day-clear">Изменить</button></div>`}
    ${streak()}
  </section>`;
}

function streak() {
  const days = last7(), n = days.filter(Boolean).length;
  return `<div class="dots" aria-label="Главное сделано ${n} из 7 последних дней">${days.map((on, i) => `<i class="${on ? 'on' : ''}${i === 6 ? ' today' : ''}" style="--k:${i}"></i>`).join('')}<span><b data-count="${n}">${n}</b> из 7 дней</span></div>`;
}

function weekCard() {
  const tasks = weekTasks(), done = tasks.filter((t) => t.done).length;
  return `<section class="card">
    <div class="card-head"><p class="label">Три задачи недели</p>${tasks.length ? `<span class="meta">${done} из ${tasks.length}</span>` : ''}</div>
    ${tasks.length
      ? `<ul class="tasks">${tasks.map((t) => `<li><button class="check" role="checkbox" aria-checked="${!!t.done}" data-act="week-toggle" data-id="${t.id}"><span class="box"></span><span class="txt">${esc(t.text)}</span></button><button class="x" data-act="week-del" data-id="${t.id}" aria-label="Удалить задачу">×</button></li>`).join('')}</ul>`
      : `<p class="hint">Три шага, которые за эту неделю двинут фокус вперёд.</p>`}
    ${tasks.length < 3
      ? `<form class="inline-form" data-form="week"><input type="text" name="text" placeholder="Задача ${tasks.length + 1} из 3" enterkeyhint="done" autocomplete="off" required><button class="btn">Добавить</button></form>`
      : `<p class="hint small">Три — это предел. Новое — после этих.</p>`}
  </section>`;
}

const BUCKETS = {
  candidate: ['Кандидат в фокус', 'Может стать главным на 90 дней'],
  duty: ['Обязательство', 'Нельзя бросить — делаю минимум'],
  park: ['Парковка', 'Идея подождёт 30 дней'],
  closed: ['Отпустить', 'Честно: этого не будет'],
};

function viewSort() {
  const inbox = bucket('inbox');
  const out = [H('Разбор')];
  if (inbox.length) {
    const it = inbox[0];
    out.push(`<section class="card triage">
      <div class="card-head"><p class="label">Осталось ${inbox.length}</p>${ui.undo ? `<button class="link" data-act="undo">Отменить</button>` : ''}</div>
      <p class="triage-text">${esc(it.text)}</p>
      <div class="buckets">${Object.entries(BUCKETS).map(([b, [t, s]], i) => `<button class="bucket" data-b="${b}" data-act="triage" data-id="${it.id}" data-to="${b}"><b>${t}<kbd>${i + 1}</kbd></b><span>${s}</span></button>`).join('')}</div>
    </section>`);
  } else if (S.items.length) {
    out.push(sortSummary());
  }
  out.push(`<section class="card">
    <p class="label">${inbox.length ? 'Добавить ещё' : 'Выгрузи всё из головы'}</p>
    <p class="hint">Дела, проекты, идеи, обещания людям, «надо бы», тревоги. Каждая мысль — с новой строки. Не сортируй и не оценивай — пиши, пока не закончится.</p>
    <form data-form="dump">
      <textarea name="text" rows="${inbox.length ? 4 : 9}" placeholder="Доделать портфолио&#10;Позвонить родителям&#10;Идея: своё приложение">${esc(ui.draft)}</textarea>
      <button class="btn primary block mt">Во входящие</button>
    </form>
  </section>`);
  return out.join('');
}

function sortSummary() {
  const c = (b) => bucket(b).length;
  return `<section class="card">
    <p class="label">Входящие разобраны</p>
    <div class="tally">${Object.entries(BUCKETS).map(([b, [t]]) => `<div data-b="${b}"><b data-count="${c(b)}">${c(b)}</b><span>${t}</span></div>`).join('')}</div>
    ${!S.focus && c('candidate') ? `<button class="btn primary block mt" data-act="tab" data-tab="focus">Выбрать фокус из ${c('candidate')}</button>` : ''}
  </section>`;
}

function viewFocus() {
  const cands = bucket('candidate');
  const ripe = bucket('park').filter(isRipe);
  const out = [];
  if (S.focus) {
    const left = Math.max(0, focusLen() - focusDay() + 1);
    out.push(H('Текущий фокус'), focusCard(),
      `<div class="row stack"><button class="btn block" data-act="review">Недельный обзор</button><button class="btn block" data-act="edit-focus">Уточнить формулировку</button><button class="btn ghost block" data-act="finish">Завершить фокус</button></div>`);
    if (cands.length) {
      out.push(`<section class="card"><p class="label">Ждут следующего цикла · ${cands.length}</p><p class="hint">Слот занят: один фокус за раз. ${left ? `Через ${nDays(left)} выберешь из них.` : 'Цикл окончен — подведи итог и выбирай.'}</p><ul class="list">${cands.map((i) => `<li><p class="li-text">${esc(i.text)}</p></li>`).join('')}</ul></section>`);
    }
  } else {
    out.push(`${H('Выбери один фокус')}<p class="lead">Какое одно дело на ближайшие 90 дней сделает остальное проще или вообще ненужным?</p>`);
    if (!cands.length) out.push(`<section class="card empty"><p>Кандидатов пока нет.</p><button class="btn primary" data-act="tab" data-tab="sort">Выгрузить и разобрать</button></section>`);
    else out.push(leaderCard(cands), ...cands.map(candCard));
  }
  if (ripe.length) out.push(`<section class="card"><p class="label">Созрели на парковке · ${ripe.length}</p><p class="hint">Прошло 30 дней. Всё ещё горит?</p><ul class="list">${ripe.map(ripeRow).join('')}</ul></section>`);
  if (S.history.length) out.push(historyCard());
  return out.join('');
}

function leaderCard(cands) {
  const ranked = cands.filter(isRated).sort((a, b) => score(b) - score(a) || b.regret - a.regret);
  const left = cands.length - ranked.length;
  if (!ranked.length) {
    return `<section class="card leader"><p class="label">Как выбрать</p><p class="hint">Оцени каждого кандидата по трём шкалам от 1 до 5. Баллы перемножатся — и лидер обычно становится очевиден. Тест сожаления помогает, когда баллы равны.</p></section>`;
  }
  const [a, b] = ranked;
  const close = b && score(a) - score(b) <= Math.max(4, score(a) * 0.15);
  return `<section class="card leader">
    <p class="label">Лидер${left ? ` · не оценено ещё ${left}` : ''}</p>
    <p class="leader-title">${esc(a.text)}</p>
    ${ranked.length > 1 ? `<ol class="rank">${ranked.slice(0, 3).map((i) => `<li><span>${esc(i.text)}</span><b>${score(i)}</b></li>`).join('')}</ol>` : ''}
    ${close ? `<p class="hint">Первые два почти равны. Подбрось монетку: пока она в воздухе, станет понятно, на что ты надеешься.</p><button class="btn block mb" data-act="coin" data-a="${a.id}" data-b="${b.id}">Подбросить монетку</button>` : ''}
    <button class="btn primary block" data-act="pick" data-id="${a.id}">Сделать фокусом</button>
  </section>`;
}

const AXES = [['imp', 'Важность'], ['energy', 'Моя энергия к этому'], ['real', 'Реально за 90 дней']];

function candCard(i) {
  return `<article class="card cand${isRated(i) ? '' : ' unrated'}">
    <div class="cand-head"><p class="cand-text">${esc(i.text)}</p><span class="score" title="Важность × энергия × реальность">${isRated(i) ? score(i) : '—'}</span></div>
    ${AXES.map(([k, label]) => `<div class="axis"><span>${label}</span><div class="seg" role="group" aria-label="${label}">${[1, 2, 3, 4, 5].map((n) => `<button data-act="rate" data-id="${i.id}" data-k="${k}" data-v="${n}" aria-pressed="${i.scores[k] === n}" class="${n <= i.scores[k] ? 'on' : ''}">${n}</button>`).join('')}</div></div>`).join('')}
    <button class="toggle" role="switch" aria-checked="${!!i.regret}" data-act="regret" data-id="${i.id}"><span class="sw"></span>Пожалею через 5 лет, если не сделаю</button>
    <div class="cand-foot"><button class="link muted" data-act="cand-park" data-id="${i.id}">На парковку</button><button class="link" data-act="pick" data-id="${i.id}">Выбрать этот →</button></div>
  </article>`;
}

const ripeRow = (i) => `<li><p class="li-text">${esc(i.text)}</p><div class="row"><button class="btn sm" data-act="promote" data-id="${i.id}">Да, в кандидаты</button><button class="btn sm ghost" data-act="release" data-id="${i.id}">Отпустить</button></div></li>`;

function historyCard() {
  return `<section class="card"><p class="label">Завершённые циклы · ${S.history.length}</p><ul class="list">${S.history.slice().reverse().map((h) => `<li>
    <p class="li-text"><span class="tag ${h.outcome}">${h.outcome === 'done' ? 'Готово' : 'Закрыто'}</span>${esc(h.title)}</p>
    <div class="li-meta"><span>${fmtShort.format(h.start)} — ${fmtShort.format(h.closedAt)}</span></div>
    ${h.note ? `<p class="li-note">${esc(h.note)}</p>` : ''}
  </li>`).join('')}</ul></section>`;
}

function viewLists() {
  const segs = { park: 'Парковка', duty: 'Обязательства', closed: 'Отпущено' };
  const items = byMoved(bucket(ui.seg));
  const intro = {
    park: 'Правило 30 дней: новая идея ждёт месяц. Если всё ещё горит — может стать кандидатом. Большинство остынут сами.',
    duty: 'Обязательства — это не фокус. Делаю минимум, чтобы ничего не горело, и не отдаю им лучшие часы.',
    closed: 'Отпустить осознанно — тоже завершение. Здесь всё, от чего ты честно отказываешься.',
  }[ui.seg];
  const form = ui.seg === 'closed' ? ''
    : `<form class="inline-form mb" data-form="add" data-to="${ui.seg}"><input type="text" name="text" placeholder="${ui.seg === 'park' ? 'Новая идея' : 'Новое обязательство'}" enterkeyhint="done" autocomplete="off" required><button class="btn">Добавить</button></form>`;
  return `${H('Списки')}
    <div class="segctl" role="group" aria-label="Список">${Object.entries(segs).map(([k, t]) => `<button data-act="seg" data-seg="${k}" aria-pressed="${ui.seg === k}">${t} <span class="cnt">${bucket(k).length}</span></button>`).join('')}</div>
    <section class="card"><p class="hint">${intro}</p>${form}${items.length ? `<ul class="list">${items.map(listRow).join('')}</ul>` : `<p class="empty">Пусто</p>`}</section>
    ${themeCard()}
    ${settingsCard()}`;
}

function listRow(i) {
  if (i.bucket === 'park') {
    if (isRipe(i)) return ripeRow(i);
    const passed = Math.floor((Date.now() - i.movedAt) / DAY);
    return `<li><p class="li-text">${esc(i.text)}</p><div class="cool"><i style="width:${((passed / PARK_DAYS) * 100).toFixed(1)}%"></i></div><div class="li-meta"><span>Остынет через ${nDays(PARK_DAYS - passed)}</span><button class="link muted" data-act="release" data-id="${i.id}">Отпустить</button></div></li>`;
  }
  const [act, label] = i.bucket === 'duty' ? ['release', 'Отпустить'] : ['restore', 'Вернуть'];
  return `<li><div class="li-meta"><p class="li-text">${esc(i.text)}</p><button class="link muted" data-act="${act}" data-id="${i.id}">${label}</button></div></li>`;
}

// ---------- тема ----------
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
const THEMES = {
  auto: ['Авто', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor"/></svg>'],
  light: ['Светлая', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>'],
  dark: ['Тёмная', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></svg>'],
};
const resolvedTheme = () => (ui.theme === 'dark' || (ui.theme !== 'light' && darkMQ.matches) ? 'dark' : 'light');

function applyTheme() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  $('#themeColor')?.setAttribute('content', t === 'dark' ? '#06070D' : '#EEF0F5');
}

// Новая тема раскрывается кругом от кнопки, которую нажали.
function setTheme(next, from) {
  const before = resolvedTheme();
  ui.theme = next;
  try { next === 'auto' ? localStorage.removeItem(THEME_KEY) : localStorage.setItem(THEME_KEY, next); } catch {}
  let swapped = false;
  const swap = () => { if (swapped) return; swapped = true; applyTheme(); render(); };
  if (before === resolvedTheme() || !document.startViewTransition || reduceMotion()) return swap();
  // Если переход завис (вкладка в фоне, браузер занят), тема всё равно применится.
  setTimeout(swap, 400);
  const r = from.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  document.startViewTransition(swap).ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${R}px at ${x}px ${y}px)`] },
      { duration: 750, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' },
    );
  }).catch(() => {});
}
darkMQ.addEventListener?.('change', () => { if (ui.theme === 'auto') applyTheme(); });

function themeCard() {
  return `<section class="card">
    <p class="label">Оформление</p>
    <div class="segctl even" role="group" aria-label="Тема">${Object.entries(THEMES).map(([k, [t, icon]]) => `<button data-act="theme" data-theme="${k}" aria-pressed="${ui.theme === k}">${icon}${t}</button>`).join('')}</div>
  </section>`;
}

function settingsCard() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return `<section class="card">
    <p class="label">Данные</p>
    <p class="hint">Всё хранится только на этом устройстве — без аккаунтов и серверов. Иногда сохраняй копию.</p>
    <div class="row stack">
      <button class="btn block" data-act="export">Сохранить копию</button>
      <button class="btn block" data-act="import">Восстановить из копии</button>
      ${installPrompt && !standalone ? `<button class="btn block" data-act="install">Установить приложение</button>` : ''}
      <button class="btn ghost block danger" data-act="reset">Стереть всё</button>
    </div>
    ${standalone ? '' : `<p class="hint small">На iPhone: «Поделиться» → «На экран „Домой“». На Android: меню ⋮ → «Установить приложение».</p>`}
    <input type="file" id="importFile" accept="application/json,.json" hidden>
  </section>`;
}

// ---------- окно снизу ----------
const sheet = $('#sheet');
let closeT, coinT;

function openSheet(title, body) {
  clearTimeout(closeT);
  sheet.classList.remove('closing');
  $('#sheetBody').innerHTML = `<div class="sheet-top"><h3 class="sheet-title">${title}</h3><button class="sheet-close" data-act="close" aria-label="Закрыть">×</button></div>${body}`;
  if (!sheet.open) sheet.showModal();
  $('#sheetBody').scrollTop = 0;
  sheet.querySelector('[autofocus]')?.focus();
}
function closeSheet() {
  if (!sheet.open || sheet.classList.contains('closing')) return;
  if (reduceMotion()) return sheet.close();
  sheet.classList.add('closing');
  closeT = setTimeout(() => { sheet.classList.remove('closing'); sheet.close(); }, 220);
}
sheet.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
sheet.addEventListener('close', () => { ui.review = null; clearTimeout(coinT); });

function captureSheet() {
  openSheet('Записать мысль', `<p class="hint">Не держи в голове — разберёшь потом. Каждая строка станет отдельным пунктом.</p>
    <form data-form="capture"><textarea name="text" rows="3" placeholder="Мысль, идея, задача, тревога…" autofocus required></textarea><button class="btn primary block mt">Во входящие</button></form>`);
}

function pickSheet(id) {
  const i = findItem(id);
  if (!i) return;
  openSheet('Фокус на 90 дней', `<form data-form="focus" data-id="${i.id}">
    <label class="field"><span>Что это</span><input type="text" name="title" value="${esc(i.text)}" required autocomplete="off"></label>
    <label class="field"><span>Готово, когда…</span><textarea name="doneWhen" rows="3" required placeholder="Проверяемый результат. Например: сайт из 3 страниц опубликован и пришла первая заявка"></textarea></label>
    <label class="field"><span>Первый шаг на 15 минут</span><input type="text" name="firstStep" required autocomplete="off" placeholder="Например: набросать структуру главной"></label>
    <p class="hint">Цикл: сегодня — ${fmtShort.format(addDays(new Date(), CYCLE_DAYS))}. Это эксперимент на 90 дней, а не выбор на всю жизнь. Потом пересмотришь.</p>
    <button class="btn primary block">Начать 90 дней</button>
  </form>`);
}

function editFocusSheet() {
  const f = S.focus;
  openSheet('Уточнить фокус', `<form data-form="edit-focus">
    <label class="field"><span>Что это</span><input type="text" name="title" value="${esc(f.title)}" required autocomplete="off"></label>
    <label class="field"><span>Готово, когда…</span><textarea name="doneWhen" rows="3" required>${esc(f.doneWhen)}</textarea></label>
    <p class="hint">Уточнять формулировку — нормально. Сменить фокус целиком можно только через «Завершить».</p>
    <button class="btn primary block">Сохранить</button>
  </form>`);
}

function finishSheet() {
  const over = focusDay() > focusLen();
  openSheet('Завершить фокус', `<form data-form="finish">
    <div class="choice">
      <label><input type="radio" name="outcome" value="done" checked><span><b>Готово</b>Результат достигнут</span></label>
      <label><input type="radio" name="outcome" value="closed"><span><b>Закрываю осознанно</b>Это тоже завершение, а не провал</span></label>
    </div>
    <label class="field"><span>Чему это научило?</span><textarea name="note" rows="3" placeholder="Коротко — для себя через год"></textarea></label>
    <button class="btn primary block">Завершить и освободить слот</button>
    ${over ? `<button type="button" class="btn ghost block mt" data-act="extend">Продлить на 30 дней</button>` : ''}
  </form>`);
}

function coinSheet(aId, bId) {
  const A = findItem(aId), B = findItem(bId);
  if (!A || !B) return;
  const win = Math.random() < 0.5 ? A : B, lose = win === A ? B : A;
  openSheet('Монетка', `<div class="coin-stage"><div class="coin-lift"><div class="coin" id="coin"><span class="face front">А</span><span class="face back">Б</span></div></div></div>
    <ul class="legend"><li><b>А</b>${esc(A.text)}</li><li><b>Б</b>${esc(B.text)}</li></ul>
    <p class="hint center" id="coinHint">Пока монетка в воздухе — заметь, на что ты надеешься.</p>
    <div id="coinResult"></div>`);
  const coin = $('#coin'), turns = 5 * 360 + (win === B ? 180 : 0);
  const reveal = () => {
    const box = $('#coinResult');
    if (!box) return;
    box.innerHTML = `<p class="coin-out">Выпало: <b>${esc(win.text)}</b></p>
      <button class="btn primary block" data-act="pick" data-id="${win.id}">Да, беру это</button>
      <button class="btn block mt" data-act="pick" data-id="${lose.id}">Внутри ёкнуло на другое — беру «${esc(lose.text)}»</button>`;
    $('#coinHint').textContent = 'Что почувствовалось, когда выпало? Облегчение или разочарование — это и есть ответ.';
  };
  if (reduceMotion()) { coin.style.transform = `rotateY(${turns}deg)`; return reveal(); }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $('.coin-stage')?.classList.add('toss');
    coin.style.transform = `rotateY(${turns}deg)`;
  }));
  coinT = setTimeout(reveal, 1900);
}

function reviewSheet(step) {
  if (!S.focus) return;
  if (step === 0 || !ui.review) ui.review = { win: '' };
  const cur = weekTasks(), next = reviewTarget() !== weekKey();
  const dots = `<div class="stepper" aria-label="Шаг ${step + 1} из 3">${[0, 1, 2].map((i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>`;
  if (step === 0) {
    const n = last7().filter(Boolean).length;
    openSheet('Обзор · что сделано', `${dots}
      ${cur.length ? `<ul class="list compact mb">${cur.map((t) => `<li class="${t.done ? 'is-done' : ''}">${t.done ? '✓' : '○'} ${esc(t.text)}</li>`).join('')}</ul>` : `<p class="hint">Задач на эту неделю не было.</p>`}
      <p class="hint">Главное дня сделано ${n} из 7 последних дней.</p>
      <label class="field"><span>Главная победа недели — даже маленькая</span><textarea id="rvWin" rows="2">${esc(ui.review.win)}</textarea></label>
      <button class="btn primary block" data-act="review-step" data-step="1">Дальше</button>`);
  } else if (step === 1) {
    const ripe = bucket('park').filter(isRipe), duties = byMoved(bucket('duty')), inbox = bucket('inbox').length;
    openSheet('Обзор · что отпустить', `${dots}
      ${inbox ? `<p class="note">Во входящих ${inbox} — разбери их после обзора.</p>` : ''}
      ${ripe.length ? `<p class="label">Созрели на парковке</p><ul class="list mb">${ripe.map(ripeRow).join('')}</ul>` : ''}
      <p class="label">Обязательства</p>
      <p class="hint">Что можно отпустить, делегировать или сделать проще?</p>
      ${duties.length ? `<ul class="list mb">${duties.map(listRow).join('')}</ul>` : `<p class="hint">Список пуст.</p>`}
      <button class="btn primary block mt" data-act="review-step" data-step="2">Дальше</button>`);
  } else {
    const pre = (next ? cur.filter((t) => !t.done) : cur).slice(0, 3).map((t) => t.text);
    openSheet('Обзор · три задачи', `${dots}
      <p class="hint">${next ? 'На следующую неделю' : 'На эту неделю'}: три шага, которые двинут «${esc(S.focus.title)}». Не больше.</p>
      <form data-form="review">
        ${[0, 1, 2].map((i) => `<input type="text" class="mb" name="t${i}" value="${esc(pre[i] || '')}" placeholder="Задача ${i + 1}" autocomplete="off">`).join('')}
        <button class="btn primary block mt">Завершить обзор</button>
      </form>`);
  }
}
const refreshReview = () => { if (ui.review && sheet.open) reviewSheet(1); };

// ---------- таймер ----------
let audio;
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

const timerLeftPct = () => ((S.timer.end - Date.now()) / (S.timer.total || S.timer.min * 60e3)) * 100;

function startTimer(min) {
  S.timer = { end: Date.now() + min * 60e3, min, total: min * 60e3 };
  save();
  try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch {}
  timerSheet();
}
function timerSheet() {
  if (!S.timer) return;
  const t = today();
  openSheet('Фокус-сессия', `${ring(timerLeftPct(), { id: 'gTimer', cls: 'big', inner: `<b data-timer>${mmss(S.timer.end - Date.now())}</b><span>осталось</span>`, label: 'Оставшееся время', attr: 'data-timer-ring' })}
    ${t ? `<p class="center mb">${esc(t.text)}</p>` : ''}
    <p class="center hint small">Просто начни. Через 15 минут можно остановиться — или продолжить.</p>
    <div class="row center-row"><button class="btn" data-act="timer-add">+5 минут</button><button class="btn ghost" data-act="timer-stop">Стоп</button></div>`);
}
function updateTimer() {
  const pill = $('#timerPill');
  if (!S.timer) { pill.hidden = true; return; }
  const left = S.timer.end - Date.now();
  if (left <= 0) return timerDone();
  const txt = mmss(left);
  pill.hidden = false;
  pill.textContent = txt;
  document.querySelectorAll('[data-timer]').forEach((el) => { el.textContent = txt; });
  const p = `${Math.max(0, timerLeftPct()).toFixed(2)} 100`;
  document.querySelectorAll('[data-timer-ring]').forEach((el) => el.setAttribute('stroke-dasharray', p));
}
function timerDone() {
  const min = S.timer.min, t = today();
  S.timer = null;
  save();
  $('#timerPill').hidden = true;
  try { navigator.vibrate?.([200, 100, 200]); } catch {}
  beep();
  openSheet('Время вышло', `${ring(100, { id: 'gDone', cls: 'big ok', inner: `<b>${min}</b><span>минут сделано</span>`, label: `${min} минут сделано` })}
    <p class="center">Начало положено — это и было самое трудное.</p>
    <div class="row stack mt">
      ${t && !t.done ? `<button class="btn primary block" data-act="timer-finish">Отметить главное сделанным</button>` : ''}
      <button class="btn block" data-act="timer" data-min="15">Ещё 15 минут</button>
      <button class="btn ghost block" data-act="close">Закрыть</button>
    </div>`);
}
function beep() {
  if (!audio) return;
  try {
    const o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime;
    o.frequency.value = 660;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
    o.connect(g).connect(audio.destination);
    o.start(t0);
    o.stop(t0 + 1);
  } catch {}
}

// ---------- эффекты ----------
// Number Ticker: число набегает от нуля с замедлением к концу.
function countUp(el) {
  const to = +el.dataset.count;
  if (!to) return;
  const t0 = performance.now(), dur = 1100 + Math.min(to, 90) * 6;
  el.textContent = '0';
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(2, -10 * k);
    el.textContent = Math.round(to * (k === 1 ? 1 : e));
    if (k < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Конфетти из точки, где отметили выполненное.
function confetti(from, n = 90) {
  if (reduceMotion()) return;
  const r = from?.getBoundingClientRect();
  const x = r ? r.left + r.width / 2 : innerWidth / 2, y = r ? r.top + r.height / 2 : innerHeight / 3;
  const W = innerWidth, Hh = innerHeight, dpr = Math.min(2, devicePixelRatio || 1);
  const c = Object.assign(document.createElement('canvas'), { className: 'confetti', width: W * dpr, height: Hh * dpr });
  document.body.append(c);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const colors = ['#38BDF8', '#6366F1', '#A78BFA', '#F472B6', '#FBBF24', '#34D399'];
  const ps = Array.from({ length: n }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15, v = 5 + Math.random() * (n > 50 ? 10 : 7);
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: 5 + Math.random() * 5, h: 8 + Math.random() * 7, r: Math.random() * 6.3, vr: (Math.random() - 0.5) * 0.4, c: colors[(Math.random() * colors.length) | 0], dot: Math.random() < 0.3 };
  });
  const t0 = performance.now();
  const frame = (t) => {
    const k = (t - t0) / 1000;
    ctx.clearRect(0, 0, W, Hh);
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 1.3) / 0.9);
    for (const p of ps) {
      p.vy += 0.3; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      if (p.dot) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, 6.3); ctx.fill(); }
      else { const s = Math.abs(Math.cos(p.r * 2)); ctx.fillRect(-p.w / 2, (-p.h / 2) * s, p.w, p.h * s); }
      ctx.restore();
    }
    if (k < 2.2) requestAnimationFrame(frame); else c.remove();
  };
  requestAnimationFrame(frame);
}

// ---------- действия ----------
let toastT;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 2600);
}

// Пружинка только на той отметке, которую нажали, а не на всех после перерисовки.
function pop(sel) { $(sel)?.classList.add('pop'); }

function withItem(fn) {
  return (el) => { const i = findItem(el.dataset.id); if (i) fn(i, el); };
}

const acts = {
  tab: (el) => { ui.tab = el.dataset.tab; ui.undo = null; render(); window.scrollTo(0, 0); },
  close: () => closeSheet(),
  capture: () => captureSheet(),
  triage: withItem((i, el) => {
    ui.undo = { id: i.id, movedAt: i.movedAt };
    move(i, el.dataset.to);
    commit();
    if (!bucket('inbox').length) toast('Входящие разобраны');
  }),
  undo: () => {
    const i = ui.undo && findItem(ui.undo.id);
    if (i) {
      i.bucket = 'inbox';
      i.movedAt = ui.undo.movedAt;
      S.items = [i, ...S.items.filter((x) => x !== i)];
    }
    ui.undo = null;
    commit();
  },
  'day-toggle': () => {
    const t = today();
    if (!t) return;
    t.done = !t.done;
    commit();
    if (!t.done) return;
    pop('[data-act="day-toggle"]');
    confetti($('[data-act="day-toggle"] .box'));
    try { navigator.vibrate?.(12); } catch {}
    toast('Главное на сегодня сделано');
  },
  'day-clear': () => { delete S.days[dateKey()]; commit(); $('[data-form="day"] input')?.focus(); },
  'day-pick': (el) => { S.days[dateKey()] = { text: el.dataset.text, done: false }; commit(); },
  'week-toggle': (el) => {
    const t = weekTasks().find((x) => x.id === el.dataset.id);
    if (!t) return;
    t.done = !t.done;
    commit();
    if (!t.done) return;
    pop(`[data-act="week-toggle"][data-id="${t.id}"]`);
    const all = weekTasks().every((x) => x.done);
    confetti($(`[data-act="week-toggle"][data-id="${t.id}"] .box`), all ? 90 : 28);
  },
  'week-del': (el) => { const w = S.weeks[weekKey()]; if (w) { w.tasks = w.tasks.filter((x) => x.id !== el.dataset.id); commit(); } },
  rate: withItem((i, el) => { i.scores[el.dataset.k] = +el.dataset.v; commit(); }),
  regret: withItem((i) => { i.regret = !i.regret; commit(); }),
  'cand-park': withItem((i) => { move(i, 'park'); commit(); toast('На парковке на 30 дней'); }),
  pick: (el) => pickSheet(el.dataset.id),
  coin: (el) => coinSheet(el.dataset.a, el.dataset.b),
  promote: withItem((i) => { move(i, 'candidate'); commit(); refreshReview(); toast('Теперь в кандидатах'); }),
  release: withItem((i) => { move(i, 'closed'); commit(); refreshReview(); toast('Отпущено'); }),
  restore: withItem((i) => { move(i, 'inbox'); commit(); toast('Вернулось во входящие'); }),
  seg: (el) => { ui.seg = el.dataset.seg; render(); },
  theme: (el) => { if (el.dataset.theme !== ui.theme) setTheme(el.dataset.theme, el); },
  'edit-focus': () => editFocusSheet(),
  finish: () => finishSheet(),
  extend: () => {
    S.focus.days = focusLen() + 30;
    S.focus.end = +addDays(S.focus.start, S.focus.days);
    closeSheet();
    commit();
    toast('Цикл продлён на 30 дней');
  },
  review: () => reviewSheet(0),
  'review-step': (el) => { const w = $('#rvWin'); if (w && ui.review) ui.review.win = w.value.trim(); reviewSheet(+el.dataset.step); },
  timer: (el) => startTimer(+el.dataset.min || 15),
  'open-timer': () => timerSheet(),
  'timer-add': () => {
    if (!S.timer) return;
    S.timer.total = (S.timer.total || S.timer.min * 60e3) + 5 * 60e3;
    S.timer.end += 5 * 60e3;
    save();
    updateTimer();
  },
  'timer-stop': () => { S.timer = null; save(); updateTimer(); closeSheet(); },
  'timer-finish': () => { const t = today(); if (t) t.done = true; closeSheet(); commit(); confetti($('[data-act="day-toggle"] .box')); toast('Главное на сегодня сделано'); },
  export: () => exportData(),
  import: () => $('#importFile')?.click(),
  install: async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    render();
  },
  reset: () => {
    if (!confirm('Стереть все данные на этом устройстве? Отменить будет нельзя.')) return;
    S = fresh();
    ui.draft = '';
    writeDraft('');
    commit();
    toast('Всё стёрто');
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && acts[el.dataset.act]) acts[el.dataset.act](el, e);
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  e.preventDefault();
  const fd = new FormData(form);
  const v = (k) => String(fd.get(k) || '').trim();
  switch (form.dataset.form) {
    case 'dump': {
      const list = lines(fd.get('text'));
      if (!list.length) return;
      addItems(list);
      ui.draft = '';
      writeDraft('');
      ui.undo = null;
      commit();
      window.scrollTo(0, 0);
      toast(`Во входящих +${list.length}`);
      break;
    }
    case 'capture': {
      const list = lines(fd.get('text'));
      if (!list.length) return;
      addItems(list);
      closeSheet();
      commit();
      toast('Записано. Голова свободна.');
      break;
    }
    case 'day':
      if (!v('text')) return;
      S.days[dateKey()] = { text: v('text'), done: false };
      commit();
      break;
    case 'week': {
      const k = weekKey();
      S.weeks[k] ||= { tasks: [] };
      if (!v('text') || S.weeks[k].tasks.length >= 3) return;
      S.weeks[k].tasks.push({ id: uid(), text: v('text'), done: false });
      commit();
      $('[data-form="week"] input')?.focus();
      break;
    }
    case 'add':
      if (!v('text')) return;
      addItems([v('text')], form.dataset.to);
      commit();
      $('[data-form="add"] input')?.focus();
      break;
    case 'focus': {
      const start = Date.now();
      S.focus = { id: uid(), title: v('title'), doneWhen: v('doneWhen'), firstStep: v('firstStep'), start, days: CYCLE_DAYS, end: +addDays(start, CYCLE_DAYS) };
      S.items = S.items.filter((x) => x.id !== form.dataset.id);
      if (!today()?.done) S.days[dateKey()] = { text: v('firstStep'), done: false };
      ui.tab = 'today';
      closeSheet();
      commit();
      window.scrollTo(0, 0);
      setTimeout(() => confetti($('.focus-card .ring')), 250);
      toast('Фокус выбран. Первый шаг — уже на сегодня.');
      break;
    }
    case 'edit-focus':
      S.focus.title = v('title');
      S.focus.doneWhen = v('doneWhen');
      closeSheet();
      commit();
      break;
    case 'finish': {
      const f = S.focus, outcome = v('outcome');
      S.history.push({ title: f.title, doneWhen: f.doneWhen, start: f.start, closedAt: Date.now(), outcome, note: v('note') });
      S.focus = null;
      ui.tab = 'focus';
      closeSheet();
      commit();
      window.scrollTo(0, 0);
      if (outcome === 'done') confetti(null, 140);
      toast(outcome === 'done' ? 'Доведено до конца. Это победа.' : 'Закрыто осознанно. Слот свободен.');
      break;
    }
    case 'review': {
      const target = reviewTarget(), old = weekTasks(target);
      const texts = [0, 1, 2].map((i) => v(`t${i}`)).filter(Boolean);
      S.weeks[target] = { tasks: texts.map((text) => old.find((t) => t.text === text) || { id: uid(), text, done: false }) };
      S.reviews.push({ at: Date.now(), week: target, win: ui.review?.win || '' });
      S.lastReview = Date.now();
      closeSheet();
      commit();
      toast('Обзор готов. Неделя спланирована.');
      break;
    }
  }
});

// Черновик выгрузки переживает перезапуск: iOS выгружает PWA из памяти в фоне.
document.addEventListener('input', (e) => {
  if (e.target.closest?.('[data-form="dump"]')) { ui.draft = e.target.value; writeDraft(ui.draft); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.form) { e.preventDefault(); e.target.form.requestSubmit(); return; }
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
  if (ui.tab === 'sort' && !sheet.open && !typing && /^[1-4]$/.test(e.key)) document.querySelectorAll('.bucket')[+e.key - 1]?.click();
});

document.addEventListener('change', async (e) => {
  if (e.target.id !== 'importFile') return;
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.items)) throw new Error('bad');
    if (!confirm('Заменить текущие данные копией из файла?')) return;
    S = { ...fresh(), ...data };
    commit();
    toast('Данные восстановлены');
  } catch {
    toast('Это не похоже на копию «Фокус 90»');
  }
});

async function exportData() {
  const name = `focus90-${dateKey()}.json`;
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Фокус 90 — копия' }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (ui.tab === 'lists') render();
});

// Блик на стекле следует за курсором — только для мыши и трекпада.
if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
  let last, queued = false;
  document.addEventListener('pointermove', (e) => {
    last = e;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const card = last.target.closest?.('.card, .banner');
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${last.clientX - r.left}px`);
      card.style.setProperty('--my', `${last.clientY - r.top}px`);
    });
  }, { passive: true });
}

setInterval(updateTimer, 500);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  updateTimer();
  if (ui.day !== dateKey()) { ui.day = dateKey(); render(); }
});

// ---------- старт ----------
applyTheme();
render();
if (new URLSearchParams(location.search).has('capture')) {
  history.replaceState(null, '', location.pathname);
  captureSheet();
}
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
navigator.storage?.persist?.().catch(() => {});
