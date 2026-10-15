// Accounts, sync payload, and the database contract. No network.
import { readFileSync } from 'node:fs';
import { roleForEmail, nameForEmail, toRow, toContract, fromRow, ACCOUNTS, sessionFromStorage, offlineAccessOk } from '../js/cloud.js';

const fail = (msg) => { console.error('FAIL', msg); process.exitCode = 1; };
const eq = (actual, expected, msg) => { if (actual !== expected) fail(msg + ' — ' + JSON.stringify(actual)); };

eq(roleForEmail('mgr@noblewandd.com'), 'admin', 'Nicholas is admin');
eq(roleForEmail('MGR@noblewandd.com'), 'admin', 'admin email is case-insensitive');
eq(roleForEmail('Eric@noblewandd.com'), 'sales', 'Eric is sales');
eq(roleForEmail('Mgr@noblegcllc.com'), 'sales', 'George is sales');
eq(roleForEmail('dan@noblewandd.com'), 'sales', 'Daniel is sales');
eq(roleForEmail('DAN@noblewandd.com'), 'sales', 'Daniel email is case-insensitive');
eq(roleForEmail('stranger@example.com'), null, 'unknown email is not a sales rep');
eq(nameForEmail('eric@noblewandd.com'), 'Eric Havins', 'Eric name');
eq(nameForEmail('mgr@noblegcllc.com'), 'George Piekarski', 'George name');
eq(nameForEmail('mgr@noblewandd.com'), 'Nicholas Sommer', 'Nicholas name');
eq(nameForEmail('dan@noblewandd.com'), 'Daniel Smalley', 'Daniel name');
eq(ACCOUNTS.length, 4, 'four known accounts');

const token = 'header.payload.signature-long-enough';
const session = sessionFromStorage(JSON.stringify({
  access_token: token,
  user: { id: '11111111-1111-4111-8111-111111111111', email: 'Dan@noblewandd.com' },
}));
eq(session?.user?.email, 'dan@noblewandd.com', 'stored session keeps the email');
eq(sessionFromStorage('{}'), null, 'empty cached token is not a session');
eq(sessionFromStorage('{"access_token":"short"}'), null, 'short token is not a session');
eq(offlineAccessOk({ allowed: true, email: 'dan@noblewandd.com', role: 'sales' }, session), true, 'allowed rep can continue offline');
eq(offlineAccessOk({ allowed: false, email: 'dan@noblewandd.com', role: 'sales' }, session), false, 'revoked rep cannot continue offline');
eq(offlineAccessOk({ allowed: true, email: 'eric@noblewandd.com', role: 'sales' }, session), false, 'offline cache must match the signed-in email');
eq(offlineAccessOk(null, session), false, 'no access check means stay signed out');

const sql = readFileSync(new URL('../supabase/migrations/001_schema.sql', import.meta.url), 'utf8');
for (const needle of [
  'mgr@noblewandd.com',
  'eric@noblewandd.com',
  'mgr@noblegcllc.com',
  'Nicholas Sommer',
  'Eric Havins',
  'George Piekarski',
  'only admin can reassign',
  'signed estimate locked',
  'hard delete is disabled',
  'document jsonb',
]) {
  if (!sql.includes(needle)) fail('schema missing ' + needle);
}
if (/for\s+delete/i.test(sql)) fail('schema must not grant a DELETE policy');
if (!/before delete on public\.estimates/i.test(sql) || !/before delete on public\.contracts/i.test(sql)) fail('hard delete triggers missing');

const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
if (!sw.includes("const CACHE = 'nwd-sales-v38-real-photos'")) fail('service worker should be nwd-sales-v38-real-photos');
for (const file of ['js/cloud.js', 'js/pages/auth.js', 'js/pages/admin.js', 'js/milgard.js', 'data/milgard-onelink.json']) {
  if (!sw.includes(file)) fail('precache missing ' + file);
}

const fn = readFileSync(new URL('../supabase/functions/hubspot-sync/index.ts', import.meta.url), 'utf8');
if (!fn.includes('HUBSPOT_TOKEN')) fail('function should read HUBSPOT_TOKEN');
if (!fn.includes('closed') && !fn.includes('closedwon')) fail('signed deals should use closed won');
if (!/presentation|appointment/i.test(fn)) fail('presented deals should use the appointment or presentation stage');
if (fn.includes('pat-') || fn.includes('HUBSPOT_TOKEN =')) fail('function must not embed the HubSpot token');

