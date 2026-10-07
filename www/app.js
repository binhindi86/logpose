/* Log Pose – a One Piece Card Game binder companion */
(() => {
'use strict';
const API = 'https://optcgapi.com/api/';
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CLOSE = '<button class="icon-btn close" type="button" aria-label="Close"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></button>';

/* ---------- storage ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const owned = store.get('lp.owned', {});   // setId -> { imageId: 1 }
const board = store.get('lp.board', {});   // character -> { st: got|ordered|picked, pick: imageId }
const chase = store.get('lp.chase', {});   // imageId -> { setId, name, img, num }
const meta = store.get('lp.meta', {});     // setId -> { name, cover, total, kind }
const prefs = Object.assign({ modes: {}, tracked: [], view: 'grid', badges: {}, recent: [] }, store.get('lp.prefs', {}));
const saveOwned = () => store.set('lp.owned', owned), saveBoard = () => store.set('lp.board', board), saveChase = () => store.set('lp.chase', chase);
const saveMeta = () => store.set('lp.meta', meta), savePrefs = () => store.set('lp.prefs', prefs);

/* ---------- API with an offline cache ---------- */
const idb = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open('logpose', 1); r.onupgradeneeded = () => r.result.createObjectStore('cache'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  return {
    async get(k) { try { const db = await open(); return await new Promise(res => { const q = db.transaction('cache').objectStore('cache').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); } catch { return undefined; } },
    async set(k, v) { try { const db = await open(); db.transaction('cache', 'readwrite').objectStore('cache').put(v, k); } catch {} }
  };
})();
const mem = new Map();
function api(path, ttlHours = 24) {
  if (mem.has(path)) return mem.get(path);
  const p = (async () => {
    const hit = await idb.get(path);
    if (hit && Date.now() - hit.t < ttlHours * 3600e3) return hit.d;
    try {
      const r = await fetch(API + path);
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      idb.set(path, { t: Date.now(), d });
      return d;
    } catch (e) { if (hit) return hit.d; mem.delete(path); throw e; }
  })();
  mem.set(path, p);
  return p;
}
async function pool(tasks, n) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } })); return out; }

/* ---------- feedback ---------- */
const buzz = kind => { try { navigator.vibrate && navigator.vibrate(kind === 'win' ? [20, 60, 40] : 8); } catch {} };
let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button">${esc(action.label)}</button>` : '');
  t.hidden = false;
  if (action) t.querySelector('button').onclick = () => { t.hidden = true; action.run(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function confetti() {
  if (reduced()) return;
  const box = $('#confetti'); box.innerHTML = '';
  const colors = ['#D7263D', '#F2B630', '#3FB6D9', '#F3E2B8', '#7bd389', '#ffffff'];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('i');
    c.style.left = Math.random() * 100 + 'vw'; c.style.background = colors[i % colors.length];
    c.style.setProperty('--dx', (Math.random() * 160 - 80) + 'px'); c.style.setProperty('--rot', (Math.random() * 900 - 450) + 'deg');
    c.style.animationDelay = Math.random() * .35 + 's'; box.appendChild(c);
  }
  setTimeout(() => { box.innerHTML = ''; }, 2600);
}
function ring(pct, big) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return `<div class="ring${big ? ' big' : ''}${p >= 100 ? ' full' : p === 0 ? ' zero' : ''}" style="--p:${p}" role="img" aria-label="${p}% collected"><span>${p}%</span></div>`;
}
const loading = msg => `<div class="loading"><div class="spin"></div><div>${esc(msg)}</div></div>`;
function errorView(msg, retry) {
  view.innerHTML = `<div class="empty"><h2>Can't reach the card library</h2><p>${esc(msg)} Check your internet connection, then try again.</p><button class="btn" id="retry">Try again</button></div>`;
  $('#retry').onclick = retry;
}

/* ---------- cards ---------- */
// One card from the API -> { id, base, num, name, label, variant, rarity, img, type, color, cost, power, text, sub }
function normCard(c) {
  const id = c.card_image_id || c.card_set_id;
  const labels = [...String(c.card_name || '').matchAll(/\(([^)]*)\)/g)].map(m => m[1]).filter(x => !/^\d+$/.test(x));
  const label = labels.join(' ');
  return {
    id, base: c.card_set_id || id, num: String(c.card_set_id || id).split('-').pop(),
    name: String(c.card_name || '').replace(/\s*\([^)]*\)/g, '').replace(/\s*-\s*[A-Z]{1,3}\d{0,2}-\d{3}\s*$/, '').trim() || 'Card',
    label, variant: id.includes('_p') || !!label, rarity: c.rarity || '', img: c.card_image || '',
    type: c.card_type || '', color: c.card_color || '', cost: c.card_cost, power: c.card_power, text: c.card_text || '', sub: c.sub_types || '', setName: c.set_name || ''
  };
}
function sortCards(list) {
  const pn = id => { const m = id.match(/_p(\d+)/); return m ? +m[1] : 0; };
  return list.sort((a, b) => (a.variant - b.variant) || a.base.localeCompare(b.base, 'en', { numeric: true }) || pn(a.id) - pn(b.id) || a.id.localeCompare(b.id));
}
const HIT_TITLE = ['Manga & super alt arts', 'SP cards', 'Secret rares', 'Alt arts & parallels', 'Super rares'];
function hitRank(c) {
  const l = (c.label || '').toLowerCase();
  if (/manga|super alt/.test(l)) return 0;
  if (/\bsp\b/.test(l)) return 1;
  if (c.rarity === 'SEC' && !c.variant) return 2;
  if (c.variant) return 3;
  if (c.rarity === 'SR') return 4;
  return -1;
}
const KIND_NAME = { op: 'Booster sets', eb: 'Extra & premium boosters', st: 'Starter decks', promo: 'Promos' };
async function loadCatalog() {
  const [boosters, decks] = await Promise.all([api('allSets/', 24), api('allDecks/', 24).catch(() => [])]);
  const sets = [];
  boosters.forEach((s, i) => sets.push({ id: s.set_id, name: s.set_name, kind: /^OP/.test(s.set_id) ? 'op' : 'eb', order: i, path: `sets/${encodeURIComponent(s.set_id)}/` }));
  decks.forEach((s, i) => sets.push({ id: s.structure_deck_id, name: String(s.structure_deck_name).replace(/^Starter Deck( EX)? ?\d*:?\s*/i, '') || s.structure_deck_name, full: s.structure_deck_name, kind: 'st', order: i, path: `decks/${encodeURIComponent(s.structure_deck_id)}/` }));
  sets.push({ id: 'PROMO', name: 'Promotion cards', kind: 'promo', order: 0, path: 'allPromos/' });
  return sets;
}
let CATALOG = null;
const catalog = async () => CATALOG || (CATALOG = await loadCatalog());
async function loadSet(setId) {
  const s = (await catalog()).find(x => x.id === setId);
  if (!s) throw new Error('no set');
  const raw = await api(s.path, 24);
  const seen = new Set(); const cards = [];
  (raw || []).forEach(c => { const n = normCard(c); if (!seen.has(n.id)) { seen.add(n.id); cards.push(n); } });
  sortCards(cards);
  return { ...s, cards };
}

