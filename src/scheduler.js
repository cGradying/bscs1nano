import cron from 'node-cron';
import { config } from './config.js';
import { publishSchedule } from './publish.js';

export function startScheduler() {
  const cronExpr = `${config.postMinute} ${config.postHour} * * *`;
  cron.schedule(
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
    `[scheduler] daily post scheduled for ${config.postHour}:${String(config.postMinute).padStart(2, '0')} (${config.timezone})`
  );
}
