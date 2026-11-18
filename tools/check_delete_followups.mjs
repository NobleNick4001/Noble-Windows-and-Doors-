// Soft-delete RPC, follow-up creation, and the Follow-ups refresh. No network.
import { readFileSync, readdirSync } from 'node:fs';
import {
  followUpDue, followUpNoteFromInteraction, planFollowUpBackfill, presentedFollowUpNote,
} from '../supabase/functions/hubspot-sync/followup.js';

const fail = (msg) => { console.error('FAIL', msg); process.exitCode = 1; };
const eq = (actual, expected, msg) => {
  if (actual !== expected) fail(msg + ' — ' + JSON.stringify(actual) + ' !== ' + JSON.stringify(expected));
};
const has = (text, needle, msg) => {
  if (!String(text).includes(needle)) fail(msg + ' — missing ' + needle);
};
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const cloud = read('../js/cloud.js');
const page = read('../js/pages/estimate.js');
const followups = read('../js/pages/followups.js');
const hub = read('../supabase/functions/hubspot-sync/index.ts');
const backfillJs = read('../supabase/functions/hubspot-sync/backfill-followups.js');
const migration = read('../supabase/migrations/007_soft_delete_and_follow_ups.sql');
const backfillSql = read('../supabase/backfill_presented_follow_ups.sql');
const migrationNames = readdirSync(new URL('../supabase/migrations/', import.meta.url));

has(cloud, "rpc('soft_delete_estimate'", 'delete calls the soft-delete RPC');
has(cloud, 'p_id: item.remoteId', 'RPC receives the estimate id');
eq(cloud.includes(".from('estimates').update({ deleted_at:"), false, 'delete no longer PATCHes deleted_at');
has(cloud, "Couldn't delete this estimate. It is back in your list.", 'a failed delete says the estimate is back');
has(cloud, 'restoreDeleted(item.remoteId)', 'a failed delete puts the row back');
has(cloud, 'nwd.deletedRemoteIds', 'deleted ids are remembered so a later sync cannot restore them');
has(cloud, 'gone.has(row.id)', 'pull skips a deleted estimate');
has(page, 'delete-error', 'the estimate list can show the delete error');
has(page, 'nwd-delete-failed', 'the list listens for a failed delete');

has(migration, 'create or replace function public.soft_delete_estimate(p_id uuid)', 'migration defines the RPC');
has(migration, 'security definer', 'the RPC bypasses the select policy');
has(migration, 'set search_path = public', 'search_path is fixed');
has(migration, 'public.is_allowed()', 'the RPC checks the allowlist');
has(migration, 'auth.uid()', 'the RPC checks the owner');
has(migration, 'public.is_admin()', 'an admin can delete');
has(migration, 'set deleted_at = now()', 'the RPC sets deleted_at');
has(migration, 'revoke all on function public.soft_delete_estimate(uuid) from public, anon;', 'anon cannot call the RPC');
has(migration, 'grant execute on function public.soft_delete_estimate(uuid) to authenticated;', 'signed-in users can call the RPC');
has(migration, 'estimates_presented_follow_up', 'presenting an estimate schedules a follow-up');
has(migration, 'on conflict (estimate_id) where status = ' + "'open' do nothing", 'one open follow-up per estimate');
has(migration, 'add column if not exists note text', 'follow-ups can store a note');
has(migration, 'create policy fu_ins on public.follow_ups', 'the owner has an insert policy');
has(migration, 'owner_id = auth.uid()', 'the insert policy allows the owner');
has(migration, 'grant insert on public.follow_ups to authenticated;', 'authenticated can insert a follow-up');
eq(/pat-|sk_live|service_role key|eyJ/.test(migration), false, 'migration has no secrets');
eq(migrationNames.some((name) => name.startsWith('backfill_')), false, 'the backfill is not a migration');

has(backfillSql, "e.status = 'presented'", 'backfill keeps presented estimates');
has(backfillSql, 'e.deleted_at is null', 'backfill skips deleted estimates');
has(backfillSql, 'e.won_at is null', 'backfill skips won estimates');
has(backfillSql, 'e.lost_at is null', 'backfill skips lost estimates');
has(backfillSql, "f.status = 'open'", 'backfill does not add a second open follow-up');
has(backfillSql, 'public.follow_up_due(now())', 'backfill uses the two-business-day rule');
has(backfillSql, 'NOT a migration', 'backfill file says it is not a migration');
eq(/api\.hubapi\.com|HUBSPOT_TOKEN/.test(backfillSql), false, 'the SQL backfill does not call HubSpot');

