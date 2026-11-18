// Business-hours call deadline for America/Phoenix (UTC-7, no daylight saving).
// Mon–Fri 7:00 AM–6:00 PM, 1 hour. Sat–Sun 10:00 AM–4:00 PM, 4 hours.
// The close is exclusive. Time outside a window does not count. A lead assigned
// outside a window starts at the next opening, and that opening's window sets
// the budget. Leftover budget continues at the next opening.
// public.lead_call_plan in supabase/migrations/009_leads.sql is the server copy.
// Keep the two in step. The cases in lead-clock.test.mjs are the spec.

const PHOENIX = 'America/Phoenix';

function parts(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: PHOENIX,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const bag = {};
  for (const part of fmt.formatToParts(date)) bag[part.type] = part.value;
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    y: Number(bag.year),
    m: Number(bag.month),
    d: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

function weekday(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
}

function addDays(y, m, d, n) {
  const next = new Date(Date.UTC(y, m - 1, d + n, 12, 0, 0));
  return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() };
}

function windowFor(y, m, d) {
  const weekend = weekday(y, m, d) === 0 || weekday(y, m, d) === 6;
  if (weekend) return { openMin: 10 * 60, closeMin: 16 * 60, budgetMin: 4 * 60, callWindow: 'weekend' };
  return { openMin: 7 * 60, closeMin: 18 * 60, budgetMin: 60, callWindow: 'weekday' };
}

function atPhoenix(y, m, d, minutes) {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return new Date(Date.UTC(y, m - 1, d, hh + 7, mm, 0));
}

export function leadCallPlan(from) {
  const startAt = new Date(from);
  if (Number.isNaN(startAt.getTime())) throw new Error('assigned time is not a date');
  let cursorParts = parts(startAt);
  let win = windowFor(cursorParts.y, cursorParts.m, cursorParts.d);
  const localMs = ((cursorParts.hour * 60 + cursorParts.minute) * 60 + cursorParts.second) * 1000;
  const openMs = win.openMin * 60 * 1000;
  const closeMs = win.closeMin * 60 * 1000;
  let cursor;
  if (localMs >= openMs && localMs < closeMs) cursor = startAt;
  else if (localMs < openMs) cursor = atPhoenix(cursorParts.y, cursorParts.m, cursorParts.d, win.openMin);
  else {
    const next = addDays(cursorParts.y, cursorParts.m, cursorParts.d, 1);
    win = windowFor(next.y, next.m, next.d);
    cursor = atPhoenix(next.y, next.m, next.d, win.openMin);
  }
  let left = win.budgetMin * 60 * 1000;
  for (let i = 0; i < 21; i += 1) {
    const here = parts(cursor);
    const day = windowFor(here.y, here.m, here.d);
    const close = atPhoenix(here.y, here.m, here.d, day.closeMin);
    const available = close.getTime() - cursor.getTime();
    if (available >= left) {
      return {
        dueAt: new Date(cursor.getTime() + left).toISOString(),
        callWindow: win.callWindow,
        budgetMinutes: win.budgetMin,
      };
    }
    left -= available;
    const next = addDays(here.y, here.m, here.d, 1);
    const opened = windowFor(next.y, next.m, next.d);
    cursor = atPhoenix(next.y, next.m, next.d, opened.openMin);
  }
  throw new Error('lead clock did not resolve');
}

export function callPhrase(callWindow) {
  return callWindow === 'weekend' ? '4 hours' : '1 hour';
}
