const DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAMES = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
// Matches store.js's DEFAULT_SCHEDULE.section.name — the sentinel for "this
// deployment hasn't been set up yet." A real section is never named this,
// so the onboarding wizard can never re-trigger against live data.
const PLACEHOLDER_SECTION_NAME = 'Your Section';

let schedule = null;
let settings = null;
let selectedDate = new Date().toISOString().slice(0, 10);
let skipOnboarding = false;

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function dateToDayKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const idx = (d.getDay() + 6) % 7; // Mon=0..Sun=6
  return DAY_KEYS[idx];
}

async function load() {
  schedule = await api('/api/schedule');
  settings = await api('/api/settings');
  render();
}

function render() {
  const isFreshSetup = schedule.section.name === PLACEHOLDER_SECTION_NAME;
  if (isFreshSetup && !skipOnboarding) {
    renderOnboarding();
    return;
  }

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="topbar">
      <h1>📅 ${escapeHtml(schedule.section.name)} — Schedule Admin</h1>
      <div style="display:flex; gap:8px;">
        <button class="pill-btn" id="logoutBtn">Log out</button>
        <button class="pill-btn primary" id="publishBtn">Publish now</button>
      </div>
    </div>

    <div class="card">
      <h2>Daily auto-post time</h2>
      <p style="color:var(--faint); font-size:12px; margin:-4px 0 10px;">
        What time the schedule gets posted automatically every day. Takes effect immediately — no redeploy needed.
      </p>
      <div class="add-form">
        <input type="time" id="postTime" value="${String(settings.postHour).padStart(2, '0')}:${String(settings.postMinute).padStart(2, '0')}" />
        <button id="saveTimeBtn">Save time</button>
      </div>
    </div>

    <div class="card">
      <h2>Section info</h2>
      <div class="add-form">
        <input type="text" id="secName" placeholder="Section name" value="${escapeHtml(schedule.section.name)}" />
        <input type="text" id="secProgram" placeholder="Program" value="${escapeHtml(schedule.section.program)}" />
        <button id="saveSectionBtn">Save</button>
      </div>
    </div>

    <div class="card">
      <h2>Weekly recurring classes</h2>
      <div class="day-grid" id="dayGrid"></div>
    </div>

    <div class="card">
      <h2>Today / specific date — overrides</h2>
      <p style="color:var(--faint); font-size:12px; margin:-4px 0 10px;">
        Status, time and meeting link here only apply to this one date — the weekly schedule above is untouched.
      </p>
      <div class="override-controls">
        <input type="date" id="dateInput" value="${selectedDate}" />
      </div>
      <div id="overrideList"></div>
      <textarea class="day-note" id="dayNote" placeholder="Optional note for this day (e.g. 'Suspended — no classes')"></textarea>
      <div style="margin-top:8px;"><button class="pill-btn primary" id="saveNoteBtn">Save note</button></div>
    </div>

    <div class="card">
      <h2>One-time events for ${selectedDate}</h2>
      <p style="color:var(--faint); font-size:12px; margin:-4px 0 10px;">
        Only shows up on this exact date — unlike weekly classes, it never repeats.
      </p>
      <div id="eventList"></div>
      <div class="add-form" style="flex-wrap:wrap;">
        <label style="display:flex; align-items:center; gap:4px; font-size:12px; color:var(--faint);">
          <input type="checkbox" id="evAllDay" /> All day
        </label>
        <input type="number" step="0.5" placeholder="Start" id="evStart" style="width:56px" />
        <input type="number" step="0.5" placeholder="End" id="evEnd" style="width:56px" />
        <input type="date" id="evStartDate" style="display:none;" />
        <input type="date" id="evEndDate" style="display:none;" />
        <input type="text" placeholder="Event title" id="evTitle" style="flex:1;" />
        <input type="color" id="evColor" value="#c084fc" title="Event color" />
        <button id="addEventBtn">Add event</button>
      </div>
    </div>

    <div class="card preview">
      <h2>Live preview (what gets posted to Discord)</h2>
      <img id="previewImg" src="/api/preview.png?date=${selectedDate}&t=${Date.now()}" />
    </div>
  `;

  renderDayGrid();
  loadOverridesFor(selectedDate);
  loadEventsFor(selectedDate);

  document.getElementById('logoutBtn').onclick = () => {
    fetch('/logout', { method: 'POST' }).then(() => (window.location.href = '/login'));
  };
  document.getElementById('publishBtn').onclick = async () => {
    toast('Publishing…');
    try {
      const r = await api('/api/publish', { method: 'POST' });
      toast(`Published (${r.mode}) ✅`);
    } catch (e) {
      toast('Publish failed — check bot token/channel');
    }
  };
  document.getElementById('saveTimeBtn').onclick = async () => {
    const [h, m] = document.getElementById('postTime').value.split(':');
    settings = await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ postHour: h, postMinute: m }),
    });
    toast(`Daily post time set to ${document.getElementById('postTime').value}`);
  };
  document.getElementById('saveSectionBtn').onclick = async () => {
    schedule.section.name = document.getElementById('secName').value;
    schedule.section.program = document.getElementById('secProgram').value;
    await api('/api/section', { method: 'POST', body: JSON.stringify(schedule.section) });
    toast('Section info saved');
    render();
  };
  document.getElementById('dateInput').onchange = (e) => {
    selectedDate = e.target.value;
    render();
  };
  document.getElementById('saveNoteBtn').onclick = async () => {
    const note = document.getElementById('dayNote').value;
    await api('/api/day-note', { method: 'POST', body: JSON.stringify({ date: selectedDate, note }) });
    toast('Note saved');
    refreshPreview();
  };
  document.getElementById('evAllDay').onchange = (e) => {
    const allDay = e.target.checked;
    document.getElementById('evStart').style.display = allDay ? 'none' : '';
    document.getElementById('evEnd').style.display = allDay ? 'none' : '';
    document.getElementById('evStartDate').style.display = allDay ? '' : 'none';
    document.getElementById('evEndDate').style.display = allDay ? '' : 'none';
  };
  document.getElementById('evStartDate').value = selectedDate;
  document.getElementById('evEndDate').value = selectedDate;
  document.getElementById('addEventBtn').onclick = async () => {
    const allDay = document.getElementById('evAllDay').checked;
    const title = document.getElementById('evTitle').value;
    const color = document.getElementById('evColor').value;
    if (!title) return toast('Fill title');
    const body = { allDay, title, color };
    if (allDay) {
      const startDate = document.getElementById('evStartDate').value;
      const endDate = document.getElementById('evEndDate').value;
      if (!startDate || !endDate || endDate < startDate) return toast('Fix start/end date');
      body.startDate = startDate;
      body.endDate = endDate;
    } else {
      const start = document.getElementById('evStart').value;
      const end = document.getElementById('evEnd').value;
      if (!start || !end) return toast('Fill start/end');
      body.startDate = selectedDate;
      body.endDate = selectedDate;
      body.start = start;
      body.end = end;
    }
    await api('/api/events', { method: 'POST', body: JSON.stringify(body) });
    toast('Event added');
    await loadEventsFor(selectedDate);
    refreshPreview();
  };
}

// First-run setup screen for a fresh deployment — reuses the exact same
// section-info and add-class UI as the normal dashboard (renderDayGrid,
// POST /api/section), just framed as a guided flow. Gated purely on
// schedule.section.name still being the DEFAULT_SCHEDULE placeholder, so
// there's nothing to persist beyond the section name itself — saving a
// real name is what "finishes" setup.
function renderOnboarding() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="onboarding">
      <div class="onboarding-head">
        <h1>👋 Welcome — let's set up your schedule</h1>
        <p style="color:var(--faint); font-size:13px;">
          This only shows up once, on a fresh deployment. Fill in your section and add your weekly classes below, then finish setup.
        </p>
      </div>

      <div class="card">
        <h2>Step 1 — Section info</h2>
        <div class="add-form">
          <input type="text" id="obSecName" placeholder="Section name (e.g. BSCS 1-1N)" />
          <input type="text" id="obSecProgram" placeholder="Program (e.g. BS Computer Science)" />
        </div>
      </div>

      <div class="card">
        <h2>Step 2 — Weekly classes</h2>
        <p style="color:var(--faint); font-size:12px; margin:-4px 0 10px;">
          Add each recurring class block below, per day. You can always edit these later from the dashboard.
        </p>
        <div class="day-grid" id="dayGrid"></div>
      </div>

      <div class="onboarding-actions">
        <button class="pill-btn" id="skipSetupBtn">Skip for now</button>
        <button class="pill-btn primary" id="finishSetupBtn">Finish setup</button>
      </div>
    </div>
  `;

  renderDayGrid();

  document.getElementById('skipSetupBtn').onclick = () => {
    skipOnboarding = true;
    render();
  };
  document.getElementById('finishSetupBtn').onclick = async () => {
    const name = document.getElementById('obSecName').value.trim();
    const program = document.getElementById('obSecProgram').value.trim();
    if (!name || name === PLACEHOLDER_SECTION_NAME) return toast('Enter your section name first');
    schedule.section = { name, program };
    await api('/api/section', { method: 'POST', body: JSON.stringify(schedule.section) });
    toast('Setup saved 🎉');
    await load();
  };
}