/* ---------- set art: a fan of the set's best cards ---------- */
function setBadge(s) {
  let h = 0; for (const ch of String(s.id)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `<span class="set-badge" style="--h:${h}">${esc(String(s.id).replace('PROMO', 'P'))}</span>`;
}
function setArt(s) {
  const m = meta[s.id];
  if (m && m.covers && m.covers.length) return `<span class="fan">${m.covers.slice(0, 3).map((u, i) => `<img loading="lazy" src="${esc(u)}" alt="" style="--i:${i}">`).join('')}</span>`;
  return setBadge(s);
}
function rememberSet(set) {
  const best = set.cards.filter(c => hitRank(c) >= 0).sort((a, b) => hitRank(a) - hitRank(b)).slice(0, 3).map(c => c.img);
  const covers = best.length ? best : set.cards.filter(c => c.rarity === 'L').slice(0, 3).map(c => c.img);
  meta[set.id] = { name: set.name, kind: set.kind, total: set.cards.filter(c => !c.variant).length, master: set.cards.length, covers, variants: set.cards.filter(c => c.variant && !c.id.includes('_p')).map(c => c.id) };
  saveMeta();
}

/* ---------- progress ---------- */
const ownedSet = id => owned[id] || {};
function progressOf(id, mode) {
  const m = meta[id] || {}; const o = ownedSet(id);
  const total = mode === 'master' ? (m.master || 0) : (m.total || 0);
  const have = mode === 'master' ? Object.keys(o).length : Object.keys(o).filter(k => !k.includes('_p') && !(m.variants || []).includes(k)).length;
  return { have, total, pct: total ? Math.min(100, have / total * 100) : 0 };
}
const totalOwned = () => Object.values(owned).reduce((n, o) => n + Object.keys(o).length, 0);
function collectingIds() { const s = new Set(Object.keys(owned).filter(k => Object.keys(owned[k]).length)); (prefs.tracked || []).forEach(k => s.add(k)); return [...s]; }

/* ---------- routing ---------- */
let renderId = 0; const scrollMemo = {}; let currentPath = '';
function parse() {
  const p = (location.hash.slice(1) || '/').split('/').filter(Boolean).map(decodeURIComponent);
  if (p[0] === 'set' && p[1]) return { name: 'set', id: p[1] };
  if (['sets', 'mine', 'board', 'gaps'].includes(p[0])) return { name: p[0] };
  return { name: 'home' };
}
const SUB = new Set(['set', 'gaps']);
const TAB_OF = { set: 'sets', gaps: 'home' };
function go(hash, replace) {
  scrollMemo[currentPath] = window.scrollY;
  const d = (history.state && history.state.d) || 0;
  if (replace) history.replaceState({ d }, '', hash); else history.pushState({ d: d + 1 }, '', hash);
  route();
}
function goBack() {
  if (!$('#sheet').hidden) { closeSheet(); return; }
  if ((history.state && history.state.d) > 0) history.back(); else go('#/', true);
}
window.addEventListener('popstate', () => { closeSheet(); route(); });
document.addEventListener('click', e => { const a = e.target.closest('a[href^="#"]'); if (!a) return; e.preventDefault(); go(a.getAttribute('href'), a.hasAttribute('data-tab')); });
$('#backBtn').onclick = goBack;
function route() {
  currentPath = location.hash || '#/';
  const r = parse();
  document.querySelectorAll('#tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === (TAB_OF[r.name] || r.name)));
  $('#backBtn').hidden = !SUB.has(r.name); $('#brand').hidden = SUB.has(r.name);
  const id = ++renderId;
  if (r.name === 'set') return renderSet(id, r.id);
  if (r.name === 'sets') return renderSets(id);
  if (r.name === 'mine') return renderMine(id);
  if (r.name === 'board') return renderBoard(id);
  if (r.name === 'gaps') return renderGaps(id);
  return renderHome(id);
}
const restoreScroll = () => window.scrollTo(0, scrollMemo[currentPath] || 0);

/* ---------- Home ---------- */
async function renderHome(id) {
  const ids = collectingIds();
  const cards = totalOwned();
  const complete = ids.filter(k => { const p = progressOf(k, 'set'); return p.total && p.have >= p.total; }).length;
  const bGot = Object.values(board).filter(v => v.st === 'got').length;
  const hour = new Date().getHours();
  const greet = (hour < 12 ? 'Good morning, ' : hour < 18 ? 'Good afternoon, ' : 'Good evening, ') + (prefs.trainer || 'Captain');
  const recent = prefs.recent || [];
  const prog = ids.map(k => ({ k, ...progressOf(k, prefs.modes[k] || 'set') })).sort((a, b) => { const ia = recent.indexOf(a.k), ib = recent.indexOf(b.k); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib); });
  const chaseList = Object.entries(chase);
  view.innerHTML = `
    <div class="hello"><h1>${esc(greet)}</h1><p>${cards ? `Your binder holds ${cards} card${cards === 1 ? '' : 's'} so far.` : 'Pick a set and start ticking the cards you own.'}</p></div>
    <div class="stats">
      <div class="stat hot"><b>${cards}</b><span>cards collected</span></div>
      <div class="stat"><b>${ids.length}</b><span>sets started</span></div>
      <div class="stat"><b>${complete}</b><span>sets complete</span></div>
    </div>
    <a class="dexcard" href="#/board" data-tab>
      <div><div class="dk">Bounty Board</div><div class="dv">${bGot} <small>characters claimed</small></div><div class="dsub">One special art card for every character</div></div>
      <span class="poster-mini" aria-hidden="true">WANTED</span>
    </a>
    <div class="home-actions">
      <a class="hact" href="#/gaps"><b>🧭 What I'm missing</b><span>Every gap in your sets and board</span></a>
      <button type="button" class="hact" id="shareHome"><b>📤 Share my collection</b><span>A picture to send to friends</span></button>
    </div>
    ${trophyShelf()}
    <section class="block"><div class="block-head"><h2>Keep collecting</h2>${ids.length ? '<a href="#/mine" data-tab>See all</a>' : ''}</div>
      ${prog.length ? `<div class="rail">${prog.slice(0, 10).map(p => { const m = meta[p.k] || { name: p.k }; return `
        <a class="prog" href="#/set/${encodeURIComponent(p.k)}"><div class="art">${setArt({ id: p.k })}</div>
        <div class="row"><div><div class="nm">${esc(m.name)}</div><div class="sub">${esc(p.k)} – ${p.have} of ${p.total}</div></div>${ring(p.pct)}</div></a>`; }).join('')}</div>`
      : '<div class="hint">Sets you start ticking show up here, so you can jump straight back in.</div>'}
    </section>
    <section class="block"><div class="block-head"><h2>My chase list</h2></div>
      ${chaseList.length ? `<div class="rail">${chaseList.map(([k, c]) => { const have = !!ownedSet(c.setId)[k]; return `
        <a class="chase" href="#/set/${encodeURIComponent(c.setId)}" data-card="${esc(k)}"><div class="pic${have ? ' have' : ''}"><img loading="lazy" src="${esc(c.img)}" alt=""></div>
        <div class="nm">${have ? '✓ ' : ''}${esc(c.name)}</div><div class="sub">${esc(c.num)}${c.label ? ' – ' + esc(c.label) : ''}</div></a>`; }).join('')}</div>`
      : '<div class="hint">Open any card and tap “Add to my chase list” to keep the cards you’re hunting right here.</div>'}
    </section>
    <section class="block" id="newest"><div class="block-head"><h2>Newest sets</h2><a href="#/sets" data-tab>All sets</a></div>${loading('Loading sets…')}</section>`;
  view.querySelectorAll('a.chase').forEach(a => a.addEventListener('click', () => { openAfterLoad = a.dataset.card; }, true));
  $('#shareHome').onclick = () => openSharePicker('all');
  view.querySelector('.trophies')?.addEventListener('click', e => { const b = e.target.closest('[data-badge]'); if (b) showBadge(b.dataset.badge); });
  restoreScroll();
  try {
    const sets = (await catalog()).filter(s => s.kind === 'op' || s.kind === 'eb').slice().reverse().slice(0, 8);
    if (id !== renderId) return;
    $('#newest .loading').outerHTML = `<div class="rail">${sets.map((s, i) => { const p = progressOf(s.id, 'set'); return `
      <a class="rel" href="#/set/${encodeURIComponent(s.id)}"><div class="art">${setArt(s)}</div><div class="nm">${esc(s.name)}</div>
      <div class="sub">${i === 0 ? '<span class="tag">Newest</span> ' : ''}${esc(s.id)}${p.have ? ` – ${p.have} ticked` : ''}</div></a>`; }).join('')}</div>`;
  } catch { if (id === renderId) $('#newest .loading').outerHTML = '<div class="hint">Couldn’t load the sets. Check your internet connection.</div>'; }
}

/* ---------- All sets ---------- */
function setRow(s) {
  const p = progressOf(s.id, 'set');
  return `<a class="set-row${p.total && p.have >= p.total ? ' done' : ''}" href="#/set/${encodeURIComponent(s.id)}">
    <div class="art">${setArt(s)}</div>
    <div class="info"><div class="nm">${esc(s.name)}</div><div class="sub">${esc(s.id)}${p.total ? ` – ${p.have} of ${p.total}` : ''}</div></div>${ring(p.pct)}</a>`;
}
async function renderSets(id) {
  view.innerHTML = loading('Loading sets…');
  let sets; try { sets = await catalog(); } catch { if (id === renderId) errorView('The set list didn’t load.', route); return; }
  if (id !== renderId) return;
  const groups = ['op', 'eb', 'st', 'promo'].map(k => [k, sets.filter(s => s.kind === k).slice().reverse()]).filter(([, l]) => l.length);
  view.innerHTML = `<label class="search"><svg viewBox="0 0 24 24" width="20" height="20"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M15.5 15.5L20 20" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
      <input id="setSearch" type="search" placeholder="Search ${sets.length} sets" autocomplete="off" aria-label="Search sets"></label><div id="setGroups"></div>`;
  const paint = q => { $('#setGroups').innerHTML = groups.map(([k, l]) => { const f = l.filter(s => !q || (s.name + ' ' + s.id).toLowerCase().includes(q)); return f.length ? `<section class="series"><div class="series-head"><h2>${KIND_NAME[k]}</h2><span class="count">${f.length}</span></div><div class="set-list">${f.map(setRow).join('')}</div></section>` : ''; }).join('') || '<div class="empty"><h2>No sets match</h2></div>'; };
  paint('');
  $('#setSearch').oninput = e => paint(e.target.value.trim().toLowerCase());
  restoreScroll();
}
function renderMine(id) {
  const ids = collectingIds();
  if (!ids.length) { view.innerHTML = `<div class="empty"><h2>No sets yet</h2><p>Open any set and tap the cards you own, or tap “Collect this set”. It shows up here with your progress.</p><a class="btn" href="#/sets" data-tab>Browse sets</a></div>`; return; }
  view.innerHTML = `<div class="trainer"><div><div class="big">${totalOwned()}</div><div class="lbl">cards ticked</div></div><div class="split">${ids.length} set${ids.length === 1 ? '' : 's'} started</div></div>
    <div class="set-list">${ids.map(k => ({ id: k, name: (meta[k] || {}).name || k })).sort((a, b) => progressOf(b.id).pct - progressOf(a.id).pct).map(setRow).join('')}</div>`;
  restoreScroll();
}

/* ---------- One set ---------- */
const S = { set: null, mode: 'set', filter: 'all', q: '' };
let openAfterLoad = null;
const has = c => !!ownedSet(S.set.id)[c.id];
const visibleBase = () => S.set.cards.filter(c => S.mode === 'master' || !c.variant);
function tally() { const list = visibleBase(); return { have: list.filter(has).length, total: list.length }; }
function tileHTML(c, i) {
  const on = has(c);
  return `<div class="tile${on ? ' owned' : ''}" data-id="${esc(c.id)}" style="--hp:${(i * 37) % 100}%">
    <button class="face" type="button" data-act="tick" aria-pressed="${on}" aria-label="${esc(c.name)} ${esc(c.base)}">
      ${c.img ? `<img loading="lazy" decoding="async" src="${esc(c.img)}" alt="">` : `<span class="noimg">${esc(c.name)}</span>`}
      <span class="num">${esc(c.num)}${c.variant ? ' ★' : ''}</span><span class="stamp">${CHECK}</span>
    </button>
    <button class="info" type="button" data-act="info" aria-label="Details for ${esc(c.name)}">i</button>
    <div class="nm">${esc(c.name)}</div>${c.variant ? `<div class="vlabel">${esc(c.label || 'Parallel')}</div>` : ''}
  </div>`;
}
function visibleCards() {
  const q = S.q.toLowerCase();
  return visibleBase().map((c, i) => ({ c, i })).filter(({ c }) => {
    if (q && !((c.name + ' ' + c.base + ' ' + c.label).toLowerCase().includes(q))) return false;
    if (S.filter === 'need') return !has(c);
    if (S.filter === 'have') return has(c);
    return true;
  });
}
function paintGrid() {
  const list = visibleCards();
  $('#grid').innerHTML = list.map(({ c, i }) => tileHTML(c, i)).join('');
  $('#gridEmpty').hidden = list.length > 0;
  if (!list.length) $('#gridEmpty').innerHTML = S.filter === 'need' && !S.q ? '<h2>Nothing missing</h2><p>You have every card in this view.</p>' : S.filter === 'have' && !S.q ? '<h2>No cards ticked yet</h2><p>Switch to All and tap the cards you own.</p>' : '<h2>No cards match</h2><p>Try a name or a card number.</p>';
}
function paintTally(celebrate) {
  const { have, total } = tally();
  $('#ringBox').innerHTML = ring(total ? have / total * 100 : 0, true);
  $('#tally').textContent = `${have} / ${total}`;
  const done = total > 0 && have >= total;
  $('#doneBanner').hidden = !done;
  $('#doneBanner').textContent = S.mode === 'master' ? 'Master set complete! Every version is in your binder.' : 'Set complete! Every card is in your binder.';
  if (done && celebrate) { confetti(); buzz('win'); unlock(S.mode === 'master' ? 'master-full' : 'set-full'); }
}
function refreshTile(c) {
  const el = view.querySelector(`.tile[data-id="${CSS.escape(c.id)}"]`); if (!el) return null;
  const i = S.set.cards.indexOf(c); const t = document.createElement('div'); t.innerHTML = tileHTML(c, i);
  const f = t.firstElementChild; el.replaceWith(f); return f;
}
function setOwned(c, on, opts = {}) {
  const before = tally(); const wasDone = before.total && before.have >= before.total;
  const b = owned[S.set.id] || (owned[S.set.id] = {});
  if (on) b[c.id] = 1; else delete b[c.id];
  if (!Object.keys(b).length) delete owned[S.set.id];
  saveOwned();
  const el = refreshTile(c);
  if (el && on) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 650); }
  buzz(on ? 'heavy' : 'light');
  if (on) onCardAdded(c);
  const after = tally(); paintTally(!wasDone && after.total && after.have >= after.total);
  S.paintBinder && S.paintBinder();
  checkBadges();
  if (!on && !opts.silent) toast(`Removed ${c.name}`, { label: 'Undo', run: () => setOwned(c, true, { silent: true }) });
}
async function renderSet(id, setId) {
  view.innerHTML = loading('Opening set…');
  let set; try { set = await loadSet(setId); } catch { if (id === renderId) errorView('This set didn’t load.', route); return; }
  if (id !== renderId) return;
  if (S.set?.id !== setId) { S.q = ''; S.filter = 'all'; }
  S.set = set; S.mode = prefs.modes[setId] || 'set';
  rememberSet(set);
  prefs.recent = [setId, ...(prefs.recent || []).filter(k => k !== setId)].slice(0, 20); savePrefs();
  const base = set.cards.filter(c => !c.variant).length, vars = set.cards.length - base;
  view.innerHTML = `
    <div class="set-hero"><div class="logo"><div class="hero-fan">${setArt(set)}</div><h1>${esc(set.full || set.name)}</h1>
      <div class="sub">${esc(set.id)} – ${base} cards${vars ? ` + ${vars} alt arts and parallels` : ''}</div></div><div id="ringBox"></div></div>
    <div class="set-actions">
      <div class="seg view-seg" role="group" aria-label="View"><button type="button" data-view="grid">Checklist</button><button type="button" data-view="binder">Binder</button></div>
      <button type="button" class="track-btn" id="trackBtn"></button>
      <button type="button" class="track-btn" id="scanBtn">📷 Scan a card</button>
      <button type="button" class="track-btn" id="shareSetBtn">Share</button>
    </div>
    <section class="hits" id="hits"></section>
    <div class="controls">
      <div class="seg mode" role="group" aria-label="Checklist type"><button type="button" data-mode="set">Set</button><button type="button" data-mode="master">Master</button></div>
      <div class="seg" role="group" aria-label="Show"><button type="button" data-filter="all">All</button><button type="button" data-filter="need">Need</button><button type="button" data-filter="have">Have</button></div>
      <span class="tally" id="tally"></span>
    </div>
    <div class="legend" id="legend"></div>
    <div id="doneBanner" class="complete-banner" hidden></div>
    <label class="search"><svg viewBox="0 0 24 24" width="20" height="20"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M15.5 15.5L20 20" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
      <input id="cardSearch" type="search" placeholder="Find a card by name or number" autocomplete="off" aria-label="Find a card" value="${esc(S.q)}"></label>
    <div class="grid" id="grid"></div><div class="empty" id="gridEmpty" hidden></div>
    <section id="binderBox" class="binder-box" hidden></section>`;
  const paintControls = () => {
    view.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)));
    view.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === S.filter)));
    $('#legend').textContent = S.mode === 'master' ? 'Master set: every version counts, including alt arts, parallels, SP and manga cards (marked ★).' : 'Set: one copy of each card. Tap a card to tick it, tap i for details.';
  };
  view.querySelector('.controls').onclick = e => {
    const m = e.target.closest('[data-mode]'), f = e.target.closest('[data-filter]');
    if (m && m.dataset.mode !== S.mode) { S.mode = m.dataset.mode; prefs.modes[setId] = S.mode; savePrefs(); buzz(); paintControls(); paintGrid(); paintTally(false); S.paintBinder && S.paintBinder(); }
    if (f && f.dataset.filter !== S.filter) { S.filter = f.dataset.filter; paintControls(); paintGrid(); }
  };
  $('#cardSearch').oninput = e => { S.q = e.target.value.trim(); paintGrid(); };
  $('#grid').onclick = e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const c = set.cards.find(x => x.id === b.closest('.tile').dataset.id); if (!c) return;
    if (b.dataset.act === 'tick') setOwned(c, !has(c)); else openCard(c);
  };
  const paintTrack = () => { const on = prefs.tracked.includes(setId) || Object.keys(ownedSet(setId)).length > 0; $('#trackBtn').setAttribute('aria-pressed', String(on)); $('#trackBtn').textContent = on ? '★ Collecting this set' : '☆ Collect this set'; };
  $('#trackBtn').onclick = () => { const i = prefs.tracked.indexOf(setId); if (i >= 0) { prefs.tracked.splice(i, 1); toast('Removed from the sets you’re collecting'); } else { prefs.tracked.push(setId); buzz('heavy'); toast(`${set.name} added to your sets`); } savePrefs(); paintTrack(); };
  paintTrack();
  $('#scanBtn').onclick = startScan;
  $('#shareSetBtn').onclick = () => openSharePicker(setId);
  const items = () => visibleBase().map(c => ({ card: c, pic: c.img, have: has(c), label: c.num + (c.variant ? ' ★' : ''), name: c.name }));
  const cover = () => ({ title: set.name, logo: (meta[set.id]?.covers || [])[0] || '' });
  const paintView = () => {
    const b = prefs.view === 'binder';
    view.querySelectorAll('[data-view]').forEach(x => x.setAttribute('aria-pressed', String((x.dataset.view === 'binder') === b)));
    $('#grid').hidden = b; $('#cardSearch').closest('.search').hidden = b; view.querySelector('.controls [aria-label="Show"]').hidden = b; $('#hits').hidden = b; $('#binderBox').hidden = !b;
    if (b) { renderBinder($('#binderBox'), items(), k => openCard(items()[k].card), 0, cover()); $('#legend').textContent = 'Binder: cards in set order. Tap a pocket to see the card and exactly where it goes.'; }
    else paintControls();
  };
  S.paintBinder = () => { if (prefs.view === 'binder') { const box = $('#binderBox'); renderBinder(box, items(), k => openCard(items()[k].card), box._page ?? 1, cover()); } };
  view.querySelector('.view-seg').onclick = e => { const b = e.target.closest('[data-view]'); if (!b) return; prefs.view = b.dataset.view; savePrefs(); buzz(); paintView(); };
  paintControls(); paintGrid(); paintTally(false); paintView(); paintHits();
  restoreScroll();
  if (openAfterLoad) { const c = set.cards.find(x => x.id === openAfterLoad); openAfterLoad = null; if (c) openCard(c); }
}
function paintHits() {
  const groups = HIT_TITLE.map(() => []);
  S.set.cards.forEach(c => { const k = hitRank(c); if (k >= 0) groups[k].push(c); });
  const total = groups.reduce((n, g) => n + g.length, 0);
  $('#hits').innerHTML = total ? `<div class="hits-head"><h2>Hits in this set</h2><span class="count">${total} cards</span></div>
    ${groups.map((g, i) => g.length ? `<div class="hit-group"><h3>${HIT_TITLE[i]} <span class="count">${g.length}</span></h3><div class="rail hit-rail">${g.map(c => `
      <button type="button" class="hit${has(c) ? ' have' : ''}" data-hit="${esc(c.id)}"><img loading="lazy" src="${esc(c.img)}" alt=""><span class="nm">${esc(c.name)}</span><span class="sub">${esc(c.num)}${c.label ? ' – ' + esc(c.label) : ''}</span></button>`).join('')}</div></div>` : '').join('')}` : '';
  $('#hits').onclick = e => { const b = e.target.closest('[data-hit]'); if (b) { const c = S.set.cards.find(x => x.id === b.dataset.hit); if (c) openCard(c); } };
}

