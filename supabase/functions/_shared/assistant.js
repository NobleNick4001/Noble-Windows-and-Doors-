// Sales-assistant dates, metrics, and internal email HTML. No network and no secrets.
// Phoenix is UTC-7 all year. Business days skip Saturday and Sunday only.

import { phoenixParts } from '../hubspot-sync/followup.js';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const STALL_MS = 7 * DAY_MS;
export const DEFAULT_REPORT_TO = 'mgr@noblewandd.com';
export const DEFAULT_REPORT_CC = 'noblenicksbot@mail.grokbot.com';

export function phoenixDayStart(from) {
  const p = phoenixParts(from);
  return new Date(Date.UTC(p.year, p.month, p.day, 7, 0, 0, 0));
}

export function phoenixDayEnd(from) {
  return new Date(phoenixDayStart(from).getTime() + DAY_MS);
}

// The Monday–Sunday that ended before the Monday of `now` (Phoenix).
export function weekRange(now = new Date()) {
  const p = phoenixParts(now);
  const sinceMonday = (p.dow + 6) % 7;
  const thisMonday = new Date(Date.UTC(p.year, p.month, p.day - sinceMonday, 7, 0, 0, 0));
  return { start: new Date(thisMonday.getTime() - 7 * DAY_MS), end: thisMonday };
}

export function shiftWeek(week, delta) {
  const ms = (Number(delta) || 0) * 7 * DAY_MS;
  return { start: new Date(week.start.getTime() + ms), end: new Date(week.end.getTime() + ms) };
}

export function weekKey(week) {
  const p = phoenixParts(week.start);
  const month = String(p.month + 1).padStart(2, '0');
  const day = String(p.day).padStart(2, '0');
  return `${p.year}-${month}-${day}`;
}

export function weekFromKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!match) return null;
  const start = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 7, 0, 0, 0));
  if (Number.isNaN(start.getTime())) return null;
  const p = phoenixParts(start);
  const sinceMonday = (p.dow + 6) % 7;
  const monday = new Date(start.getTime() - sinceMonday * DAY_MS);
  return { start: monday, end: new Date(monday.getTime() + 7 * DAY_MS) };
}

export function formatPhoenix(iso, options = {}) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', ...options }).format(new Date(iso));
}

export function formatWeek(week) {
  const endInclusive = new Date(week.end.getTime() - 1);
  const opts = { month: 'short', day: 'numeric', year: 'numeric' };
  return `${formatPhoenix(week.start, opts)} – ${formatPhoenix(endInclusive, opts)}`;
}

export function money(amount) {
  const n = Number(amount);
  const value = Number.isFinite(n) ? n : 0;
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function inRange(iso, week) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= week.start.getTime() && t < week.end.getTime();
}

export function dueBucket(dueAt, now) {
  const due = new Date(dueAt).getTime();
  if (!Number.isFinite(due)) return 'later';
  const start = phoenixDayStart(now).getTime();
  if (due < start) return 'overdue';
  if (due < start + DAY_MS) return 'today';
  return 'later';
}

export function isDueOrOverdue(dueAt, now, status = 'open') {
  if (status !== 'open') return false;
  const bucket = dueBucket(dueAt, now);
  return bucket === 'overdue' || bucket === 'today';
}

export function openAt(followUp, at) {
  const created = new Date(followUp.created_at || followUp.due_at || 0).getTime();
  if (!Number.isFinite(created) || created >= at.getTime()) return false;
  if (followUp.status === 'open') return true;
  if (followUp.status === 'done') {
    const done = followUp.completed_at ? new Date(followUp.completed_at).getTime() : Infinity;
    return done >= at.getTime();
  }
  if (followUp.status === 'canceled') {
    const when = followUp.updated_at ? new Date(followUp.updated_at).getTime() : Infinity;
    return when >= at.getTime();
  }
  return false;
}