function renderDayGrid() {
  const grid = document.getElementById('dayGrid');
  grid.innerHTML = DAY_KEYS.map((day) => `
    <div class="day-col" data-day="${day}">
      <h3>${DAY_NAMES[day]}</h3>
      <div class="rows"></div>
      <div class="add-form">
        <input type="number" step="0.5" placeholder="Start" class="new-start" />
        <input type="number" step="0.5" placeholder="End" class="new-end" />
        <input type="text" placeholder="Code" class="new-code" />
        <input type="text" placeholder="Title" class="new-title" />
        <button class="add-btn">Add</button>
      </div>
    </div>
  `).join('');

  DAY_KEYS.forEach((day) => {
    const col = grid.querySelector(`[data-day="${day}"]`);
    const rows = col.querySelector('.rows');
    (schedule.classes[day] || []).forEach((c) => {
      const row = document.createElement('div');
      row.className = 'class-row';
      renderClassRowView(row, day, c);
      rows.appendChild(row);
    });

    col.querySelector('.add-btn').onclick = async () => {
      const start = col.querySelector('.new-start').value;
      const end = col.querySelector('.new-end').value;
      const code = col.querySelector('.new-code').value;
      const title = col.querySelector('.new-title').value;
      if (!start || !end || !code) return toast('Fill start/end/code');
      await api('/api/classes', { method: 'POST', body: JSON.stringify({ day, start, end, code, title }) });
      toast('Class added');
      await load();
    };
  });
}