/* ---------- Binder view with turning pages ---------- */
const BINDER_SIZES = { 4: [2, 2], 9: [3, 3], 12: [3, 4], 16: [4, 4] };
const binderSize = () => BINDER_SIZES[prefs.binderSize] ? prefs.binderSize : 9;
function binderPos(index) { const size = binderSize(), [cols] = BINDER_SIZES[size]; const page = Math.floor(index / size) + 1, inPage = index % size; return { page, sheet: Math.ceil(page / 2), side: page % 2 ? 'front' : 'back', row: Math.floor(inPage / cols) + 1, col: inPage % cols + 1 }; }
function renderBinder(box, items, onTap, startPage, cover) {
  const size = binderSize(), [cols, rows] = BINDER_SIZES[size];
  const pages = []; for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  const haveCount = items.filter(x => x.have).length;
  const first = cover ? 0 : 1, last = Math.max(1, pages.length);
  let cur = Math.max(first, Math.min(last, startPage ?? first)), busy = false; box._page = cur;
  const pageHTML = n => {
    if (n === 0) return `<section class="bcover" data-cover="1"><div class="bc-in">${cover.logo ? `<img src="${esc(cover.logo)}" alt="" class="bc-card">` : '<span class="compass big" aria-hidden="true"></span>'}<h3>${esc(cover.title)}</h3><p>${haveCount} of ${items.length} in place</p><span class="bc-open">Tap or swipe to open</span></div></section>`;
    const pg = pages[n - 1] || [], base = (n - 1) * size;
    return `<section class="bpage"><div class="bsheet">${pg.map((it, j) => `<button type="button" class="bslot${it.have ? ' have' : ''}${it.soft ? ' soft' : ''}" data-bk="${base + j}" aria-label="${esc(it.name)} ${esc(it.label)}">${it.pic ? `<img decoding="async" src="${esc(it.pic)}" alt="">` : ''}<span class="blabel">${esc(it.label)}</span>${it.have ? '' : `<span class="bname">${esc(it.name)}</span>`}</button>`).join('')}${Array.from({ length: size - pg.length }, () => '<span class="bslot blank"></span>').join('')}</div>
      <div class="bfoot">Page ${n} – sheet ${Math.ceil(n / 2)} ${n % 2 ? 'front' : 'back'}${pg.length ? ` – ${esc(pg[0].label)} to ${esc(pg[pg.length - 1].label)}` : ''}</div></section>`;
  };
  box.innerHTML = `<div class="btools"><div class="seg" role="group" aria-label="Pockets per page">${Object.keys(BINDER_SIZES).map(n => `<button type="button" data-bsize="${n}" aria-pressed="${+n === size}">${n}</button>`).join('')}</div><span class="bcount">${haveCount} of ${items.length} in place</span></div>
    <div class="binder3d" id="binderStage" style="--cols:${cols};--rows:${rows}"><div class="bleaf">${pageHTML(cur)}</div></div>
    <div class="bnav"><button type="button" class="icon-btn" data-bnav="-1" aria-label="Previous page"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <input type="range" id="bRange" min="${first}" max="${last}" value="${cur}" aria-label="Page"><span class="bpageno" id="bPageNo"></span>
      <button type="button" class="icon-btn" data-bnav="1" aria-label="Next page"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>
    <p class="note">Swipe or use the arrows to turn pages. Each sheet has a front and a back, the same as your real binder.</p>`;
  const stage = box.querySelector('#binderStage');
  const nav = () => { box.querySelector('#bPageNo').textContent = cur === 0 ? 'Cover' : `${cur} / ${last}`; box.querySelector('#bRange').value = cur; };
  const show = n => { cur = n; box._page = n; stage.innerHTML = `<div class="bleaf">${pageHTML(n)}</div>`; nav(); };
  const turn = dir => {
    const n = cur + dir; if (busy || n < first || n > last) return; buzz();
    if (reduced()) { show(n); return; }
    busy = true; const old = stage.lastElementChild;
    if (dir > 0) { const nx = document.createElement('div'); nx.className = 'bleaf'; nx.innerHTML = pageHTML(n); stage.insertBefore(nx, old); old.classList.add('flip-next'); old.addEventListener('animationend', () => { old.remove(); busy = false; }, { once: true }); }
    else { const inc = document.createElement('div'); inc.className = 'bleaf flip-prev'; inc.innerHTML = pageHTML(n); stage.appendChild(inc); inc.addEventListener('animationend', () => { old.remove(); inc.classList.remove('flip-prev'); busy = false; }, { once: true }); }
    setTimeout(() => { if (busy) { busy = false; while (stage.children.length > 1) stage.firstElementChild.remove(); } }, 900);
    cur = n; box._page = n; nav();
  };
  nav();
  let sx = 0, sy = 0, moved = false, drag = null; const W = () => stage.clientWidth || 300;
  stage.addEventListener('pointerdown', e => { if (busy) return; sx = e.clientX; sy = e.clientY; moved = false; drag = { dir: 0 }; });
  stage.addEventListener('pointermove', e => {
    if (!drag || busy) return; const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!drag.dir) {
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy)) return;
      const dir = dx < 0 ? 1 : -1, n = cur + dir; if (n < first || n > last) { drag = null; return; }
      drag.dir = dir; moved = true; try { stage.setPointerCapture(e.pointerId); } catch {}
      if (dir > 0) { drag.el = stage.lastElementChild; drag.under = document.createElement('div'); drag.under.className = 'bleaf'; drag.under.innerHTML = pageHTML(n); stage.insertBefore(drag.under, drag.el); }
      else { drag.under = stage.lastElementChild; drag.el = document.createElement('div'); drag.el.className = 'bleaf'; drag.el.innerHTML = pageHTML(n); drag.el.style.transform = 'rotateY(-105deg)'; stage.appendChild(drag.el); }
    }
    const f = Math.max(0, Math.min(1, Math.abs(dx) / (W() * .8))); const ang = drag.dir > 0 ? -105 * f : -105 * (1 - f);
    drag.el.style.transform = `rotateY(${ang}deg)`; drag.el.style.filter = `brightness(${1 - .5 * Math.abs(ang) / 105})`;
  });
  const endDrag = e => {
    if (!drag) return; const d = drag; drag = null; if (!d.dir) return;
    const go2 = Math.abs((e.clientX ?? sx) - sx) > W() * .22; const el = d.el; el.style.transition = 'transform .32s ease, filter .32s ease'; busy = true;
    if (d.dir > 0) { el.style.transform = go2 ? 'rotateY(-105deg)' : 'rotateY(0deg)'; el.style.filter = go2 ? 'brightness(.45)' : ''; setTimeout(() => { if (go2) { el.remove(); cur++; box._page = cur; nav(); buzz(); } else { d.under.remove(); el.style.cssText = ''; } busy = false; }, 340); }
    else { el.style.transform = go2 ? 'rotateY(0deg)' : 'rotateY(-105deg)'; el.style.filter = ''; setTimeout(() => { if (go2) { d.under.remove(); el.style.cssText = ''; cur--; box._page = cur; nav(); buzz(); } else el.remove(); busy = false; }, 340); }
  };
  stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);
  box.querySelector('#bRange').oninput = e => show(+e.target.value);
  box.onclick = e => {
    const sz = e.target.closest('[data-bsize]'), nv = e.target.closest('[data-bnav]'), sl = e.target.closest('[data-bk]'), cv = e.target.closest('[data-cover]');
    if (moved) { moved = false; return; }
    if (sz) { const fi = Math.max(0, cur - 1) * binderSize(); prefs.binderSize = +sz.dataset.bsize; savePrefs(); buzz(); renderBinder(box, items, onTap, cur === 0 ? 0 : Math.floor(fi / binderSize()) + 1, cover); }
    else if (nv) turn(+nv.dataset.bnav); else if (cv) turn(1); else if (sl) onTap(+sl.dataset.bk);
  };
}

