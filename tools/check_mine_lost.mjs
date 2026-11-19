// Lost stays out of the All chip, and a presented estimate cannot be deleted by a sales rep.
// Run: node tools/check_mine_lost.mjs
import { readFileSync } from 'node:fs';
import {
  canDeleteEstimate, inMineFolder, mineCounts, mineSearchMatch, wasPresented,
} from '../js/mine-rules.js';

const fail = (msg) => { console.error('FAIL', msg); process.exitCode = 1; };
const eq = (actual, expected, msg) => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) fail(msg + ' — ' + a + ' !== ' + b);
};
const has = (text, needle, msg) => {
  if (!String(text).includes(needle)) fail(msg + ' — missing ' + needle);
};
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const rows = [
  { id: 'draft', status: 'draft', customer: { name: 'Riley Brooks', address: '1 Oak' }, number: 'NWD-1' },
  { id: 'shown', status: 'presented', presentedAt: '2026-11-01T15:00:00.000Z', customer: { name: 'Jordan Hale' }, number: 'NWD-2' },
  { id: 'won', status: 'won', presentedAt: '2026-11-02T15:00:00.000Z', wonAt: '2026-11-03T15:00:00.000Z', customer: { name: 'Casey Nguyen' }, number: 'NWD-3' },
  { id: 'lost', status: 'lost', presentedAt: '2026-11-04T15:00:00.000Z', lostAt: '2026-11-05T15:00:00.000Z', customer: { name: 'Sam Ortega', address: '9 Lost Lane' }, number: 'NWD-4' },
  { id: 'signed', status: 'signed', signedAt: '2026-11-06T15:00:00.000Z', customer: { name: 'Avery Chen' }, number: 'NWD-5' },
];

const visible = (filter, query) => rows.filter((row) => inMineFolder(row, filter) && mineSearchMatch(row, query)).map((row) => row.id);

eq(visible('all', ''), ['draft', 'shown', 'won', 'signed'], 'All omits the lost estimate');
eq(visible('lost', ''), ['lost'], 'Lost chip is only the lost estimate');
eq(visible('all', 'sam'), [], 'search in All does not find a lost customer');
eq(visible('lost', 'sam'), ['lost'], 'search in Lost finds the lost customer');
eq(visible('lost', '9 lost'), ['lost'], 'search in Lost matches the lost address');
eq(visible('all', 'jordan'), ['shown'], 'search in All still finds a shown estimate');
eq(visible('presented', ''), ['shown'], 'Shown chip stays presented only');
eq(mineCounts(rows, ''), { all: 4, draft: 1, presented: 1, won: 1, lost: 1 }, 'chip counts match the folders');
eq(mineCounts(rows, 'sam'), { all: 0, draft: 0, presented: 0, won: 0, lost: 1 }, 'a search does not add the lost hit to All');

const rep = 'rep-1';
eq(canDeleteEstimate({ status: 'draft', ownerId: rep }, { admin: false, uid: rep }), true, 'a rep can delete their own draft');
eq(canDeleteEstimate({ status: 'presented', presentedAt: '2026-11-01', ownerId: rep }, { admin: false, uid: rep }), false, 'a rep cannot delete a presented estimate');
eq(canDeleteEstimate({ status: 'presented', ownerId: rep }, { admin: false, uid: rep }), false, 'presented status alone blocks a rep');
eq(canDeleteEstimate({ status: 'draft', presentedAt: '2026-11-01', ownerId: rep }, { admin: false, uid: rep }), false, 'presented_at blocks a rep even if status says draft');
eq(canDeleteEstimate({ status: 'lost', ownerId: rep }, { admin: false, uid: rep }), false, 'a rep cannot delete a lost estimate');
eq(canDeleteEstimate({ status: 'won', ownerId: rep }, { admin: false, uid: rep }), false, 'a rep cannot delete a won estimate');
eq(canDeleteEstimate({ status: 'signed', ownerId: rep }, { admin: false, uid: rep }), false, 'a rep cannot delete a signed estimate');
eq(canDeleteEstimate({ status: 'presented', ownerId: rep }, { admin: true, uid: 'admin-1' }), true, 'an admin can delete a presented estimate');
eq(canDeleteEstimate({ status: 'lost', ownerId: rep }, { admin: true, uid: 'admin-1' }), true, 'an admin can delete a lost estimate');
eq(canDeleteEstimate({ status: 'draft', ownerId: 'other' }, { admin: false, uid: rep }), false, 'a rep cannot delete someone else\'s draft');
eq(wasPresented({ status: 'presented' }), true, 'follow-up jobs stay status presented and count as presented');
eq(wasPresented({ status: 'draft' }), false, 'a draft was not presented');

const sql = read('../supabase/migrations/011_presented_delete.sql');
const page = read('../js/pages/estimate.js');
const cloud = read('../js/cloud.js');
has(sql, 'create or replace function public.soft_delete_estimate(p_id uuid)', '011 replaces the RPC');
has(sql, 'public.is_admin()', 'admin check uses is_admin(), which reads profiles.role = \'admin\'');
has(sql, 'only an admin can delete an estimate after it has been presented', 'the RPC returns a clear error');
has(sql, 'public.estimate_was_presented(row.status, row.presented_at, row.signed_at, row.won_at, row.lost_at)', 'the RPC checks presented state');
has(sql, 'p_status in (\'presented\', \'signed\', \'won\', \'lost\')', 'presented or later includes signed, won, and lost');
has(sql, 'create or replace function public.guard_estimate_outcome()', 'the update trigger enforces the same rule');
has(sql, 'only an admin can change a presented estimate back to a draft', 'a rep cannot clear presented state and then delete');
has(sql, 'drop policy if exists e_upd on public.estimates', 'the update policy is replaced');
has(sql, 'or not public.estimate_was_presented(status, presented_at, signed_at, won_at, lost_at)', 'e_upd with check blocks deleted_at on a presented row');
has(sql, 'revoke all on function public.soft_delete_estimate(uuid) from public, anon;', 'anon cannot call the RPC');
has(sql, 'grant execute on function public.soft_delete_estimate(uuid) to authenticated;', 'signed-in users can call the RPC');
has(sql, "only an admin can reopen a won or lost estimate", 'reopen stays admin-only');
eq(/pat-|sk_live|service_role key|eyJ/.test(sql), false, '011 has no secrets');
has(page, 'inMineFolder', 'the Mine list uses the folder rule');
has(page, 'mineCounts', 'chip counts use the same rule');
has(page, 'canDeleteEstimate', 'the Delete button uses the presented rule');
has(cloud, 'canDeleteEstimate', 'a local delete is refused before it is queued');
has(cloud, 'Only an admin can delete an estimate after it has been presented.', 'the app repeats the server error');

if (process.exitCode) console.error('mine lost check failed');
else console.log('mine lost check ok');
