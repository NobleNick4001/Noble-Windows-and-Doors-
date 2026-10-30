// Offline stand-in for js/cloud.js. No network. Copied into demo-dist by tools/build_demo.mjs.
import { estimates, toast, totals as liveTotals } from './core.js';
import {
  applyFeeState, applyPaymentState, buildInvoice, payFrom, paymentView,
} from '../supabase/functions/quickbooks-invoice/invoice.js';

const DEMO_ID = 'demo-admin';
const DEMO_EMAIL = 'demo.admin@example.com';
const SEED_KEY = 'nwd.demo.seed';
const SEED_VERSION = '3';
const CONN_KEY = 'nwd.demo.qbo';
const ROSTER_KEY = 'nwd.demo.roster';

const profile = {
  id: DEMO_ID,
  email: DEMO_EMAIL,
  full_name: 'Demo Admin',
  role: 'admin',
  see_all: true,
};

let readyHook = null;
let signedOutHook = null;
let signedOut = false;

export function userId() { return signedOut ? null : DEMO_ID; }
export function currentProfile() { return signedOut ? null : profile; }
export function isAdmin() { return !signedOut && profile.role === 'admin'; }
export function canSeeAllEstimates() { return isAdmin() || profile.see_all === true; }
export function consumeAuthMessage() { return ''; }

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function connection() {
  return readJson(CONN_KEY, { connected: true, companyName: 'Demo Windows & Doors', realmId: 'demo-realm' });
}
function saveConnection(row) {
  writeJson(CONN_KEY, row);
}

function payUrl(invoiceId) {
  return new URL('demo-pay.html?invoice=' + encodeURIComponent(invoiceId), location.href).href;
}

function jobTotals(unit, labor) {
  const windows = unit;
  const tax = Math.round(windows * 9.1) / 100;
  const total = Math.round((windows + labor + 150 + tax) * 100) / 100;
  return { windows, discount: 0, percentDiscountAmount: 0, labor, shipping: 150, extras: 0, tax, taxPct: 9.1, total };
}

function windowLine(id, label, unit, labor) {
  return {
    id,
    label,
    brand: 'milgard',
    series: 'V300',
    type: 'hslider',
    color: 'ww',
    w: 36,
    h: 48,
    qty: 1,
    unit,
    install: { type: 'retrofit', surcharges: [], override: labor, custom: null, frameType: 'zbar' },
  };
}

function baseEstimate(id, number, customer, unit, labor, status) {
  const now = Date.now();
  return {
    id,
    number,
    created: now,
    updated: now,
    status,
    customer,
    lines: [windowLine(id + '-w', 'Living room', unit, labor)],
    extras: [],
    stuccoRepair: { on: false, qty: null },
    notes: '',
    promoCode: '',
    percentDiscount: 0,
    validDays: 30,
    remoteId: id,
    ownerId: DEMO_ID,
    ownerName: 'Demo Admin',
  };
}

function signedContract(e, pay) {
  e.contract = {
    specsEdited: true,
    specifications: 'Demo scope only. This is not a customer job.',
    submittedBy: 'Demo Admin',
    completionDate: '2026-12-15',
    signatures: { p1a: '', p1b: '', p2a: '', p2b: '' },
    signedOn: {},
    snapshot: {
      total: pay.total,
      deposit: pay.deposit,
      balance: pay.balance,
      depositPct: 60,
      lineDescriptions: ['Living room — demo window'],
      customer: { ...e.customer },
    },
  };
  e.signedAt = new Date().toISOString();
}