has(hub, "payload.action === 'backfill-followups'", 'hubspot-sync has a follow-up backfill step');
has(hub, 'profile?.role === \'admin\'', 'backfill uses the same admin check as pull');
has(hub, 'presentedFollowUpNote(estimate)', 'a HubSpot present still stores the estimate note');
has(backfillJs, 'readLatestEngagement', 'backfill reads the latest HubSpot engagement');
has(backfillJs, "name: 'notes'", 'notes are one engagement type');
has(backfillJs, "name: 'calls'", 'calls are one engagement type');
has(backfillJs, "name: 'emails'", 'emails are one engagement type');
has(backfillJs, '/associations/${kind.name}', 'engagements are read from HubSpot associations');
eq(/method:\s*['"]POST['"]|method:\s*['"]PATCH['"]|method:\s*['"]PUT['"]/.test(backfillJs), false, 'the backfill step does not write to HubSpot');

has(followups, 'syncFromHubspot()', 'Follow-ups Refresh runs the Sales HubSpot sync');
has(followups, 'Refreshing…', 'Refresh shows a busy state');
has(followups, 'followups-refresh', 'the refresh button stays');
has(followups, 'Updated just now · ${count} ${noun}', 'Refresh reports how many follow-ups are open');
has(followups, 'No follow-ups due. Mark an estimate Presented to schedule one.', 'empty follow-ups explain how one is scheduled');
has(followups, 'followup-note-', 'a follow-up card shows its note');
has(followups, 'followups-error', 'a sync failure is shown');

const presented = {
  id: 'e1',
  owner_id: 'rep',
  status: 'presented',
  total_amount: 4280,
  presented_at: '2026-11-18T15:00:00.000Z',
  document: { notes: 'White frames on the front of the house.' },
};
eq(
  presentedFollowUpNote(presented),
  'Presented $4,280.00 estimate on Nov 18, 2026\nWhite frames on the front of the house.',
  'a new present note includes the total, the date, and the estimate notes',
);
eq(presentedFollowUpNote({ total_amount: 0, presented_at: '2026-11-18T15:00:00.000Z' }), 'Presented $0.00 estimate on Nov 18, 2026', 'blank notes stay off the line');
eq(followUpDue(new Date('2026-11-16T15:00:00.000Z'), 2), '2026-11-19T00:00:00.000Z', 'due date is still two business days at 5pm Phoenix');

const call = { body: 'Called Avery. They will decide tomorrow.', at: '2026-11-18T20:00:00.000Z' };
eq(
  followUpNoteFromInteraction({ estimate: presented, engagement: call }),
  call.body,
  'a later call replaces the present note',
);
eq(
  followUpNoteFromInteraction({ estimate: presented, engagement: { body: 'Older email', at: '2026-11-17T15:00:00.000Z' } }),
  presentedFollowUpNote(presented),
  'an older email does not replace the present note',
);

const plans = planFollowUpBackfill({
  estimates: [
    presented,
    { id: 'won', owner_id: 'rep', status: 'won', won_at: '2026-11-18T18:00:00.000Z' },
    { id: 'lost', owner_id: 'rep', status: 'lost', lost_at: '2026-11-18T18:00:00.000Z' },
    { id: 'gone', owner_id: 'rep', status: 'presented', deleted_at: '2026-11-18T18:00:00.000Z' },
    { id: 'has', owner_id: 'rep', status: 'presented', total_amount: 10, presented_at: '2026-11-18T15:00:00.000Z', document: { notes: '' } },
  ],
  openFollowUps: [{ id: 'f-has', estimate_id: 'has', status: 'open', note: 'Presented $10.00 estimate on Nov 18, 2026' }],
  engagementByEstimateId: { e1: call },
});
eq(plans.length, 1, 'only the presented estimate without an open follow-up is scheduled');
eq(plans[0].action, 'insert', 'the missing follow-up is an insert');
eq(plans[0].estimateId, 'e1', 'the insert is the presented estimate');
eq(plans[0].note, call.body, 'the insert uses the latest call');

const refreshNote = planFollowUpBackfill({
  estimates: [presented],
  openFollowUps: [{ id: 'f1', estimate_id: 'e1', status: 'open', note: 'old' }],
  engagementByEstimateId: { e1: call },
});
eq(refreshNote.length, 1, 'an open follow-up with a stale note is updated');
eq(refreshNote[0].action, 'update', 'the stale note is an update, not a second row');
eq(refreshNote[0].note, call.body, 'the update stores the latest call');

if (process.exitCode) console.error('delete follow-up check failed');
else console.log('delete follow-up check ok');
