// Sales-assistant dates, metrics, and mail. No network.
import { readFileSync } from 'node:fs';
import { addBusinessDays, followUpDue, resolveTaskOwner, shouldCreateFollowUp } from '../supabase/functions/hubspot-sync/followup.js';
import {
  buildDigestHtml, buildWeeklyHtml, buildWeeklyReport, closeRate, currentMonth, digestPlan, digestSubject,
  dueBucket, formatCloseRate, formatMonth, formatSyncedAgo, formatWeek, hubspotAppointmentRows, hubspotBodyAllowed,
  isDueOrOverdue, isOpenPresented, isOverdueAt, isStalledDeal, isUncontactedLead, lostDealNote, monthMetrics,
  secretMatches, stageToStatus, syncDecision, weekFromKey, weekKey, weekRange, weeklyRecipients,
} from '../supabase/functions/_shared/assistant.js';
import { hubspotSignatureOk } from '../supabase/functions/_shared/hubspot-sign.js';
import { buildHtmlRaw } from '../supabase/functions/_shared/outbound.js';

const fail = (msg) => { console.error('FAIL', msg); process.exitCode = 1; };
const eq = (actual, expected, msg) => {
  if (actual !== expected) fail(msg + ' — ' + JSON.stringify(actual) + ' !== ' + JSON.stringify(expected));
};
const has = (text, needle, msg) => {
  if (!String(text).includes(needle)) fail(msg + ' — missing ' + needle);
};
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

eq(addBusinessDays(new Date('2026-11-16T15:00:00.000Z'), 2).toISOString(), '2026-11-18T00:00:00.000Z', 'Monday plus two business days is Wednesday');
eq(followUpDue(new Date('2026-11-16T15:00:00.000Z'), 2), '2026-11-19T00:00:00.000Z', 'Monday lands at Wednesday 5pm Phoenix');
eq(followUpDue(new Date('2026-11-13T15:00:00.000Z'), 2), '2026-11-18T00:00:00.000Z', 'Friday skips the weekend to Tuesday 5pm Phoenix');
eq(addBusinessDays(new Date('2026-11-14T15:00:00.000Z'), 1).toISOString().slice(0, 10), '2026-11-16', 'Saturday starts the count on Monday');

const mondayMorning = new Date('2026-11-16T14:00:00.000Z');
const prior = weekRange(mondayMorning);
eq(prior.start.toISOString(), '2026-11-09T07:00:00.000Z', 'Monday 7am Phoenix reports the prior Monday');
eq(prior.end.toISOString(), '2026-11-16T07:00:00.000Z', 'the week ends at the next Monday midnight Phoenix');
eq(formatWeek(prior), 'Nov 9, 2026 – Nov 15, 2026', 'week label is Monday through Sunday');
const sundayNight = weekRange(new Date('2026-11-16T03:00:00.000Z'));
eq(sundayNight.start.toISOString(), '2026-11-02T07:00:00.000Z', 'Sunday evening is still inside its own week');
eq(weekKey(prior), '2026-11-09', 'week key is the Phoenix Monday');
eq(weekFromKey('2026-11-11').start.toISOString(), '2026-11-09T07:00:00.000Z', 'a mid-week key snaps back to Monday');

eq(resolveTaskOwner({ hubspotOwnerId: ' 99 ', owners: [{ id: '1', email: 'eric@noblewandd.com' }], email: 'eric@noblewandd.com' }).ownerId, '99', 'stored HubSpot owner id wins');
eq(resolveTaskOwner({ hubspotOwnerId: ' 99 ', owners: [{ id: '1', email: 'eric@noblewandd.com' }], email: 'eric@noblewandd.com' }).source, 'profile', 'profile is the source when the id is set');
eq(resolveTaskOwner({ hubspotOwnerId: '', owners: [{ id: '1', email: 'Eric@NobleWANDD.com' }], email: 'eric@noblewandd.com' }).ownerId, '1', 'blank id falls back to the email match');
eq(resolveTaskOwner({ hubspotOwnerId: ' ', owners: [], email: 'eric@noblewandd.com' }).ownerId, null, 'no match leaves the task unassigned');
eq(shouldCreateFollowUp(null), true, 'no follow-up means create one');
eq(shouldCreateFollowUp({ status: 'open', hubspot_task_id: '55' }), false, 'an open task is not duplicated');
eq(shouldCreateFollowUp({ status: 'open', hubspot_task_id: '' }), true, 'an open row without a task id is filled in');
eq(shouldCreateFollowUp({ status: 'done', hubspot_task_id: '55' }), true, 'a finished follow-up does not block a new one');