function seedEstimates() {
  if (readJson(SEED_KEY, '') === SEED_VERSION) return;
  const alex = baseEstimate('demo-alex', 'NWD-DEMO-001', {
    name: 'Alex Rivera',
    address: '100 Demo Court, Mesa, AZ 85201',
    phone: '(480) 555-0101',
    email: 'alex.rivera.demo@example.com',
  }, 1200, 360, 'draft');
  alex.updated = Date.now() - 3000;

  const jordanTotals = jobTotals(1000, 360);
  const jordanPay = payFrom(jordanTotals.total, 60, null);
  const jordan = baseEstimate('demo-jordan', 'NWD-DEMO-002', {
    name: 'Jordan Blake',
    address: '200 Sample Road, Tempe, AZ 85281',
    phone: '(480) 555-0102',
    email: 'jordan.blake.demo@example.com',
  }, 1000, 360, 'signed');
  signedContract(jordan, jordanPay);
  jordan.qbo = { state: 'queued', error: '', mock: true };
  jordan.updated = Date.now() - 2000;

  const samTotals = jobTotals(2016, 795);
  const samPay = payFrom(samTotals.total, 60, null);
  const sam = baseEstimate('demo-sam', 'NWD-DEMO-003', {
    name: 'Sam Patel',
    address: '300 Practice Way, Scottsdale, AZ 85251',
    phone: '(480) 555-0103',
    email: 'sam.patel.demo@example.com',
  }, 2016, 795, 'signed');
  signedContract(sam, samPay);
  const built = buildInvoice({
    lines: sam.lines,
    extras: [],
    totals: samTotals,
    pay: samPay,
    depositPct: 60,
    descriptions: sam.contract.snapshot.lineDescriptions,
  });
  sam.qbo = {
    customerId: 'demo-cust-sam',
    invoiceId: 'demo-inv-sam',
    docNumber: sam.number,
    paymentLink: payUrl('demo-inv-sam'),
    state: 'created',
    error: '',
    notice: built.notice,
    depositCents: built.depositCents,
    balanceCents: built.balanceCents,
    totalCents: built.totalCents,
    amountDueCents: built.totalCents,
    paidCents: 0,
    feeDepositCents: null,
    feeFinalCents: null,
    cardOn: false,
    offlinePaymentId: '',
    offlineFinalPaymentId: '',
    attached: true,
    mock: true,
    lines: built.lines,
    depositReceived: false,
  };
  sam.updated = Date.now() - 1000;

  const all = { [alex.id]: alex, [jordan.id]: jordan, [sam.id]: sam };
  writeJson('nwd.estimates', all);
  writeJson('nwd.currentId', sam.id);
  writeJson('nwd.counter', 3);
  writeJson(SEED_KEY, SEED_VERSION);
  if (!localStorage.getItem(CONN_KEY)) saveConnection({ connected: true, companyName: 'Demo Windows & Doors', realmId: 'demo-realm' });
  if (!localStorage.getItem(ROSTER_KEY)) {
    writeJson(ROSTER_KEY, [
      { email: DEMO_EMAIL, full_name: 'Demo Admin', role: 'admin', on_list: true, revoked_at: null, profile_id: DEMO_ID, see_all: true },
      { email: 'casey.demo@example.com', full_name: 'Casey Nguyen', role: 'sales', on_list: true, revoked_at: null, profile_id: 'demo-casey', see_all: false },
      { email: 'riley.demo@example.com', full_name: 'Riley Chen', role: 'sales', on_list: true, revoked_at: null, profile_id: 'demo-riley', see_all: false },
    ]);
  }
}

function notConnected() {
  return { ok: false, code: 'not_connected', error: 'QuickBooks is not connected. Connect the demo company on the Admin page.' };
}

function remember(e) {
  estimates.save(e);
}

function viewOf(e) {
  const q = e.qbo || {};
  const view = paymentView({
    paidCents: q.paidCents,
    depositCents: q.depositCents,
    amountDueCents: q.amountDueCents,
  });
  q.depositReceived = view.depositReceived;
  return {
    ok: true,
    mock: true,
    customerId: q.customerId || '',
    invoiceId: q.invoiceId || '',
    docNumber: q.docNumber || '',
    paymentLink: q.paymentLink || '',
    state: q.state || '',
    notice: q.notice || '',
    depositCents: q.depositCents,
    balanceCents: q.balanceCents,
    totalCents: q.totalCents,
    amountDueCents: q.amountDueCents,
    paidCents: q.paidCents,
    feeDepositCents: q.feeDepositCents,
    feeFinalCents: q.feeFinalCents,
    cardOn: q.cardOn === true,
    offlinePaymentId: q.offlinePaymentId || '',
    offlineFinalPaymentId: q.offlineFinalPaymentId || '',
    depositReceived: view.depositReceived,
    attached: q.attached === true,
    reused: false,
  };
}

