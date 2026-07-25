import { getState, saveState } from './store.js';
import { now, weekKeyFor } from './dates.js';
import { config } from './config.js';
import { buildWeekPayload } from './scheduleView.js';

let clientRef = null;
export function attachClient(client) {
  clientRef = client;
}

/**
 * Renders today's week image (with This Week/Next Week nav buttons) and
 * either posts a brand-new message or edits the existing one for this week
 * (real-time updates from the admin panel land here too).
 *
 * `force` = true always posts a new message (used by the daily 1am cron).
 * Pings SCHEDULE_ROLE_ID (if configured) with a link to the message on
 * every call, since any call to this function represents "an update".
 */
export async function publishSchedule({ force = false } = {}) {
  if (!clientRef) throw new Error('Discord client not attached yet');
  const channel = await clientRef.channels.fetch(config.channelId);
  if (!channel) throw new Error(`Channel ${config.channelId} not found`);

  const today = now();
  const payload = await buildWeekPayload(today, 'current');

  const state = getState();
  const wKey = weekKeyFor(today);

  let resultMsg;
  let mode;

  if (!force && state.lastMessageId && state.lastMessageWeekKey === wKey) {
    try {
      resultMsg = await channel.messages.fetch(state.lastMessageId);
      resultMsg = await resultMsg.edit(payload);
      mode = 'edited';
    } catch (err) {
      console.warn('[publish] could not edit previous message, posting new one:', err.message);
    }
  }

  if (!resultMsg) {
    resultMsg = await channel.send(payload);
    mode = 'posted';
    saveState({ lastMessageId: resultMsg.id, lastMessageWeekKey: wKey });
  }

  if (config.scheduleRoleId) {
    await channel.send({
      content: `<@&${config.scheduleRoleId}> 📅 The schedule was just updated — ${resultMsg.url}`,
      allowedMentions: { roles: [config.scheduleRoleId] },
    });
  }

  return { mode, messageId: resultMsg.id };
}