const now = new Date('2026-11-17T16:00:00.000Z');
eq(dueBucket('2026-11-18T00:00:00.000Z', now), 'today', 'Tuesday 5pm Phoenix is due today');
eq(dueBucket('2026-11-17T00:00:00.000Z', now), 'overdue', 'Monday 5pm Phoenix is overdue on Tuesday');
eq(dueBucket('2026-11-19T00:00:00.000Z', now), 'later', 'Wednesday 5pm Phoenix is not in the badge');
eq(isDueOrOverdue('2026-11-18T00:00:00.000Z', now, 'done'), false, 'a finished task is not in the badge');

const week = prior;
const asOf = week.end;
const eric = { id: 'eric', full_name: 'Eric Havins', email: 'eric@noblewandd.com', role: 'sales', hubspot_owner_id: '' };
const source = {
  reps: [eric, { id: 'nick', full_name: 'Nicholas Sommer', email: 'mgr@noblewandd.com', role: 'admin' }],
  estimates: [
    { id: 'e1', owner_id: 'eric', customer_name: 'Ada', customer_email: 'ada@example.com', status: 'signed', total_amount: 1000, presented_at: '2026-11-10T18:00:00.000Z', signed_at: '2026-11-12T18:00:00.000Z', updated_at: '2026-11-12T18:00:00.000Z' },
    { id: 'e2', owner_id: 'eric', customer_name: 'Bea', customer_email: 'bea@example.com', status: 'lost', total_amount: 500, presented_at: '2026-11-10T18:00:00.000Z', lost_at: '2026-11-13T18:00:00.000Z', updated_at: '2026-11-13T18:00:00.000Z' },
    { id: 'e3', owner_id: 'eric', customer_name: 'Cam', status: 'presented', total_amount: 2000, presented_at: '2026-11-01T18:00:00.000Z', updated_at: '2026-11-01T18:00:00.000Z', created_at: '2026-11-01T18:00:00.000Z' },
    { id: 'e4', owner_id: 'eric', customer_name: 'Dee', status: 'presented', total_amount: 3000, presented_at: '2026-11-14T18:00:00.000Z', updated_at: '2026-11-15T18:00:00.000Z', created_at: '2026-11-14T18:00:00.000Z' },
    { id: 'e5', owner_id: 'eric', customer_name: 'Gone', status: 'presented', total_amount: 9000, presented_at: '2026-11-02T18:00:00.000Z', updated_at: '2026-11-02T18:00:00.000Z', deleted_at: '2026-11-03T18:00:00.000Z' },
  ],
  followUps: [
    { id: 'f1', owner_id: 'eric', estimate_id: 'e4', due_at: '2026-11-12T00:00:00.000Z', status: 'done', completed_at: '2026-11-12T18:00:00.000Z', created_at: '2026-11-10T18:00:00.000Z', updated_at: '2026-11-12T18:00:00.000Z' },
    { id: 'f2', owner_id: 'eric', estimate_id: 'e3', due_at: '2026-11-05T00:00:00.000Z', status: 'open', created_at: '2026-11-01T18:00:00.000Z', updated_at: '2026-11-01T18:00:00.000Z' },
    { id: 'f3', owner_id: 'eric', estimate_id: 'e4', due_at: '2026-11-14T00:00:00.000Z', status: 'open', created_at: '2026-11-12T18:00:00.000Z', updated_at: '2026-11-12T18:00:00.000Z' },
  ],
  appointments: [
    { owner_id: 'eric', estimate_id: 'e4', set_at: '2026-11-10T18:00:00.000Z', source: 'app' },
    { owner_id: 'eric', estimate_id: 'e1', set_at: '2026-11-11T18:00:00.000Z', source: 'hubspot' },
    { owner_id: 'eric', estimate_id: 'e3', set_at: '2026-11-02T18:00:00.000Z', source: 'app' },
  ],
  activity: [],
};
const report = buildWeeklyReport(source, week);
const row = report.reps.find((rep) => rep.id === 'eric');
eq(report.reps.some((rep) => rep.id === 'nick'), false, 'an admin with no jobs is left out of the report');
eq(row.signed, 1, 'one signed job that week');
eq(row.lost, 1, 'one lost job that week');
eq(row.closeRate, 0.5, 'close rate is signed divided by signed plus lost');
eq(formatCloseRate(row.closeRate), '50%', 'close rate is a percent');
eq(formatCloseRate(closeRate(0, 0)), '—', 'no signed or lost jobs has no rate');
eq(row.appointmentsSet, 2, 'appointments set counts the app and HubSpot');
eq(row.appointmentsHeld, 3, 'held counts estimates marked presented that week');
eq(row.followUpsDue, 2, 'due counts follow-ups whose due time is in the week');
eq(row.followUpsDone, 1, 'done counts follow-ups completed in the week');
eq(row.followUpsOverdue, 2, 'overdue means still open past due at the end of Sunday');
eq(row.pipelineValue, 5000, 'pipeline is the estimate total of open presented jobs');
eq(row.stalled.length, 1, 'one deal has had no activity for 7 days');
eq(row.stalled[0].customerName, 'Cam', 'the stalled deal is the quiet presented job');
eq(row.stalled[0].total, 2000, 'stalled amount is the estimate total');

