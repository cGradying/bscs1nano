import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { MongoClient } from 'mongodb';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

const FILES = {
  schedule: path.join(DATA_DIR, 'schedule.json'),
  overrides: path.join(DATA_DIR, 'overrides.json'),
  state: path.join(DATA_DIR, 'state.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
  events: path.join(DATA_DIR, 'events.json'),
};

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// --- GitHub backend (used automatically when GITHUB_TOKEN + GITHUB_DATA_REPO
// are set — durable, free, and diffable, one JSON file per doc committed to
// a dedicated data repo). Checked first. Falls back to Mongo (MONGODB_URI —
// also durable, needed on hosts with no persistent disk and no GitHub repo
// configured), then to local JSON files, which is fine on any host with a
// real disk (a VM, Oracle Cloud, your own PC). ---
const GITHUB_API = 'https://api.github.com';
const githubEnabled = () => Boolean(config.githubToken && config.githubRepo);

async function githubRequest(method, path, body) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.githubToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    const err = new Error(`GitHub API ${method} ${path} failed: ${res.status} ${text}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

async function githubRead(key) {
  const res = await githubRequest(
    'GET',
    `/repos/${config.githubRepo}/contents/${config.githubDir}/${key}.json?ref=${config.githubBranch}`
  );
  if (res.status === 404) return { data: null, sha: null };
  const json = await res.json();
  const decoded = Buffer.from(json.content, 'base64').toString('utf-8');
  return { data: JSON.parse(decoded), sha: json.sha };
}

async function githubWrite(key, data, sha) {
  if (sha === undefined) ({ sha } = await githubRead(key));
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  await githubRequest('PUT', `/repos/${config.githubRepo}/contents/${config.githubDir}/${key}.json`, {
    message: `Update ${key}.json — ${new Date().toISOString()}`,
    content,
    branch: config.githubBranch,
    ...(sha ? { sha } : {}),
  });
}

let dbPromise = null;
function getDb() {
  if (!config.mongoUri) return null;
  if (!dbPromise) {
    const client = new MongoClient(config.mongoUri);
    dbPromise = client.connect().then((c) => c.db('schedule_bot'));
  }
  return dbPromise;
}

async function readDoc(key, fallback) {
  if (githubEnabled()) {
    const { data } = await githubRead(key);
    return data ?? fallback;
  }
  const db = await getDb();
  if (db) {
    const doc = await db.collection('docs').findOne({ _id: key });
    return doc ? doc.data : fallback;
  }
  return readJsonFile(FILES[key], fallback);
}

async function writeDoc(key, data) {
  if (githubEnabled()) {
    await githubWrite(key, data);
    return data;
  }
  const db = await getDb();
  if (db) {
    await db.collection('docs').updateOne({ _id: key }, { $set: { data } }, { upsert: true });
  } else {
    writeJsonFile(FILES[key], data);
  }
  return data;
}

const DEFAULT_SCHEDULE = {
  section: { name: 'Your Section', program: 'Your Program' },
  dayStart: 6,
  dayEnd: 21,
  classes: { Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [], Sun: [] },
};

export async function getSchedule() {
  return readDoc('schedule', DEFAULT_SCHEDULE);
}

export async function saveSchedule(schedule) {
  return writeDoc('schedule', schedule);
}

// overrides: { "YYYY-MM-DD": { "<classId>": "vacant" | "online", "_note"?: "string", "_links"?: { "<classId>": "url" }, "_times"?: { "<classId>": { start, end } } } }
export async function getOverrides() {
  return readDoc('overrides', {});
}

export async function saveOverrides(overrides) {
  return writeDoc('overrides', overrides);
}

export async function setOverrideForDate(dateKey, classId, status) {
  const overrides = await getOverrides();
  if (!overrides[dateKey]) overrides[dateKey] = {};
  if (status === 'none' || !status) {
    delete overrides[dateKey][classId];
    if (Object.keys(overrides[dateKey]).length === 0) delete overrides[dateKey];
  } else {
    overrides[dateKey][classId] = status;
  }
  await saveOverrides(overrides);
  return overrides;
}

export async function setDayNote(dateKey, note) {
  const overrides = await getOverrides();
  if (!overrides[dateKey]) overrides[dateKey] = {};
  if (note) {
    overrides[dateKey]._note = note;
  } else {
    delete overrides[dateKey]._note;
    if (Object.keys(overrides[dateKey]).length === 0) delete overrides[dateKey];
  }
  await saveOverrides(overrides);
  return overrides;
}

export async function setClassLink(dateKey, classId, url) {
  const overrides = await getOverrides();
  if (!overrides[dateKey]) overrides[dateKey] = {};
  if (!overrides[dateKey]._links) overrides[dateKey]._links = {};
  if (url) {
    overrides[dateKey]._links[classId] = url;
  } else {
    delete overrides[dateKey]._links[classId];
    if (Object.keys(overrides[dateKey]._links).length === 0) {
      delete overrides[dateKey]._links;
      if (Object.keys(overrides[dateKey]).length === 0) delete overrides[dateKey];
    }
  }
  await saveOverrides(overrides);
  return overrides;
}

export async function setClassTime(dateKey, classId, start, end) {
  const overrides = await getOverrides();
  if (!overrides[dateKey]) overrides[dateKey] = {};
  if (!overrides[dateKey]._times) overrides[dateKey]._times = {};
  if (start != null && end != null) {
    overrides[dateKey]._times[classId] = { start, end };
  } else {
    delete overrides[dateKey]._times[classId];
    if (Object.keys(overrides[dateKey]._times).length === 0) {
      delete overrides[dateKey]._times;
      if (Object.keys(overrides[dateKey]).length === 0) delete overrides[dateKey];
    }
  }
  await saveOverrides(overrides);
  return overrides;
}

const DEFAULT_STATE = { lastMessageId: null, lastMessageWeekKey: null };

export async function getState() {
  return readDoc('state', DEFAULT_STATE);
}

export async function saveState(state) {
  return writeDoc('state', state);
}

// --- class CRUD helpers ---
export async function addClass(day, cls) {
  const schedule = await getSchedule();
  if (!schedule.classes[day]) schedule.classes[day] = [];
  const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  schedule.classes[day].push({ id, ...cls });
  await saveSchedule(schedule);
  return id;
}

export async function updateClass(day, classId, patch) {
  const schedule = await getSchedule();
  const list = schedule.classes[day] || [];
  const idx = list.findIndex((c) => c.id === classId);
  if (idx === -1) return false;
  list[idx] = { ...list[idx], ...patch };
  await saveSchedule(schedule);
  return true;
}

export async function removeClass(day, classId) {
  const schedule = await getSchedule();
  schedule.classes[day] = (schedule.classes[day] || []).filter((c) => c.id !== classId);
  await saveSchedule(schedule);
  return true;
}

// --- admin-configurable settings (daily post time) ---
const DEFAULT_SETTINGS = { postHour: 1, postMinute: 0 };

export async function getSettings() {
  const s = await readDoc('settings', DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...s };
}

export async function saveSettings(settings) {
  const merged = { ...(await getSettings()), ...settings };
  await writeDoc('settings', merged);
  return merged;
}

// --- one-time events: flat array, one entry per event.
// { id, allDay, startDate, endDate, start?, end?, title, room, color? }
// Unlike schedule.classes (which repeats every week on the same day-of-week
// forever), these only ever show up within [startDate, endDate] — e.g. a
// single seminar, an exam day, an orientation, a multi-day all-day event —
// then never again. Timed events (allDay:false) have startDate===endDate
// and required start/end decimal hours; all-day events span a date range
// with no start/end.
const DEFAULT_EVENTS = [];

export async function getEvents() {
  return readDoc('events', DEFAULT_EVENTS);
}

export async function saveEvents(events) {
  return writeDoc('events', events);
}

export function eventOccursOn(event, dateKey) {
  return event.startDate <= dateKey && dateKey <= event.endDate;
}

export async function getEventsForDate(dateKey) {
  const events = await getEvents();
  return events.filter((e) => eventOccursOn(e, dateKey));
}

export async function addEvent(event) {
  const events = await getEvents();
  const id = 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  events.push({ id, ...event });
  await saveEvents(events);
  return id;
}

export async function removeEvent(eventId) {
  const events = await getEvents();
  const next = events.filter((e) => e.id !== eventId);
  await saveEvents(next);
  return next.length !== events.length;
}

// Self-check: run directly with `node src/store.js`.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const e = { startDate: '2026-03-10', endDate: '2026-03-12' };
  console.assert(!eventOccursOn(e, '2026-03-09'), 'day before range should not occur');
  console.assert(eventOccursOn(e, '2026-03-10'), 'start date should occur');
  console.assert(eventOccursOn(e, '2026-03-11'), 'middle date should occur');
  console.assert(eventOccursOn(e, '2026-03-12'), 'end date should occur');
  console.assert(!eventOccursOn(e, '2026-03-13'), 'day after range should not occur');
  console.log('ok - eventOccursOn boundary checks passed');
}