const client = readFileSync(new URL('../js/cloud.js', import.meta.url), 'utf8');
if (client.includes('HUBSPOT_TOKEN') || client.includes('SERVICE_ROLE')) fail('client must not contain HubSpot or service-role secrets');
if (!client.includes('sb_publishable_SnKqbI5z7tlZzQmntcxumQ_AqB1pNJ9')) fail('publishable key should be in the client');
if (!client.includes('cdn.jsdelivr.net/npm/@supabase/supabase-js')) fail('supabase-js should load from the CDN');
if (!client.includes('dan@noblewandd.com') || !client.includes('Daniel Smalley')) fail('client allowlist should include Daniel');
if (!client.includes('current_access') || !client.includes('offlineAccessOk')) fail('client should check the allowlist and the offline access flag');
if (!client.includes('admin_revoke_user') || !client.includes('revoke-sessions')) fail('revoke should hit the database and the sign-out function');
if (/if \(cached\) \{\s*onReady/.test(client)) fail('a cached token alone must not open the app');

const allow = readFileSync(new URL('../supabase/migrations/003_allowlist.sql', import.meta.url), 'utf8');
for (const needle of [
  'dan@noblewandd.com',
  'Daniel Smalley',
  'allowed_users',
  'revoked_at',
  'is_allowed',
  'admin_revoke_user',
  'admin_restore_user',
  'admin_add_user',
  'current_access',
  'custom_access_token_hook',
  'hook_before_user_created',
  'auth.sessions',
  'auth.refresh_tokens',
  'drop_sessions_for_email',
  'This email is not allowed to sign in.',
  'This email is not allowed to create an account.',
  'you cannot revoke your own access',
  'see_all boolean not null default false',
  'can_see_all_estimates',
  'admin_set_see_all',
  'admins already see every estimate',
]) {
  if (!allow.includes(needle)) fail('allowlist migration missing ' + needle);
}
if (/for\s+delete/i.test(allow)) fail('allowlist migration must not add a DELETE policy');
const estimateSelect = allow.split('create policy e_sel')[1]?.split('create policy e_ins')[0] || '';
const estimateUpdate = allow.split('create policy e_upd')[1]?.split('create policy c_sel')[0] || '';
const contractSelect = allow.split('create policy c_sel')[1]?.split('create policy c_ins')[0] || '';
if (!estimateSelect.includes('can_see_all_estimates')) fail('estimate select should follow the see-all flag');
if (!contractSelect.includes('can_see_all_estimates')) fail('contract select should follow the see-all flag');
if (estimateUpdate.includes('can_see_all_estimates')) fail('seeing other estimates must not allow editing them');
if (!client.includes('admin_set_see_all') || !client.includes('canSeeAllEstimates')) fail('client should toggle and honor see-all');

const adminPage = readFileSync(new URL('../js/pages/admin.js', import.meta.url), 'utf8');
const estimatePage = readFileSync(new URL('../js/pages/estimate.js', import.meta.url), 'utf8');
if (!adminPage.includes("Can see other reps' estimates")) fail('admin page should label the see-all toggle');
if (!adminPage.includes('Sees every estimate')) fail('admin row should say the admin sees every estimate');
if (!estimatePage.includes('ownerName') || !estimatePage.includes('canSeeAllEstimates')) fail('estimate list should name the owner and include shared jobs');

const kick = readFileSync(new URL('../supabase/functions/revoke-sessions/index.ts', import.meta.url), 'utf8');
if (!kick.includes("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')")) fail('revoke function should read the service role from the environment');
if (!kick.includes('drop_sessions_for_email')) fail('revoke function should delete that user\'s sessions');
if (kick.includes('eyJ') || /SERVICE_ROLE_KEY\s*=\s*['"]/.test(kick)) fail('revoke function must not embed the service role key');

const estimate = {
  id: 'local1',
  remoteId: '11111111-1111-4111-8111-111111111111',
  number: 'NWD-TEST',
  customer: { name: 'Ada Lovelace', email: 'ada@example.com', phone: '(602) 555-0100', address: '1 Main' },
  lines: [],
  extras: [],
  stuccoRepair: { on: false, qty: null },
  promoCode: '',
  status: 'signed',
  signedAt: '2026-10-14T12:00:00.000Z',
  contract: {
    specifications: 'Replace 1 window.',
    initials: 'data:image/png;base64,aaa',
    signatures: { p1a: 'data:image/png;base64,bbb', p1b: 'data:image/png;base64,ccc' },
    signedOn: { p1a: '2026-10-14T12:00:00.000Z' },
    snapshot: { total: 150 },
  },
};
const owner = '22222222-2222-4222-8222-222222222222';
const row = toRow(estimate, owner);
eq(row.total_amount, 150, 'empty job still includes shipping');
eq(row.status, 'signed', 'status round trip');
eq(row.customer_email, 'ada@example.com', 'customer email');
eq(row.document.contract.signatures.p1a, 'data:image/png;base64,bbb', 'signature stays on the estimate document');
const contract = toContract(estimate, owner);
const parsed = JSON.parse(contract.signature_data);
eq(parsed.signatures.p1b, 'data:image/png;base64,ccc', 'contract stores every signature');
eq(parsed.initials, 'data:image/png;base64,aaa', 'initials stored');
const back = fromRow({ ...row, owner_id: owner, updated_at: '2026-10-14T12:00:01.000Z', hubspot_deal_id: 'deal-9', contracts: [{ id: 'c1', signed_at: '2026-10-14T12:00:00.000Z' }] });
eq(back.remoteId, estimate.remoteId, 'remote id restored');
eq(back.hubspotDealId, 'deal-9', 'hubspot id restored from the column');
eq(back.contract.signatures.p1a, 'data:image/png;base64,bbb', 'reopen keeps the signature');
eq(back.contractRowId, 'c1', 'contract row linked');

if (process.exitCode) console.error('account check failed');
else console.log('account check ok', { admin: 'mgr@noblewandd.com', sales: ['Eric Havins', 'George Piekarski', 'Daniel Smalley'], shippingOnEmpty: 150 });
