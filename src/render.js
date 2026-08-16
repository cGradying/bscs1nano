import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSchedule, getOverrides, getEvents, eventOccursOn } from './store.js';
import { DAY_KEYS, weekDatesFor, dateKey, now } from './dates.js';

// Bundle our own font instead of relying on whatever (if anything) is
// installed on the host OS — headless free-tier containers often ship
// with zero fonts, which makes canvas fall back to a broken glyph set
// and produce garbled text in the rendered image.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Roboto-Regular.ttf'), 'Schedule Sans');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Roboto-Bold.ttf'), 'Schedule Sans Bold');

const FONT = 'Schedule Sans';
const FONT_BOLD = 'Schedule Sans Bold';

const COLORS = {
  bg: '#0b1220',
  bgSoft: '#0f1830',
  gridLine: 'rgba(120,170,220,0.14)',
  gridLineMajor: 'rgba(120,170,220,0.24)',
  text: '#eef3f8',
  textDim: '#8fa1bd',
  textFaint: '#5d6d88',
  classBlue: '#5aa9e6',
  classBlueFill: 'rgba(90,169,230,0.18)',
  online: '#39d98a',
  onlineFill: 'rgba(57,217,138,0.18)',
  vacant: '#6a7690',
  vacantFill: 'rgba(106,118,144,0.10)',
  gold: '#f2b84b',
  goldFill: 'rgba(242,184,75,0.16)',
  today: '#f2b84b',
  event: '#c084fc',
  eventFill: 'rgba(192,132,252,0.20)',
};

const PX_PER_HOUR = 42;
const COL_WIDTH = 150;
const AXIS_WIDTH = 54;
const HEADER_H = 108;
const DAYHEAD_H = 46;
const FOOTER_H = 34;
const PAD = 20;

// Bumps the physical resolution (and therefore visual size when Discord
// renders/expands the image) without touching any of the layout math
// below — everything is drawn in the same logical coordinate space, then
// the whole canvas is scaled up before it's painted.
const RENDER_SCALE = 1.6;

function fmtHour(h) {
  const hour = Math.floor(h);
  const min = Math.round((h - hour) * 60);
  const period = hour < 12 ? 'AM' : 'PM';
  let dh = hour % 12;
  if (dh === 0) dh = 12;
  return dh + (min ? ':' + String(min).padStart(2, '0') : '') + period;
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Merge busy intervals then invert within [dayStart, dayEnd] to get free windows.
function computeFreeWindows(busyIntervals, dayStart, dayEnd) {
  const sorted = [...busyIntervals].sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of sorted) {
    if (merged.length && s <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    } else {
      merged.push([s, e]);
    }
  }
  const free = [];
  let cursor = dayStart;
  for (const [s, e] of merged) {
    if (s > cursor) free.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < dayEnd) free.push([cursor, dayEnd]);
  return free;
}

/**
 * Renders the week (Mon-Sun) containing `targetDate` (a dayjs instance).
 * Applies any date-specific overrides (vacant / online) and highlights
 * the column matching `targetDate` as "today".
 */