export async function syncQuickBooks(e, opts = {}) {
  if (!e) return { ok: false, error: 'Save the estimate first.' };
  if (e.status !== 'signed') return { ok: false, error: 'Sign the agreement first.' };
  if (!connection().connected) {
    e.qbo = { ...(e.qbo || {}), state: e.qbo?.invoiceId ? (e.qbo.state || 'created') : 'error', error: notConnected().error, mock: true };
    remember(e);
    if (!opts.quiet) toast(e.qbo.error);
    return notConnected();
  }
  if (opts.pdfBase64) e.qbo = { ...(e.qbo || {}), attached: true, attachmentError: '' };
  if (e.qbo?.invoiceId) {
    e.qbo.state = 'created';
    e.qbo.error = '';
    e.qbo.mock = true;
    if (!e.qbo.paymentLink) e.qbo.paymentLink = payUrl(e.qbo.invoiceId);
    remember(e);
    return { ...viewOf(e), reused: true };
  }
  const snap = e.contract?.snapshot || null;
  let totals;
  try { totals = liveTotals(e); }
  catch { return { ok: false, error: 'Could not read the estimate total.' }; }
  const pct = Number(snap?.depositPct) || 60;
  const pay = payFrom(snap?.total != null ? snap.total : totals.total, pct, snap);
  const built = buildInvoice({
    lines: e.lines || [],
    extras: e.extras || [],
    totals,
    pay,
    depositPct: pct,
    descriptions: snap?.lineDescriptions || [],
  });
  const invoiceId = 'demo-inv-' + String(e.id).replace(/[^a-z0-9]+/gi, '').slice(0, 12);
  e.qbo = {
    customerId: 'demo-cust-' + String(e.id).slice(0, 12),
    invoiceId,
    docNumber: e.number || invoiceId,
    paymentLink: payUrl(invoiceId),
    state: 'created',
    error: '',
    notice: built.notice,
    depositCents: built.depositCents,
    balanceCents: built.balanceCents,
    totalCents: built.totalCents,
    amountDueCents: built.totalCents,
    paidCents: 0,
    feeDepositCents: null,
    feeFinalCents: null,
    cardOn: false,
    offlinePaymentId: '',
    offlineFinalPaymentId: '',
    attached: Boolean(opts.pdfBase64) || e.qbo?.attached === true,
    mock: true,
    lines: built.lines,
    depositReceived: false,
  };
  remember(e);
  return { ...viewOf(e), reused: false };
}

export async function enableCardPayment(e, stage) {
  const which = stage === 'final' ? 'final' : 'deposit';
  if (!e?.qbo?.invoiceId) return { ok: false, error: 'Create the QuickBooks invoice before turning on card payments.' };
  if (!connection().connected) return notConnected();
  const key = which === 'deposit' ? 'feeDepositCents' : 'feeFinalCents';
  if (e.qbo[key] != null) {
    e.qbo.cardOn = true;
    e.qbo.error = '';
    remember(e);
    return { ...viewOf(e), added: false, stage: which, feeCents: e.qbo[key] };
  }
  const applied = applyFeeState({
    lines: e.qbo.lines || [],
    depositCents: e.qbo.depositCents,
    amountDueCents: e.qbo.amountDueCents,
    totalCents: e.qbo.totalCents,
    feeDepositCents: e.qbo.feeDepositCents ?? null,
    feeFinalCents: e.qbo.feeFinalCents ?? null,
  }, which);
  e.qbo.lines = applied.state.lines;
  e.qbo.feeDepositCents = applied.state.feeDepositCents ?? null;
  e.qbo.feeFinalCents = applied.state.feeFinalCents ?? null;
  e.qbo.totalCents = applied.state.totalCents;
  e.qbo.amountDueCents = applied.state.amountDueCents;
  e.qbo.cardOn = true;
  e.qbo.state = 'created';
  e.qbo.error = '';
  remember(e);
  return { ...viewOf(e), added: applied.added, stage: which, feeCents: applied.feeCents, baseCents: applied.baseCents };
}

export async function refreshQboPayment(e) {
  if (!e?.qbo?.invoiceId) return { ok: false, error: 'This estimate has no QuickBooks invoice yet.' };
  if (!connection().connected) return notConnected();
  e.qbo.error = '';
  e.qbo.state = 'created';
  remember(e);
  return { ...viewOf(e), refreshed: true };
}

