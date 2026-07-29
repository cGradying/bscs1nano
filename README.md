# Section Schedule Bot

A Discord bot that posts your section's weekly class schedule as an image
every day at **1:00 AM** (configurable), plus a password-protected admin
web page where you (or another officer) can:

- Add/edit/delete recurring classes for each day
- Mark a specific date's class as **Vacant / no class** or **Moved online**
- Add a note for a specific day (e.g. "Suspended — no classes")
- Hit **Publish now** to push the update to Discord immediately — no
  waiting for 1am, and it edits the same message instead of spamming
  the channel if it's still the same week
- Preview exactly what will be posted before it goes out

The image always uses the **real current date** — it's generated fresh
on each post/preview, it's never a static picture.

## Use cases

- Class officer who's tired of manually re-typing/re-posting the weekly
  schedule in Discord every day.
- Sections with frequent one-off changes (moved online, cancelled, holiday) —
  update once in the admin panel instead of editing a shared spreadsheet and
  re-announcing.
- Students who just want `/schedule` on demand instead of scrolling channel
  history for the last posted image.

---

## 1. Create the Discord bot

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. **Bot** tab → **Reset Token** → copy it. This is your `DISCORD_TOKEN`.
3. Still on the **Bot** tab, nothing extra needs to be toggled on for this
   bot (it doesn't read messages, just posts).
4. **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot permissions: `Send Messages`, `Embed Links`, `Attach Files`,
     `Use Slash Commands`
   - Open the generated URL and invite the bot to your server.
5. Turn on Developer Mode in Discord (User Settings → Advanced), then
   right-click the channel you want announcements in → **Copy Channel ID**.
   This is your `CHANNEL_ID`.

## 2. Configure

Copy `.env.example` to `.env` and fill it in:

```
DISCORD_TOKEN=...
CHANNEL_ID=...
ADMIN_PASSWORD=pick-something-only-your-officers-know
SESSION_SECRET=any-long-random-string
TIMEZONE=Asia/Manila
POST_HOUR=1
POST_MINUTE=0
PORT=3000
```

## 3. Edit the starting schedule

`data/schedule.json` ships with placeholder sample classes so you can see
the format. Easiest way to set it up for real: run the bot once, log into
the admin panel, delete the sample classes and add your section's actual
ones — no need to hand-edit JSON. (You can also edit the file directly if
you prefer; the admin panel just edits this same file.)

## 4. Run it locally first (recommended before deploying)

```
npm install
npm start
```

Then open `http://localhost:3000`, log in with `ADMIN_PASSWORD`, add your
real classes, and click **Publish now** to test that it posts to Discord.

---

## 5. Turn on the @role ping (optional)

Every time the bot posts or updates the schedule (daily cron, or "Publish
now" from the admin panel), it sends a short follow-up message that
`@mentions` a role so people actually get notified — the schedule embed
itself is never edited-in-place silently.

1. In Discord: Server Settings → Roles → create or pick a role
   (e.g. `@schedule`). Make sure it's set to "Allow anyone to @mention
   this role", **or** give the bot the "Mention @everyone, @here, and
   All Roles" permission.
2. Right-click the role → **Copy Role ID** (Developer Mode must be on).
3. Put it in `.env` as `SCHEDULE_ROLE_ID`.

Leave it blank to disable pings entirely — the schedule will still post,
just without the mention.

## 6. This Week / Next Week buttons

Every post includes two buttons under the image so people can flip
between the current week and next week without you posting two separate
images. It's stateless — clicking just re-renders on the spot — so it
keeps working correctly no matter how long the message has been sitting
there, and it doesn't re-ping anyone (only actual schedule updates do).

## 7. Changing the daily post time

`POST_HOUR`/`POST_MINUTE` in `.env` only set the *starting* time. You can
change it anytime afterward right from the admin panel — there's a
"Daily auto-post time" field at the top of the dashboard. Save it and the
schedule updates immediately, no redeploy or restart needed.

## 8. One-time events (things that happen once, not every week)

Weekly classes always repeat on the same day forever. For something that
only happens once — an orientation day, a special seminar, an exam day —
use the "One-time events" card in the admin panel instead of adding it as
a class. Pick the exact date, give it a start/end time and a title, and
it'll show up on the calendar that single time only — the same weekday
the following week stays untouched. It shows up in a distinct purple
style (📌) so it's visually obvious it's a one-off, not a recurring class,
and it still counts toward that day's busy time (so the "good time to
post" gold bands adjust around it correctly).

## 9. Deploy somewhere it stays online 24/7

A Discord bot needs a process that's *always running* — it holds a
constant connection to Discord, and the 1am cron only fires if something
is actually alive at 1am. Closing your PC kills that. Two real options,
in order of reliability:

### Option A (recommended) — Oracle Cloud "Always Free" VM

This is a real virtual server that's free **forever**, no sleeping, no
credit-card surprise bills, no keep-alive tricks needed. It's a bit more
setup than the other option, but it's the only genuinely permanent free
24/7 option left in 2026 (Railway and Fly.io both dropped their old free
tiers and now only give a short trial before billing kicks in).

1. Sign up at **oracle.com/cloud/free** (a card is required for identity
   verification, but Always Free resources are never charged).
2. **Compute → Instances → Create Instance.**
   - Shape: pick an **Always Free eligible** shape — the Ampere A1
     (ARM) shape is the most generous (up to 4 OCPUs / 24 GB RAM free).
   - Image: **Ubuntu 22.04** (or newer).
   - Add your SSH key (or let it generate one for you — download it).
   - Keep "Assign a public IPv4 address" checked.
   - Create.
3. Once it's running, note its **public IP**.
4. Open the admin panel's port to the internet:
   - In the console: **Networking → Virtual Cloud Networks** → your
     VCN → your subnet → **Security Lists** → the default list → **Add
     Ingress Rule**: source `0.0.0.0/0`, destination port `3000`
     (or whatever `PORT` you use).
   - Oracle's Ubuntu images *also* ship with their own firewall rules
     blocking ports by default — SSH in and run:
     ```
     sudo iptables -I INPUT -p tcp --dport 3000 -j ACCEPT
     sudo netfilter-persistent save
     ```
     (This step trips people up — miss it and the port stays closed
     even after the security list is open.)
5. SSH in: `ssh ubuntu@<your-public-ip>`
6. Install Node.js and pm2 (a process manager that keeps the app
   running forever and restarts it automatically if it crashes or the
   VM reboots):
   ```
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs unzip
   sudo npm install -g pm2
   ```
7. Upload the project. Easiest way: `scp` the zip up, or push this
   folder to a private GitHub repo and `git clone` it on the VM.
   ```
   scp section-schedule-bot.zip ubuntu@<your-public-ip>:~
   ssh ubuntu@<your-public-ip>
   unzip section-schedule-bot.zip && cd schedule-bot
   npm install
   cp .env.example .env
   nano .env   # fill in your real token, channel ID, password, etc.
   ```
8. Start it under pm2 and make it survive reboots:
   ```
   pm2 start src/index.js --name schedule-bot
   pm2 save
   pm2 startup   # run the command it prints out (needs sudo)
   ```
9. Visit `http://<your-public-ip>:3000/login` — that's your admin
   panel, live, permanently, whether your own PC is on or not.

To push an update later: `git pull` (or re-upload), `npm install` if
dependencies changed, then `pm2 restart schedule-bot`.

### Option B (easier, less bulletproof) — Render free tier + keep-alive

Render's free web services are genuinely free with no credit card, but
they shut down the whole process after 15 minutes of no traffic — which
means the 1am cron literally isn't running if it's asleep. You work
around this with a free uptime monitor pinging it every few minutes so
it never goes idle long enough to sleep.

1. **New → Web Service** on render.com → connect your repo (or use
   their manual deploy / Docker options if you're not using GitHub).
2. Build command: `npm install`. Start command: `npm start`.
3. Add your environment variables (`DISCORD_TOKEN`, `CHANNEL_ID`,
   `ADMIN_PASSWORD`, `SESSION_SECRET`, `TIMEZONE`, `SCHEDULE_ROLE_ID`, etc).
4. **Set up free persistent storage** — this is the step that's easy to
   miss and causes exactly the symptom of "my classes/overrides
   disappeared after a restart": Render wipes its filesystem on every
   restart and redeploy, and **persistent Disks are a paid-only feature**
   on Render — free web services can't attach one at all, so that's not
   an option here. Instead, use a free MongoDB Atlas database — the app
   already supports this automatically once you set one env var:
   1. Sign up free at **mongodb.com/cloud/atlas** (no card needed for
      the free tier).
   2. Create a free **M0** cluster (permanently free, not a trial).
   3. **Database Access** → add a database user (username + password).
   4. **Network Access** → **Add IP Address** → **Allow Access from
      Anywhere** (`0.0.0.0/0`) — needed since Render's free tier doesn't
      have a fixed outbound IP.
   5. **Connect** → **Drivers** → copy the connection string
      (`mongodb+srv://user:pass@cluster.../`).
   6. Add it to Render as env var `MONGODB_URI`.

   That's it — once `MONGODB_URI` is set, the app automatically stores
   everything (classes, overrides, settings) in Atlas instead of local
   files, and it survives restarts/redeploys/sleeping indefinitely.
   Leave `MONGODB_URI` blank on hosts that *do* have a real disk (a VM,
   Oracle Cloud, your own PC) — local JSON files work fine there and
   Atlas isn't needed.

   If you already deployed and lost your data, this is why — set up
   Atlas now and re-enter your classes once through the admin panel;
   it'll stick from then on.
5. Sign up free at **uptimerobot.com**, add an HTTP monitor hitting
   `https://your-app.onrender.com/health` every 5 minutes. As long as
   that ping never stops, Render never sees 15 minutes of inactivity
   and the process — including the cron — keeps running.
6. This is "free forever" but slightly fragile: if the monitor ever
   has a gap right around 1am, that day's post gets skipped. Oracle
   doesn't have this risk since nothing ever sleeps in the first place.

Either way: once deployed, your admin panel is at
`http://<host>/login` (or `https://your-app.onrender.com/login` on Render).

### Option C — Google Cloud "Always Free" e2-micro VM (Oracle alternative)

Worth knowing if Oracle's free-tier signup gets stuck on identity
verification (a common complaint): GCP's `e2-micro` in `us-west1`,
`us-central1`, or `us-east1` is also permanently free, no sleeping. Same
pm2 setup as Option A once the VM is up — smaller (1 shared vCPU, 1GB RAM)
but this bot is light enough to not need more.

---

## How the "real-time" update works

- The daily 1am job always posts a **new** message.
- Any change from the admin panel (marking a class vacant/online, adding
  a note, or clicking **Publish now**) re-renders the image and **edits
  that same day's message** if one's already been posted this week —
  so the channel shows the latest state without extra clutter, and
  students see the update the moment you save it.

## Why the image looked garbled after deploying

If the schedule image renders fine locally but comes out as broken/garbled
glyphs once posted from your deployed host (Railway, Render, etc.), it's
because that container has no fonts installed at all, so canvas silently
substitutes a broken glyph set. This is now fixed by bundling
`assets/fonts/Roboto-Regular.ttf` and `Roboto-Bold.ttf` directly in the
project and registering them at startup (`src/render.js`), so the image
renders identically everywhere regardless of what fonts the host has.
Don't delete the `assets/fonts` folder.

## Customizing the look

Colors, fonts, and layout live in `src/render.js` (`COLORS` object at the
top). It mirrors the blueprint-blue/terminal-green/gold theme from your
original two-person HTML calendar, just condensed to one section.

## Slash commands

- `/schedule` — anyone can run this to see the current week's schedule
  on demand (ephemeral to them, doesn't post publicly).
- `/publish` — force a fresh post (same as the admin panel's button).

---

<div align="center">

**Author:** [cGradying](https://github.com/cGradying)

![astra cosmic](https://img.shields.io/badge/cGradying-astra%20cosmic-F97316?style=for-the-badge&labelColor=0B1120)

</div>
