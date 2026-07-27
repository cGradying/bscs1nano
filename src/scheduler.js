import cron from 'node-cron';
import { config } from './config.js';
import { publishSchedule } from './publish.js';
import { getSettings } from './store.js';

let task = null;

function scheduleTask(hour, minute) {
  if (task) task.stop();
  const cronExpr = `${minute} ${hour} * * *`;
  task = cron.schedule(
    cronExpr,
    async () => {
      try {
        const result = await publishSchedule({ force: true });
        console.log(`[scheduler] daily post ${result.mode} (${result.messageId})`);
      } catch (err) {
        console.error('[scheduler] failed to post daily schedule:', err);
      }
    },
    { timezone: config.timezone }
  );
  console.log(
    `[scheduler] daily post scheduled for ${hour}:${String(minute).padStart(2, '0')} (${config.timezone})`
  );
}

export async function startScheduler() {
  const { postHour, postMinute } = await getSettings();
  scheduleTask(postHour, postMinute);
}

// Called by the admin panel after saving a new post time — takes effect
// immediately, no redeploy or restart needed.
export async function rescheduleFromSettings() {
  const { postHour, postMinute } = await getSettings();
  scheduleTask(postHour, postMinute);
}