export async function recordOfflineDeposit(e) {
  if (!e?.qbo?.invoiceId) return { ok: false, error: 'Create the QuickBooks invoice first.' };
  if (!connection().connected) return notConnected();
  if (e.qbo.offlinePaymentId) return { ...viewOf(e), reused: true, paymentId: e.qbo.offlinePaymentId, purpose: 'deposit' };
  const amount = e.qbo.depositCents;
  if (amount == null || amount <= 0) return { ok: false, error: 'Enter an amount greater than zero.' };
  const next = applyPaymentState({ paidCents: e.qbo.paidCents || 0, totalCents: e.qbo.totalCents || 0 }, amount);
  e.qbo.paidCents = next.paidCents;
  e.qbo.amountDueCents = next.amountDueCents;
  e.qbo.offlinePaymentId = 'demo-pay-deposit-' + e.qbo.invoiceId;
  e.qbo.error = '';
  remember(e);
  return { ...viewOf(e), paymentId: e.qbo.offlinePaymentId, purpose: 'deposit', amountCents: amount, reused: false };
}

export async function qboStatus() {
  const row = connection();
  return {
    ok: true,
    connected: row.connected === true,
    companyName: row.connected ? (row.companyName || 'Demo Windows & Doors') : '',
    realmId: isAdmin() && row.connected ? (row.realmId || 'demo-realm') : undefined,
    mock: true,
  };
}

export async function startQboConnect() {
  saveConnection({ connected: true, companyName: 'Demo Windows & Doors', realmId: 'demo-realm' });
  return { ok: true, url: new URL('demo-connect.html', location.href).href, mock: true };
}

export async function disconnectQbo() {
  saveConnection({ connected: false, companyName: '', realmId: '' });
  return { ok: true, connected: false };
}

export async function recordSigned(e, extras = {}) {
  if (!e.remoteId) e.remoteId = e.id || ('demo-' + Math.random().toString(36).slice(2, 10));
  e.status = 'signed';
  e.signedAt = e.signedAt || new Date().toISOString();
  if (!e.qbo?.invoiceId) e.qbo = { ...(e.qbo || {}), state: 'queued', error: '', mock: true };
  remember(e);
  const qbo = await syncQuickBooks(e, { pdfBase64: extras?.pdfBase64, quiet: true });
  if (qbo?.invoiceId || e.qbo?.invoiceId) toast('Agreement saved. Demo invoice is ready.');
  else if (e.qbo?.error) toast('Agreement saved. ' + e.qbo.error);
  else toast('Agreement saved.');
  return qbo || { ok: true };
}

export async function preparePresented(e) {
  if (!e?.customer?.name && !(e?.lines || []).length) {
    toast('Add a customer or a window first.');
    return { ok: false };
  }
  return { ok: true, ready: true, skipped: true };
}

export function applyHubspotChoice() {}

export async function markPresented(e, opts = {}) {
  if (!e?.customer?.name && !(e?.lines || []).length) {
    toast('Add a customer or a window first.');
    return { ok: false };
  }
  if (e.status !== 'signed') {
    e.status = 'presented';
    e.presentedAt = e.presentedAt || new Date().toISOString();
  }
  remember(e);
  if (!opts.quiet) toast('Marked presented in this demo. Nothing was sent.');
  return { ok: false, skipped: true };
}

export async function sendEstimateEmail(e) {
  const email = String(e?.customer?.email || '').trim();
  if (!email || !email.includes('@')) return { ok: false, error: 'Enter the client email before sending.' };
  e.sentAt = new Date().toISOString();
  e.sentTo = email;
  remember(e);
  return { ok: true, data: { sent_at: e.sentAt, sent_to: email, demo: true } };
}

export async function refreshEstimates() {
  window.dispatchEvent(new Event('nwd-synced'));
}

function roster() {
  return readJson(ROSTER_KEY, []);
}

export async function loadRoster() {
  return { people: roster() };
}