function renderClassRowView(row, day, c) {
  row.innerHTML = `
    <strong>${escapeHtml(c.code)}</strong>
    <span>${escapeHtml(c.title)}</span>
    <span class="meta">${fmtHour(c.start)}–${fmtHour(c.end)}</span>
    <div class="row-actions">
      <button class="edit">Edit</button>
      <button class="danger delete">Delete</button>
    </div>
  `;
  row.querySelector('.delete').onclick = async () => {
    await api(`/api/classes/${day}/${c.id}`, { method: 'DELETE' });
    toast('Class removed');
    await load();
  };
  row.querySelector('.edit').onclick = () => renderClassRowEdit(row, day, c);
}

// Inline edit, in place of the old prompt()x4 chain — same input layout as
// the "add class" form below it, swapped into the row itself.
function renderClassRowEdit(row, day, c) {
  row.innerHTML = `
    <div class="add-form">
      <input type="number" step="0.5" class="edit-start" value="${c.start}" style="width:56px" />
      <input type="number" step="0.5" class="edit-end" value="${c.end}" style="width:56px" />
      <input type="text" class="edit-code" value="${escapeHtml(c.code)}" style="width:90px" />
      <input type="text" class="edit-title" value="${escapeHtml(c.title)}" style="flex:1; min-width:100px;" />
      <button class="edit-save">Save</button>
      <button type="button" class="edit-cancel">Cancel</button>
    </div>
  `;
  row.querySelector('.edit-save').onclick = async () => {
    const start = row.querySelector('.edit-start').value;
    const end = row.querySelector('.edit-end').value;
    const code = row.querySelector('.edit-code').value;
    const title = row.querySelector('.edit-title').value;
    if (!start || !end || !code) return toast('Fill start/end/code');
    await api(`/api/classes/${day}/${c.id}`, {
      method: 'PUT',
      body: JSON.stringify({ start, end, code, title }),
    });
    toast('Class updated');
    await load();
  };
  row.querySelector('.edit-cancel').onclick = () => renderClassRowView(row, day, c);
}