/* ---------- Card sheet ---------- */
function closeSheet() { const sh = $('#sheet'); if (sh.hidden) return; sh.hidden = true; sh.innerHTML = ''; document.body.style.overflow = ''; }
function openSheet(html) { const sh = $('#sheet'); sh.innerHTML = CLOSE + html; sh.hidden = false; sh.scrollTop = 0; document.body.style.overflow = 'hidden'; sh.querySelector('.close').onclick = closeSheet; return sh; }
function openCard(c) {
  const versions = S.set.cards.filter(x => x.base === c.base && x.id !== c.id);
  const paint = () => {
    const on = has(c);
    const idx = visibleBase().indexOf(c); const b = idx >= 0 ? binderPos(idx) : null;
    const facts = [['Rarity', c.rarity + (c.label ? ` – ${c.label}` : '')], ['Type', [c.type, c.color].filter(Boolean).join(' – ')], ['Cost', c.cost], ['Power', c.power], ['Crew', c.sub]].filter(([, v]) => v != null && v !== '' && v !== 'null');
    const sh = openSheet(`<div class="stage"><div class="big-card">${c.img ? `<img src="${esc(c.img)}" alt="${esc(c.name)}">` : `<div class="noimg">${esc(c.name)}</div>`}</div></div>
      <div class="detail"><h2>${esc(c.name)}</h2><div class="sub">${esc(S.set.name)} – ${esc(c.base)}${c.label ? ' – ' + esc(c.label) : ''}</div>
        <button type="button" class="own-big${on ? ' on' : ''}" id="ownBtn">${on ? '✓ In my binder' : 'Add to my binder'}</button>
        ${b ? `<div class="where">📍 In a ${binderSize()}-pocket binder${S.mode === 'master' ? ' (master set)' : ''}: <b>page ${b.page}</b> (sheet ${b.sheet} ${b.side}), row ${b.row}, slot ${b.col}</div>` : ''}
        <button type="button" class="chase-btn" id="chaseBtn" aria-pressed="${!!chase[c.id]}">${chase[c.id] ? '★ On my chase list' : '☆ Add to my chase list'}</button>
        ${versions.length ? `<div class="panel"><h3>Other versions of this card</h3><div class="rail">${versions.map(v => `<button type="button" class="hit${has(v) ? ' have' : ''}" data-ver="${esc(v.id)}"><img loading="lazy" src="${esc(v.img)}" alt=""><span class="nm">${esc(v.label || 'Base')}</span></button>`).join('')}</div></div>` : ''}
        ${facts.length ? `<div class="panel"><h3>About this card</h3><dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>` : ''}
        ${c.text ? `<div class="panel"><h3>Card text</h3><p class="ctext">${esc(c.text)}</p></div>` : ''}</div>`);
    sh.onclick = e => {
      if (e.target.closest('#ownBtn')) { setOwned(c, !has(c)); paint(); return; }
      if (e.target.closest('#chaseBtn')) { if (chase[c.id]) delete chase[c.id]; else chase[c.id] = { setId: S.set.id, name: c.name, img: c.img, num: c.base, label: c.label }; saveChase(); buzz(); toast(chase[c.id] ? `${c.name} added to your chase list` : `${c.name} removed from your chase list`); paint(); return; }
      const v = e.target.closest('[data-ver]'); if (v) { const x = S.set.cards.find(y => y.id === v.dataset.ver); if (x) openCard(x); }
    };
  };
  paint();
}

