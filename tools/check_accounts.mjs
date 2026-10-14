// Accounts, sync payload, and the database contract. No network.
import { readFileSync } from 'node:fs';
import { roleForEmail, nameForEmail, toRow, toContract, fromRow, ACCOUNTS } from '../js/cloud.js';

const fail = (msg) => { console.error('FAIL', msg); process.exitCode = 1; };
const eq = (actual, expected, msg) => { if (actual !== expected) fail(msg + ' — ' + JSON.stringify(actual)); };

eq(roleForEmail('mgr@noblewandd.com'), 'admin', 'Nicholas is admin');
eq(roleForEmail('MGR@noblewandd.com'), 'admin', 'admin email is case-insensitive');
eq(roleForEmail('Eric@noblewandd.com'), 'sales', 'Eric is sales');
eq(roleForEmail('Mgr@noblegcllc.com'), 'sales', 'George is sales');
eq(nameForEmail('eric@noblewandd.com'), 'Eric Havins', 'Eric name');
eq(nameForEmail('mgr@noblegcllc.com'), 'George Piekarski', 'George name');
eq(nameForEmail('mgr@noblewandd.com'), 'Nicholas Sommer', 'Nicholas name');
eq(ACCOUNTS.length, 3, 'three known accounts');

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
if (!sw.includes("const CACHE = 'nwd-sales-v28'")) fail('service worker should be nwd-sales-v28');
for (const file of ['js/cloud.js', 'js/pages/auth.js', 'js/pages/admin.js']) {
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
else console.log('account check ok', { admin: 'mgr@noblewandd.com', sales: ['Eric Havins', 'George Piekarski'], shippingOnEmpty: 150 });