export function isOverdueAt(followUp, at) {
  if (!followUp?.due_at) return false;
  if (new Date(followUp.due_at).getTime() >= at.getTime()) return false;
  return openAt(followUp, at);
}

export function isOpenPresented(estimate, asOf) {
  if (!estimate?.presented_at) return false;
  if (new Date(estimate.presented_at).getTime() >= asOf.getTime()) return false;
  if (estimate.deleted_at && new Date(estimate.deleted_at).getTime() < asOf.getTime()) return false;
  if (estimate.signed_at && new Date(estimate.signed_at).getTime() < asOf.getTime()) return false;
  if (estimate.lost_at && new Date(estimate.lost_at).getTime() < asOf.getTime()) return false;
  return true;
}

export function isStalledDeal(estimate, times, asOf) {
  if (!isOpenPresented(estimate, asOf)) return false;
  const stamps = (times || [])
    .filter(Boolean)
    .map((t) => new Date(t).getTime())
    .filter((t) => Number.isFinite(t) && t <= asOf.getTime());
  if (!stamps.length) return true;
  return asOf.getTime() - Math.max(...stamps) >= STALL_MS;
}

function activityFor(estimate, followUps, appointments, audits) {
  const times = [estimate.presented_at, estimate.updated_at, estimate.created_at, estimate.signed_at, estimate.lost_at];
  for (const row of followUps) {
    if (row.estimate_id !== estimate.id) continue;
    times.push(row.created_at, row.completed_at, row.updated_at);
  }
  for (const row of appointments) {
    if (row.estimate_id !== estimate.id) continue;
    times.push(row.set_at, row.created_at);
  }
  for (const row of audits) {
    if (row.estimate_id !== estimate.id) continue;
    times.push(row.created_at);
  }
  return times;
}

export function closeRate(signed, lost) {
  const denom = (Number(signed) || 0) + (Number(lost) || 0);
  if (!denom) return null;
  return (Number(signed) || 0) / denom;
}

export function formatCloseRate(rate) {
  if (rate == null || !Number.isFinite(rate)) return '—';
  return `${Math.round(rate * 100)}%`;
}

export function reportReps(profiles, estimates, followUps, appointments) {
  const owners = new Set();
  for (const row of [...(estimates || []), ...(followUps || []), ...(appointments || [])]) {
    if (row?.owner_id) owners.add(row.owner_id);
  }
  return (profiles || [])
    .filter((p) => p && (p.role === 'sales' || owners.has(p.id)))
    .slice()
    .sort((a, b) => String(a.full_name || a.email || '').localeCompare(String(b.full_name || b.email || '')));
}

export function buildWeeklyReport({ reps, estimates = [], followUps = [], appointments = [], activity = [] }, week) {
  const asOf = week.end;
  const people = reportReps(reps, estimates, followUps, appointments);
  const rows = people.map((rep) => {
    const mine = (row) => row.owner_id === rep.id && !row.deleted_at;
    const jobs = estimates.filter((row) => row.owner_id === rep.id && !row.deleted_at);
    const signed = jobs.filter((row) => inRange(row.signed_at, week)).length;
    const lost = jobs.filter((row) => inRange(row.lost_at, week)).length;
    const held = jobs.filter((row) => inRange(row.presented_at, week)).length;
    const set = appointments.filter((row) => mine(row) && inRange(row.set_at, week) && (row.source === 'app' || row.source === 'hubspot')).length;
    const due = followUps.filter((row) => mine(row) && inRange(row.due_at, week)).length;
    const done = followUps.filter((row) => mine(row) && row.status === 'done' && inRange(row.completed_at, week)).length;
    const overdue = followUps.filter((row) => mine(row) && isOverdueAt(row, asOf)).length;
    const openPresented = jobs.filter((row) => isOpenPresented(row, asOf));
    const pipelineValue = openPresented.reduce((sum, row) => sum + (Number(row.total_amount) || 0), 0);
    const stalled = openPresented.filter((row) => isStalledDeal(row, activityFor(row, followUps, appointments, activity), asOf))
      .map((row) => ({
        id: row.id,
        customerName: row.customer_name || 'Customer',
        total: Number(row.total_amount) || 0,
      }));
    return {
      id: rep.id,
      name: rep.full_name || rep.email || 'Rep',
      email: String(rep.email || '').trim().toLowerCase(),
      signed,
      lost,
      closeRate: closeRate(signed, lost),
      appointmentsSet: set,
      appointmentsHeld: held,
      followUpsDue: due,
      followUpsDone: done,
      followUpsOverdue: overdue,
      pipelineValue,
      stalled,
    };
  });
  return { week, reps: rows };
}

