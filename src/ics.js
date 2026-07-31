import { pathToFileURL } from 'url';
import { now, weekDatesFor, dateKey, DAY_KEYS } from './dates.js';

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
// so each fetch shifts to whatever the current week is.
export function buildIcsFeed(schedule) {
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
  for (let w = 0; w < NUM_WEEKS; w++) {
    const dates = weekDatesFor(now().add(w, 'week'));
    DAY_KEYS.forEach((day, i) => {
      const date = dates[i];
      const classes = schedule.classes?.[day] || [];
      for (const cls of classes) {
        lines.push(
          'BEGIN:VEVENT',
          `UID:${cls.id}-${dateKey(date)}@schedule-bot`,
          `DTSTAMP:${stamp}`,
          `DTSTART:${toUtcStamp(atHour(date, cls.start))}`,
          `DTEND:${toUtcStamp(atHour(date, cls.end))}`,
          `SUMMARY:${escapeText(`${cls.code} ${cls.title}`.trim())}`,
          ...(cls.room ? [`LOCATION:${escapeText(cls.room)}`] : []),
          'END:VEVENT'
        );
      }
    });
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// Self-check: run directly with `node src/ics.js`.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fake = {
    section: { name: 'BSCS 1-1N' },
    classes: {
      Mon: [{ id: 'x1', start: 13.5, end: 15, code: 'COMP 001', title: 'Intro to Computing', room: '' }],
      Tue: [], Wed: [], Thu: [], Fri: [], Sat: [], Sun: [],
    },
  };
  const feed = buildIcsFeed(fake);
  const lines = feed.split('\r\n');
  console.assert(lines[0] === 'BEGIN:VCALENDAR', 'missing VCALENDAR header');
  console.assert(lines.at(-2) === 'END:VCALENDAR', 'missing VCALENDAR footer');
  const dtStarts = lines.filter((l) => l.startsWith('DTSTART:'));
  console.assert(dtStarts.length === NUM_WEEKS, `expected ${NUM_WEEKS} occurrences, got ${dtStarts.length}`);
  // Asia/Manila is UTC+8 with no DST, so 13.5 local (13:30) is always 05:30 UTC.
  console.assert(dtStarts.every((l) => l.endsWith('T053000Z')), `wrong UTC offset: ${dtStarts[0]}`);
  const uids = lines.filter((l) => l.startsWith('UID:'));
  console.assert(new Set(uids).size === uids.length, 'UIDs are not unique across weeks');
  console.log(`ok - ${dtStarts.length} occurrences, ${feed.length} bytes`);
}
