/* Manor Park Dates: calendar, PDF import, important marks and one-week flags.
   Everything is stored in this browser's localStorage. */
(function () {
  'use strict';

  const STORE_KEY = 'manor-park-dates-v1';
  const FLAG_DAYS = 7;
  const WHO_LABEL = { theo: 'Theo', ruby: 'Ruby', both: 'Theo & Ruby' };
  const $ = sel => document.querySelector(sel);

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'vendor/pdf.worker.min.js';
  }

  /* ---------- State ---------- */
  let state = { events: [], meals: { theo: {}, ruby: {} } };
  let mode = 'loading';    // 'server' (signed in on Netlify) or 'local' (browser-only preview)
  let view = startOfMonth(new Date());
  let filter = 'all';
  let pending = null;      // { source, items: [...] } while reviewing an upload
  let editingId = null;

  /* ---------- Storage ----------
     On the live site, dates are kept privately on the server behind the sign-in.
     Opened without the server (e.g. a local file), it falls back to this browser only. */
  function loadLocal() {
    try {
      const data = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (data && Array.isArray(data.events)) return withMeals(data);
    } catch (e) { /* storage blocked or corrupt */ }
    return withMeals({ events: [] });
  }
  function withMeals(data) {
    const m = data.meals && typeof data.meals === 'object' ? data.meals : {};
    data.meals = { theo: m.theo || {}, ruby: m.ruby || {} };
    return data;
  }

  async function api(path, opts = {}) {
    const res = await fetch('/api/' + path, {
      credentials: 'same-origin',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      ...opts,
    });
    let body = {};
    try { body = await res.json(); } catch { /* not JSON: no server here */ }
    return { status: res.status, body, isApi: (res.headers.get('content-type') || '').includes('json') };
  }

  let saveTimer = null, saving = Promise.resolve();
  function save() {
    if (mode === 'local') {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
      catch (e) { toast('Could not save in this browser. Download a backup to keep your dates.'); }
      return;
    }
    if (mode !== 'server') return;
    clearTimeout(saveTimer);
    setSync('Saving…');
    saveTimer = setTimeout(() => {
      const snapshot = JSON.stringify({ events: state.events, meals: state.meals });
      saving = saving.then(async () => {
        try {
          const r = await api('events', { method: 'PUT', body: snapshot });
          if (r.status === 401) { showLogin('You were signed out. Sign in again and your change will be saved.'); return; }
          if (r.status !== 200) throw new Error(r.body.error || 'Save failed');
          setSync('Saved');
        } catch (e) {
          setSync('Not saved. Check your connection.', true);
          toast('Couldn\u2019t save that change. Check your connection and try again.');
        }
      });
    }, 400);
  }
  function setSync(msg, bad) {
    const s = $('#sync');
    if (!s) return;
    s.textContent = msg;
    s.classList.toggle('bad', !!bad);
  }

  async function boot() {
    let r;
    try { r = await api('session'); } catch { r = { isApi: false }; }
    if (!r.isApi) {
      mode = 'local';
      state = loadLocal();
      document.body.classList.remove('locked');
      $('#local-note').hidden = false;
      $('#signout-btn').hidden = true;
      $('#email-settings').hidden = true;
      render();
      return;
    }
    if (r.status === 401) return showLogin();
    if (r.status !== 200) return showLogin(r.body.error || 'The site isn\u2019t ready yet.');
    await enterApp(r.body);
  }

  async function enterApp(session) {
    const r = await api('events');
    if (r.status === 401) return showLogin();
    mode = 'server';
    state = withMeals({ events: Array.isArray(r.body.events) ? r.body.events : [], meals: r.body.meals });
    $('#login').hidden = true;
    document.body.classList.remove('locked');
    $('#email-status').textContent = session.emailReady
      ? `Reminder emails are on. They go to ${session.recipients} address${session.recipients === 1 ? '' : 'es'} each morning: one a week before each date, and one the day before.`
      : 'Reminder emails are not set up yet. See the README for the three settings to add in Netlify.';
    $('#test-email-btn').disabled = !session.emailReady;
    render();
  }

  function showLogin(msg) {
    mode = 'loading';
    document.body.classList.add('locked');
    $('#login').hidden = false;
    $('#login-error').textContent = msg || '';
    $('#login-password').focus();
  }

  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#login-submit');
    btn.disabled = true; btn.textContent = 'Checking…';
    $('#login-error').textContent = '';
    try {
      const r = await api('login', { method: 'POST', body: JSON.stringify({ password: $('#login-password').value }) });
      if (r.status === 200) {
        $('#login-password').value = '';
        const s = await api('session');
        await enterApp(s.body);
      } else {
        $('#login-error').textContent = r.body.error || 'Couldn\u2019t sign in.';
      }
    } catch {
      $('#login-error').textContent = 'Couldn\u2019t reach the site. Check your connection.';
    }
    btn.disabled = false; btn.textContent = 'Sign in';
  });

  $('#signout-btn').addEventListener('click', async () => {
    try { await api('logout', { method: 'POST' }); } catch {}
    state = withMeals({ events: [] });
    render();
    showLogin('Signed out.');
  });

  $('#test-email-btn').addEventListener('click', async () => {
    const btn = $('#test-email-btn');
    btn.disabled = true;
    try {
      const r = await api('test-email', { method: 'POST' });
      toast(r.status === 200 ? `Test email sent to ${r.body.sentTo} address${r.body.sentTo === 1 ? '' : 'es'}` : (r.body.error || 'The test email failed.'));
    } catch { toast('Couldn\u2019t reach the site.'); }
    btn.disabled = false;
  });

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ---------- Dates ---------- */
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function toISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function fromISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function todayISO() { return toISO(new Date()); }
  function addDays(iso, n) { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
  function daysBetween(a, b) { return Math.round((fromISO(b) - fromISO(a)) / 86400000); }
  const fmtLong = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtShort = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtMonth = new Intl.DateTimeFormat('en-GB', { month: 'long' });
  const fmtDow = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });

  function whenText(ev) {
    let t = fmtLong.format(fromISO(ev.date));
    if (ev.endDate) t += ' to ' + fmtLong.format(fromISO(ev.endDate));
    return t;
  }
  function relText(iso) {
    const n = daysBetween(todayISO(), iso);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    return `In ${n} days`;
  }

  /* An event is "flagged" while it starts within the next week and the flag hasn't been closed. */
  function isFlagged(ev) {
    if (ev.flagClosed) return false;
    const n = daysBetween(todayISO(), ev.date);
    return n >= 0 && n <= FLAG_DAYS;
  }
  function visible(ev) {
    if (filter === 'all') return true;
    return ev.who === filter || ev.who === 'both' || !ev.who;
  }
  function onDay(ev, iso) { return ev.date === iso || (ev.endDate && ev.date <= iso && iso <= ev.endDate); }
  function sortEvents(a, b) {
    return a.date.localeCompare(b.date) || (b.important - a.important) || a.title.localeCompare(b.title);
  }

  /* ---------- Rendering ---------- */
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid);
    return n;
  }
  function whoTag(ev) {
    const w = ev.who || 'both';
    return el('span', { class: 'who-tag ' + w }, WHO_LABEL[w]);
  }

  function render() {
    renderLunchNext();
    renderFlags();
    renderGrid();
    renderMonthList();
  }

  // The next school day's lunches, for packing the night before.
  function renderLunchNext() {
    const box = $('#lunch-next');
    let iso = todayISO();
    for (let i = 0; i < 14; i++) {
      iso = addDays(iso, 1);
      const w = fromISO(iso).getDay();
      if (w !== 0 && w !== 6 && !schoolClosed(iso)) break;
    }
    const meals = mealsOn(iso);
    box.hidden = !meals.length;
    if (!meals.length) return;
    const n = daysBetween(todayISO(), iso);
    box.replaceChildren(
      el('span', { class: 'when' }, (n === 1 ? 'Tomorrow' : fmtLong.format(fromISO(iso))) + ':'),
      ...meals.map(({ child, kind }) => el('span', { class: `kid ${child} ${kind}` },
        `${WHO_LABEL[child]}, ${kind === 'dinner' ? 'school dinner' : 'packed lunch'}`)));
  }

  function renderFlags() {
    const list = $('#flag-list');
    const flagged = state.events.filter(e => isFlagged(e) && visible(e)).sort(sortEvents);
    $('#flags').hidden = flagged.length === 0;
    list.replaceChildren(...flagged.map(ev => el('li', { class: 'flag-item' },
      el('span', { class: 'flag-when' }, relText(ev.date)),
      el('div', { class: 'flag-text' },
        whoTag(ev),
        el('button', { type: 'button', onclick: () => openEvent(ev.id) }, (ev.important ? '★ ' : '') + ev.title),
        el('small', {}, whenText(ev))),
      el('button', {
        type: 'button', class: 'btn ghost small flag-close',
        'aria-label': `Close the flag for ${ev.title}`,
        onclick: () => { ev.flagClosed = true; save(); render(); toast('Flag closed. The date stays on the calendar.'); },
      }, 'Close flag'))));
  }

  function renderGrid() {
    const grid = $('#grid');
    const title = $('#month-title');
    title.replaceChildren(fmtMonth.format(view) + ' ', el('span', {}, String(view.getFullYear())));

    const first = new Date(view);
    const offset = (first.getDay() + 6) % 7; // Monday first
    const start = new Date(first); start.setDate(1 - offset);
    const today = todayISO();
    const events = state.events.filter(visible).sort(sortEvents);
    const cells = [];

    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      if (i >= 35 && d.getMonth() !== view.getMonth()) break;
      const iso = toISO(d);
      const dayEvents = events.filter(e => onDay(e, iso));
      const meals = mealsOn(iso);
      const shown = dayEvents.slice(0, 4);
      const label = `${fmtLong.format(d)}${dayEvents.length ? ', ' + dayEvents.length + ' date' + (dayEvents.length > 1 ? 's' : '') : ''}`;
      const cls = ['day'];
      if (d.getMonth() !== view.getMonth()) cls.push('out');
      if (iso === today) cls.push('is-today');
      if (d.getDay() === 0 || d.getDay() === 6) cls.push('weekend');

      cells.push(el('div', {
        class: cls.join(' '), role: 'button', tabindex: '0', 'aria-label': label,
        onclick: e => { if (!e.target.closest('.chip, .meal')) dayClicked(iso, dayEvents); },
        onkeydown: e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); dayClicked(iso, dayEvents); } },
      },
        el('span', { class: 'day-num' }, String(d.getDate())),
        el('div', { class: 'chips' },
          shown.map(ev => el('button', {
            type: 'button',
            class: ['chip', ev.who || 'both', ev.important && 'important', isFlagged(ev) && 'flagged'].filter(Boolean).join(' '),
            title: `${WHO_LABEL[ev.who || 'both']}: ${ev.title}`,
            onclick: () => openEvent(ev.id),
          },
            ev.important ? el('span', { class: 'star-mark' }, '★ ') : null,
            el('span', { class: 'who' }, ev.who === 'both' || !ev.who ? 'Both' : WHO_LABEL[ev.who]),
            el('span', { class: 'chip-title' }, ev.title))),
          dayEvents.length > shown.length ? el('span', { class: 'more' }, `+${dayEvents.length - shown.length} more`) : null),
        meals.length ? el('div', { class: 'meal-lines' }, meals.map(({ child, kind }) => {
          const label = `${WHO_LABEL[child]}: ${kind === 'dinner' ? 'School dinner' : 'Packed lunch'}`;
          return el('button', {
            type: 'button', class: `meal ${child} ${kind}`, title: label + ' (tap to switch)',
            'aria-label': `${label}, ${fmtLong.format(d)}. Tap to switch.`,
            onclick: () => {
              state.meals[child][iso] = kind === 'dinner' ? 'packed' : 'dinner';
              save(); render();
              toast(`${WHO_LABEL[child]}: ${state.meals[child][iso] === 'dinner' ? 'school dinner' : 'packed lunch'} on ${fmtShort.format(d)}`);
            },
          }, el('span', { class: 'long' }, label), el('span', { class: 'short' }, WHO_LABEL[child][0]));
        })) : null));
    }
    grid.replaceChildren(...cells);
  }

  function dayClicked(iso, dayEvents) {
    if (window.matchMedia('(max-width: 640px)').matches && dayEvents.length) {
      const item = document.querySelector(`#month-list [data-date="${iso}"]`);
      if (item) { item.scrollIntoView({ behavior: 'smooth', block: 'center' }); item.querySelector('button')?.focus({ preventScroll: true }); return; }
    }
    openNew(iso);
  }

  function renderMonthList() {
    const list = $('#month-list');
    const mStart = toISO(view);
    const mEnd = toISO(new Date(view.getFullYear(), view.getMonth() + 1, 0));
    const items = state.events
      .filter(e => visible(e) && e.date <= mEnd && (e.endDate || e.date) >= mStart)
      .sort(sortEvents);
    if (!items.length) {
      list.replaceChildren(el('li', { class: 'empty' },
        state.events.length ? 'Nothing this month.' : 'No dates yet. Upload a letter from school to get started.'));
      return;
    }
    list.replaceChildren(...items.map(ev => {
      const d = fromISO(ev.date);
      return el('li', { class: [ev.who || 'both', ev.important && 'important'].filter(Boolean).join(' '), 'data-date': ev.date },
        el('div', { class: 'ml-date' }, el('b', {}, String(d.getDate())), el('small', {}, fmtDow.format(d) + (ev.endDate ? ' →' : ''))),
        el('div', { class: 'ml-body' },
          whoTag(ev),
          el('button', { type: 'button', class: 'ml-title', onclick: () => openEvent(ev.id) }, ev.title),
          isFlagged(ev) ? el('span', { class: 'badge' }, relText(ev.date)) : null,
          el('small', {}, [whenText(ev), ev.notes, ev.source && 'From ' + ev.source].filter(Boolean).join(' · '))),
        el('button', {
          type: 'button', class: 'star', 'aria-pressed': ev.important ? 'true' : 'false',
          'aria-label': ev.important ? `Unmark ${ev.title} as important` : `Mark ${ev.title} as important`,
          title: ev.important ? 'Important' : 'Mark as important',
          onclick: () => { ev.important = !ev.important; save(); render(); },
        }, ev.important ? '★' : '☆'));
    }));
  }

  /* ---------- Dialog ---------- */
  const dlg = $('#event-dialog');
  function setWho(w) { const r = document.getElementById('f-who-' + (w || 'both')); if (r) r.checked = true; }
  function getWho() { return document.querySelector('input[name="f-who"]:checked')?.value || 'both'; }

  function openEvent(id) {
    const ev = state.events.find(e => e.id === id);
    if (!ev) return;
    editingId = id;
    $('#dialog-title').textContent = 'Date details';
    $('#f-title').value = ev.title;
    $('#f-date').value = ev.date;
    $('#f-end').value = ev.endDate || '';
    $('#f-notes').value = ev.notes || '';
    $('#f-important').checked = !!ev.important;
    setWho(ev.who);
    $('#f-source').textContent = ev.source ? `From ${ev.source}` : 'Added by hand';
    $('#f-delete').hidden = false;
    dlg.showModal();
  }
  function openNew(iso) {
    editingId = null;
    $('#dialog-title').textContent = 'Add a date';
    $('#event-form').reset();
    $('#f-date').value = iso || todayISO();
    setWho('both');
    $('#f-source').textContent = '';
    $('#f-delete').hidden = true;
    dlg.showModal();
    $('#f-title').focus();
  }

  $('#event-form').addEventListener('submit', e => {
    e.preventDefault();
    const title = $('#f-title').value.trim();
    const date = $('#f-date').value;
    if (!title || !date) return;
    let end = $('#f-end').value || null;
    if (end && end <= date) end = null;
    const fields = { title, date, endDate: end, notes: $('#f-notes').value.trim(), important: $('#f-important').checked, who: getWho() };
    if (editingId) {
      const ev = state.events.find(x => x.id === editingId);
      if (ev.date !== date) ev.flagClosed = false; // a moved date gets a fresh flag
      Object.assign(ev, fields);
    } else {
      state.events.push({ id: uid(), ...fields, source: '', flagClosed: false, added: new Date().toISOString() });
    }
    save(); dlg.close(); jumpTo(date); toast('Saved');
  });
  $('#f-cancel').addEventListener('click', () => dlg.close());
  $('#f-delete').addEventListener('click', () => {
    const btn = $('#f-delete');
    if (btn.dataset.confirm !== '1') { btn.dataset.confirm = '1'; btn.textContent = 'Tap again to delete'; return; }
    state.events = state.events.filter(e => e.id !== editingId);
    save(); dlg.close(); render(); toast('Deleted');
  });
  dlg.addEventListener('close', () => { const b = $('#f-delete'); b.dataset.confirm = ''; b.textContent = 'Delete'; });

  function jumpTo(iso) { view = startOfMonth(fromISO(iso)); render(); }

  /* ---------- School dinners ----------
     state.meals[child][date] is 'dinner' or 'packed' for each school day a PDF covered. */
  const CLOSED = /\b(inset|half[- ]?term|holiday|bank holiday|school closed|closure|training day)\b/i;
  function schoolClosed(iso) {
    return state.events.some(e => onDay(e, iso) && CLOSED.test(e.title));
  }
  function mealsOn(iso) {
    const out = [];
    for (const child of ['theo', 'ruby']) {
      if (filter !== 'all' && filter !== child) continue;
      const kind = state.meals[child][iso];
      if (kind && !schoolClosed(iso)) out.push({ child, kind });
    }
    return out;
  }

  let mealPending = null; // { child, source, days: { iso: 'dinner' | 'packed' } }

  async function handleMealFile(file, child) {
    const status = $('#meal-status');
    const say = (msg, bad) => { status.textContent = msg; status.classList.toggle('error', !!bad); };
    if (!file || !(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) { say('Choose a PDF.', true); return; }
    say(`Reading ${file.name}…`);
    let dates;
    try {
      dates = MPDParser.findMealDates(await pdfLines(file));
    } catch (err) {
      console.error(err); say(`Couldn\u2019t read ${file.name}. ${err.message || ''}`, true); return;
    }
    dates = dates.filter(d => { const w = fromISO(d).getDay(); return w !== 0 && w !== 6; });
    if (!dates.length) { say(`No dates found in ${file.name}. If it's a scanned image, send it to me and I'll look at the layout.`, true); return; }
    // The PDF covers Monday of its first week to Friday of its last week.
    const first = fromISO(dates[0]); first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    const last = fromISO(dates[dates.length - 1]); last.setDate(last.getDate() + (5 - last.getDay()));
    const set = new Set(dates);
    const days = {};
    for (const d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const k = toISO(d);
      days[k] = set.has(k) ? 'dinner' : (schoolClosed(k) ? 'closed' : 'packed');
    }
    say('');
    mealPending = { child, source: file.name, days };
    renderMealReview();
    $('#meal-review').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderMealReview() {
    const sec = $('#meal-review');
    if (!mealPending) { sec.hidden = true; return; }
    sec.hidden = false;
    const { child, days, source } = mealPending;
    const keys = Object.keys(days).sort();
    const n = k => keys.filter(x => days[x] === k).length;
    $('#meal-review-title').textContent = `${WHO_LABEL[child]}'s school dinners, from ${source}`;
    $('#meal-review-summary').textContent =
      `${n('dinner')} school dinner day${n('dinner') === 1 ? '' : 's'} and ${n('packed')} packed lunch day${n('packed') === 1 ? '' : 's'}, ` +
      `${fmtShort.format(fromISO(keys[0]))} to ${fmtShort.format(fromISO(keys[keys.length - 1]))}.`;
    const weeks = [];
    for (let i = 0; i < keys.length; i += 5) weeks.push(keys.slice(i, i + 5));
    $('#meal-weeks').replaceChildren(...weeks.map(wk => el('div', { class: 'meal-week' }, wk.map(k => {
      const kind = days[k];
      return el('button', {
        type: 'button', class: 'meal-day ' + (kind === 'closed' ? 'none' : kind), disabled: kind === 'closed',
        'aria-label': `${fmtLong.format(fromISO(k))}: ${kind === 'dinner' ? 'school dinner' : kind === 'packed' ? 'packed lunch' : 'school closed'}`,
        onclick: () => { days[k] = days[k] === 'dinner' ? 'packed' : 'dinner'; renderMealReview(); },
      }, el('b', {}, fmtShort.format(fromISO(k))), kind === 'dinner' ? 'School dinner' : kind === 'packed' ? 'Packed lunch' : 'School closed');
    }))));
  }

  document.querySelectorAll('.meal-up input').forEach(inp => inp.addEventListener('change', e => {
    handleMealFile(e.target.files[0], e.target.dataset.child); e.target.value = '';
  }));
  $('#meal-cancel').addEventListener('click', () => { mealPending = null; renderMealReview(); });
  $('#meal-save').addEventListener('click', () => {
    const { child, days } = mealPending;
    for (const [k, v] of Object.entries(days)) if (v === 'dinner' || v === 'packed') state.meals[child][k] = v;
    const firstDay = Object.keys(days).sort()[0];
    mealPending = null; renderMealReview();
    save(); jumpTo(firstDay);
    toast(`Saved ${WHO_LABEL[child]}'s school dinners`);
  });

  /* ---------- PDF import ---------- */
  async function pdfLines(file) {
    if (!window.pdfjsLib) throw new Error('The PDF reader did not load. Check your connection and refresh.');
    const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      lines.push(...MPDParser.groupItems(content.items.map(it => ({
        str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height,
      }))));
    }
    return lines;
  }

  async function handleFiles(files) {
    const pdfs = [...files].filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (!pdfs.length) { setStatus('That isn’t a PDF. Choose a PDF letter from school.', true); return; }
    const items = [];
    for (const f of pdfs) {
      setStatus(`Reading ${f.name}…`);
      try {
        const lines = await pdfLines(f);
        if (!lines.length) {
          setStatus(`${f.name} has no readable text (it may be a scanned image). Copy the text and paste it instead, or use “Add a date”.`, true);
          continue;
        }
        MPDParser.findDates(lines, new Date(), { list: true }).forEach(d => items.push({ ...d, source: f.name }));
      } catch (err) {
        console.error(err);
        setStatus(`Couldn’t read ${f.name}. ${err.message || ''}`, true);
        return;
      }
    }
    startReview(items, pdfs.map(f => f.name).join(', '));
  }

  $('#paste-form').addEventListener('submit', e => {
    e.preventDefault();
    const text = $('#paste-text').value;
    if (!text.trim()) { setStatus('Paste the email text first.', true); return; }
    const source = 'Pasted email, ' + fmtShort.format(new Date());
    startReview(MPDParser.findDates(text.split(/\r?\n/)).map(d => ({ ...d, source })), source);
  });
  $('#paste-clear').addEventListener('click', () => { $('#paste-text').value = ''; setStatus(''); });

  const STOP = new Set(['the', 'and', 'for', 'with', 'class', 'day', 'school', 'event', 'from', 'your', 'will', 'this', 'that', 'year']);
  const words = t => new Set((t.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(w => !STOP.has(w)));
  // An existing date this one probably describes: same day and a shared meaningful word.
  function findMatch(it) {
    const mine = words(it.title + ' ' + it.context);
    return state.events.find(e => e.date === it.date &&
      (e.title.toLowerCase() === it.title.toLowerCase() || [...words(e.title)].some(w => mine.has(w))));
  }

  function startReview(items, source) {
    // Leave out anything that has already happened.
    const today = todayISO();
    const past = items.filter(it => (it.endDate || it.date) < today).length;
    items = items.filter(it => (it.endDate || it.date) >= today);
    if (!items.length) {
      setStatus(past ? `Every date found has already passed (${past}).` : 'No dates found. You can add them by hand with “Add a date”.', true);
      return;
    }
    for (const it of items) {
      it.key = uid();
      it.who = it.guessWho || null;
      it.important = false;
      it.notes = it.details || '';
      const m = findMatch(it);
      if (m) {
        it.matchId = m.id;
        it.matchTitle = m.title;
        // Nothing new to add if the notes are already there.
        it.dupe = !it.notes || (m.notes || '').includes(it.notes);
      }
    }
    setStatus(past ? `Left out ${past} date${past === 1 ? '' : 's'} that ${past === 1 ? 'has' : 'have'} already passed.` : '');
    pending = { source, items, bulkWho: 'both' };
    renderReview();
    $('#review').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderReview() {
    const sec = $('#review');
    if (!pending || !pending.items.length) {
      if (pending) toast('All sorted');
      pending = null; sec.hidden = true; return;
    }
    sec.hidden = false;
    $('#review-source').textContent = pending.source;
    const bulk = document.querySelector(`#bulk-who input[value="${pending.bulkWho}"]`);
    if (bulk) bulk.checked = true;
    $('#review-list').replaceChildren(...pending.items.map((it, i) => {
      const who = it.who || pending.bulkWho;
      return el('li', { class: 'review-item' + (it.dupe ? ' dupe' : '') },
        el('div', { class: 'rv-main' },
          el('div', { class: 'rv-fields' },
            el('input', { type: 'date', id: `rv-date-${it.key}`, value: it.date, 'aria-label': 'Date',
              onchange: e => { it.date = e.target.value; } }),
            el('input', { type: 'text', id: `rv-title-${it.key}`, class: 'title-input', value: it.title, 'aria-label': 'What is happening',
              oninput: e => { it.title = e.target.value; } })),
          el('div', { class: 'rv-meta' },
            el('div', { class: 'who-pick', role: 'radiogroup', 'aria-label': 'Who is it for' },
              ['theo', 'ruby', 'both'].map(w => el('label', {},
                el('input', { type: 'radio', name: `rv-who-${it.key}`, value: w, checked: who === w,
                  onchange: () => { it.who = w; } }),
                el('span', {}, w === 'both' ? 'Both' : WHO_LABEL[w])))),
            el('button', { type: 'button', class: 'star', 'aria-pressed': it.important ? 'true' : 'false',
              'aria-label': 'Important', title: 'Mark as important',
              onclick: e => { it.important = !it.important; e.currentTarget.setAttribute('aria-pressed', it.important); e.currentTarget.textContent = it.important ? '★' : '☆'; } },
              it.important ? '★' : '☆'),
            el('span', { class: 'rv-star-label' }, 'Important')),
          el('textarea', { class: 'rv-notes', id: `rv-notes-${it.key}`, rows: it.notes ? 2 : 1, placeholder: 'Notes (optional)', 'aria-label': 'Notes',
            oninput: e => { it.notes = e.target.value; } }, it.notes),
          el('div', { class: 'rv-meta' },
            it.matchId ? el('span', { class: 'pill match' }, it.dupe ? `Already on your calendar as “${it.matchTitle}”` : `✓ adds these notes to “${it.matchTitle}”`) : null,
            it.guessWho ? el('span', { class: 'pill auto' }, `Mentions ${it.guessWho === 'ruby' ? 'Year 1' : it.guessWho === 'theo' ? 'Year 3' : 'Years 1 and 3'}`) : null,
            it.otherGroup ? el('span', { class: 'pill other' }, `For ${it.otherGroup}, not Theo or Ruby?`) : null),
          el('div', { class: 'context' },
            (it.endDate ? `Runs until ${fmtShort.format(fromISO(it.endDate))}. ` : '') + 'It says: “' + it.context + '”')),
        el('div', { class: 'rv-decide' },
          el('button', { type: 'button', class: 'decide yes', 'aria-label': `Add ${it.title} to the calendar`, title: 'Add to calendar',
            onclick: () => decide(i, true) }, '✓'),
          el('button', { type: 'button', class: 'decide no', 'aria-label': `Skip ${it.title}`, title: 'Skip',
            onclick: () => decide(i, false) }, '✕')));
    }));
    const n = pending.items.filter(addAllIncludes).length;
    $('#review-add').textContent = n ? `Add all ${n}` : 'Add all';
    $('#review-add').disabled = !n;
    $('#review-add').title = 'Adds every date except ones already on the calendar or for other year groups';
  }

  // "Add all" skips repeats and dates that only mention other year groups (unless you picked a child for them).
  const addAllIncludes = it => !it.dupe && (!it.otherGroup || it.who);

  function addFromReview(it) {
    if (!it.date || !it.title.trim()) return false;
    const match = it.matchId && state.events.find(e => e.id === it.matchId);
    if (match) {
      const extra = (it.notes || '').trim();
      if (extra && !(match.notes || '').includes(extra)) match.notes = [match.notes, extra].filter(Boolean).join('\n');
      if (it.important) match.important = true;
      return true;
    }
    state.events.push({
      id: uid(), title: it.title.trim(), date: it.date, endDate: it.endDate || null,
      who: it.who || pending.bulkWho, important: !!it.important, flagClosed: false,
      notes: (it.notes || '').trim(), source: it.source, added: new Date().toISOString(),
    });
    return true;
  }
  function decide(i, keep) {
    const it = pending.items[i];
    if (keep && addFromReview(it)) { save(); render(); toast(it.matchId ? `Added notes to: ${it.matchTitle}` : `Added: ${it.title.trim()}`); }
    pending.items.splice(i, 1);
    const focusIdx = Math.min(i, pending.items.length - 1);
    renderReview();
    if (pending && focusIdx >= 0) document.querySelectorAll('#review-list .decide.yes')[focusIdx]?.focus({ preventScroll: true });
  }

  $('#bulk-who').addEventListener('change', e => {
    if (!pending) return;
    pending.bulkWho = e.target.value;
    pending.items.forEach(it => { it.who = it.guessWho || null; });
    renderReview();
  });
  $('#review-cancel').addEventListener('click', () => { pending = null; renderReview(); });
  $('#review-add').addEventListener('click', () => {
    const items = pending.items.filter(addAllIncludes);
    let n = 0;
    items.forEach(it => { if (addFromReview(it)) n++; });
    save();
    const first = items.map(c => c.date).sort().find(d => d >= todayISO()) || items[0]?.date;
    pending = null; $('#review').hidden = true;
    if (first) jumpTo(first); else render();
    toast(`Added ${n} date${n === 1 ? '' : 's'}`);
  });

  function setStatus(msg, isError) {
    const s = $('#drop-status');
    s.textContent = msg;
    s.classList.toggle('error', !!isError);
  }

  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => document.addEventListener(t, e => {
    e.preventDefault();
    if (t === 'drop' || !e.relatedTarget) dz.classList.remove('over');
  }));
  document.addEventListener('drop', e => { if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files); });
  dz.addEventListener('click', () => $('#pdf-input').click());
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#pdf-input').click(); } });
  $('#pdf-input').addEventListener('change', e => { handleFiles(e.target.files); e.target.value = ''; });

  /* ---------- Backup ---------- */
  $('#export-btn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `manor-park-dates-${todayISO()}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#import-input').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.events)) throw new Error();
      const have = new Set(state.events.map(x => x.id));
      const added = data.events.filter(x => x && x.id && x.date && x.title && !have.has(x.id));
      state.events.push(...added);
      if (data.meals) for (const c of ['theo', 'ruby']) Object.assign(state.meals[c], data.meals[c] || {});
      save(); render(); toast(`Restored ${added.length} date${added.length === 1 ? '' : 's'}`);
    } catch { toast('That file isn’t a Manor Park Dates backup.'); }
  });

  /* ---------- Navigation ---------- */
  $('#prev').addEventListener('click', () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); render(); });
  $('#next').addEventListener('click', () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); render(); });
  $('#today').addEventListener('click', () => { view = startOfMonth(new Date()); render(); });
  $('#add-btn').addEventListener('click', () => openNew());
  document.querySelectorAll('input[name="filter"]').forEach(r => r.addEventListener('change', e => { filter = e.target.value; render(); }));
  document.addEventListener('keydown', e => {
    if (dlg.open || /input|textarea/i.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') $('#prev').click();
    if (e.key === 'ArrowRight') $('#next').click();
  });

  let toastTimer;
  function toast(msg) {
    let t = $('.toast');
    if (!t) { t = el('div', { class: 'toast', role: 'status' }); document.body.append(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
  }

  // Re-check flags when the tab comes back (e.g. the next morning).
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

  boot();
})();
