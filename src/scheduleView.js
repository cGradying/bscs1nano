import { AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { renderWeekImage } from './render.js';
import { dateKey, weekDatesFor, DAY_KEYS } from './dates.js';
import { getOverrides, getSchedule } from './store.js';

/**
 * Builds the embed + image + nav buttons for either the "current" or "next"
 * week, anchored to `anchorDate` (the date the message was originally posted
 * for). Stateless by design — the anchor date and which side is showing are
 * both encoded in the button custom IDs, so this works correctly however
 * long the message has been sitting in the channel.
 */
export async function buildWeekPayload(anchorDate, which = 'current') {
  const targetDate = which === 'next' ? anchorDate.add(7, 'day') : anchorDate;
  const buffer = await renderWeekImage(targetDate);
  const attachment = new AttachmentBuilder(buffer, { name: 'schedule.png' });
  const weekDates = weekDatesFor(targetDate);
  const label = which === 'next' ? 'Next week' : 'This week';

  const embed = new EmbedBuilder()
    .setColor(0xf2b84b)
    .setTitle(`${label} — ${weekDates[0].format('MMM D')} to ${weekDates[6].format('MMM D')}`)
    .setImage('attachment://schedule.png')
    .setFooter({ text: `Updated ${anchorDate.format('MMM D, h:mm A')} · use the buttons below to flip weeks` });

  // Add online links if any exist for this week
  const overrides = await getOverrides();
  const schedule = await getSchedule();
  const linkLines = [];
  for (let i = 0; i < 7; i++) {
    const d = weekDates[i];
    const dKey = dateKey(d);
    const dayOverride = overrides[dKey];
    if (dayOverride && dayOverride._links) {
      const dayName = DAY_KEYS[i];
      const dayClasses = schedule.classes[dayName] || [];
      for (const classId of Object.keys(dayOverride._links)) {
        const cls = dayClasses.find((c) => c.id === classId);
        const linkUrl = dayOverride._links[classId];
        if (cls && linkUrl) {
          linkLines.push(`🔗 ${d.format('ddd M/D')} — ${cls.code}: ${linkUrl}`);
        }
      }
    }
  }
  if (linkLines.length > 0) {
    embed.addFields({
      name: 'Online Links',
      value: linkLines.join('\n'),
    });
  }

  const anchorKey = dateKey(anchorDate);
  const currentBtn = new ButtonBuilder()
    .setCustomId(`sched_nav:current:${anchorKey}`)
    .setLabel('◀ This Week')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(which === 'current');
  const nextBtn = new ButtonBuilder()
    .setCustomId(`sched_nav:next:${anchorKey}`)
    .setLabel('Next Week ▶')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(which === 'next');
  const row = new ActionRowBuilder().addComponents(currentBtn, nextBtn);

  return { embeds: [embed], files: [attachment], components: [row] };
}
