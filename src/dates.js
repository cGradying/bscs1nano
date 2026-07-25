import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from './config.js';

dayjs.extend(utc);
dayjs.extend(timezone);

export const DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function now() {
  return dayjs().tz(config.timezone);
}

// Returns the 7 dayjs dates (Mon..Sun) for the week containing `d`.
export function weekDatesFor(d) {
  const dow = d.day(); // 0=Sun..6=Sat
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = d.add(diffToMonday, 'day');
  return Array.from({ length: 7 }, (_, i) => monday.add(i, 'day'));
}

export function dateKey(d) {
  return d.format('YYYY-MM-DD');
}

export function dateFromKey(key) {
  return dayjs.tz(key, config.timezone);
}

export function weekKeyFor(d) {
  return dateKey(weekDatesFor(d)[0]); // Monday's date identifies the week
}
