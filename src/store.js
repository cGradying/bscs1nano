import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');
const OVERRIDES_FILE = path.join(DATA_DIR, 'overrides.json');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const DEFAULT_SCHEDULE = {
  section: { name: 'Your Section', program: 'Your Program' },
  dayStart: 6,
  dayEnd: 21,
  classes: { Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [], Sun: [] },
};

export function getSchedule() {
  return readJson(SCHEDULE_FILE, DEFAULT_SCHEDULE);
}

export function saveSchedule(schedule) {
  writeJson(SCHEDULE_FILE, schedule);
  return schedule;
}

// overrides: { "YYYY-MM-DD": { "<classId>": "vacant" | "online", "_note": "string" } }
export function getOverrides() {
  return readJson(OVERRIDES_FILE, {});
}

export function saveOverrides(overrides) {
  writeJson(OVERRIDES_FILE, overrides);
  return overrides;
}

export function setOverrideForDate(dateKey, classId, status) {
  const overrides = getOverrides();
  if (!overrides[dateKey]) overrides[dateKey] = {};
  if (status === 'none' || !status) {
    delete overrides[dateKey][classId];
    if (Object.keys(overrides[dateKey]).length === 0) delete overrides[dateKey];
  } else {
    overrides[dateKey][classId] = status;
  }
  saveOverrides(overrides);
  return overrides;
}

export function setDayNote(dateKey, note) {
  const overrides = getOverrides();
  if (!overrides[dateKey]) overrides[dateKey] = {};
  if (note) {
    overrides[dateKey]._note = note;
  } else {
    delete overrides[dateKey]._note;
    if (Object.keys(overrides[dateKey]).length === 0) delete overrides[dateKey];
  }
  saveOverrides(overrides);
  return overrides;
}

const DEFAULT_STATE = { lastMessageId: null, lastMessageWeekKey: null };

export function getState() {
  return readJson(STATE_FILE, DEFAULT_STATE);
}

export function saveState(state) {
  writeJson(STATE_FILE, state);
  return state;
}

// --- class CRUD helpers ---
export function addClass(day, cls) {
  const schedule = getSchedule();
  if (!schedule.classes[day]) schedule.classes[day] = [];
  const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  schedule.classes[day].push({ id, ...cls });
  saveSchedule(schedule);
  return id;
}

export function updateClass(day, classId, patch) {
  const schedule = getSchedule();
  const list = schedule.classes[day] || [];
  const idx = list.findIndex((c) => c.id === classId);
  if (idx === -1) return false;
  list[idx] = { ...list[idx], ...patch };
  saveSchedule(schedule);
  return true;
}

export function removeClass(day, classId) {
  const schedule = getSchedule();
  schedule.classes[day] = (schedule.classes[day] || []).filter((c) => c.id !== classId);
  saveSchedule(schedule);
  return true;
}

// --- admin-configurable settings (daily post time) ---
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const DEFAULT_SETTINGS = { postHour: 1, postMinute: 0 };

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, DEFAULT_SETTINGS) };
}

export function saveSettings(settings) {
  const merged = { ...getSettings(), ...settings };
  writeJson(SETTINGS_FILE, merged);
  return merged;
}