/* ---------- Card reveal ---------- */
function reveal({ pic, name, line, tier, kicker }) {
  if (reduced()) { confetti(); toast(`${kicker || 'Big pull!'} ${name}`); return; }
  let el = $('#reveal'); if (!el) { el = document.createElement('div'); el.id = 'reveal'; document.body.appendChild(el); }
  el.className = 'reveal tier' + tier;
  el.innerHTML = `<div class="rv-rays" aria-hidden="true"></div><div class="rv-kicker">${esc(kicker || (tier === 2 ? 'Legendary pull!' : 'Big pull!'))}</div>
    <div class="rv-card"><div class="rv-inner"><div class="rv-back" aria-hidden="true"><span class="compass big"></span></div><div class="rv-front">${pic ? `<img src="${esc(pic)}" alt="${esc(name)}">` : ''}<span class="rv-shine" aria-hidden="true"></span></div></div></div>
    <div class="rv-name">${esc(name)}</div><div class="rv-line">${esc(line || '')}</div><div class="rv-tap">Tap anywhere to close</div>
    <div class="rv-sparks" aria-hidden="true">${Array.from({ length: 26 }, (_, i) => `<i style="--a:${i * 360 / 26}deg;--d:${120 + (i * 53) % 140}px;--t:${(i % 5) * .06}s"></i>`).join('')}</div>`;
  el.hidden = false; requestAnimationFrame(() => el.classList.add('go')); buzz('win');
  setTimeout(() => { if (el.classList.contains('go')) confetti(); }, 900);
  el.onclick = () => { el.classList.remove('go'); el.hidden = true; el.innerHTML = ''; setTimeout(nextBadge, 300); };
}
function onCardAdded(c) {
  const r = hitRank(c);
  if (r >= 0 && r <= 3) {
    reveal({ pic: c.img, name: c.name, line: `${S.set.name} ${c.base}${c.label ? ' – ' + c.label : ''}`, tier: r <= 1 ? 2 : 1 });
    unlock(r === 0 ? 'first-manga' : r === 1 ? 'first-sp' : r === 2 ? 'first-sec' : 'first-alt');
  }
  if (c.rarity === 'L') unlock('first-leader');
  if (chase[c.id]) unlock('chase-hit');
}

/* ---------- Badges ---------- */
const BADGES = [
  { id: 'first-card', icon: '🃏', name: 'Set sail', how: 'Tick your first card' },
  { id: 'cards-50', icon: '⛵', name: '50 cards', how: 'Tick 50 cards' },
  { id: 'cards-100', icon: '🚢', name: '100 cards', how: 'Tick 100 cards' },
  { id: 'cards-250', icon: '⚓', name: '250 cards', how: 'Tick 250 cards' },
  { id: 'cards-500', icon: '🏴‍☠️', name: '500 cards', how: 'Tick 500 cards' },
  { id: 'cards-1000', icon: '👑', name: 'Pirate King', how: 'Tick 1,000 cards' },
  { id: 'first-leader', icon: '🧭', name: 'Captain', how: 'Tick your first Leader' },
  { id: 'first-alt', icon: '🎨', name: 'Alt art', how: 'Tick your first alt art or parallel' },
  { id: 'first-sec', icon: '💎', name: 'Secret treasure', how: 'Tick your first secret rare' },
  { id: 'first-sp', icon: '✨', name: 'Special', how: 'Tick your first SP card' },
  { id: 'first-manga', icon: '📖', name: 'Manga legend', how: 'Tick a manga or super alt art' },
  { id: 'chase-hit', icon: '🎯', name: 'Chase complete', how: 'Tick a card from your chase list' },
  { id: 'board-10', icon: '📜', name: 'First bounties', how: 'Claim 10 characters on the Bounty Board' },
  { id: 'board-25', icon: '💰', name: 'Bounty hunter', how: 'Claim 25 characters' },
  { id: 'board-50', icon: '🗡️', name: 'Supernova', how: 'Claim 50 characters' },
  { id: 'board-100', icon: '🌊', name: 'Warlord', how: 'Claim 100 characters' },
  { id: 'set-half', icon: '🌓', name: 'Halfway', how: 'Reach 50% of any set' },
  { id: 'set-full', icon: '✅', name: 'Set complete', how: 'Complete a whole set' },
  { id: 'master-full', icon: '🏆', name: 'Master set', how: 'Complete every version of a set' },
];
function badgeProgress() {
  const cards = totalOwned(), b = Object.values(board).filter(v => v.st === 'got').length;
  const best = Math.max(0, ...collectingIds().map(k => Math.floor(progressOf(k, 'set').pct)));
  return { 'first-card': [cards, 1], 'cards-50': [cards, 50], 'cards-100': [cards, 100], 'cards-250': [cards, 250], 'cards-500': [cards, 500], 'cards-1000': [cards, 1000],
    'board-10': [b, 10], 'board-25': [b, 25], 'board-50': [b, 50], 'board-100': [b, 100], 'set-half': [best, 50], 'set-full': [best, 100] };
}
const badgeQueue = [];
function unlock(id, quiet) {
  if (prefs.badges[id]) return; prefs.badges[id] = new Date().toISOString().slice(0, 10); savePrefs();
  if (!quiet) { badgeQueue.push(id); setTimeout(nextBadge, 250); }
}
function checkBadges(quiet) { const p = badgeProgress(); for (const id in p) if (p[id][0] >= p[id][1]) unlock(id, quiet); }
function nextBadge() {
  const rv = $('#reveal'), bp = $('#badgePop');
  if (!badgeQueue.length || (bp && !bp.hidden)) return;
  if (rv && !rv.hidden) { setTimeout(nextBadge, 600); return; }
  showBadge(badgeQueue.shift(), true);
}
function showBadge(id, fresh) {
  const b = BADGES.find(x => x.id === id); if (!b) return;
  const got = prefs.badges[id], pr = badgeProgress()[id];
  let el = $('#badgePop'); if (!el) { el = document.createElement('div'); el.id = 'badgePop'; document.body.appendChild(el); }
  el.className = 'badge-pop' + (fresh ? ' fresh' : '');
  el.innerHTML = `<div class="bp-card"><div class="medal${got ? '' : ' locked'}"><span>${b.icon}</span></div><div class="bp-k">${fresh ? 'Badge unlocked!' : got ? 'Earned ' + esc(got) : 'Locked badge'}</div>
    <h3>${esc(b.name)}</h3><p>${esc(b.how)}</p>${!got && pr ? `<div class="bp-bar"><i style="width:${Math.min(100, pr[0] / pr[1] * 100)}%"></i></div><p class="muted">${pr[0]} of ${pr[1]}</p>` : ''}
    <button type="button" class="btn">${fresh ? 'Nice!' : 'Close'}</button></div>`;
  el.hidden = false; if (fresh) { confetti(); buzz('win'); }
  el.onclick = e => { if (e.target === el || e.target.closest('.btn')) { el.hidden = true; setTimeout(nextBadge, 300); } };
}
function trophyShelf() {
  const p = badgeProgress();
  const got = BADGES.filter(b => prefs.badges[b.id]);
  const next = BADGES.filter(b => !prefs.badges[b.id] && p[b.id]).sort((a, b) => p[b.id][0] / p[b.id][1] - p[a.id][0] / p[a.id][1]).slice(0, 4);
  return `<section class="block"><div class="block-head"><h2>Trophy shelf</h2><span class="count">${got.length} of ${BADGES.length}</span></div>
    <div class="rail trophies">${[...got, ...next].map(b => { const on = !!prefs.badges[b.id], pr = p[b.id]; return `<button type="button" class="trophy${on ? ' won' : ''}" data-badge="${b.id}"><span class="medal${on ? '' : ' locked'}"><span>${b.icon}</span></span><b>${esc(b.name)}</b>${!on && pr ? `<span class="tbar"><i style="width:${Math.min(100, pr[0] / pr[1] * 100)}%"></i></span>` : ''}</button>`; }).join('')}</div></section>`;
}

