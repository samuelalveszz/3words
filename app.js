const DB_NAME = 'three-words-db';
const DB_VERSION = 1;
const INTERVALS = [3, 7, 14, 30, 60, 120];
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const DEMO_WORDS = [
  ['hinder', 'to make something more difficult', 'dificultar / impedir', 'Lack of information can hinder decision-making.', 'verb', 'B2'],
  ['bicker', 'to argue about small, unimportant things', 'discutir / implicar', 'The siblings kept bickering over whose turn it was.', 'verb', 'C1'],
  ['quarrel', 'an angry disagreement between people', 'discussão / desentendimento', 'They had a quarrel but made peace the next day.', 'noun · verb', 'B2'],
  ['haggle', 'to argue about the price of something', 'regatear', 'We haggled with the seller over the price.', 'verb', 'C1'],
  ['stunning', 'extremely beautiful or impressive', 'deslumbrante / impressionante', 'The view from the top was absolutely stunning.', 'adjective', 'B2'],
  ['livestock', 'animals kept on a farm', 'gado / animais de criação', 'The farm raises livestock and grows vegetables.', 'noun', 'B2'],
  ['endangered', 'at serious risk of disappearing', 'em perigo de extinção', 'The reserve protects several endangered species.', 'adjective', 'B2'],
  ['settle', 'to resolve a disagreement or make a place your home', 'resolver / estabelecer-se', 'They managed to settle the matter calmly.', 'verb', 'B2'],
  ['establish', 'to start or create something intended to last', 'estabelecer / fundar', 'The team established a clear routine.', 'verb', 'B2'],
];

let db;
let route = 'today';
let todaySelection = null;
let installPrompt = null;
let settings = { theme: 'system', notifications: false, notificationTime: '09:00', eveningCheckIn: false, eveningTime: '20:30' };

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const words = database.createObjectStore('words', { keyPath: 'id' });
      words.createIndex('term', 'term', { unique: true });
      words.createIndex('status', 'status');
      const events = database.createObjectStore('events', { keyPath: 'id' });
      events.createIndex('wordId', 'wordId');
      events.createIndex('createdAt', 'createdAt');
      database.createObjectStore('daily', { keyPath: 'date' });
      database.createObjectStore('settings', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function store(name, mode = 'readonly') { return db.transaction(name, mode).objectStore(name); }
function requestResult(request) { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
const getAll = name => requestResult(store(name).getAll());
const getOne = (name, key) => requestResult(store(name).get(key));
const putOne = (name, value) => requestResult(store(name, 'readwrite').put(value));
const deleteOne = (name, key) => requestResult(store(name, 'readwrite').delete(key));

function localDate(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}
function addDays(date, days) { const d = new Date(date); d.setDate(d.getDate() + days); return d.toISOString(); }
function daysSince(value) { return value ? Math.max(0, (Date.now() - new Date(value).getTime()) / 86400000) : 999; }
function uid(prefix) { return `${prefix}_${Date.now()}_${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`; }
function escapeHtml(value = '') { return value.replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]); }
function hash(text) { let h = 2166136261; for (const c of text) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }
function statusFor(word) { if (word.masteryScore >= 72) return 'familiar'; if (word.timesShown > 0 || word.meaningRequests > 0) return 'learning'; return 'new'; }

async function addEvent(wordId, type, meta = {}) {
  await putOne('events', { id: uid('evt'), wordId, type, meta, createdAt: new Date().toISOString() });
}

async function seed() {
  if ((await getAll('words')).length) return;
  const now = new Date();
  for (let i = 0; i < DEMO_WORDS.length; i++) {
    const [term, meaning, translation, example, partOfSpeech, cefr] = DEMO_WORDS[i];
    const seen = i < 5 ? Math.max(0, 4 - i) : 0;
    await putOne('words', {
      id: uid('word'), term, meaning, translation, example, partOfSpeech, cefr,
      addedAt: addDays(now, -(i + 1) * 3), updatedAt: now.toISOString(), lastShown: seen ? addDays(now, -(i + 2)) : null,
      nextReview: seen ? addDays(now, -1) : now.toISOString(), timesShown: seen,
      meaningRequests: i < 2 ? 2 - i : 0, translationRequests: i < 2 ? 2 - i : 0,
      timesUsed: i === 4 ? 1 : 0, lastUsed: i === 4 ? addDays(now, -8) : null,
      masteryScore: seen ? 22 + i * 8 : 0, currentInterval: seen ? INTERVALS[Math.min(i, 2)] : 0,
      status: seen ? 'learning' : 'new', difficulty: i < 2 ? .65 : .25,
    });
  }
}

