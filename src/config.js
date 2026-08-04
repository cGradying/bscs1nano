import 'dotenv/config';

export const config = {
  discordToken: process.env.DISCORD_TOKEN,
  channelId: process.env.CHANNEL_ID,
  scheduleRoleId: process.env.SCHEDULE_ROLE_ID || null,
  adminPassword: process.env.ADMIN_PASSWORD || 'change-me',
  sessionSecret: process.env.SESSION_SECRET || 'insecure-dev-secret',
  timezone: process.env.TIMEZONE || 'Asia/Manila',
  postHour: Number(process.env.POST_HOUR ?? 1),
  postMinute: Number(process.env.POST_MINUTE ?? 0),
  port: Number(process.env.PORT ?? 3000),
  // Public base URL of this app, used to hand out the /feed.ics subscribe
  // link. No trailing slash. Render sets RENDER_EXTERNAL_URL automatically on
  // web services, so this needs no manual config there. Without either,
  // /calendar reports that the feed isn't configured.
  publicUrl:
    (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '') || null,
  // Optional: when set, data persists in MongoDB Atlas (free tier) instead
  // of local JSON files. Needed on hosts (like Render's free tier) that
  // don't offer persistent disks at all.
  mongoUri: process.env.MONGODB_URI || null,
  // GitHub-as-database — checked first if GITHUB_TOKEN + GITHUB_DATA_REPO
  // are both set. Use a repo dedicated to data only, NOT this bot's own
  // code repo, so saves don't trigger redeploys on hosts that auto-deploy
  // on push. Same pattern/env var names as the resource-faq-bot.
  githubToken: process.env.GITHUB_TOKEN || null,
  githubRepo: process.env.GITHUB_DATA_REPO || null, // "owner/repo"
  githubBranch: process.env.GITHUB_DATA_BRANCH || 'main',
  githubDir: process.env.GITHUB_DATA_DIR || 'data', // one JSON file per doc, matching local layout
};

export function assertConfig() {
  const missing = [];
  if (!config.discordToken) missing.push('DISCORD_TOKEN');
  if (!config.channelId) missing.push('CHANNEL_ID');
  if (missing.length) {
    console.warn(
      `[config] Missing env vars: ${missing.join(', ')}. The bot will not be able to post until these are set.`
    );
  }
}