/* ---------- Bounty Board: one special art card per character ---------- */
let BOARD = null;
async function loadBoard() {
  if (BOARD) return BOARD;
  const sets = await catalog();
  const lists = await pool(sets.filter(s => s.kind !== 'st').map(s => async () => { try { return (await loadSet(s.id)).cards.map(c => ({ ...c, setId: s.id, setLabel: s.name })); } catch { return []; } }), 4);
  const byName = new Map();
  lists.flat().forEach(c => {
    if (!(c.type === 'Leader' || c.type === 'Character')) return;
    if (!(c.variant || c.rarity === 'SEC' || c.rarity === 'L')) return;
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name).push(c);
  });
  BOARD = [...byName.entries()].map(([name, opts]) => ({ name, opts: opts.sort((a, b) => hitRank(a) - hitRank(b)), color: (opts[0].color || '').split(/[ /]/)[0] }))
    .filter(x => x.opts.some(o => o.variant || o.rarity === 'SEC')).sort((a, b) => a.name.localeCompare(b.name));
  return BOARD;
}
const boardPic = e => { const a = board[e.name]; if (!a || !a.pick) return ''; const o = e.opts.find(x => x.id === a.pick); return o ? o.img : ''; };
const BX = { filter: 'all', q: '', color: '' };
async function renderBoard(id) {
  view.innerHTML = loading('Unrolling the Bounty Board… (the first time takes a moment)');
  try { await loadBoard(); } catch { if (id === renderId) errorView('The Bounty Board didn’t load.', route); return; }
  if (id !== renderId) return;
  const vals = Object.values(board), got = vals.filter(v => v.st === 'got').length, way = vals.filter(v => v.st === 'ordered').length, plan = vals.filter(v => v.st === 'picked').length;
  const colors = [...new Set(BOARD.map(e => e.color).filter(Boolean))];
  view.innerHTML = `
    <div class="dex-hero"><div><h1>Bounty Board</h1><p class="muted">Claim one special card for every character: an alt art, parallel, SP, manga or secret rare. ${BOARD.length} characters are wanted.</p></div>${ring(got / BOARD.length * 100, true)}</div>
    <div class="stats"><div class="stat hot"><b>${got}</b><span>claimed</span></div><div class="stat"><b>${way}</b><span>on the way</span></div><div class="stat"><b>${plan}</b><span>planned</span></div></div>
    <div class="set-actions"><div class="seg view-seg" role="group" aria-label="View"><button type="button" data-bview="grid">Posters</button><button type="button" data-bview="binder">Binder</button></div><button type="button" class="track-btn" id="shareBoardBtn">Share</button></div>
    <section id="boardBinder" class="binder-box" hidden></section>
    <div class="board-tools">
      <div class="controls dex-controls"><div class="seg" role="group" aria-label="Show"><button type="button" data-bf="all">All</button><button type="button" data-bf="need">Wanted</button><button type="button" data-bf="picked">Planned</button><button type="button" data-bf="ordered">On way</button><button type="button" data-bf="got">Claimed</button></div></div>
      <div class="gens">${['', ...colors].map(c => `<button type="button" class="chip gen" data-color="${esc(c)}">${c || 'All colours'}</button>`).join('')}</div>
      <label class="search"><svg viewBox="0 0 24 24" width="20" height="20"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M15.5 15.5L20 20" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg><input id="boardSearch" type="search" placeholder="Find a character" autocomplete="off" aria-label="Find a character" value="${esc(BX.q)}"></label>
      <div class="count-line" id="boardCount"></div><div class="grid dex-grid" id="boardGrid"></div>
    </div>`;
  const list = () => BOARD.filter(e => { const st = (board[e.name] || {}).st || ''; if (BX.filter === 'need' && st) return false; if (!['all', 'need'].includes(BX.filter) && st !== BX.filter) return false; if (BX.color && e.color !== BX.color) return false; if (BX.q && !e.name.toLowerCase().includes(BX.q.toLowerCase())) return false; return true; });
  const tile = e => { const a = board[e.name] || {}, st = a.st || '', pic = boardPic(e);
    return `<button type="button" class="dslot poster st-${st || 'need'}" data-char="${esc(e.name)}"><span class="dpic">${pic ? `<img loading="lazy" src="${esc(pic)}" alt="">` : `<span class="wanted"><b>WANTED</b><img loading="lazy" src="${esc(e.opts[0].img)}" alt=""><i>${esc(e.name)}</i><small>${e.opts.length} version${e.opts.length === 1 ? '' : 's'}</small></span>`}</span>${st ? `<span class="dbadge">${st === 'got' ? CHECK : st === 'ordered' ? '🚚' : '★'}</span>` : ''}<span class="dnm">${esc(e.name)}</span></button>`; };
  const paint = () => {
    view.querySelectorAll('[data-bf]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.bf === BX.filter)));
    view.querySelectorAll('[data-color]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === BX.color)));
    const L = list(); $('#boardCount').textContent = `${L.length} characters`; $('#boardGrid').innerHTML = L.map(tile).join('');
  };
  const items = () => BOARD.map(e => { const a = board[e.name] || {}; return { e, pic: boardPic(e) || e.opts[0].img, have: a.st === 'got', soft: a.st && a.st !== 'got', label: e.name.split(' ').pop(), name: e.name }; });
  const paintV = () => { const b = prefs.boardView === 'binder'; view.querySelectorAll('[data-bview]').forEach(x => x.setAttribute('aria-pressed', String((x.dataset.bview === 'binder') === b))); view.querySelector('.board-tools').hidden = b; $('#boardBinder').hidden = !b; if (b) renderBinder($('#boardBinder'), items(), k => openBoardSheet(items()[k].e), 0, { title: 'Bounty Board', logo: '' }); };
  view.querySelector('.view-seg').onclick = e => { const b = e.target.closest('[data-bview]'); if (b) { prefs.boardView = b.dataset.bview; savePrefs(); buzz(); paintV(); } };
  view.querySelector('.dex-controls').onclick = e => { const b = e.target.closest('[data-bf]'); if (b) { BX.filter = b.dataset.bf; paint(); } };
  view.querySelector('.gens').onclick = e => { const b = e.target.closest('[data-color]'); if (b) { BX.color = b.dataset.color; paint(); } };
  $('#boardSearch').oninput = e => { BX.q = e.target.value.trim(); paint(); };
  $('#boardGrid').onclick = e => { const b = e.target.closest('[data-char]'); if (b) openBoardSheet(BOARD.find(x => x.name === b.dataset.char)); };
  $('#shareBoardBtn').onclick = () => openSharePicker('board');
  BX.repaint = () => { if (parse().name !== 'board') return; paint(); if (prefs.boardView === 'binder') { const box = $('#boardBinder'); renderBinder(box, items(), k => openBoardSheet(items()[k].e), box._page ?? 1, { title: 'Bounty Board', logo: '' }); } };
  paint(); paintV(); restoreScroll();
}
const BOARD_ST = { '': 'Wanted', picked: 'Planned', ordered: 'On the way', got: 'Claimed' };
function openBoardSheet(e) {
  if (!e) return;
  const paint = () => {
    const a = board[e.name] || {}, st = a.st || '', pick = a.pick ? e.opts.find(o => o.id === a.pick) : null;
    const sh = openSheet(`<div class="detail dex-detail"><div class="dex-title"><h2>${esc(e.name)}</h2><div class="sub">${e.opts.length} special version${e.opts.length === 1 ? '' : 's'}</div></div>
      <div class="stage"><div class="big-card">${pick ? `<img src="${esc(pick.img)}" alt="">` : `<div class="noimg wanted-big"><b>WANTED</b>${esc(e.name)}<small>Pick a card below</small></div>`}</div></div>
      ${pick ? `<div class="sub" style="text-align:center">My pick: ${esc(pick.setLabel)} ${esc(pick.base)}${pick.label ? ' – ' + esc(pick.label) : ''}</div>` : ''}
      ${(a.pick || a.st) ? '<div style="text-align:center;margin-top:10px"><button type="button" class="btn ghost" data-clear="1">Clear this character</button></div>' : ''}
      <div class="panel"><h3>Status</h3><div class="own-row">${['', 'picked', 'ordered', 'got'].map(s => `<button type="button" class="own-btn" data-st="${s}" aria-pressed="${st === s}"><span class="dot"></span>${BOARD_ST[s]}</button>`).join('')}</div></div>
      <div class="panel"><h3>Choose your card <span class="count">${e.opts.length}</span></h3><div class="opt-grid">${e.opts.map(o => `<button type="button" class="opt${a.pick === o.id ? ' on' : ''}" data-pick="${esc(o.id)}"><img loading="lazy" src="${esc(o.img)}" alt=""><span class="opt-set">${esc(o.setLabel)} ${esc(o.base)}</span><span class="opt-r">${esc(o.label || o.rarity)}</span>${a.pick === o.id ? '<span class="opt-tag">My pick</span>' : ''}</button>`).join('')}</div></div>
      <p class="note" style="text-align:center">Tap a card to make it your pick. Tap it again to remove it.</p></div>`);
    sh.onclick = ev => {
      const sb = ev.target.closest('[data-st]'), pb = ev.target.closest('[data-pick]'), cb = ev.target.closest('[data-clear]'); if (!sb && !pb && !cb) return;
      const before = JSON.stringify(board[e.name] || null); const undo = () => { const b = JSON.parse(before); if (b) board[e.name] = b; else delete board[e.name]; saveBoard(); paint(); BX.repaint && BX.repaint(); };
      const x = board[e.name] || (board[e.name] = {});
      if (cb) { delete board[e.name]; toast(`${e.name} cleared`, { label: 'Undo', run: undo }); }
      else if (sb) { const was = x.st || ''; x.st = sb.dataset.st; if (!x.st) { delete board[e.name]; toast(`${e.name} is wanted again`, { label: 'Undo', run: undo }); } else if (x.st === 'got' && was !== 'got') { const o = x.pick ? e.opts.find(y => y.id === x.pick) : null; reveal({ pic: o ? o.img : e.opts[0].img, name: e.name, line: o ? `${o.setLabel} ${o.base}${o.label ? ' – ' + o.label : ''}` : 'Claimed on your Bounty Board', tier: 1, kicker: 'Bounty claimed!' }); } else buzz(); }
      else if (pb) { if (x.pick === pb.dataset.pick) { delete x.pick; if (x.st === 'picked') delete x.st; toast('Pick removed', { label: 'Undo', run: undo }); } else { x.pick = pb.dataset.pick; if (!x.st) x.st = 'picked'; buzz(); toast('Saved as your pick (Planned)'); } }
      if (board[e.name] && !board[e.name].st && !board[e.name].pick) delete board[e.name];
      saveBoard(); paint(); BX.repaint && BX.repaint(); checkBadges();
    };
  };
  paint();
}

/* ---------- What I'm missing ---------- */
async function renderGaps(id) {
  const ids = collectingIds();
  const planned = Object.entries(board).filter(([, v]) => v.st === 'picked' || v.st === 'ordered');
  view.innerHTML = `<div class="dex-hero"><div><h1>What I'm missing</h1><p class="muted">Everything still to find, in one place. Copy the list to take to a shop or an event.</p></div></div>
    <button type="button" class="btn" id="copyGaps" style="margin-bottom:18px">Copy my list</button>
    <section class="block"><div class="block-head"><h2>Bounty Board: planned and on the way</h2><span class="count">${planned.length}</span></div>${planned.length ? '<div class="rail" id="gapBoard"></div>' : '<div class="hint">No planned picks waiting.</div>'}</section>
    ${ids.map(k => `<section class="block set-gap" data-k="${esc(k)}"><div class="block-head"><h2>${esc((meta[k] || {}).name || k)} <small class="muted">${esc(k)}</small></h2><span class="count">…</span></div>${loading('Checking…')}</section>`).join('')}
    ${!ids.length ? '<div class="hint">Start ticking a set and its missing cards show up here.</div>' : ''}`;
  const text = [];
  if (planned.length) {
    try { await loadBoard(); } catch {}
    if (id !== renderId) return;
    const el = $('#gapBoard');
    if (el) el.innerHTML = planned.map(([n, v]) => { const e = (BOARD || []).find(x => x.name === n); const o = e && v.pick ? e.opts.find(y => y.id === v.pick) : null; return `<button type="button" class="chase gap-b" data-char="${esc(n)}"><div class="pic">${o ? `<img loading="lazy" src="${esc(o.img)}" alt="">` : ''}</div><div class="nm">${v.st === 'ordered' ? '🚚 ' : '★ '}${esc(n)}</div><div class="sub">${o ? esc(o.base + (o.label ? ' ' + o.label : '')) : 'No card picked'}</div></button>`; }).join('');
    view.querySelectorAll('.gap-b').forEach(b => b.onclick = () => openBoardSheet((BOARD || []).find(x => x.name === b.dataset.char)));
    text.push('BOUNTY BOARD – planned / on the way:', ...planned.map(([n, v]) => { const e = (BOARD || []).find(x => x.name === n); const o = e && v.pick ? e.opts.find(y => y.id === v.pick) : null; return `- ${n}${o ? ` – ${o.base}${o.label ? ' ' + o.label : ''}` : ''}${v.st === 'ordered' ? ' (on the way)' : ''}`; }));
  }
  for (const k of ids) {
    const el = view.querySelector(`.set-gap[data-k="${CSS.escape(k)}"]`);
    try {
      const set = await loadSet(k); if (id !== renderId) return;
      const mode = prefs.modes[k] || 'set'; const o = ownedSet(k);
      const miss = set.cards.filter(c => (mode === 'master' || !c.variant) && !o[c.id]);
      el.querySelector('.count').textContent = `${miss.length} missing`;
      el.querySelector('.loading').outerHTML = miss.length ? `<div class="rail">${miss.map(c => `<a class="chase" href="#/set/${encodeURIComponent(k)}"><div class="pic"><img loading="lazy" src="${esc(c.img)}" alt=""></div><div class="nm">${esc(c.name)}</div><div class="sub">${esc(c.num)}${c.label ? ' ' + esc(c.label) : ''}</div></a>`).join('')}</div>` : '<div class="hint">Complete! Nothing missing.</div>';
      text.push('', `${set.name} (${k}) – ${miss.length} missing:`, miss.map(c => `${c.base}${c.label ? ' ' + c.label : ''} ${c.name}`).join(', '));
    } catch { if (el) el.querySelector('.loading').outerHTML = '<div class="hint">Couldn’t load this set.</div>'; }
  }
  $('#copyGaps').onclick = async () => { const t = text.join('\n') || 'Nothing missing yet!'; try { await navigator.clipboard.writeText(t); toast('List copied. Paste it in WhatsApp or Notes.'); } catch { if (navigator.share) navigator.share({ title: 'My missing cards', text: t }).catch(() => {}); } };
}

/* ---------- Scan a card ---------- */
let tessP = null;
const loadTesseract = () => window.Tesseract ? Promise.resolve(window.Tesseract) : (tessP || (tessP = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'; s.onload = () => res(window.Tesseract); s.onerror = () => { tessP = null; rej(new Error('load')); }; document.head.appendChild(s); })));
function shrink(file, max = 1600) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => { const k = Math.min(1, max / Math.max(im.width, im.height)); const c = document.createElement('canvas'); c.width = im.width * k; c.height = im.height * k; const x = c.getContext('2d'); x.filter = 'grayscale(1) contrast(1.4)'; x.drawImage(im, 0, 0, c.width, c.height); res(c); }; im.onerror = rej; im.src = URL.createObjectURL(file); }); }
function findCodes(text) {
  const t = text.toUpperCase().replace(/[O](?=\d)/g, '0');
  const codes = new Set(); let m; const re = /\b(OP|ST|EB|PRB|P)\s?0?(\d{1,2})?\s?[-–]\s?(\d{3})\b/g;
  while ((m = re.exec(t))) codes.add(m[2] ? `${m[1]}${m[2].padStart(2, '0')}-${m[3]}` : `${m[1]}-${m[3]}`);
  return S.set.cards.filter(c => codes.has(c.base));
}
function scanResult(found, note) {
  const sh = openSheet(`<div class="detail scan-detail"><h2>Scan a card</h2>${note ? `<p class="muted">${esc(note)}</p>` : ''}
    ${found.length ? `<div class="scan-found">${found.slice(0, 6).map(c => `<div class="sf"><div class="pic"><img src="${esc(c.img)}" alt=""></div><div><b>${esc(c.name)}</b><div class="muted">${esc(c.base)}${c.label ? ' – ' + esc(c.label) : ''}</div><button type="button" class="btn" data-tickc="${esc(c.id)}">${has(c) ? '✓ Already ticked' : 'Tick this card'}</button></div></div>`).join('')}</div>` : ''}
    <div class="panel"><h3>Or type the number</h3><p class="muted">It's printed at the bottom right of the card, like ${esc(S.set.cards[0]?.base || 'OP01-001')}.</p><div class="quick-num"><input id="qNum" inputmode="numeric" placeholder="e.g. 77" aria-label="Card number"><button type="button" class="btn" id="qGo">Find</button></div><div id="qOut"></div></div>
    <button type="button" class="btn ghost" id="scanAgain">📷 Scan another card</button></div>`);
  sh.onclick = e => {
    const t = e.target.closest('[data-tickc]'); if (t) { const c = S.set.cards.find(x => x.id === t.dataset.tickc); if (c && !has(c)) { setOwned(c, true); t.textContent = '✓ Ticked'; } return; }
    if (e.target.closest('#scanAgain')) { closeSheet(); startScan(); return; }
    if (e.target.closest('#qGo')) { const n = $('#qNum').value.trim().padStart(3, '0'); const cs = S.set.cards.filter(c => c.num === n || c.base.endsWith(n)); $('#qOut').innerHTML = cs.length ? cs.map(c => `<div class="sf"><div class="pic"><img src="${esc(c.img)}" alt=""></div><div><b>${esc(c.name)}</b><div class="muted">${esc(c.base)}${c.label ? ' – ' + esc(c.label) : ''}</div><button type="button" class="btn" data-tickc="${esc(c.id)}">${has(c) ? '✓ Already ticked' : 'Tick this card'}</button></div></div>`).join('') : '<p class="muted">No card with that number in this set.</p>'; }
  };
}
function startScan() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment');
  inp.onchange = async () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    openSheet(`<div class="detail"><h2>Reading the card…</h2>${loading('Looking for the card number')}</div>`);
    try { const T = await loadTesseract(); const r = await T.recognize(await shrink(f), 'eng'); const found = findCodes(r.data.text || ''); scanResult(found, found.length ? (found.length > 1 ? 'This number has more than one version. Pick the one in your hand:' : 'Is this the card?') : 'I couldn’t read the number from that photo. Try closer to the bottom of the card in good light, or type the number.'); }
    catch { scanResult([], 'Scanning needs an internet connection the first time. You can type the number instead.'); }
  };
  inp.click();
}

