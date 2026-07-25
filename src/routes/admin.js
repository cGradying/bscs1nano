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
  getSettings,
  saveSettings,
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

router.get('/api/schedule', (req, res) => {
  res.json(getSchedule());
});

router.post('/api/section', (req, res) => {
  const schedule = getSchedule();
  schedule.section = { ...schedule.section, ...req.body };
  saveSchedule(schedule);
  res.json(schedule);
});

router.post('/api/classes', (req, res) => {
  const { day, start, end, code, title, room } = req.body;
  const id = addClass(day, { start: Number(start), end: Number(end), code, title, room: room || '' });
  res.json({ id });
});

router.put('/api/classes/:day/:id', (req, res) => {
  const { day, id } = req.params;
  const patch = { ...req.body };
  if (patch.start !== undefined) patch.start = Number(patch.start);
  if (patch.end !== undefined) patch.end = Number(patch.end);
  const ok = updateClass(day, id, patch);
  res.json({ ok });
});

router.delete('/api/classes/:day/:id', (req, res) => {
  removeClass(req.params.day, req.params.id);
  res.json({ ok: true });
});

router.get('/api/overrides', (req, res) => {
  const date = req.query.date;
  const overrides = getOverrides();
  res.json(overrides[date] || {});
});

router.post('/api/overrides', (req, res) => {
  const { date, classId, status } = req.body;
  const overrides = setOverrideForDate(date, classId, status);
  res.json(overrides[date] || {});
});

router.post('/api/day-note', (req, res) => {
  const { date, note } = req.body;
  const overrides = setDayNote(date, note);
  res.json(overrides[date] || {});
});

router.get('/api/preview.png', async (req, res) => {
  const date = req.query.date ? dayjs(req.query.date) : now();
  const buffer = await renderWeekImage(date.tz ? date.tz(config.timezone) : date);
  res.type('png').send(buffer);
});

router.get('/api/settings', (req, res) => {
  res.json(getSettings());
});

router.post('/api/settings', (req, res) => {
  const { postHour, postMinute } = req.body;
  const settings = saveSettings({ postHour: Number(postHour), postMinute: Number(postMinute) });
  rescheduleFromSettings();
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