export function digestPlan({ reps, followUps, estimates = [], now = new Date() }) {
  const jobs = new Map(estimates.map((row) => [row.id, row]));
  const byOwner = new Map();
  for (const row of followUps || []) {
    if (!isDueOrOverdue(row.due_at, now, row.status)) continue;
    if (!byOwner.has(row.owner_id)) byOwner.set(row.owner_id, []);
    const job = jobs.get(row.estimate_id) || row.estimates || {};
    byOwner.get(row.owner_id).push({
      id: row.id,
      customerName: job.customer_name || row.customer_name || 'Customer',
      total: job.total_amount ?? row.total_amount ?? 0,
      dueAt: row.due_at,
      bucket: dueBucket(row.due_at, now),
    });
  }
  const plans = [];
  for (const rep of reps || []) {
    const items = byOwner.get(rep.id) || [];
    if (!items.length) continue;
    const to = String(rep.email || '').trim().toLowerCase();
    if (!to || !to.includes('@')) continue;
    items.sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
    plans.push({ to, repName: rep.full_name || to, items });
  }
  return plans;
}

export function weeklyRecipients(env = {}) {
  const to = String(env.WEEKLY_REPORT_TO || DEFAULT_REPORT_TO).trim();
  const cc = String(env.WEEKLY_REPORT_CC || DEFAULT_REPORT_CC).trim();
  return { to, cc };
}

export function secretMatches(expected, got) {
  const a = String(expected || '');
  const b = String(got || '');
  if (!a || !b) return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i += 1) {
    const left = a.charCodeAt(i);
    const right = b.charCodeAt(i);
    diff |= (Number.isFinite(left) ? left : 0) ^ (Number.isFinite(right) ? right : 0);
  }
  return diff === 0;
}

