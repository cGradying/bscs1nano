const DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAMES = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };

let schedule = null;
let settings = null;
let selectedDate = new Date().toISOString().slice(0, 10);

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
      <h2>Today / specific date — vacant &amp; online overrides</h2>
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
      row.querySelector('.edit').onclick = async () => {
        const start = prompt('Start hour (e.g. 13.5 for 1:30PM)', c.start);
        const end = prompt('End hour', c.end);
        const code = prompt('Code', c.code);
        const title = prompt('Title', c.title);
        if (start === null) return;
        await api(`/api/classes/${day}/${c.id}`, {
          method: 'PUT',
          body: JSON.stringify({ start, end, code, title }),
        });
        toast('Class updated');
        await load();
      };
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

async function loadOverridesFor(dateStr) {
  const dayKey = dateToDayKey(dateStr);
  const overrides = await api(`/api/overrides?date=${dateStr}`);
  const list = document.getElementById('overrideList');
  const classes = schedule.classes[dayKey] || [];
  if (!classes.length) {
    list.innerHTML = `<p style="color:var(--faint); font-size:13px;">No recurring classes on ${DAY_NAMES[dayKey]}s.</p>`;
  } else {
    list.innerHTML = classes.map((c) => `
      <div class="override-row" data-id="${c.id}">
        <span>${escapeHtml(c.code)} — ${escapeHtml(c.title)} (${fmtHour(c.start)}–${fmtHour(c.end)})</span>
        <select>
          <option value="none">Scheduled as normal</option>
          <option value="online">Moved online</option>
          <option value="vacant">Vacant / no class</option>
        </select>
      </div>
    `).join('');
    classes.forEach((c) => {
      const row = list.querySelector(`[data-id="${c.id}"]`);
      const sel = row.querySelector('select');
      sel.value = overrides[c.id] || 'none';
      sel.onchange = async () => {
        await api('/api/overrides', {
          method: 'POST',
          body: JSON.stringify({ date: dateStr, classId: c.id, status: sel.value }),
        });
        toast('Updated — refreshing preview');
        refreshPreview();
      };
    });
  }
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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

load();