export async function renderWeekImage(targetDate) {
  const schedule = await getSchedule();
  const overrides = await getOverrides();
  const { dayStart, dayEnd } = schedule;
  const weekDates = weekDatesFor(targetDate);
  const todayKey = dateKey(now());

  const colHeight = (dayEnd - dayStart) * PX_PER_HOUR;
  const width = PAD * 2 + AXIS_WIDTH + COL_WIDTH * 7;
  const height = PAD * 2 + HEADER_H + DAYHEAD_H + colHeight + FOOTER_H;

  const canvas = createCanvas(Math.round(width * RENDER_SCALE), Math.round(height * RENDER_SCALE));
  const ctx = canvas.getContext('2d');
  ctx.scale(RENDER_SCALE, RENDER_SCALE);

  // background
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, '#0c1425');
  bgGrad.addColorStop(1, COLORS.bg);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // header
  const gridLeft = PAD + AXIS_WIDTH;
  const headerTop = PAD;
  ctx.fillStyle = COLORS.gold;
  ctx.font = `12px ${FONT_BOLD}`;
  ctx.textBaseline = 'top';
  const monday = weekDates[0];
  const sunday = weekDates[6];
  const weekLabel = `WEEK OF ${monday.format('MMM D')} – ${sunday.format('MMM D, YYYY')}`;
  ctx.fillText(weekLabel.toUpperCase(), gridLeft, headerTop);

  ctx.fillStyle = COLORS.text;
  ctx.font = `26px ${FONT_BOLD}`;
  ctx.fillText(`${schedule.section.name} — Weekly Schedule`, gridLeft, headerTop + 20);

  ctx.fillStyle = COLORS.textDim;
  ctx.font = `13px ${FONT}`;
  ctx.fillText(
    `${schedule.section.program} · Today is ${now().format('dddd, MMMM D, YYYY')}`,
    gridLeft,
    headerTop + 56
  );

  // legend
  const legendY = headerTop + 80;
  let lx = gridLeft;
  const legendItem = (color, label) => {
    ctx.fillStyle = color;
    roundRect(ctx, lx, legendY + 2, 12, 12, 3);
    ctx.fill();
    ctx.fillStyle = COLORS.textDim;
    ctx.font = `12px ${FONT}`;
    ctx.fillText(label, lx + 18, legendY);
    lx += 18 + ctx.measureText(label).width + 26;
  };
  legendItem(COLORS.classBlueFill, 'Class');
  legendItem(COLORS.onlineFill, 'Online');
  legendItem(COLORS.vacantFill, 'Vacant / no class');
  legendItem(COLORS.eventFill, 'One-time event');
  legendItem(COLORS.eventFill, 'All-day event');
  legendItem(COLORS.goldFill, 'Free — good time to post');

  // grid top
  const gridTop = PAD + HEADER_H;
  const dayHeadTop = gridTop;
  const bodyTop = gridTop + DAYHEAD_H;

  // day headers
  DAY_KEYS.forEach((dayKey, i) => {
    const x = gridLeft + AXIS_WIDTH_OFFSET(i);
    const d = weekDates[i];
    const isToday = dateKey(d) === todayKey;
    if (isToday) {
      ctx.fillStyle = 'rgba(242,184,75,0.10)';
      ctx.fillRect(x, dayHeadTop, COL_WIDTH, DAYHEAD_H + colHeight);
    }
    ctx.fillStyle = isToday ? COLORS.gold : COLORS.text;
    ctx.font = `14px ${FONT_BOLD}`;
    ctx.textAlign = 'center';
    ctx.fillText(fullDayName(dayKey), x + COL_WIDTH / 2, dayHeadTop + 8);
    ctx.fillStyle = COLORS.textFaint;
    ctx.font = `11px ${FONT}`;
    ctx.fillText(d.format('MMM D'), x + COL_WIDTH / 2, dayHeadTop + 26);
    ctx.textAlign = 'left';
  });

  function AXIS_WIDTH_OFFSET(i) {
    return i * COL_WIDTH;
  }
  function fullDayName(k) {
    return { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' }[k];
  }

  // hour lines + time axis labels
  for (let h = dayStart; h <= dayEnd; h++) {
    const y = bodyTop + (h - dayStart) * PX_PER_HOUR;
    ctx.strokeStyle = h % 3 === 0 ? COLORS.gridLineMajor : COLORS.gridLine;
    ctx.beginPath();
    ctx.moveTo(gridLeft, y);
    ctx.lineTo(gridLeft + COL_WIDTH * 7, y);
    ctx.stroke();
    if (h < dayEnd) {
      ctx.fillStyle = COLORS.textFaint;
      ctx.font = `10px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(fmtHour(h), gridLeft - 8, y - 5);
      ctx.textAlign = 'left';
    }
  }

  // per-day columns: free bands + class blocks
  const allEvents = await getEvents();

  DAY_KEYS.forEach((dayKey, i) => {
    const x = gridLeft + i * COL_WIDTH;
    const d = weekDates[i];
    const dKey = dateKey(d);
    const dayOverrides = overrides[dKey] || {};
    const classes = (schedule.classes[dayKey] || []).map((c) => {
      const timeOverride = dayOverrides._times?.[c.id];
      return {
        ...c,
        start: timeOverride?.start ?? c.start,
        end: timeOverride?.end ?? c.end,
        status: dayOverrides[c.id] || 'scheduled',
      };
    });
    const dayEvents = allEvents.filter((e) => eventOccursOn(e, dKey));
    const events = dayEvents.filter((e) => !e.allDay);
    const allDayEvents = dayEvents.filter((e) => e.allDay);

    // vertical column divider
    ctx.strokeStyle = COLORS.gridLine;
    ctx.beginPath();
    ctx.moveTo(x, bodyTop);
    ctx.lineTo(x, bodyTop + colHeight);
    ctx.stroke();

    const busy = classes
      .filter((c) => c.status !== 'vacant')
      .map((c) => [c.start, c.end])
      .concat(events.map((e) => [e.start, e.end]));
    const free = computeFreeWindows(busy, dayStart, dayEnd);

    // free bands (behind blocks)
    free.forEach(([s, e]) => {
      const y = bodyTop + (s - dayStart) * PX_PER_HOUR;
      const h = (e - s) * PX_PER_HOUR;
      ctx.fillStyle = COLORS.goldFill;
      ctx.fillRect(x + 2, y, COL_WIDTH - 4, h);
      ctx.strokeStyle = 'rgba(242,184,75,0.5)';
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(x + 2, y, COL_WIDTH - 4, h);
      ctx.setLineDash([]);
      if (h > 16) {
        ctx.fillStyle = COLORS.gold;
        ctx.font = `9px ${FONT_BOLD}`;
        ctx.fillText(fmtHour(s) + '–' + fmtHour(e), x + 6, y + 3);
      }
    });

    // class blocks
    classes.forEach((c) => {
      const y = bodyTop + (c.start - dayStart) * PX_PER_HOUR;
      const h = (c.end - c.start) * PX_PER_HOUR;
      let fill = COLORS.classBlueFill;
      let border = COLORS.classBlue;
      let label = null;
      if (c.status === 'online') {
        fill = COLORS.onlineFill;
        border = COLORS.online;
        label = 'ONLINE';
      } else if (c.status === 'vacant') {
        fill = COLORS.vacantFill;
        border = COLORS.vacant;
        label = 'NO CLASS';
      }
      roundRect(ctx, x + 3, y + 1, COL_WIDTH - 6, Math.max(h - 2, 10), 5);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = border;
      ctx.font = `10.5px ${FONT_BOLD}`;
      ctx.fillText(c.code, x + 8, y + 5);
      if (c.status === 'vacant') {
        ctx.fillStyle = COLORS.textFaint;
        ctx.font = `9px ${FONT}`;
        // strike-through style label
        ctx.fillText(c.title + ' — cancelled', x + 8, y + 18);
      } else {
        ctx.fillStyle = COLORS.textDim;
        ctx.font = `9px ${FONT}`;
        wrapText(ctx, c.title, x + 8, y + 18, COL_WIDTH - 16, 11);
      }
      if (label && h > 30) {
        ctx.fillStyle = border;
        ctx.font = `8.5px ${FONT_BOLD}`;
        ctx.fillText(label, x + 8, y + h - 12);
      }
    });

    // one-time event blocks (only ever drawn on their exact date, never repeat)
    events.forEach((e) => {
      const y = bodyTop + (e.start - dayStart) * PX_PER_HOUR;
      const h = (e.end - e.start) * PX_PER_HOUR;
      const border = e.color || COLORS.event;
      roundRect(ctx, x + 3, y + 1, COL_WIDTH - 6, Math.max(h - 2, 10), 5);
      ctx.fillStyle = hexToRgba(border, 0.2);
      ctx.fill();
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = border;
      ctx.font = `10.5px ${FONT_BOLD}`;
      ctx.fillText('📌 EVENT', x + 8, y + 5);
      ctx.fillStyle = COLORS.textDim;
      ctx.font = `9px ${FONT}`;
      wrapText(ctx, e.title, x + 8, y + 18, COL_WIDTH - 16, 11);
    });

    // all-day events: one light wash + accent lines per DAY (not per event —
    // stacking a second event's fill on top used to double the tint and make
    // busier days look heavier than quiet ones for no reason). Each event
    // gets its own color-coded row instead of a repeated 📌 on every line,
    // and a small count badge appears when 2+ events overlap the same day
    // so that's obvious at a glance instead of two titles just crowding
    // each other.
    if (allDayEvents.length > 0) {
      const primary = allDayEvents[0].color || COLORS.event;
      ctx.fillStyle = hexToRgba(primary, 0.09);
      ctx.fillRect(x, bodyTop, COL_WIDTH, colHeight);
      ctx.strokeStyle = hexToRgba(primary, 0.55);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, bodyTop + 0.5);
      ctx.lineTo(x + COL_WIDTH, bodyTop + 0.5);
      ctx.moveTo(x, bodyTop + colHeight - 0.5);
      ctx.lineTo(x + COL_WIDTH, bodyTop + colHeight - 0.5);
      ctx.stroke();

      // Free-time labels for a window starting right at dayStart land at
      // bodyTop+3 (render below); give the event rows enough clearance
      // below that so the two never collide.
      const rowH = 13;
      const rowsTop = bodyTop + 18;
      allDayEvents.forEach((e, idx) => {
        const rowColor = e.color || COLORS.event;
        const rowY = rowsTop + idx * rowH;
        // color-coded dot instead of a repeated pin emoji per row
        ctx.fillStyle = rowColor;
        ctx.beginPath();
        ctx.arc(x + 10, rowY - 2, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `10px ${FONT_BOLD}`;
        ctx.textAlign = 'left';
        ctx.fillText(truncateText(ctx, e.title, COL_WIDTH - 34), x + 17, rowY);
      });

      if (allDayEvents.length > 1) {
        // small count badge — the "there's more than one thing here" tell
        const badgeR = 8;
        const bx = x + COL_WIDTH - badgeR - 4;
        const by = rowsTop - 5;
        ctx.fillStyle = COLORS.bgSoft;
        ctx.beginPath();
        ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = primary;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = primary;
        ctx.font = `9px ${FONT_BOLD}`;
        ctx.textAlign = 'center';
        ctx.fillText(String(allDayEvents.length), bx, by + 3);
        ctx.textAlign = 'left';
      }
    }
  });

  function truncateText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let out = text;
    while (out.length > 1 && ctx.measureText(out + '…').width > maxWidth) {
      out = out.slice(0, -1);
    }
    return out + '…';
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    let curY = y;
    for (const word of words) {
      const test = line + word + ' ';
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, curY);
        line = word + ' ';
        curY += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, curY);
  }

  // footer
  ctx.fillStyle = COLORS.textFaint;
  ctx.font = `10px ${FONT}`;
  ctx.fillText(
    `Auto-generated ${targetDate.format('MMM D, YYYY h:mm A')} · times shown ${fmtHour(dayStart)}–${fmtHour(dayEnd)}`,
    gridLeft,
    height - PAD - 16
  );

  return canvas.encode('png');
}
