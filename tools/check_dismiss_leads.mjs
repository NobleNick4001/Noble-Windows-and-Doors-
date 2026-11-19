// Dismissed leads stay out of the lists, the pull, the cleanup, and the lead counts.
// Run: node tools/check_dismiss_leads.mjs
import { readFileSync } from 'node:fs';
import { leadUpsertPlan } from '../supabase/functions/_shared/lead-upsert.js';
import { normalizeDismissReason } from '../supabase/functions/_shared/lead-dismiss.js';
import { mineAttentionTotal } from '../js/attention.js';

const fail = (msg) => { console.error('FAIL', msg); process.exitCode = 1; };
const eq = (actual, expected, msg) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(msg + ' — ' + JSON.stringify(actual));
};
const has = (text, needle, msg) => {
  if (!String(text).includes(needle)) fail(msg + ' — missing ' + needle);
};
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

eq(normalizeDismissReason(''), '', 'a blank dismiss reason is allowed');
eq(normalizeDismissReason('Already assigned in HubSpot'), 'Already assigned in HubSpot', 'the HubSpot reason is allowed');
eq(normalizeDismissReason('Already handled'), 'Already handled', 'the handled reason is allowed');
eq(normalizeDismissReason('Other'), 'Other', 'Other is allowed');
eq(normalizeDismissReason('Spam/fake'), null, 'an invalid-lead reason is not a dismiss reason');

const skipped = leadUpsertPlan({
  id: 'lead-9', owner_id: null, stage: 'dismissed', hubspot_contact_id: 'c1', hubspot_deal_id: 'd9',
}, { hubspot_contact_id: 'c1', hubspot_deal_id: 'd9', name: 'Again' }, '2026-11-19T15:00:00.000Z');
eq(skipped, { action: 'skip' }, 'a dismissed HubSpot id is not inserted again');

eq(mineAttentionTotal(2, 3), 5, 'the Mine bubble is new leads plus follow-ups due');
eq(mineAttentionTotal(0, 0), 0, 'a zero total hides the Mine bubble');
eq(mineAttentionTotal(1, 0), 1, 'follow-ups at zero leave only the new-lead count');

const sql = read('../supabase/migrations/012_dismiss_leads.sql');
const page = read('../js/pages/leads.js');
const cloud = read('../js/cloud.js');
const cleanup = read('../supabase/maintenance/lead_cleanup_30d.sql');
const app = read('../js/app.js');
const tabs = read('../js/mine-tabs.js');
const more = read('../js/pages/more.js');
has(sql, 'create or replace function public.lead_dismiss(p_id uuid, p_reason text)', '012 defines the RPC');
has(sql, 'if not public.is_admin()', 'dismiss checks profiles.role = admin through is_admin');
has(sql, 'only an admin can dismiss a lead', 'a sales rep gets a clear error');
has(sql, 'only an unassigned lead can be dismissed', 'an assigned lead cannot be dismissed');
has(sql, "'dismissed'", 'stage dismissed is stored');
has(sql, 'a dismissed lead stays dismissed', 'a later update cannot put it back');
has(sql, 'grant execute on function public.lead_dismiss(uuid, text) to authenticated', 'signed-in users can call the RPC');
has(sql, 'revoke all on function public.lead_dismiss(uuid, text) from public, anon', 'anon cannot call the RPC');
eq(/pat-|sk_live|service_role key|eyJ/.test(sql), false, '012 has no secrets');
has(cleanup, "stage is distinct from 'dismissed'", 'cleanup does not delete dismissed leads');
has(cleanup, 'dismissed_at is null', 'cleanup keeps a row with dismissed_at');
has(page, 'dismissLead', 'the page calls the dismiss RPC');
has(page, 'Dismiss', 'the assign card has a Dismiss button');
has(read('../supabase/functions/_shared/lead-dismiss.js'), 'Already assigned in HubSpot', 'the confirm offers the HubSpot reason');
has(page, 'DISMISS_LEAD_REASONS', 'the confirm uses those reason chips');
has(page, 'HubSpot is not changed, and no text is sent.', 'the confirm says HubSpot and texts are untouched');
has(page, "href: call", 'the phone number is a tel link');
has(page, 'maps.apple.com', 'the address opens maps');
eq(page.includes("leadAction('dismiss'"), false, 'dismiss does not call the HubSpot function');
has(cloud, "leadRpc('lead_dismiss'", 'dismiss uses the SQL RPC');
has(app, 'mineAttentionTotal', 'the Mine tab badge is the sum of the section counts');
has(tabs, "'mine-badge-' + id", 'each Mine chip can show a bubble');
has(tabs, '#/saved/leads', 'New Leads is a Mine chip');
has(tabs, '#/saved/followups', 'Follow-ups is a Mine chip');
has(tabs, 'leadsLate', 'an overdue new lead highlights that bubble');
has(more, 'more-lead-badge', 'admin More > Leads uses the orange bubble');

if (process.exitCode) console.error('dismiss lead check failed');
else console.log('dismiss lead check ok');