async function loadOverridesFor(dateStr) {
  const dayKey = dateToDayKey(dateStr);
  const overrides = await api(`/api/overrides?date=${dateStr}`);
  const list = document.getElementById('overrideList');
  const classes = schedule.classes[dayKey] || [];

  if (!classes.length) {
    list.innerHTML = `<p style="color:var(--faint); font-size:13px;">No recurring classes on ${DAY_NAMES[dayKey]}s.</p>`;
    document.getElementById('dayNote').value = overrides._note || '';
    return;
  }

  list.innerHTML = classes.map((c) => {
    const timeOverride = overrides._times?.[c.id];
    const startVal = decimalToTimeInput(timeOverride?.start ?? c.start);
    const endVal = decimalToTimeInput(timeOverride?.end ?? c.end);
    const linkVal = overrides._links?.[c.id] || '';
    return `
      <div class="override-row" data-id="${c.id}">
        <div class="override-row-head">
          <span>${escapeHtml(c.code)} — ${escapeHtml(c.title)} <span class="meta">(normally ${fmtHour(c.start)}–${fmtHour(c.end)})</span></span>
          <select class="status-select">
            <option value="none">Scheduled as normal</option>
            <option value="online">Moved online</option>
            <option value="vacant">Vacant / no class</option>
          </select>
        </div>
        <div class="add-form override-row-controls">
          <label class="mini-label">Time ${timeOverride ? '<span class="badge-dot" title="Overridden for this date"></span>' : ''}</label>
          <input type="time" class="time-start" value="${startVal}" />
          <span class="meta">–</span>
          <input type="time" class="time-end" value="${endVal}" />
          <button type="button" class="mini-btn time-reset" ${timeOverride ? '' : 'disabled'}>Reset</button>
          <input type="url" class="link-input" placeholder="Meeting link (Zoom, Meet…)" value="${escapeHtml(linkVal)}" />
        </div>
      </div>
    `;
  }).join('');

  classes.forEach((c) => {
    const row = list.querySelector(`[data-id="${c.id}"]`);

    const sel = row.querySelector('.status-select');
    sel.value = overrides[c.id] || 'none';
    sel.onchange = async () => {
      await api('/api/overrides', {
        method: 'POST',
        body: JSON.stringify({ date: dateStr, classId: c.id, status: sel.value }),
      });
      toast('Updated — refreshing preview');
      refreshPreview();
    };

    const startInput = row.querySelector('.time-start');
    const endInput = row.querySelector('.time-end');
    const resetBtn = row.querySelector('.time-reset');
    const saveTime = async () => {
      if (!startInput.value || !endInput.value) return;
      await api('/api/class-time', {
        method: 'POST',
        body: JSON.stringify({
          date: dateStr,
          classId: c.id,
          start: timeInputToDecimal(startInput.value),
          end: timeInputToDecimal(endInput.value),
        }),
      });
      toast('Time updated — refreshing preview');
      resetBtn.disabled = false;
      refreshPreview();
    };
    startInput.onchange = saveTime;
    endInput.onchange = saveTime;
    resetBtn.onclick = async () => {
      await api('/api/class-time', {
        method: 'POST',
        body: JSON.stringify({ date: dateStr, classId: c.id, start: null, end: null }),
      });
      startInput.value = decimalToTimeInput(c.start);
      endInput.value = decimalToTimeInput(c.end);
      resetBtn.disabled = true;
      toast('Time override cleared');
      refreshPreview();
    };

    const linkInput = row.querySelector('.link-input');
    let lastSavedLink = linkInput.value;
    const saveLink = async () => {
      if (linkInput.value === lastSavedLink) return;
      lastSavedLink = linkInput.value;
      await api('/api/links', {
        method: 'POST',
        body: JSON.stringify({ date: dateStr, classId: c.id, link: linkInput.value }),
      });
      toast('Link saved');
      refreshPreview();
    };
    linkInput.onblur = saveLink;
    linkInput.onkeydown = (e) => {
      if (e.key === 'Enter') linkInput.blur();
    };
  });

  document.getElementById('dayNote').value = overrides._note || '';
}

async function loadEventsFor(dateStr) {
  const events = await api(`/api/events?date=${dateStr}`);
  const list = document.getElementById('eventList');
  if (!events.length) {
    list.innerHTML = `<p style="color:var(--faint); font-size:13px;">No one-time events on ${dateStr}.</p>`;
    return;
  }
  list.innerHTML = events.map((e) => `
    <div class="class-row" data-id="${e.id}">
      <strong style="color:${e.color || 'inherit'}">📌 ${escapeHtml(e.title)}</strong>
      <span class="meta">${e.allDay ? (e.startDate === e.endDate ? 'All day' : `${e.startDate} → ${e.endDate}`) : `${fmtHour(e.start)}–${fmtHour(e.end)}`}</span>
      <div class="row-actions">
        <button class="danger delete">Delete</button>
      </div>
    </div>
  `).join('');
  events.forEach((e) => {
    const row = list.querySelector(`[data-id="${e.id}"]`);
    row.querySelector('.delete').onclick = async () => {
      await api(`/api/events/${e.id}`, { method: 'DELETE' });
      toast('Event removed');
      await loadEventsFor(dateStr);
      refreshPreview();
    };
  });
}

function refreshPreview() {
  const img = document.getElementById('previewImg');
  img.src = `/api/preview.png?date=${selectedDate}&t=${Date.now()}`;
}

function fmtHour(h) {
  const hour = Math.floor(h);
  const min = Math.round((h - hour) * 60);
  const period = hour < 12 ? 'AM' : 'PM';
  let dh = hour % 12;
  if (dh === 0) dh = 12;
  return dh + (min ? ':' + String(min).padStart(2, '0') : '') + period;
}

// Decimal hour (13.5) <-> native <input type="time"> value ("13:30").
function decimalToTimeInput(h) {
  const hour = Math.floor(h);
  const min = Math.round((h - hour) * 60);
  return String(hour).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}
function timeInputToDecimal(str) {
  const [h, m] = str.split(':').map(Number);
  return h + m / 60;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

load();
