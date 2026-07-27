import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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

// --- Mongo backend (used automatically when MONGODB_URI is set — this is
// what lets data survive on hosts like Render's free tier, which has no
// persistent disk at all). Falls back to local JSON files otherwise, which
// is fine on any host with a real disk (a VM, Oracle Cloud, your own PC). ---
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
  const db = await getDb();
  if (db) {
    const doc = await db.collection('docs').findOne({ _id: key });
    return doc ? doc.data : fallback;
  }
  return readJsonFile(FILES[key], fallback);
}

async function writeDoc(key, data) {
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

// overrides: { "YYYY-MM-DD": { "<classId>": "vacant" | "online", "_note": "string" } }
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

// --- one-time events: { "YYYY-MM-DD": [ {id, start, end, title, room} ] }
// Unlike schedule.classes (which repeats every week on the same day-of-week
// forever), these only ever show up on the exact date they're filed under —
// e.g. a single seminar, an exam day, an orientation — then never again.
export async function getEvents() {
  return readDoc('events', {});
}

export async function saveEvents(events) {
  return writeDoc('events', events);
}

export async function getEventsForDate(dateKey) {
  const events = await getEvents();
  return events[dateKey] || [];
}

export async function addEvent(dateKey, event) {
  const events = await getEvents();
  if (!events[dateKey]) events[dateKey] = [];
  const id = 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  events[dateKey].push({ id, ...event });
  await saveEvents(events);
  return id;
}

export async function removeEvent(dateKey, eventId) {
  const events = await getEvents();
  if (!events[dateKey]) return false;
  events[dateKey] = events[dateKey].filter((e) => e.id !== eventId);
  if (events[dateKey].length === 0) delete events[dateKey];
  await saveEvents(events);
  return true;
}