eq(isStalledDeal(
  { presented_at: '2026-11-01T18:00:00.000Z', status: 'presented' },
  ['2026-11-09T07:00:00.000Z'],
  asOf,
), true, 'exactly 7 days without activity is stalled');
eq(isStalledDeal(
  { presented_at: '2026-11-01T18:00:00.000Z', status: 'presented' },
  ['2026-11-09T07:00:00.001Z'],
  asOf,
), false, 'activity inside the 7 days is not stalled');
eq(isStalledDeal(
  { presented_at: '2026-11-01T18:00:00.000Z', signed_at: '2026-11-10T18:00:00.000Z' },
  ['2026-10-01T18:00:00.000Z'],
  asOf,
), false, 'a signed job is not a stalled presented deal');
eq(isStalledDeal(
  { presented_at: '2026-11-01T18:00:00.000Z', lost_at: '2026-11-10T18:00:00.000Z' },
  ['2026-10-01T18:00:00.000Z'],
  asOf,
), false, 'a lost job is not stalled');
eq(isOpenPresented({ presented_at: '2026-11-20T18:00:00.000Z' }, asOf), false, 'a job presented after Sunday is not in that pipeline');
eq(isOverdueAt({ due_at: '2026-11-14T00:00:00.000Z', status: 'done', completed_at: '2026-11-14T18:00:00.000Z', created_at: '2026-11-12T18:00:00.000Z' }, asOf), false, 'a task completed before Sunday is not overdue');
eq(isOverdueAt({ due_at: '2026-11-14T00:00:00.000Z', status: 'done', completed_at: '2026-11-16T18:00:00.000Z', created_at: '2026-11-12T18:00:00.000Z' }, asOf), true, 'a task completed after Sunday was still overdue at Sunday');