export async function loadAdmin() {
  const people = roster().map((p) => ({ id: p.profile_id, email: p.email, full_name: p.full_name, role: p.role }));
  const rows = Object.values(estimates.all()).map((e) => ({
    id: e.remoteId || e.id,
    owner_id: e.ownerId || DEMO_ID,
    customer_name: e.customer?.name || '',
    customer_email: e.customer?.email || '',
    status: e.status || 'draft',
    total_amount: e.contract?.snapshot?.total,
    updated_at: new Date(e.updated || Date.now()).toISOString(),
    contracts: e.status === 'signed' ? [{ id: (e.remoteId || e.id) + '-c', signer_name: e.customer?.name || '', signed_at: e.signedAt }] : [],
  }));
  return { people, estimates: rows };
}

export async function loadSignatures(contractId) {
  const id = String(contractId || '').replace(/-c$/, '');
  const e = Object.values(estimates.all()).find((row) => row.remoteId === id || row.id === id);
  if (!e) return null;
  return {
    signer_name: e.customer?.name || '',
    signed_at: e.signedAt,
    parsed: { signatures: e.contract?.signatures || {}, initials: e.contract?.initials || '' },
  };
}

export async function setUserRole(email, role) {
  const people = roster();
  const row = people.find((p) => p.email === String(email || '').toLowerCase());
  if (!row) return { error: 'That demo person is not on the list.' };
  row.role = role === 'admin' ? 'admin' : 'sales';
  writeJson(ROSTER_KEY, people);
  return { ok: true };
}

export async function setSeeAll(email, on) {
  const people = roster();
  const row = people.find((p) => p.email === String(email || '').toLowerCase());
  if (!row) return { error: 'That demo person is not on the list.' };
  row.see_all = Boolean(on);
  writeJson(ROSTER_KEY, people);
  return { ok: true };
}

export async function addRep(email, fullName, role) {
  const address = String(email || '').trim().toLowerCase();
  if (!address.includes('@')) return { error: 'Enter an email.' };
  const people = roster();
  if (people.some((p) => p.email === address)) return { error: 'That email is already on the demo list.' };
  people.push({
    email: address,
    full_name: String(fullName || '').trim() || address,
    role: role === 'admin' ? 'admin' : 'sales',
    on_list: true,
    revoked_at: null,
    profile_id: 'demo-' + address.replace(/[^a-z0-9]+/g, '').slice(0, 12),
    see_all: false,
  });
  writeJson(ROSTER_KEY, people);
  return { ok: true };
}

export async function revokeAccess(email) {
  const people = roster();
  const row = people.find((p) => p.email === String(email || '').toLowerCase());
  if (!row) return { error: 'That demo person is not on the list.' };
  row.revoked_at = new Date().toISOString();
  writeJson(ROSTER_KEY, people);
  return { ok: true, sessionFunction: false };
}

export async function restoreAccess(email) {
  const people = roster();
  const row = people.find((p) => p.email === String(email || '').toLowerCase());
  if (!row) return { error: 'That demo person is not on the list.' };
  row.revoked_at = null;
  row.on_list = true;
  writeJson(ROSTER_KEY, people);
  return { ok: true };
}

export async function reassignEstimate(remoteId, ownerId) {
  const e = Object.values(estimates.all()).find((row) => row.remoteId === remoteId);
  if (!e) return { error: 'Estimate not found in this demo.' };
  const owner = roster().find((p) => p.profile_id === ownerId);
  e.ownerId = ownerId;
  e.ownerName = owner?.full_name || ownerId;
  remember(e);
  return { ok: true };
}

export function mountAccount(el) {
  if (!el || signedOut) {
    if (el) el.replaceChildren();
    return;
  }
  el.replaceChildren(
    document.createTextNode(''),
  );
  const dot = document.createElement('span');
  dot.className = 'syncdot';
  dot.title = 'Saved on this device';
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = profile.full_name;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn sm';
  btn.id = 'btn-signout';
  btn.textContent = 'Sign out';
  btn.addEventListener('click', () => signOut());
  el.replaceChildren(dot, who, btn);
}

export async function signOut() {
  signedOut = true;
  mountAccount(document.getElementById('account'));
  signedOutHook?.();
}

export async function signIn() {
  signedOut = false;
  readyHook?.();
  return { ok: true };
}

export async function signUp() {
  return signIn();
}

export async function startAuth({ onReady, onSignedOut } = {}) {
  readyHook = onReady || null;
  signedOutHook = onSignedOut || null;
  signedOut = false;
  seedEstimates();
  if (!location.hash) location.replace('#/saved');
  await readyHook?.();
}
