# Section Schedule Bot

Discord bot that renders a section's weekly class schedule to PNG and posts it
on a daily cron, with an authenticated Express admin panel for editing the
schedule and marking per-date exceptions.

Node >= 18, ESM (`"type": "module"`). One process runs all three subsystems:
Express server, Discord client, cron scheduler.

## Stack

| Concern | Package |
|---|---|
| Discord gateway + slash commands | `discord.js` ^14 |
| PNG rendering | `@napi-rs/canvas` |
| Cron | `node-cron` |
| Timezone-aware dates | `dayjs` |
| Admin panel | `express`, `express-session` |
| Optional persistence | `mongodb` |

## Architecture

Module ownership — one process, three subsystems:

```
src/index.js          boots Express + Discord client + cron in one process
  ├─ src/bot.js         gateway client, slash command registration
  ├─ src/scheduler.js   node-cron job, rescheduleFromSettings()
  └─ src/routes/admin.js  Express router, session auth, /api/*
```

Request flow for a single post:

```
publish.js → scheduleView.js → render.js → store.js
             (embed+buttons)   (PNG)      (persistence)
```

`store.js` is the persistence abstraction. Backend is selected at runtime:
MongoDB when `MONGODB_URI` is set, otherwise JSON files under `data/`. Every
accessor is `async` regardless of backend. Never read `data/*.json` directly
from another module — that bypasses the Mongo path.

### Data model

| Store | File | Shape |
|---|---|---|
| Schedule | `data/schedule.json` | `{ section, dayStart, dayEnd, classes: { Mon..Sun: [] } }` |
| Overrides | `data/overrides.json` | `{ "YYYY-MM-DD": { "<classId>": "vacant"\|"online", _note?: string } }` |
| Events | `data/events.json` | keyed by exact `YYYY-MM-DD`, one-time only |
| Settings | `data/settings.json` | `{ postHour, postMinute }` |
| State | `data/state.json` | `{ lastMessageId, lastMessageWeekKey }` |

`settings.json` and `events.json` are created on first write; defaults come
from the `DEFAULT_*` constants in `store.js`.

**Times are decimal hours** throughout classes, events and grid math —
`13.5` is 1:30 PM. `computeFreeWindows` in `render.js` inverts busy intervals
to draw the "free time" bands; anything that should block a band must be
pushed into the `busy` array.

Recurring classes (`schedule.classes[Mon..Sun]`) repeat weekly forever.
Events are separate and render only on their exact date.

`_note` is a reserved key inside a day's override object — code iterating
overrides must skip it.

### Post semantics

`publish.js` decides edit-vs-new from `state.json`:

- Admin edit within the same ISO week → edits `lastMessageId` in place.
- `force: true` (daily cron, `/publish`, "Publish now") → always sends new.

Every publish also sends a separate role-ping message, so the embed is never
updated silently.

`scheduleView.js` is stateless: week-nav buttons encode everything in the
custom ID (`sched_nav:<current|next>:<YYYY-MM-DD anchor>`), so old messages
keep working with no server-side session.

`dates.js` is the only module that touches timezones. Weeks are Mon–Sun,
identified by their Monday (`weekKeyFor`). Use `now()`, not `dayjs()`, so
`TIMEZONE` is respected.

## Discord application setup

1. <https://discord.com/developers/applications> → **New Application**.
2. **Bot** → **Reset Token** → `DISCORD_TOKEN`. No privileged intents needed;
   the bot posts and never reads message content.
3. **OAuth2 → URL Generator** → scopes `bot`, `applications.commands`;
   permissions `Send Messages`, `Embed Links`, `Attach Files`,
   `Use Slash Commands`. Invite via the generated URL.
4. Enable Developer Mode (User Settings → Advanced), then right-click the
   target channel → **Copy Channel ID** → `CHANNEL_ID`.
5. Optional ping role: right-click role → **Copy Role ID** →
   `SCHEDULE_ROLE_ID`. The role must allow `@mention` by anyone, or grant the
   bot "Mention @everyone, @here, and All Roles". Blank disables pings.

## Configuration

