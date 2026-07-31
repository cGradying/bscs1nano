import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, assertConfig } from './config.js';
import { router as adminRouter } from './routes/admin.js';
import { createBot } from './bot.js';
import { startScheduler } from './scheduler.js';
import { getSchedule } from './store.js';
import { buildIcsFeed } from './ics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

assertConfig();

const app = express();
app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 },
  })
);
app.use(express.static(path.join(__dirname, '..', 'public')));

// Public — no session auth. Calendar clients can't do a password-form login,
// and the schedule itself isn't sensitive. Registered before the admin
// router so it never passes through requireAuth.
app.get('/feed.ics', async (req, res) => {
  const schedule = await getSchedule();
  res.type('text/calendar; charset=utf-8');
  res.set('Cache-Control', 'no-cache');
  res.send(buildIcsFeed(schedule));
});

app.use('/', adminRouter);

// tiny health check for free hosts that ping the root to keep the app awake
app.get('/health', (req, res) => res.send('ok'));

app.listen(config.port, () => {
  console.log(`[web] admin panel listening on port ${config.port}`);
});

createBot()
  .then(() => startScheduler())
  .catch((err) => {
    console.error('[bot] failed to start:', err);
  });