/* ---------- Share a picture ---------- */
const loadImg = src => new Promise(res => { if (!src) return res(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
function rr(x, X, Y, W, H, R) { x.beginPath(); x.moveTo(X + R, Y); x.arcTo(X + W, Y, X + W, Y + H, R); x.arcTo(X + W, Y + H, X, Y + H, R); x.arcTo(X, Y + H, X, Y, R); x.arcTo(X, Y, X + W, Y, R); x.closePath(); }
async function drawShare({ title, sub, pct, stats, pics, rows }) {
  await document.fonts.ready;
  const n = rows ? Math.min(rows.length, 6) : 0, W = 1080, H = 1350 + n * 70;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#12355f'); g.addColorStop(.6, '#0B1E3A'); g.addColorStop(1, '#3a1222'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(243,226,184,.06)'; x.lineWidth = 2; for (let i = 0; i < 14; i++) { x.beginPath(); x.arc(W * .8, H * .1, 120 + i * 90, 0, 7); x.stroke(); }
  x.fillStyle = '#F2B630'; x.font = '40px "Pirata One", serif'; x.fillText('Log Pose', 70, 100);
  x.fillStyle = '#F3E2B8'; x.font = '84px "Pirata One", serif'; x.fillText(title, 70, 200);
  x.fillStyle = '#9fc3dd'; x.font = '600 34px Nunito, sans-serif'; x.fillText(sub, 70, 255);
  const cx = W - 180, cy = 175, R = 95; x.lineWidth = 26; x.strokeStyle = 'rgba(255,255,255,.12)'; x.beginPath(); x.arc(cx, cy, R, 0, 7); x.stroke();
  const rg = x.createLinearGradient(cx - R, cy - R, cx + R, cy + R); rg.addColorStop(0, '#3FB6D9'); rg.addColorStop(1, '#F2B630'); x.strokeStyle = rg; x.lineCap = 'round'; x.beginPath(); x.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.max(.02, pct / 100) * Math.PI * 2); x.stroke();
  x.fillStyle = '#fff'; x.font = '700 50px Fredoka, sans-serif'; x.textAlign = 'center'; x.fillText(Math.round(pct) + '%', cx, cy + 17); x.textAlign = 'left';
  stats.forEach((s, i) => { const X = 70 + i * 320; rr(x, X, 300, 300, 130, 22); x.fillStyle = i === 0 ? '#D7263D' : 'rgba(255,255,255,.08)'; x.fill(); x.fillStyle = '#fff'; x.font = '700 60px Fredoka, sans-serif'; x.fillText(String(s[0]), X + 28, 375); x.font = '600 28px Nunito, sans-serif'; x.fillStyle = i === 0 ? '#fff' : '#9fc3dd'; x.fillText(s[1], X + 28, 412); });
  (rows || []).slice(0, 6).forEach((r, i) => { const Y = 480 + i * 70; x.fillStyle = '#fff'; x.font = '700 32px Fredoka, sans-serif'; x.fillText(r.name.length > 26 ? r.name.slice(0, 25) + '…' : r.name, 70, Y + 30); x.textAlign = 'right'; x.fillStyle = '#9fc3dd'; x.font = '600 28px Nunito, sans-serif'; x.fillText(`${r.have} / ${r.total}`, W - 70, Y + 30); x.textAlign = 'left'; rr(x, 70, Y + 42, W - 140, 12, 6); x.fillStyle = 'rgba(255,255,255,.12)'; x.fill(); if (r.total) { rr(x, 70, Y + 42, Math.max(12, (W - 140) * Math.min(1, r.have / r.total)), 12, 6); x.fillStyle = '#F2B630'; x.fill(); } });
  const imgs = (await Promise.all(pics.slice(0, 16).map(loadImg))).filter(Boolean).slice(0, 8);
  const cw = 222, ch = 310, gap = 24, top = 480 + n * 70 + (n ? 20 : 0);
  imgs.forEach((im, i) => { const X = 70 + (i % 4) * (cw + gap), Y = top + Math.floor(i / 4) * (ch + gap); x.save(); rr(x, X, Y, cw, ch, 14); x.clip(); x.drawImage(im, X, Y, cw, ch); x.restore(); });
  if (!imgs.length) { x.fillStyle = 'rgba(255,255,255,.5)'; x.font = '600 34px Nunito, sans-serif'; x.fillText('Start ticking cards to fill this picture!', 70, top + 80); }
  x.fillStyle = '#9fc3dd'; x.font = '600 28px Nunito, sans-serif'; x.fillText(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), 70, H - 60);
  try { return c.toDataURL('image/png'); } catch { return null; }
}
async function makeShare(target) {
  const ids = collectingIds(), cards = totalOwned();
  let bPics = []; const bGot = Object.values(board).filter(v => v.st === 'got').length;
  if (target === 'all' || target === 'board') { try { await loadBoard(); bPics = BOARD.filter(e => (board[e.name] || {}).st === 'got').map(boardPic).filter(Boolean); } catch {} }
  const badges = Object.keys(prefs.badges || {}).length;
  if (target === 'board') return drawShare({ title: 'My Bounty Board', sub: `${bGot} characters claimed`, pct: BOARD ? bGot / BOARD.length * 100 : 0, stats: [[bGot, 'claimed'], [cards, 'cards ticked'], [badges, 'badges']], pics: bPics });
  if (target === 'all') {
    const rows = ids.map(k => { const p = progressOf(k, prefs.modes[k] || 'set'); return { name: `${(meta[k] || {}).name || k} (${k})`, have: p.have, total: p.total }; });
    const pics = [...bPics];
    for (const k of ids) { try { const s = await loadSet(k); s.cards.filter(c => ownedSet(k)[c.id]).sort((a, b) => (hitRank(a) < 0 ? 9 : hitRank(a)) - (hitRank(b) < 0 ? 9 : hitRank(b))).slice(0, 4).forEach(c => pics.push(c.img)); } catch {} }
    return drawShare({ title: prefs.trainer ? `${prefs.trainer}'s collection` : 'My collection', sub: `${ids.length} set${ids.length === 1 ? '' : 's'} and the Bounty Board`, pct: rows.length ? rows.reduce((n, r) => n + (r.total ? r.have / r.total : 0), 0) / rows.length * 100 : 0, stats: [[cards, 'cards ticked'], [bGot, 'bounties'], [badges, 'badges']], pics, rows });
  }
  const s = await loadSet(target); const o = ownedSet(target); const mode = prefs.modes[target] || 'set';
  const list = s.cards.filter(c => mode === 'master' || !c.variant); const have = list.filter(c => o[c.id]);
  const pics = have.slice().sort((a, b) => (hitRank(a) < 0 ? 9 : hitRank(a)) - (hitRank(b) < 0 ? 9 : hitRank(b))).map(c => c.img);
  return drawShare({ title: s.name.length > 22 ? s.name.slice(0, 21) + '…' : s.name, sub: `${s.id} – ${mode === 'master' ? 'master set' : 'set'}`, pct: list.length ? have.length / list.length * 100 : 0, stats: [[have.length, 'collected'], [list.length - have.length, 'to go'], [list.length, 'in the set']], pics });
}
function openSharePicker(start) {
  const ids = collectingIds();
  const opts = [{ k: 'all', name: 'Everything', sub: 'All your sets and the Bounty Board' }, { k: 'board', name: 'Bounty Board', sub: 'Your claimed characters' }, ...ids.map(k => ({ k, name: (meta[k] || {}).name || k, sub: `${k} – ${progressOf(k).have} of ${progressOf(k).total}` }))];
  if (!opts.some(o => o.k === start)) opts.push({ k: start, name: (meta[start] || {}).name || start, sub: 'This set' });
  const sh = openSheet(`<div class="detail share-detail"><h2>Share a picture</h2><p class="muted">Pick what to show. Your best cards go in the picture.</p>
    <div class="share-opts">${opts.map(o => `<button type="button" class="share-opt" data-share="${esc(o.k)}" aria-pressed="${o.k === start}"><span class="so-art">${o.k === 'all' ? '🗺️' : o.k === 'board' ? '📜' : setArt({ id: o.k })}</span><span class="so-txt"><b>${esc(o.name)}</b><span class="muted">${esc(o.sub)}</span></span></button>`).join('')}</div>
    <div id="sharePreview"></div></div>`);
  let token = 0, cur = null;
  const preview = async k => {
    const t = ++token; sh.querySelectorAll('[data-share]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.share === k)));
    const box = $('#sharePreview'); box.innerHTML = loading('Making your picture…');
    let data = null; try { data = await makeShare(k); } catch {}
    if (t !== token || sh.hidden) return; cur = data;
    box.innerHTML = data ? `<img class="share-img" src="${data}" alt="Preview"><button type="button" class="btn share-go" id="shareGo">📤 Share this picture</button><p class="note">Or press and hold the picture to save it.</p>` : '<div class="hint">Couldn’t make the picture. Check your internet connection and try again.</div>';
    const go2 = $('#shareGo'); if (go2) go2.onclick = async () => {
      try { const blob = await (await fetch(cur)).blob(); const file = new File([blob], 'log-pose.png', { type: 'image/png' }); if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'My Log Pose collection' }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
      toast('Press and hold the picture to save or share it.');
    };
  };
  sh.onclick = e => { const b = e.target.closest('[data-share]'); if (b) { buzz(); preview(b.dataset.share); } };
  preview(start);
}

/* ---------- Settings, backup, welcome ---------- */
const KEYS = ['lp.owned', 'lp.board', 'lp.chase', 'lp.meta', 'lp.prefs'];
function backupNow() {
  const json = JSON.stringify({ app: 'LogPose', v: 1, date: new Date().toISOString(), ...Object.fromEntries(KEYS.map(k => [k, store.get(k, null)])) });
  const name = `LogPose-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: 'application/json' });
  const done = () => { prefs.lastBackup = new Date().toISOString().slice(0, 10); savePrefs(); };
  if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: 'Log Pose backup' }).then(done).catch(() => {}); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click(); done();
}
function restorePick() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json,text/plain';
  inp.onchange = async () => {
    const f = inp.files && inp.files[0]; if (!f) return; let d; try { d = JSON.parse(await f.text()); } catch {}
    if (!d || d.app !== 'LogPose') { toast('That file isn’t a Log Pose backup.'); return; }
    const n = Object.values(d['lp.owned'] || {}).reduce((s, o) => s + Object.keys(o || {}).length, 0);
    openSettings(`<div class="panel warn"><h3>Restore this backup?</h3><p>Saved ${esc(String(d.date).slice(0, 10))} with ${n} cards ticked. Everything in the app now will be replaced.</p><button type="button" class="btn" id="doRestore">Restore backup</button></div>`);
    $('#doRestore').onclick = () => { KEYS.forEach(k => { if (d[k] != null) store.set(k, d[k]); else localStorage.removeItem(k); }); location.hash = '#/'; location.reload(); };
  };
  inp.click();
}
function openSettings(extra) {
  const sh = openSheet(`<div class="detail settings"><h2>Settings</h2>${typeof extra === 'string' ? extra : ''}
    <div class="panel"><h3>Your name</h3><p class="muted">Shown on the home page and on pictures you share.</p><div class="quick-num"><input id="tName" maxlength="20" placeholder="Captain" value="${esc(prefs.trainer || '')}" aria-label="Your name"><button type="button" class="btn" id="tSave">Save</button></div></div>
    <div class="panel"><h3>Back up my collection</h3><p class="muted">Your collection is saved only on this phone. Make a backup file and keep it in iCloud Drive, Google Drive or WhatsApp.${prefs.lastBackup ? ` Last backup: ${esc(prefs.lastBackup)}.` : ' You haven’t made a backup yet.'}</p><button type="button" class="btn" id="bkNow">Back up now</button></div>
    <div class="panel"><h3>Restore from a backup</h3><p class="muted">Use this on a new phone.</p><button type="button" class="btn ghost" id="bkLoad">Choose backup file</button></div>
    <div class="panel"><h3>Start over</h3><p class="muted">Removes every tick, your Bounty Board and badges from this phone.</p><button type="button" class="btn ghost danger" id="wipe">Start over</button></div>
    <p class="note" style="text-align:center">Log Pose – fan-made, not affiliated with the One Piece Card Game.</p></div>`);
  $('#tSave').onclick = () => { prefs.trainer = $('#tName').value.trim(); savePrefs(); toast('Name saved'); closeSheet(); route(); };
  $('#bkNow').onclick = backupNow; $('#bkLoad').onclick = restorePick;
  let armed = false; $('#wipe').onclick = e => { if (!armed) { armed = true; e.target.textContent = 'Tap again to remove everything'; return; } KEYS.forEach(k => localStorage.removeItem(k)); location.hash = '#/'; location.reload(); };
}
$('#setBtn').onclick = () => openSettings();
function maybeWelcome() {
  if (prefs.welcomed) return; prefs.welcomed = true; savePrefs();
  if (Object.keys(owned).length) return;
  const sh = $('#sheet');
  sh.innerHTML = `<div class="detail welcome"><span class="compass big" aria-hidden="true"></span><h2>Welcome aboard Log Pose</h2>
    <p class="muted">Tick the One Piece cards you own, claim a special card for every character on the Bounty Board, and see exactly where each card goes in your binder.</p>
    <div class="panel"><h3>What should we call you?</h3><div class="quick-num"><input id="wName" maxlength="20" placeholder="Your name" aria-label="Your name"></div></div>
    <button type="button" class="btn" id="wGo">Set sail</button>
    <p class="muted" style="margin-top:16px">Moving from another phone? <button type="button" class="link-btn" id="wRestore">Restore a backup</button></p></div>`;
  sh.hidden = false; document.body.style.overflow = 'hidden';
  $('#wGo').onclick = () => { prefs.trainer = $('#wName').value.trim(); savePrefs(); closeSheet(); route(); confetti(); };
  $('#wRestore').onclick = restorePick;
}

/* ---------- start ---------- */
document.addEventListener('error', e => { const t = e.target; if (t.tagName === 'IMG') t.classList.add('broken'); }, true);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (!history.state) history.replaceState({ d: 0 }, '', location.hash || '#/');
route();
checkBadges(true);
maybeWelcome();
const splash = $('#splash'); setTimeout(() => { splash.classList.add('open'); setTimeout(() => splash.remove(), 900); }, 600);
})();