export function hubspotAppointmentRows(meetings, profiles) {
  const byOwner = new Map();
  for (const profile of profiles || []) {
    const id = String(profile.hubspot_owner_id || '').trim();
    if (id) byOwner.set(id, profile);
  }
  const rows = [];
  const skipped = [];
  for (const meeting of meetings || []) {
    const meetingId = String(meeting?.id || '').trim();
    const props = meeting?.properties || {};
    const setAt = props.hs_meeting_start_time || meeting.set_at || '';
    if (!meetingId || !setAt) {
      skipped.push(meetingId || 'missing');
      continue;
    }
    const profile = byOwner.get(String(props.hubspot_owner_id || '').trim());
    if (!profile) {
      skipped.push(meetingId);
      continue;
    }
    rows.push({
      owner_id: profile.id,
      set_at: new Date(setAt).toISOString(),
      source: 'hubspot',
      hubspot_meeting_id: meetingId,
    });
  }
  return { rows, skipped };
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function shell(title, body) {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;background:#eef1f4;font-family:Helvetica,Arial,sans-serif;color:#14171a;">
  <div style="max-width:640px;margin:0 auto;padding:24px;">
    <div style="background:#0e4c92;color:#ffffff;padding:18px 22px;border-bottom:4px solid #f15a22;">
      <div style="font-size:22px;font-weight:700;">Noble Windows &amp; Doors</div>
      <div style="color:#d6e6f5;font-size:13px;margin-top:4px;">${esc(title)}</div>
    </div>
    <div style="background:#ffffff;padding:22px;line-height:1.5;">${body}</div>
  </div>
</body>
</html>`;
}

export function digestSubject(now = new Date()) {
  const day = formatPhoenix(now, { weekday: 'long', month: 'long', day: 'numeric' });
  return `Follow-ups for ${day}`;
}

export function buildDigestHtml({ repName, items, now = new Date() }) {
  const rows = (items || []).map((item) => {
    const when = formatPhoenix(item.dueAt, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const flag = item.bucket === 'overdue' ? 'Overdue' : 'Due today';
    return `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #d5dbe3;"><b>${esc(item.customerName)}</b><br><span style="color:#5c6770;">${esc(when)}</span></td>
      <td style="padding:8px 0;border-bottom:1px solid #d5dbe3;text-align:right;"><b>${esc(money(item.total))}</b><br><span style="color:#d94e1c;font-weight:700;">${flag}</span></td>
    </tr>`;
  }).join('');
  const body = `
    <p style="margin:0 0 12px;">Hello ${esc(repName || 'there')},</p>
    <p style="margin:0 0 12px;">These follow-ups are due today or overdue. Totals are the estimate total.</p>
    <table style="width:100%;border-collapse:collapse;">${rows}</table>
    <p style="margin:16px 0 0;color:#5c6770;font-size:13px;">This note goes only to you. Customers are not copied.</p>`;
  return shell(digestSubject(now), body);
}

export function weeklySubject(week) {
  return `Weekly sales report, ${formatWeek(week)}`;
}

function metricRow(label, value) {
  return `<tr><td style="padding:4px 0;color:#5c6770;">${esc(label)}</td><td style="padding:4px 0;text-align:right;font-weight:700;">${esc(value)}</td></tr>`;
}

export function buildWeeklyHtml({ week, reps }) {
  const blocks = (reps || []).map((rep) => {
    const stalled = (rep.stalled || []).length
      ? `<p style="margin:8px 0 0;"><b>Stalled</b></p><ul style="margin:4px 0 0;padding-left:18px;">${rep.stalled.map((deal) => `<li>${esc(deal.customerName)} · ${esc(money(deal.total))}</li>`).join('')}</ul>`
      : '<p style="margin:8px 0 0;color:#5c6770;">No stalled deals.</p>';
    return `<div style="border:1px solid #d5dbe3;border-radius:12px;padding:12px 14px;margin:0 0 12px;">
      <div style="font-weight:800;color:#0b1f3a;margin-bottom:6px;">${esc(rep.name)}</div>
      <table style="width:100%;border-collapse:collapse;">
        ${metricRow('Close rate', `${formatCloseRate(rep.closeRate)} (${rep.signed} signed, ${rep.lost} lost)`)}
        ${metricRow('Appointments set', String(rep.appointmentsSet))}
        ${metricRow('Appointments held', String(rep.appointmentsHeld))}
        ${metricRow('Follow-ups due', String(rep.followUpsDue))}
        ${metricRow('Follow-ups done', String(rep.followUpsDone))}
        ${metricRow('Follow-ups overdue', String(rep.followUpsOverdue))}
        ${metricRow('Pipeline', money(rep.pipelineValue))}
      </table>
      ${stalled}
    </div>`;
  }).join('');
  const body = `
    <p style="margin:0 0 12px;">Monday through Sunday, Phoenix time. Close rate is signed divided by signed plus lost. Overdue follow-ups were still open past their due time at the end of Sunday. Pipeline is the estimate total of presented jobs that were still open. Amounts are the estimate total.</p>
    ${blocks || '<p>No reps.</p>'}
    <p style="margin:16px 0 0;color:#5c6770;font-size:13px;">Sent to the manager and the chief of staff. Customers are not copied.</p>`;
  return shell(weeklySubject(week), body);
}