async function loadSettings() {
  const record = await getOne('settings', 'preferences');
  if (record) settings = { ...settings, ...record.value };
  applyTheme();
}
async function saveSettings() { await putOne('settings', { key: 'preferences', value: settings }); }
function applyTheme() {
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

async function reconcilePreviousDays() {
  const records = await getAll('daily');
  for (const record of records.filter(r => r.date < localDate() && !r.processed)) {
    for (const item of record.items) {
      if (item.revealed || item.used) continue;
      const word = await getOne('words', item.id);
      if (!word) continue;
      const idx = Math.max(0, INTERVALS.indexOf(word.currentInterval));
      word.masteryScore = Math.min(100, word.masteryScore + 8);
      word.currentInterval = INTERVALS[Math.min(INTERVALS.length - 1, idx + 1)];
      word.nextReview = addDays(new Date(), word.currentInterval);
      word.difficulty = Math.max(0, word.difficulty - .08);
      word.status = statusFor(word);
      await putOne('words', word);
      await addEvent(word.id, 'recalled_without_help', { date: record.date });
    }
    record.processed = true;
    await putOne('daily', record);
  }
}

function priority(word, dateKey) {
  const stale = Math.min(90, daysSince(word.lastShown) * 3.2);
  const due = word.nextReview ? Math.max(-25, (Date.now() - new Date(word.nextReview).getTime()) / 86400000 * 12) : 45;
  const newBoost = word.status === 'new' ? 62 : 0;
  const struggle = word.meaningRequests * 14 + word.difficulty * 35;
  const activeUse = word.timesUsed * -6;
  const repetitionPenalty = word.lastShown && daysSince(word.lastShown) < 2 ? -70 : 0;
  return stale + due + newBoost + struggle + activeUse + repetitionPenalty - word.masteryScore * .45 + hash(`${dateKey}:${word.id}`) * 9;
}

async function getTodaySelection() {
  const date = localDate();
  const existing = await getOne('daily', date);
  if (existing) return existing;
  const words = await getAll('words');
  const ranked = words.sort((a, b) => priority(b, date) - priority(a, date));
  const selected = [];
  for (const candidate of ranked) {
    const hardCount = selected.filter(w => w.difficulty > .6).length;
    if (candidate.difficulty > .6 && hardCount >= 1 && ranked.length > 4) continue;
    selected.push(candidate);
    if (selected.length === 3) break;
  }
  for (const candidate of ranked) if (selected.length < 3 && !selected.some(w => w.id === candidate.id)) selected.push(candidate);
  const record = { date, createdAt: new Date().toISOString(), processed: false, items: selected.map(w => ({ id: w.id, revealed: false, used: false })) };
  await putOne('daily', record);
  for (const word of selected) {
    word.timesShown += 1; word.lastShown = new Date().toISOString(); word.status = statusFor(word);
    await putOne('words', word); await addEvent(word.id, 'presented', { date });
  }
  return record;
}

async function selectedWords() {
  const result = [];
  for (const item of todaySelection.items) { const word = await getOne('words', item.id); if (word) result.push({ ...word, today: item }); }
  return result;
}

async function revealWord(id) {
  const item = todaySelection.items.find(i => i.id === id);
  if (!item || item.revealed) return;
  item.revealed = true; await putOne('daily', todaySelection);
  const word = await getOne('words', id);
  word.meaningRequests += 1; word.translationRequests += 1; word.masteryScore = Math.max(0, word.masteryScore - 18);
  word.currentInterval = word.meaningRequests > 2 ? 2 : 3; word.nextReview = addDays(new Date(), word.currentInterval);
  word.difficulty = Math.min(1, word.difficulty + .16); word.status = 'learning';
  await putOne('words', word);
  await Promise.all([addEvent(id, 'meaning_requested'), addEvent(id, 'translation_consulted'), addEvent(id, 'example_consulted')]);
  await renderToday();
}

async function markUsed(id, source = 'today') {
  const item = todaySelection?.items.find(i => i.id === id);
  if (item?.used) return;
  if (item) { item.used = true; await putOne('daily', todaySelection); }
  const word = await getOne('words', id);
  word.timesUsed += 1; word.lastUsed = new Date().toISOString(); word.masteryScore = Math.min(100, word.masteryScore + 24);
  const index = Math.max(0, INTERVALS.indexOf(word.currentInterval));
  word.currentInterval = INTERVALS[Math.min(INTERVALS.length - 1, index + 1)]; word.nextReview = addDays(new Date(), word.currentInterval);
  word.difficulty = Math.max(0, word.difficulty - .18); word.status = statusFor(word);
  await putOne('words', word); await addEvent(id, 'used', { source });
  toast(`Nice — “${word.term}” is in play.`);
  if (route === 'today') await renderToday(); else if (route === 'words') await renderWords();
}

function greeting() { const hour = new Date().getHours(); return `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'} 👋`; }
function relativeDate(value) { if (!value) return 'Never'; const days = Math.floor(daysSince(value)); return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`; }

async function renderToday() {
  $('#greeting').textContent = greeting();
  $('#datePill').textContent = new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date());
  const words = await selectedWords();
  $('#todayWords').innerHTML = words.length ? words.map((word, index) => `
    <article class="word-card ${word.today.revealed ? 'revealed' : ''}" data-word-id="${word.id}">
      <div class="word-main"><span class="word-number">0${index + 1}</span><h2>${escapeHtml(word.term)}</h2>
        ${word.today.revealed ? `<div class="meaning-panel"><p class="definition">${escapeHtml(word.meaning || 'Add an English meaning in Words.')}</p><p class="translation"><span aria-hidden="true">🇵🇹</span> ${escapeHtml(word.translation || 'Add a Portuguese translation.')}</p><div class="example"><span>Example</span><p>“${escapeHtml(word.example || 'Add a natural example sentence.')}”</p></div></div>` : '<p>Can you remember it?</p>'}
      </div>
      ${word.today.revealed ? `<button class="used-button ${word.today.used ? 'done' : ''}" type="button" data-use="${word.id}" ${word.today.used ? 'disabled' : ''}>${word.today.used ? '✓ Used today' : '✓ I used this word today'}</button>` : `<button class="reveal-button" type="button" data-reveal="${word.id}">Show meaning</button>`}
    </article>`).join('') : emptyToday();
  $$('[data-reveal]').forEach(button => button.addEventListener('click', () => revealWord(button.dataset.reveal)));
  $$('[data-use]').forEach(button => button.addEventListener('click', () => markUsed(button.dataset.use)));
  $('.daily-finish').hidden = words.length === 0;
}

function emptyToday() { return `<div class="empty-state"><div class="empty-glyph">Aa</div><h2>Your words will appear here.</h2><p>Add at least one word and we’ll take it from there.</p><a href="#add" class="primary-button">Add your first words</a></div>`; }

function renderAdd() {
  $('#addView').innerHTML = `
    <div class="page-heading"><p class="eyebrow">Quick add</p><h1 id="addTitle">Words from your lesson,<br>in under 30 seconds.</h1><p>One word or expression per line. Commas work too.</p></div>
    <form class="add-card" id="addForm"><label for="bulkWords">New words or expressions</label><textarea id="bulkWords" rows="8" placeholder="hinder&#10;bicker&#10;haggle&#10;look forward to" autocomplete="off" spellcheck="false"></textarea><div class="add-footer"><span id="wordCount">0 words</span><button class="primary-button" id="addSubmit" type="submit" disabled>Add words</button></div></form>
    <div class="quiet-note"><span>✦</span><p>Add now, complete the meanings later. Nothing should slow down your lesson.</p></div>`;
  const textarea = $('#bulkWords');
  textarea.addEventListener('input', () => { const count = parseTerms(textarea.value).length; $('#wordCount').textContent = `${count} ${count === 1 ? 'word' : 'words'}`; $('#addSubmit').textContent = count ? `Add ${count} ${count === 1 ? 'word' : 'words'}` : 'Add words'; $('#addSubmit').disabled = !count; });
  $('#addForm').addEventListener('submit', addWords); setTimeout(() => textarea.focus(), 80);
}

function parseTerms(value) { return [...new Set(value.split(/[\n,;]+/).map(v => v.trim().replace(/\s+/g, ' ')).filter(Boolean))]; }
async function addWords(event) {
  event.preventDefault(); const terms = parseTerms($('#bulkWords').value); const existing = await getAll('words'); const existingTerms = new Set(existing.map(w => w.term.toLocaleLowerCase())); let added = 0;
  for (const term of terms) {
    if (existingTerms.has(term.toLocaleLowerCase())) continue;
    const word = { id: uid('word'), term, meaning: '', translation: '', example: '', partOfSpeech: '', cefr: '', addedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastShown: null, nextReview: new Date().toISOString(), timesShown: 0, meaningRequests: 0, translationRequests: 0, timesUsed: 0, lastUsed: null, masteryScore: 0, currentInterval: 0, status: 'new', difficulty: 0 };
    await putOne('words', word); await addEvent(word.id, 'added', { source: 'quick_add' }); added++;
  }
  $('#bulkWords').value = ''; $('#bulkWords').dispatchEvent(new Event('input')); toast(added ? `${added} ${added === 1 ? 'word' : 'words'} added.` : 'Those words are already in your library.');
}

async function renderWords() {
  const words = await getAll('words');
  $('#wordsView').innerHTML = `<div class="page-heading library-heading"><div><p class="eyebrow">Your library</p><h1 id="wordsTitle">Words <span>${words.length}</span></h1></div></div><div class="library-tools"><label class="search-box"><span aria-hidden="true">⌕</span><span class="sr-only">Search words</span><input id="wordSearch" type="search" placeholder="Search your words" autocomplete="off"></label><div class="filter-row" role="group" aria-label="Filter words">${['all', 'new', 'learning', 'familiar'].map((f, i) => `<button class="filter-button ${i === 0 ? 'active' : ''}" data-filter="${f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}</div></div><div class="word-list" id="wordList"></div>`;
  let filter = 'all'; const update = () => renderWordList(words, $('#wordSearch').value, filter);
  $('#wordSearch').addEventListener('input', update);
  $$('.filter-button').forEach(button => button.addEventListener('click', () => { $$('.filter-button').forEach(b => b.classList.remove('active')); button.classList.add('active'); filter = button.dataset.filter; update(); })); update();
}

function renderWordList(words, query = '', filter = 'all') {
  const q = query.trim().toLocaleLowerCase();
  const results = words.filter(w => filter === 'all' || statusFor(w) === filter).filter(w => !q || [w.term, w.meaning, w.translation].some(v => (v || '').toLocaleLowerCase().includes(q))).sort((a, b) => a.term.localeCompare(b.term));
  $('#wordList').innerHTML = results.length ? results.map(word => `<button class="library-row" data-open-word="${word.id}"><div><strong>${escapeHtml(word.term)}</strong><span>${escapeHtml(word.translation || word.meaning || 'Meaning not added yet')}</span></div><div class="row-meta"><span class="status-dot ${statusFor(word)}"></span><span>${statusFor(word)}</span><b>›</b></div></button>`).join('') : `<div class="empty-state compact"><div class="empty-glyph">⌕</div><h2>No words found.</h2><p>Try another search or filter.</p></div>`;
  $$('[data-open-word]').forEach(button => button.addEventListener('click', () => openWordDetail(button.dataset.openWord)));
}

async function openWordDetail(id) {
  const word = await getOne('words', id); const events = (await getAll('events')).filter(e => e.wordId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  showSheet(`<div class="sheet-head"><div><span class="status-label">${statusFor(word)}</span><h2>${escapeHtml(word.term)}</h2></div><button class="close-button" data-close aria-label="Close">×</button></div><form id="wordForm" class="word-form"><input type="hidden" name="id" value="${word.id}"><label>Word or expression<input name="term" value="${escapeHtml(word.term)}" required></label><label>Short meaning in English<textarea name="meaning" rows="2" placeholder="to make something more difficult">${escapeHtml(word.meaning)}</textarea></label><label>Portuguese (Portugal)<input name="translation" value="${escapeHtml(word.translation)}" placeholder="dificultar / impedir"></label><label>Natural example<textarea name="example" rows="2" placeholder="Use it in a sentence…">${escapeHtml(word.example)}</textarea></label><div class="field-grid"><label>Part of speech<input name="partOfSpeech" value="${escapeHtml(word.partOfSpeech)}" placeholder="verb"></label><label>CEFR<select name="cefr"><option value="">—</option>${['A1','A2','B1','B2','C1','C2'].map(l => `<option ${word.cefr === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div><button class="primary-button full" type="submit">Save changes</button></form><div class="detail-section"><h3>Progress</h3><div class="stats-grid"><div><span>Last seen</span><strong>${relativeDate(word.lastShown)}</strong></div><div><span>Times seen</span><strong>${word.timesShown}</strong></div><div><span>Meaning requested</span><strong>${word.meaningRequests}</strong></div><div><span>Used</span><strong>${word.timesUsed}</strong></div></div><button class="secondary-button full" data-detail-use="${word.id}">✓ I used this word today</button></div><details class="history"><summary>History <span>${events.length}</span></summary><div>${events.length ? events.slice(0, 20).map(e => `<div class="history-row"><span>${eventLabel(e.type)}</span><time>${new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(e.createdAt))}</time></div>`).join('') : '<p>No activity yet.</p>'}</div></details><button class="delete-button" data-delete-word="${word.id}">Delete word</button>`);
  $('#wordForm').addEventListener('submit', saveWord); $('[data-detail-use]').addEventListener('click', () => markUsed(id, 'detail')); $('[data-delete-word]').addEventListener('click', () => deleteWord(id, word.term));
}

function eventLabel(type) { return ({ added: 'Added', presented: 'Shown today', meaning_requested: 'Meaning revealed', translation_consulted: 'Translation consulted', example_consulted: 'Example consulted', used: 'Marked as used', recalled_without_help: 'Recalled without help', edited: 'Details edited' })[type] || type; }
async function saveWord(event) { event.preventDefault(); const data = new FormData(event.currentTarget); const word = await getOne('words', data.get('id')); ['term', 'meaning', 'translation', 'example', 'partOfSpeech', 'cefr'].forEach(key => word[key] = String(data.get(key) || '').trim()); word.updatedAt = new Date().toISOString(); await putOne('words', word); await addEvent(word.id, 'edited'); closeSheet(); toast('Word updated.'); if (route === 'words') await renderWords(); else await renderToday(); }
async function deleteWord(id, term) { if (!confirm(`Delete “${term}” and its history?`)) return; await deleteOne('words', id); const events = (await getAll('events')).filter(e => e.wordId === id); await Promise.all(events.map(e => deleteOne('events', e.id))); closeSheet(); toast('Word deleted.'); await renderWords(); }

function showSheet(content) { $('#overlayRoot').innerHTML = `<div class="overlay"><button class="backdrop" data-close aria-label="Close"></button><aside class="sheet" role="dialog" aria-modal="true">${content}</aside></div>`; $$('[data-close]', $('#overlayRoot')).forEach(button => button.addEventListener('click', closeSheet)); document.body.classList.add('locked'); setTimeout(() => $('.sheet').classList.add('open'), 10); }
function closeSheet() { $('#overlayRoot').innerHTML = ''; document.body.classList.remove('locked'); }

function openSettings() {
  showSheet(`<div class="sheet-head"><div><span class="status-label">Preferences</span><h2>Settings</h2></div><button class="close-button" data-close aria-label="Close">×</button></div><section class="settings-group"><h3>Appearance</h3><div class="segmented" role="group" aria-label="Colour theme">${['system','light','dark'].map(t => `<button data-theme-choice="${t}" class="${settings.theme === t ? 'active' : ''}">${t[0].toUpperCase()+t.slice(1)}</button>`).join('')}</div></section><section class="settings-group"><h3>Daily reminder</h3><label class="toggle-row"><div><strong>Today’s three words</strong><span>Ask permission for notifications on this device.</span></div><input id="notificationToggle" type="checkbox" ${settings.notifications ? 'checked' : ''}><i></i></label><label class="time-row">Reminder time<input id="notificationTime" type="time" value="${settings.notificationTime}"></label><div class="capability-note"><strong>Background-ready PWA</strong><p>The app includes push and notification-click support. Reliable delivery while the app is closed requires a push service on the deployed version; browser permission alone does not schedule a server push.</p></div></section><section class="settings-group"><h3>Optional check-in</h3><label class="toggle-row"><div><strong>Evening check-in</strong><span>Ask which of today’s words you used.</span></div><input id="eveningToggle" type="checkbox" ${settings.eveningCheckIn ? 'checked' : ''}><i></i></label><label class="time-row">Check-in time<input id="eveningTime" type="time" value="${settings.eveningTime}"></label></section><section class="settings-group install-group"><h3>Install</h3><p>Install Three Words from your browser’s Share or menu button for a focused, full-screen experience.</p><button id="installButton" class="secondary-button full" ${installPrompt ? '' : 'disabled'}>${installPrompt ? 'Install app' : 'Use “Add to Home Screen”'}</button></section>`);
  $$('[data-theme-choice]').forEach(button => button.addEventListener('click', async () => { settings.theme = button.dataset.themeChoice; applyTheme(); await saveSettings(); openSettings(); }));
  $('#notificationToggle').addEventListener('change', handleNotificationToggle); $('#notificationTime').addEventListener('change', async e => { settings.notificationTime = e.target.value; await saveSettings(); }); $('#eveningToggle').addEventListener('change', async e => { settings.eveningCheckIn = e.target.checked; await saveSettings(); }); $('#eveningTime').addEventListener('change', async e => { settings.eveningTime = e.target.value; await saveSettings(); }); $('#installButton').addEventListener('click', installApp);
}

async function handleNotificationToggle(event) { if (event.target.checked && 'Notification' in window) { const permission = await Notification.requestPermission(); settings.notifications = permission === 'granted'; event.target.checked = settings.notifications; toast(settings.notifications ? 'Notifications allowed on this device.' : 'Notification permission was not granted.'); } else settings.notifications = false; await saveSettings(); }
async function installApp() { if (!installPrompt) return; await installPrompt.prompt(); installPrompt = null; closeSheet(); }
function toast(message) { const item = document.createElement('div'); item.className = 'toast'; item.textContent = message; $('#toastRoot').append(item); setTimeout(() => item.classList.add('show'), 10); setTimeout(() => item.remove(), 3100); }

async function navigate(next) {
  route = ['today', 'add', 'words'].includes(next) ? next : 'today';
  $$('.view').forEach(view => { const active = view.id === `${route}View`; view.hidden = !active; view.classList.toggle('active', active); });
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.route === route));
  if (route === 'today') await renderToday(); if (route === 'add') renderAdd(); if (route === 'words') await renderWords();
  $('#app').focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function registerWebMCP() {
  if (!document.modelContext?.registerTool) return;
  const controller = new AbortController(); const register = tool => Promise.resolve(document.modelContext.registerTool(tool, { signal: controller.signal })).catch(() => {});
  await register({ name: 'add_vocabulary', title: 'Add vocabulary', description: 'Add one or more English words or expressions to the vocabulary library.', inputSchema: { type: 'object', properties: { terms: { type: 'array', items: { type: 'string' }, minItems: 1 } }, required: ['terms'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, async execute({ terms }) { const existing = new Set((await getAll('words')).map(w => w.term.toLowerCase())); let added = 0; for (const raw of terms) { const term = String(raw).trim(); if (!term || existing.has(term.toLowerCase())) continue; const word = { id: uid('word'), term, meaning: '', translation: '', example: '', partOfSpeech: '', cefr: '', addedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastShown: null, nextReview: new Date().toISOString(), timesShown: 0, meaningRequests: 0, translationRequests: 0, timesUsed: 0, lastUsed: null, masteryScore: 0, currentInterval: 0, status: 'new', difficulty: 0 }; await putOne('words', word); await addEvent(word.id, 'added', { source: 'webmcp' }); added++; } if (route === 'words') await renderWords(); return { added }; } });
  await register({ name: 'read_today_words', title: 'Read today’s words', description: 'Read the three vocabulary words selected for today without revealing their meanings.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, async execute() { return { date: todaySelection.date, words: (await selectedWords()).map(w => w.term) }; } });
}

async function init() {
  try {
    db = await openDB(); await seed(); await loadSettings(); await reconcilePreviousDays(); todaySelection = await getTodaySelection();
    window.addEventListener('hashchange', () => navigate(location.hash.slice(1))); $('#settingsButton').addEventListener('click', openSettings);
    $('#themeButton').addEventListener('click', async () => { settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(); await saveSettings(); });
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; }); matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (settings.theme === 'system') applyTheme(); });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
    await navigate(location.hash.slice(1) || 'today'); await registerWebMCP();
  } catch (error) {
    console.error(error); $('#todayWords').innerHTML = `<div class="empty-state"><div class="empty-glyph">!</div><h2>We couldn’t open your words.</h2><p>Reload the app to try again. Your saved data is still on this device.</p><button class="primary-button" onclick="location.reload()">Reload</button></div>`;
  }
}

init();
