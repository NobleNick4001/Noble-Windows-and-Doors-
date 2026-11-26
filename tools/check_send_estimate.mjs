// Estimate email and the HubSpot follow-up task. No network.
import { readFileSync } from 'node:fs';
import {
  SENDER_EMAIL, SENDER_FROM, COMPANY_PHONE, COMPANY_ROC, providerFor, gmailTokenDead, buildHtml, buildRawMessage, safeFilename,
} from '../supabase/functions/send-estimate/mail.js';
import { followUpDue, followUpTitle, matchOwner, moneyLabel } from '../supabase/functions/hubspot-sync/followup.js';

const fail = (msg) => { console.error('FAIL', msg); process.exitCode = 1; };
const eq = (actual, expected, msg) => {
  if (actual !== expected) fail(msg + ' — ' + JSON.stringify(actual) + ' !== ' + JSON.stringify(expected));
};
const has = (text, needle, msg) => {
  if (!String(text).includes(needle)) fail(msg + ' — missing ' + needle);
};

eq(SENDER_EMAIL, 'mgr@noblewandd.com', 'sender mailbox');
eq(providerFor({}), null, 'no secrets means email is not configured');
eq(providerFor({ RESEND_API_KEY: 're_x' }), 'resend', 'Resend is the fallback');
eq(providerFor({ GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'sec', GMAIL_REFRESH_TOKEN: 'tok' }), 'gmail', 'all three Gmail secrets select Gmail');
eq(providerFor({ GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: ' ', GMAIL_REFRESH_TOKEN: 'tok', RESEND_API_KEY: 're_x' }), 'resend', 'a blank Gmail secret falls back to Resend');
eq(providerFor({ GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'sec', GMAIL_REFRESH_TOKEN: 'tok', RESEND_API_KEY: 're_x' }), 'gmail', 'Gmail wins when both providers are configured');
eq(gmailTokenDead('Token has been expired or revoked.'), true, 'Google expired refresh token is dead');
eq(gmailTokenDead('invalid_grant'), true, 'Google invalid_grant is dead');
eq(gmailTokenDead('Client email is required'), false, 'a normal send error is not a dead Gmail token');

const html = buildHtml({ repName: 'Eric Havins', customerName: 'Janice <Williams>', number: 'E-100', total: 3144.46, depositPct: 60 });
has(html, COMPANY_PHONE, 'email shows the company phone');
has(html, '(623) 810-3460', 'phone is the Noble number');
has(html, COMPANY_ROC, 'email shows both ROC numbers');
has(html, 'ROC #364772', 'ROC 364772');
has(html, '#364771', 'ROC 364771');
has(html, 'Eric Havins', 'email names the rep');
has(html, '#0e3a63', 'navy branding');
has(html, '#f28c28', 'orange branding');
has(html, 'Janice &lt;Williams&gt;', 'customer name is escaped');
has(html, '$3,144.46', 'total is formatted');
has(html, 'Deposit (60%)', 'deposit percent');
has(html, 'Final (40%)', 'final percent');

const pdf = Buffer.from('%PDF-1.4 sample').toString('base64');
const raw = buildRawMessage({
  from: SENDER_FROM,
  to: 'janice@example.com',
  subject: 'Noble Windows & Doors — Estimate E-100',
  html,
  pdfBase64: pdf,
  filename: safeFilename('E-100'),
});
has(raw, 'From: Noble Windows & Doors <mgr@noblewandd.com>', 'from mailbox');
has(raw, 'To: janice@example.com', 'recipient');
has(raw, 'Content-Type: application/pdf; name="Noble-estimate-E-100.pdf"', 'pdf attachment');
has(raw, 'Content-Disposition: attachment; filename="Noble-estimate-E-100.pdf"', 'pdf filename');
has(raw.replace(/\s/g, ''), pdf, 'pdf bytes are in the message');
eq(safeFilename('E 100/a'), 'Noble-estimate-E-100-a.pdf', 'filename strips path characters');

eq(followUpDue(new Date('2026-10-14T15:00:00.000Z'), 2), '2026-10-17T00:00:00.000Z', 'Wednesday plus two business days is Friday 5pm Phoenix');
eq(followUpDue(new Date('2026-10-15T15:00:00.000Z'), 2), '2026-10-20T00:00:00.000Z', 'Thursday skips the weekend');
eq(followUpDue(new Date('2026-10-16T15:00:00.000Z'), 2), '2026-10-21T00:00:00.000Z', 'Friday lands on Tuesday');
eq(followUpDue(new Date('2026-10-17T15:00:00.000Z'), 2), '2026-10-21T00:00:00.000Z', 'Saturday starts the count on Monday');
eq(followUpTitle('Janice Williams', 8888.33), 'Follow up: Janice Williams estimate $8,888.33', 'task title');
eq(followUpTitle('', 0), 'Follow up: Customer estimate $0.00', 'blank customer');
eq(moneyLabel(8888.33), '$8,888.33', 'currency label');
eq(matchOwner([{ id: '1', email: 'Eric@NobleWANDD.com' }, { id: '2', email: 'mgr@noblewandd.com' }], 'eric@noblewandd.com')?.id, '1', 'owner email match ignores case');
eq(matchOwner([{ id: '1', email: 'eric@noblewandd.com' }], ''), null, 'blank rep email does not match');
eq(matchOwner([{ id: '1', email: 'other@example.com' }], 'eric@noblewandd.com'), null, 'unmatched owner');

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const sendFn = read('../supabase/functions/send-estimate/index.ts');
for (const needle of ['auth.getUser', "profile?.role !== 'admin'", 'estimate.owner_id', 'customer_email', 'JVBERi', 'sent_at', 'sent_to', 'providerFor', 'gmailTokenDead', 'sendResend(secrets.RESEND_API_KEY', 'Company Gmail needs to be reconnected', 'Email is not configured', 'Client email is required']) {
  has(sendFn, needle, 'send-estimate function');
}
const hubFn = read('../supabase/functions/hubspot-sync/index.ts');
for (const needle of ['followUp', 'hs_task_subject', '/crm/v3/objects/tasks', '/crm/v3/owners/', 'hubspot_owner_id', 'followUpDue', 'followUpTitle']) {
  has(hubFn, needle, 'hubspot task handling');
}
const page = read('../js/pages/estimate.js');
for (const needle of ["id: 'btn-present'", "id: 'btn-accept'", 'Save & Send', "id: 'send-confirm'", "id: 'send-confirm-email'", 'Enter the client email before sending.', "e.status === 'signed'", 'followUp: true']) {
  has(page, needle, 'present screen');
}
const cloud = read('../js/cloud.js');
has(cloud, "invoke('send-estimate'", 'client calls send-estimate');
has(cloud, 'body.followUp = true', 'presented sync can request a follow-up');
has(cloud, "e.status === 'signed'", 'signed estimates are not sent back through presented');
const sql = read('../supabase/migrations/002_estimate_sent.sql');
has(sql, 'sent_at', 'migration adds sent_at');
has(sql, 'sent_to', 'migration adds sent_to');
has(sql, 'service_role', 'migration grants service_role');

if (process.exitCode) console.error('send estimate check failed');
else console.log('send estimate check ok');
