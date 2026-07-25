import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config } from './config.js';
import { attachClient, publishSchedule } from './publish.js';
import { buildWeekPayload } from './scheduleView.js';
import { now, dateFromKey } from './dates.js';

const commands = [
  new SlashCommandBuilder().setName('schedule').setDescription("Show this week's schedule right now"),
  new SlashCommandBuilder().setName('publish').setDescription('Force-repost the schedule to the announcement channel'),
].map((c) => c.toJSON());

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

      if (interaction.commandName === 'publish') {
        await interaction.deferReply({ ephemeral: true });
        try {
          const result = await publishSchedule({ force: true });
          await interaction.editReply(`Posted a fresh schedule (${result.mode}).`);
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