`cp .env.example .env`

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DISCORD_TOKEN` | yes | — | Missing only warns; the web half still boots |
| `CHANNEL_ID` | yes | — | Target announcement channel |
| `SCHEDULE_ROLE_ID` | no | — | Blank disables the ping message |
| `ADMIN_PASSWORD` | no | `change-me` | Admin panel login — set a real value, the fallback is public |
| `SESSION_SECRET` | no | `insecure-dev-secret` | `express-session` signing key — set a real value in any shared deployment |
| `TIMEZONE` | no | `Asia/Manila` | IANA name, drives all date math |
| `POST_HOUR` | no | `1` | Initial cron hour; overridden by settings store |
| `POST_MINUTE` | no | `0` | Initial cron minute |
| `PORT` | no | `3000` | Express listen port |
| `PUBLIC_URL` | no | — | Public base URL, no trailing slash. Required for `/calendar` to hand out a working subscribe link |
| `MONGODB_URI` | no | — | When set, switches `store.js` to MongoDB |

`config.js` reads all env vars into one exported object. `assertConfig()`
warns on missing values rather than exiting.

## Run

```
npm install
npm start          # node src/index.js
```

Admin panel at `http://localhost:3000`, login with `ADMIN_PASSWORD`.
`GET /api/preview.png` renders the same image the bot posts — the fastest way
to iterate on `render.js` without touching Discord.

`data/schedule.json` ships with sample classes. Replace them through the admin
panel or by editing the file; both write the same store.

## Calendar feed

`GET /feed.ics` — public, unauthenticated. Subscribe from Google Calendar
("Other calendars → From URL") or Apple Calendar ("File → New Calendar
Subscription") to pull the recurring weekly classes directly. Students get
this link by running `/calendar` in Discord, which requires `PUBLIC_URL` to
be set.

Generated fresh on every request from `src/ics.js`: a rolling 4-week window
starting from the current week, one `VEVENT` per class occurrence, times
converted from local decimal hours to UTC (no `VTIMEZONE` block needed).
Overrides (vacant/online), day notes, and one-time events are **not**
reflected in this feed — it always shows the base recurring schedule.
Calendar clients poll a subscribed feed roughly every 12-24h; this is not a
push update.

## Admin HTTP API

`router.use(requireAuth)` sits mid-file in `routes/admin.js`. Routes declared
after it require a session; `/login` is declared before and is public.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/schedule` | Full schedule document |
| `POST` | `/api/section` | Update section name/program |
| `POST` | `/api/classes` | Add a recurring class |
| `PUT` | `/api/classes/:day/:id` | Patch a class |
| `DELETE` | `/api/classes/:day/:id` | Remove a class |
| `GET`/`POST` | `/api/overrides` | Per-date vacant/online status |
| `POST` | `/api/day-note` | Set a day's `_note` |
| `GET`/`POST` | `/api/events` | One-time events |
| `DELETE` | `/api/events/:date/:id` | Remove an event |
| `GET` | `/api/preview.png` | Render current week to PNG |
| `GET`/`POST` | `/api/settings` | Daily post time |
| `POST` | `/api/publish` | Force a fresh post |

Changing post time at runtime requires `rescheduleFromSettings()` after
`saveSettings()` (see `POST /api/settings`) — `node-cron` will not pick up the
new time otherwise.

The admin UI is vanilla JS in `public/admin.js` against these JSON endpoints;
`routes/admin.js` serves two HTML shells as inline template strings.

## Slash commands

Registered globally on every `ready` via
`REST.put(Routes.applicationCommands(...))`, so command changes take effect on
restart with no separate deploy script.

| Command | Access | Behavior |
|---|---|---|
| `/schedule` | anyone | Ephemeral render of the current week |
| `/publish` | anyone | Forces a fresh public post |
| `/calendar` | anyone | Ephemeral subscribe link + Google/Apple setup steps. Requires `PUBLIC_URL`; without it, replies that the feed isn't configured |

## Rendering notes

`assets/fonts/Roboto-Regular.ttf` and `Roboto-Bold.ttf` are registered at
import time in `src/render.js`. **Do not remove them** — containers frequently
ship zero system fonts, and canvas silently renders garbled glyphs rather than
erroring.

Colors, fonts and layout live in the `COLORS` object at the top of
`src/render.js`.

Log prefixes: `[bot]`, `[web]`, `[publish]`, `[scheduler]`, `[config]`.

---

<div align="center">

[![Author: cGradying](https://img.shields.io/badge/cGradying-AUTHOR-10B981?style=for-the-badge&labelColor=0B1120)](https://github.com/cGradying)

</div>
