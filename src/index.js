import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, assertConfig } from './config.js';
import { router as adminRouter } from './routes/admin.js';
import { createBot } from './bot.js';
import { startScheduler } from './scheduler.js';
import { getSchedule, getOverrides, getEvents } from './store.js';
import { buildIcsFeed } from './ics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

assertConfig();

const app = express();
app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, sameSite: 'lax' },
  })
);
app.use(express.static(path.join(__dirname, '..', 'public')));

// Public — no session auth. Calendar clients can't do a password-form login,
// and the schedule itself isn't sensitive. Registered before the admin
// router so it never passes through requireAuth.
app.get('/feed.ics', async (req, res, next) => {
  try {
    const [schedule, overrides, events] = await Promise.all([getSchedule(), getOverrides(), getEvents()]);
    res.type('text/calendar; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
    res.send(buildIcsFeed(schedule, overrides, events));
  } catch (err) {
    next(err);
  }
});

app.use('/', adminRouter);

// tiny health check for free hosts that ping the root to keep the app awake
app.get('/health', (req, res) => res.send('ok'));

// generic error handler — without this, unhandled route errors fall through
// to Express's default handler, which leaks a stack trace to the client
// (this app never sets NODE_ENV=production, so that default stays "on").
app.use((err, req, res, next) => {
  console.error('[web] unhandled error:', err);
  res.status(500).send('Internal error');
});

app.listen(config.port, () => {
  console.log(`[web] admin panel listening on port ${config.port}`);
});

createBot()
  .then(() => startScheduler())
  .catch((err) => {
    console.error('[bot] failed to start:', err);
  });
