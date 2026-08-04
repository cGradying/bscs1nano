import { pathToFileURL } from 'url';
import { now, weekDatesFor, dateKey, dateFromKey, DAY_KEYS } from './dates.js';

const NUM_WEEKS = 4;

// Decimal hour (13.5) -> that same local dayjs day at that time.
function atHour(dayjsDate, decimalHour) {
  const h = Math.floor(decimalHour);
  const m = Math.round((decimalHour - h) * 60);
  return dayjsDate.hour(h).minute(m).second(0).millisecond(0);
}

function toUtcStamp(dayjsDate) {
  return dayjsDate.utc().format('YYYYMMDD[T]HHmmss[Z]');
}

// RFC 5545 3.3.11 text escaping.
function escapeText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n');
}

// RFC 5545 3.1 line folding: fold at 75 octets, continuation lines start with a space.
function foldLine(line) {
  if (line.length <= 75) return line;
  let out = line.slice(0, 75);
  let rest = line.slice(75);
  while (rest.length) {
    out += '\r\n ' + rest.slice(0, 74);
    rest = rest.slice(74);
  }
  return out;
}

// Rolling window, not a fixed export - recomputed from `now()` on every call,
// so each fetch shifts to whatever the current week is. `overrides` and
// `events` are passed in rather than fetched here, so this stays a pure
// function (cheap to self-check with zero I/O below).
export function buildIcsFeed(schedule, overrides = {}, events = []) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//schedule-bot//feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(schedule.section?.name || 'Class Schedule')}`,
    'X-PUBLISHED-TTL:PT12H',
  ];

  const stamp = toUtcStamp(now());
  const firstDate = weekDatesFor(now())[0];
  const lastDate = weekDatesFor(now().add(NUM_WEEKS - 1, 'week'))[6];
  const windowStart = dateKey(firstDate);
  const windowEnd = dateKey(lastDate);

  for (let w = 0; w < NUM_WEEKS; w++) {
    const dates = weekDatesFor(now().add(w, 'week'));
    DAY_KEYS.forEach((day, i) => {
      const date = dates[i];
      const dayOverrides = overrides[dateKey(date)] || {};
      const classes = schedule.classes?.[day] || [];
      for (const cls of classes) {
        const status = dayOverrides[cls.id];
        if (status === 'vacant') continue;
        const summary = `${cls.code} ${cls.title}`.trim() + (status === 'online' ? ' (Online)' : '');
        lines.push(
          'BEGIN:VEVENT',
          `UID:${cls.id}-${dateKey(date)}@schedule-bot`,
          `DTSTAMP:${stamp}`,
          `DTSTART:${toUtcStamp(atHour(date, cls.start))}`,
          `DTEND:${toUtcStamp(atHour(date, cls.end))}`,
          `SUMMARY:${escapeText(summary)}`,
          ...(cls.room ? [`LOCATION:${escapeText(cls.room)}`] : []),
          'END:VEVENT'
        );
      }
    });
  }

  for (const event of events) {
    if (event.endDate < windowStart || event.startDate > windowEnd) continue;
    if (event.allDay) {
      const startYmd = event.startDate.replace(/-/g, '');
      const endYmd = dateFromKey(event.endDate).add(1, 'day').format('YYYYMMDD');
      lines.push(
        'BEGIN:VEVENT',
        `UID:${event.id}@schedule-bot`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${startYmd}`,
        `DTEND;VALUE=DATE:${endYmd}`,
        `SUMMARY:${escapeText(event.title)}`,
        ...(event.room ? [`LOCATION:${escapeText(event.room)}`] : []),
        'END:VEVENT'
      );
    } else {
      const date = dateFromKey(event.startDate);
      lines.push(
        'BEGIN:VEVENT',
        `UID:${event.id}@schedule-bot`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${toUtcStamp(atHour(date, event.start))}`,
        `DTEND:${toUtcStamp(atHour(date, event.end))}`,
        `SUMMARY:${escapeText(event.title)}`,
        ...(event.room ? [`LOCATION:${escapeText(event.room)}`] : []),
        'END:VEVENT'
      );
    }
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// Self-check: run directly with `node src/ics.js`.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fake = {
    section: { name: 'BSCS 1-1N' },
    classes: {
      Mon: [
        { id: 'x1', start: 13.5, end: 15, code: 'COMP 001', title: 'Intro to Computing', room: '' },
        { id: 'x2', start: 9, end: 10.5, code: 'COMP 002', title: 'Discrete Math', room: '' },
      ],
      Tue: [], Wed: [], Thu: [], Fri: [], Sat: [], Sun: [],
    },
  };

  // Plain feed, no overrides/events — same shape as before this change.
  const plain = buildIcsFeed(fake);
  const plainLines = plain.split('\r\n');
  console.assert(plainLines[0] === 'BEGIN:VCALENDAR', 'missing VCALENDAR header');
  console.assert(plainLines.at(-2) === 'END:VCALENDAR', 'missing VCALENDAR footer');
  const dtStarts = plainLines.filter((l) => l.startsWith('DTSTART:'));
  console.assert(dtStarts.length === NUM_WEEKS * 2, `expected ${NUM_WEEKS * 2} occurrences, got ${dtStarts.length}`);
  // Asia/Manila is UTC+8 with no DST, so 13.5 local (13:30) is always 05:30 UTC
  // and 9 local (9:00) is always 01:00 UTC.
  console.assert(dtStarts.filter((l) => l.endsWith('T053000Z')).length === NUM_WEEKS, 'wrong UTC offset for 13.5h class');
  console.assert(dtStarts.filter((l) => l.endsWith('T010000Z')).length === NUM_WEEKS, 'wrong UTC offset for 9h class');
  const uids = plainLines.filter((l) => l.startsWith('UID:'));
  console.assert(new Set(uids).size === uids.length, 'UIDs are not unique across weeks');

  // Monday of the first window week — overrides/events fixtures anchor here.
  const monday = dateKey(weekDatesFor(now())[0]);

  const overrides = { [monday]: { x1: 'vacant', x2: 'online' } };
  const withOverrides = buildIcsFeed(fake, overrides);
  console.assert(!withOverrides.includes(`UID:x1-${monday}@`), 'vacant class should be omitted');
  console.assert(withOverrides.includes('(Online)'), 'online class should be marked (Online)');

  const timedEvent = { id: 'e1', allDay: false, startDate: monday, endDate: monday, start: 8, end: 9, title: 'Orientation', room: '' };
  const allDayEvent = { id: 'e2', allDay: true, startDate: monday, endDate: monday, title: 'Exam Day', room: '' };
  const withEvents = buildIcsFeed(fake, {}, [timedEvent, allDayEvent]);
  console.assert(withEvents.includes('UID:e1@schedule-bot'), 'timed one-time event missing from feed');
  console.assert(withEvents.includes('UID:e2@schedule-bot'), 'all-day event missing from feed');
  const startYmd = monday.replace(/-/g, '');
  const endYmd = dateFromKey(monday).add(1, 'day').format('YYYYMMDD');
  console.assert(withEvents.includes(`DTSTART;VALUE=DATE:${startYmd}`), 'all-day DTSTART wrong format');
  console.assert(withEvents.includes(`DTEND;VALUE=DATE:${endYmd}`), 'all-day DTEND should be exclusive (+1 day)');

  console.log(`ok - ${dtStarts.length} class occurrences, override + event fixtures passed`);
}