const plans = digestPlan({
  reps: [eric],
  followUps: [
    { id: 'open', owner_id: 'eric', estimate_id: 'e1', due_at: '2026-11-18T00:00:00.000Z', status: 'open', estimates: { customer_name: 'Ada', total_amount: 1000 } },
  ],
  estimates: source.estimates,
  now,
});
eq(plans.length, 1, 'a rep with a due follow-up gets one digest');
eq(plans[0].to, 'eric@noblewandd.com', 'the digest goes to the rep');
eq(plans.some((plan) => plan.to === 'ada@example.com' || plan.to === 'bea@example.com'), false, 'the digest never uses a customer address');
const digestHtml = buildDigestHtml({ repName: plans[0].repName, items: plans[0].items, now });
has(digestHtml, 'Ada', 'digest names the customer');
has(digestHtml, '$1,000.00', 'digest shows the estimate total');
eq(/margin/i.test(digestHtml.replace(/style="[^"]*"/g, '')), false, 'digest does not mention margin');
const digestRaw = buildHtmlRaw({ to: plans[0].to, subject: digestSubject(now), html: digestHtml });
has(digestRaw, 'To: eric@noblewandd.com', 'digest envelope is the rep');
eq(digestRaw.includes('ada@example.com'), false, 'customer email is not in the digest');

const weeklyHtml = buildWeeklyHtml(report);
eq(/margin/i.test(weeklyHtml.replace(/style="[^"]*"/g, '')), false, 'weekly report does not mention margin');
has(weeklyHtml, 'Cam', 'weekly report names the stalled customer');
has(weeklyHtml, '$5,000.00', 'weekly pipeline is the estimate total');
has(weeklyHtml, '50%', 'weekly close rate is shown');
const recipients = weeklyRecipients({});
eq(recipients.to, 'mgr@noblewandd.com', 'weekly report defaults to Nick');
eq(recipients.cc, 'noblenicksbot@mail.grokbot.com', 'weekly report defaults to the chief of staff');
eq(weeklyRecipients({ WEEKLY_REPORT_TO: 'nick@example.com', WEEKLY_REPORT_CC: 'cos@example.com' }).to, 'nick@example.com', 'weekly recipient can be changed with env');
const weeklyRaw = buildHtmlRaw({ to: recipients.to, cc: recipients.cc, subject: 'Weekly', html: weeklyHtml });
has(weeklyRaw, 'To: mgr@noblewandd.com', 'weekly envelope To');
has(weeklyRaw, 'Cc: noblenicksbot@mail.grokbot.com', 'weekly envelope Cc');
eq(weeklyRaw.includes('ada@example.com'), false, 'customer email is not in the weekly report');

const meetings = hubspotAppointmentRows([
  { id: 'm1', properties: { hs_meeting_start_time: '2026-11-11T18:00:00.000Z', hubspot_owner_id: '55' } },
  { id: 'm2', properties: { hs_meeting_start_time: '2026-11-11T18:00:00.000Z', hubspot_owner_id: 'missing' } },
], [{ id: 'eric', hubspot_owner_id: '55' }]);
eq(meetings.rows.length, 1, 'a HubSpot meeting is kept when the owner id matches a rep');
eq(meetings.rows[0].source, 'hubspot', 'ingested appointments are marked HubSpot');
eq(meetings.skipped.length, 1, 'an unmatched HubSpot owner is skipped');

eq(secretMatches('abc', 'abc'), true, 'matching cron secret');
eq(secretMatches('abc', 'abd'), false, 'wrong cron secret');
eq(secretMatches('', 'abc'), false, 'a missing cron secret rejects the call');

const sql = read('../supabase/migrations/005_sales_assistant.sql');
for (const needle of ['follow_ups', 'appointments', 'hubspot_owner_id', 'assistant_audit', 'lost_at', "source in ('app', 'hubspot')", "status in ('open', 'done', 'canceled')", 'admin_set_hubspot_owner', 'is_admin()', 'not set']) {
  has(sql, needle, 'sales assistant migration');
}
eq(/pat-|sk_live|CRON_SECRET\s*=|HUBSPOT_TOKEN\s*=|eyJ/.test(sql), false, 'migration has no secrets');
const schedule = read('../supabase/schedule/pg_cron_sales_assistant.sql');
has(schedule, '0 14 * * *', 'daily digest is 7am Phoenix');
has(schedule, '0 14 * * 1', 'weekly report is Monday 7am Phoenix');
has(schedule, 'x-cron-secret', 'schedule sends the cron header');
eq(/supabase\/migrations\/005_pg_cron/.test(schedule), false, 'schedule file is not a migration');
eq(sql.includes('cron.schedule'), false, 'the schema migration does not schedule cron');
const digestFn = read('../supabase/functions/daily-digest/index.ts');
eq(digestFn.includes('customer_email'), false, 'daily digest code does not read customer emails');
has(digestFn, 'CRON_SECRET', 'daily digest reads the cron secret from the environment');
has(digestFn, 'x-cron-secret', 'daily digest checks the cron header');
const weeklyFn = read('../supabase/functions/weekly-report/index.ts');
has(weeklyFn, 'weeklyRecipients', 'weekly report uses the configured addresses');
has(weeklyFn, 'HUBSPOT_TOKEN', 'weekly report can read HubSpot meetings when the token is set');
const config = read('../supabase/config.toml');
has(config, '[functions.daily-digest]\nverify_jwt = false', 'daily digest JWT is off');
has(config, '[functions.weekly-report]\nverify_jwt = false', 'weekly report JWT is off');
const hub = read('../supabase/functions/hubspot-sync/index.ts');
for (const needle of ['closedlost', 'assistant_audit', 'follow_ups', 'resolveTaskOwner', 'task.complete', 'deal.lost']) {
  has(hub, needle, 'hubspot sync');
}
const beforePull = hub.split("payload.action === 'pull'")[0];
const salesProfile = beforePull.slice(beforePull.lastIndexOf(".from('profiles').select("));
has(salesProfile, "select('id, role, email, full_name, hubspot_owner_id')", 'a sales pull uses the signed-in profile id');
const adminPull = hub.split("payload.action === 'pull'")[1].split('pullHubspot')[0];
has(adminPull, "select('id, full_name, email, role, hubspot_owner_id')", 'an admin pull selects every profile id');
const page = read('../js/pages/estimate.js');
has(page, "id: 'btn-lost'", 'presented estimates have a Lost button');
has(page, 'lostConfirm', 'Lost opens a confirm step');
has(read('../js/pages/lost.js'), "id: 'lost-confirm'", 'Lost confirm dialog');
const accounts = read('../js/pages/accounts.js');
has(accounts, 'hubspot-owner-', 'Accounts has the HubSpot owner field');
has(accounts, 'not set', 'a blank HubSpot owner id shows not set');
eq(accounts.includes('Mike'), false, 'Accounts does not mention Mike');
const nav = read('../js/app.js');
has(nav, 'followup-badge', 'the nav has the follow-up badge');
const sw = read('../sw.js');
has(sw, "const CACHE = 'nwd-sales-v77-andersen-100'", 'service worker cache was bumped');
has(sw, 'js/ax650.js', 'AX650 stays precached');
has(sw, 'js/vendor/supabase-js-2.119.0.mjs', 'vendored supabase-js stays precached');

const november = currentMonth(new Date('2026-11-17T16:00:00.000Z'));
eq(formatMonth(november), 'November 2026', 'current Phoenix month');
eq(november.start.toISOString(), '2026-11-01T07:00:00.000Z', 'November starts at midnight Phoenix');
const dash = monthMetrics({
  ownerId: 'eric',
  month: november,
  estimates: [
    { id: 'w', owner_id: 'eric', customer_name: 'Ada Cole', status: 'won', total_amount: 5000, won_at: '2026-11-12T18:00:00.000Z', presented_at: '2026-11-02T18:00:00.000Z' },
    { id: 's', owner_id: 'eric', customer_name: 'Signed Job', status: 'signed', total_amount: 1000, signed_at: '2026-11-20T18:00:00.000Z', presented_at: '2026-11-03T18:00:00.000Z' },
    { id: 'l', owner_id: 'eric', customer_name: 'Bea Ortiz', status: 'lost', total_amount: 2000, lost_at: '2026-11-18T18:00:00.000Z', presented_at: '2026-11-04T18:00:00.000Z' },
    { id: 'p', owner_id: 'eric', customer_name: 'Open Job', status: 'presented', total_amount: 9000, presented_at: '2026-10-02T18:00:00.000Z' },
    { id: 'gone', owner_id: 'eric', customer_name: 'Deleted', status: 'won', total_amount: 99999, won_at: '2026-11-08T18:00:00.000Z', deleted_at: '2026-11-09T18:00:00.000Z' },
  ],
  appointments: [
    { owner_id: 'eric', set_at: '2026-11-05T18:00:00.000Z', source: 'app' },
    { owner_id: 'eric', set_at: '2026-11-06T18:00:00.000Z', source: 'hubspot' },
    { owner_id: 'eric', set_at: '2026-10-06T18:00:00.000Z', source: 'app' },
  ],
});
eq(dash.appointmentsSet, 2, 'appointments set this month');
eq(dash.appointmentsHeld, 3, 'appointments held are estimates presented this month');
eq(dash.presented, 3, 'estimates presented this month');
eq(dash.wonCount, 2, 'won count includes the Won button and a signed job');
eq(dash.wonDollars, 6000, 'won dollars');
eq(dash.lostCount, 1, 'lost count');
eq(dash.lostDollars, 2000, 'lost dollars');
eq(dash.closeRate, 2 / 3, 'close rate is won divided by won plus lost');
eq(dash.pipeline, 9000, 'open pipeline is current and ignores the month and deleted rows');
eq(dash.invalidCount, 0, 'a month with no invalid leads counts zero');
const withInvalid = monthMetrics({
  ownerId: 'eric',
  month: november,
  estimates: [
    ...[
      { id: 'w', owner_id: 'eric', customer_name: 'Ada Cole', status: 'won', total_amount: 5000, won_at: '2026-11-12T18:00:00.000Z', presented_at: '2026-11-02T18:00:00.000Z' },
      { id: 's', owner_id: 'eric', customer_name: 'Signed Job', status: 'signed', total_amount: 1000, signed_at: '2026-11-20T18:00:00.000Z', presented_at: '2026-11-03T18:00:00.000Z' },
      { id: 'l', owner_id: 'eric', customer_name: 'Bea Ortiz', status: 'lost', total_amount: 2000, lost_at: '2026-11-18T18:00:00.000Z', presented_at: '2026-11-04T18:00:00.000Z' },
      { id: 'p', owner_id: 'eric', customer_name: 'Open Job', status: 'presented', total_amount: 9000, presented_at: '2026-10-02T18:00:00.000Z' },
    ],
    { id: 'spam-est', owner_id: 'eric', customer_name: 'Spam', status: 'lost', total_amount: 4000, lost_at: '2026-11-18T18:00:00.000Z', presented_at: '2026-11-04T18:00:00.000Z' },
  ],
  appointments: [
    { owner_id: 'eric', estimate_id: 'spam-est', set_at: '2026-11-05T18:00:00.000Z', source: 'app' },
    { owner_id: 'eric', set_at: '2026-11-06T18:00:00.000Z', source: 'hubspot' },
  ],
  leads: [
    { id: 'spam-lead', owner_id: 'eric', stage: 'invalid', estimate_id: 'spam-est' },
    { id: 'other', owner_id: 'nick', stage: 'invalid', estimate_id: 'nope' },
  ],
});
eq(withInvalid.lostCount, 1, 'an invalid lead is not a lost job');
eq(withInvalid.lostDollars, 2000, 'invalid dollars stay out of lost');
eq(withInvalid.closeRate, 2 / 3, 'close rate ignores the invalid lead');
eq(withInvalid.appointmentsSet, 1, 'an appointment on an invalid lead is not counted');
eq(withInvalid.invalidCount, 1, 'invalid count is the rep’s own invalid leads');
eq(withInvalid.pipeline, 9000, 'an invalid lead is not pipeline');
const invalidDigest = digestPlan({
  reps: [eric],
  followUps: [
    { id: 'keep', owner_id: 'eric', estimate_id: 'e1', due_at: '2026-11-18T00:00:00.000Z', status: 'open', estimates: { customer_name: 'Ada', total_amount: 1000 } },
    { id: 'drop', owner_id: 'eric', estimate_id: 'spam-est', due_at: '2026-11-18T00:00:00.000Z', status: 'open', estimates: { customer_name: 'Spam', total_amount: 4000 } },
  ],
  leads: [{ id: 'spam-lead', stage: 'invalid', estimate_id: 'spam-est' }],
  now,
});
eq(invalidDigest[0].items.length, 1, 'a digest skips a follow-up on an invalid lead');
eq(invalidDigest[0].items[0].customerName, 'Ada', 'the real follow-up stays in the digest');
eq(formatSyncedAgo(new Date(Date.now() - 3 * 60 * 1000).toISOString(), new Date()), 'Synced 3 min ago', 'sync label');

const note = lostDealNote({
  repName: 'Eric Havins',
  presentedAt: '2026-11-14T19:00:00.000Z',
  total: 8888.33,
  lines: [
    { series: 'V250', qty: 2, unit: 1600 },
    { series: '100', qty: 4, lineTotal: 5688.33 },
  ],
});
eq(note, [
  'Lost estimate',
  'Rep: Eric Havins',
  'Presented: Nov 14, 2026',
  'Total: $8,888.33',
  '',
  'Lines:',
  '- V250 · qty 2 · $3,200.00',
  '- 100 · qty 4 · $5,688.33',
].join('\n'), 'lost HubSpot note');
eq(/margin|cost|profit/i.test(note), false, 'lost note has no margin or cost');
eq(hubspotBodyAllowed({ properties: { dealstage: 'closedlost', amount: '8888.33' } }), true, 'selling amount is allowed');
eq(hubspotBodyAllowed({ properties: { gross_margin: '40' } }), false, 'margin fields are refused');
eq(syncDecision({ appUpdatedAt: '2026-11-10T00:00:00Z', hubspotUpdatedAt: '2026-11-11T00:00:00Z', lastSyncedAt: '2026-11-01T00:00:00Z' }), 'conflict', 'both sides changed since the last sync');
eq(syncDecision({ appUpdatedAt: '2026-10-01T00:00:00Z', hubspotUpdatedAt: '2026-11-11T00:00:00Z', lastSyncedAt: '2026-11-01T00:00:00Z' }), 'take-hubspot', 'only HubSpot changed');
eq(stageToStatus('Closed Won', 'closedwon'), 'won', 'Closed Won maps to won');
eq(stageToStatus('Closed Lost', 'closedlost'), 'lost', 'Closed Lost maps to lost');
eq(isUncontactedLead({ hubspot_owner_id: '55', closed: false, engagements: { calls: 0, emails: 0, notes: 0, meetings: 0 } }, '55'), true, 'no call, email, note, or meeting is uncontacted');
eq(isUncontactedLead({ hubspot_owner_id: '55', closed: false, engagements: { calls: 1, emails: 0, notes: 0, meetings: 0 } }, '55'), false, 'a logged call is contacted');
eq(isUncontactedLead({ hubspot_owner_id: '55', closed: false, engagements: {} }, ''), false, 'a blank owner id matches nothing');
const signed = await hubspotSignatureOk({
  method: 'POST',
  uri: 'https://example.test/functions/v1/hubspot-webhook',
  body: '[]',
  timestamp: '1700000000000',
  signature: 'nope',
  secret: 'client-secret',
  now: 1700000000000,
});
eq(signed, false, 'a bad webhook signature is rejected');
has(read('../supabase/functions/hubspot-webhook/index.ts'), 'x-hubspot-signature-v3', 'webhook requires the HubSpot signature');
has(read('../supabase/migrations/006_sales_dashboard.sql'), 'only admin can open the team dashboard', 'team dashboard is admin only in the database');
has(read('../supabase/migrations/006_sales_dashboard.sql'), 'only the owner or an admin can delete an estimate', 'delete is owner or admin');
has(read('../js/pages/lost.js'), "Delete this estimate? This can't be undone.", 'delete confirm copy');
has(read('../js/cloud.js'), 'Do not call HubSpot', 'delete does not call HubSpot');

if (process.exitCode) console.error('assistant check failed');
else console.log('assistant check ok');
