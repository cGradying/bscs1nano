import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config } from './config.js';
import { attachClient, publishSchedule } from './publish.js';
import { buildWeekPayload } from './scheduleView.js';
import { now, dateFromKey } from './dates.js';

const commands = [
  new SlashCommandBuilder().setName('schedule').setDescription("Show this week's schedule right now"),
  new SlashCommandBuilder()
    .setName('publish')
    .setDescription('Force-repost the schedule to the announcement channel')
    .addStringOption((opt) =>
      opt
        .setName('week')
        .setDescription('Which week to post (defaults to current)')
        .addChoices({ name: 'Current week', value: 'current' }, { name: 'Next week', value: 'next' })
    ),
  new SlashCommandBuilder()
    .setName('calendar')
    .setDescription('Get the link to subscribe to this schedule in Google or Apple Calendar'),
].map((c) => c.toJSON());

function buildCalendarReply() {
  if (!config.publicUrl) {
    return 'The calendar feed URL is not configured yet — an officer needs to set `PUBLIC_URL` in the bot\'s environment.';
  }
  const feed = `${config.publicUrl}/feed.ics`;
  return [
    '**Subscribe to the class schedule**',
    '',
    `\`${feed}\``,
    '',
    '**Google Calendar** (do this on a computer — the phone app cannot add feeds):',
    '1. Open <https://calendar.google.com>',
    '2. Left sidebar → **Other calendars** → **+** → **From URL**',
    '3. Paste the link above → **Add calendar**',
    '',
    '**Apple Calendar** (iPhone: Calendars → Add Calendar → Add Subscription Calendar):',
    '1. Mac: **File** → **New Calendar Subscription**',
    '2. Paste the link above → **Subscribe**',
    '',
    'It shows the next ~2 months of classes and events, and refreshes on its own. ' +
      'Calendar apps check for updates every 12-24 hours, so a change may take a while to appear. ' +
      'Vacant/online overrides and one-time/all-day events are reflected too.',
  ].join('\n');
}

export async function createBot() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once('ready', async () => {
    console.log(`[bot] logged in as ${client.user.tag}`);
    attachClient(client);
    try {
      const rest = new REST().setToken(config.discordToken);
      await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
      console.log('[bot] slash commands registered');
    } catch (err) {
      console.error('[bot] failed to register slash commands:', err);
    }
  });

  client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'schedule') {
        await interaction.deferReply();
        const payload = await buildWeekPayload(now(), 'current');
        await interaction.editReply(payload);
      }

      if (interaction.commandName === 'calendar') {
        await interaction.reply({ content: buildCalendarReply(), ephemeral: true });
      }

      if (interaction.commandName === 'publish') {
        await interaction.deferReply({ ephemeral: true });
        const which = interaction.options.getString('week') || 'current';
        try {
          const result = await publishSchedule({ force: true, which });
          await interaction.editReply(`Posted a fresh schedule for ${which === 'next' ? 'next' : 'this'} week (${result.mode}).`);
        } catch (err) {
          await interaction.editReply(`Failed to publish: ${err.message}`);
        }
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('sched_nav:')) {
      const [, which, anchorKey] = interaction.customId.split(':');
      await interaction.deferUpdate();
      try {
        const anchorDate = dateFromKey(anchorKey);
        const payload = await buildWeekPayload(anchorDate, which === 'next' ? 'next' : 'current');
        await interaction.editReply(payload);
      } catch (err) {
        console.error('[bot] failed to switch week view:', err);
      }
    }
  });

  await client.login(config.discordToken);
  return client;
}
