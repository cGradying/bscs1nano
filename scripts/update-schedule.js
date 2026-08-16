#!/usr/bin/env node
import { setClassLink, setOverrideForDate, setDayNote } from '../src/store.js';

// Minimal argv parsing: node update-schedule.js <command> --flag value ...
const command = process.argv[2];
const args = {};
for (let i = 3; i < process.argv.length; i += 2) {
  const key = process.argv[i]?.replace(/^--/, '');
  const value = process.argv[i + 1];
  if (key && value !== undefined) {
    args[key] = value;
  }
}

async function run() {
  try {
    if (command === 'link') {
      const { date, class: classId, url } = args;
      if (!date || !classId || !url) {
        console.error('Usage: node update-schedule.js link --date YYYY-MM-DD --class <id> --url <url>');
        process.exit(1);
      }
      const result = await setClassLink(date, classId, url);
      console.log(JSON.stringify(result[date] || {}, null, 2));
    } else if (command === 'override') {
      const { date, class: classId, status } = args;
      if (!date || !classId || !status) {
        console.error('Usage: node update-schedule.js override --date YYYY-MM-DD --class <id> --status online|vacant|none');
        process.exit(1);
      }
      const result = await setOverrideForDate(date, classId, status === 'none' ? null : status);
      console.log(JSON.stringify(result[date] || {}, null, 2));
    } else if (command === 'note') {
      const { date, note } = args;
      if (!date || !note) {
        console.error('Usage: node update-schedule.js note --date YYYY-MM-DD --note "<text>"');
        process.exit(1);
      }
      const result = await setDayNote(date, note);
      console.log(JSON.stringify(result[date] || {}, null, 2));
    } else {
      console.error('Unknown command:', command);
      console.error('Available: link, override, note');
      process.exit(1);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

run();
