import express from 'express';
import {
  getSchedule,
  saveSchedule,
  addClass,
  updateClass,
  removeClass,
  getOverrides,
  setOverrideForDate,
  setDayNote,
  setClassLink,
  setClassTime,
  getSettings,
  saveSettings,
  getState,
  getEventsForDate,
  getEvents,
  addEvent,
  removeEvent,
} from '../store.js';
import { renderWeekImage } from '../render.js';
import { publishSchedule } from '../publish.js';
import { rescheduleFromSettings } from '../scheduler.js';
import { now } from '../dates.js';
import { config } from '../config.js';
import dayjs from 'dayjs';

export const router = express.Router();

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.redirect('/login');
}

router.get('/login', (req, res) => {
  res.type('html').send(loginPage(req.query.error));
});

router.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  if (req.body.password === config.adminPassword) {
    req.session.authed = true;
    return res.redirect('/');
  }
  res.redirect('/login?error=1');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

router.use(requireAuth);
router.use(express.json());

router.get('/', (req, res) => {
  res.type('html').send(dashboardPage());
});

router.get('/api/schedule', async (req, res) => {
  res.json(await getSchedule());
});

router.post('/api/section', async (req, res) => {
  const schedule = await getSchedule();
  schedule.section = { ...schedule.section, ...req.body };
  await saveSchedule(schedule);
  res.json(schedule);
});

router.post('/api/classes', async (req, res) => {
  const { day, start, end, code, title, room } = req.body;
  const id = await addClass(day, { start: Number(start), end: Number(end), code, title, room: room || '' });
  res.json({ id });
});

router.put('/api/classes/:day/:id', async (req, res) => {
  const { day, id } = req.params;
  const patch = { ...req.body };
  if (patch.start !== undefined) patch.start = Number(patch.start);
  if (patch.end !== undefined) patch.end = Number(patch.end);
  const ok = await updateClass(day, id, patch);
  res.json({ ok });
});

router.delete('/api/classes/:day/:id', async (req, res) => {
  await removeClass(req.params.day, req.params.id);
  res.json({ ok: true });
});

router.get('/api/overrides', async (req, res) => {
  const date = req.query.date;
  const overrides = await getOverrides();
  res.json(overrides[date] || {});
});

router.post('/api/overrides', async (req, res) => {
  const { date, classId, status } = req.body;
  const overrides = await setOverrideForDate(date, classId, status);
  res.json(overrides[date] || {});
});

router.post('/api/day-note', async (req, res) => {
  const { date, note } = req.body;
  const overrides = await setDayNote(date, note);
  res.json(overrides[date] || {});
});

router.post('/api/links', async (req, res) => {
  const { date, classId, link } = req.body;
  const overrides = await setClassLink(date, classId, link || null);
  res.json(overrides[date] || {});
});

router.post('/api/class-time', async (req, res) => {
  const { date, classId, start, end } = req.body;
  const overrides = await setClassTime(
    date,
    classId,
    start !== undefined ? Number(start) : null,
    end !== undefined ? Number(end) : null
  );
  res.json(overrides[date] || {});
});

router.get('/api/events', async (req, res) => {
  const date = req.query.date;
  res.json(await getEventsForDate(date));
});

router.post('/api/events', async (req, res) => {
  const { allDay, startDate, endDate, start, end, title, room, color } = req.body;
  if (!startDate || !title) return res.status(400).json({ error: 'startDate and title are required' });
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) return res.status(400).json({ error: 'invalid color' });
  const event = { allDay: !!allDay, startDate, endDate: endDate || startDate, title, room: room || '' };
  if (color) event.color = color;
  if (!event.allDay) {
    event.start = Number(start);
    event.end = Number(end);
  }
  const id = await addEvent(event);
  res.json({ id });
});

router.delete('/api/events/:id', async (req, res) => {
  await removeEvent(req.params.id);
  res.json({ ok: true });
});

// Full-store dump — bulk backup/migration escape hatch, since every other
// route is scoped to one date/doc. Reuses the same getters render.js and
// the rest of the admin API already call; no new store.js code needed.
router.get('/api/export', async (req, res) => {
  const [schedule, overrides, state, settings, events] = await Promise.all([
    getSchedule(),
    getOverrides(),
    getState(),
    getSettings(),
    getEvents(),
  ]);
  res.json({ schedule, overrides, state, settings, events });
});

router.get('/api/preview.png', async (req, res) => {
  const date = req.query.date ? dayjs(req.query.date) : now();
  const buffer = await renderWeekImage(date.tz ? date.tz(config.timezone) : date);
  res.type('png').send(buffer);
});

router.get('/api/settings', async (req, res) => {
  res.json(await getSettings());
});

router.post('/api/settings', async (req, res) => {
  const { postHour, postMinute } = req.body;
  const settings = await saveSettings({ postHour: Number(postHour), postMinute: Number(postMinute) });
  await rescheduleFromSettings();
  res.json(settings);
});

router.post('/api/publish', async (req, res) => {
  try {
    const result = await publishSchedule({ force: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function loginPage(error) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Admin login</title>
  <link rel="stylesheet" href="/admin.css"></head>
  <body class="login-body">
    <form class="login-card" method="post" action="/login">
      <h1>Schedule Admin</h1>
      ${error ? '<p class="error">Wrong password.</p>' : ''}
      <input type="password" name="password" placeholder="Admin password" autofocus required />
      <button type="submit">Log in</button>
    </form>
  </body></html>`;
}

function dashboardPage() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Schedule Admin</title>
  <link rel="stylesheet" href="/admin.css"></head>
  <body>
    <div id="app">Loading…</div>
    <script src="/admin.js"></script>
  </body></html>`;
}
