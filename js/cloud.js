// Accounts and durable sync. supabase-js is loaded from the CDN on demand so a
// missing network does not stop the rest of the app. The publishable key is a client key.
import { h, store, estimates, totals, summaryLines, toast, browserOffline, OFFLINE_MESSAGE } from './core.js';

export const SUPABASE_URL = 'https://nmyatpcjqfokmfbssimc.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_SnKqbI5z7tlZzQmntcxumQ_AqB1pNJ9';
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const QUEUE_KEY = 'nwd.syncQueue';

export const ACCOUNTS = [
  { email: 'mgr@noblewandd.com', role: 'admin', fullName: 'Nicholas Sommer' },
  { email: 'eric@noblewandd.com', role: 'sales', fullName: 'Eric Havins' },
  { email: 'mgr@noblegcllc.com', role: 'sales', fullName: 'George Piekarski' },
];

export function roleForEmail(email) {
  const hit = ACCOUNTS.find((a) => a.email === String(email || '').trim().toLowerCase());
  return hit?.role || 'sales';
}
export function nameForEmail(email) {
  const hit = ACCOUNTS.find((a) => a.email === String(email || '').trim().toLowerCase());
  return hit?.fullName || '';
}

let client = null;
let me = null;
let profile = null;
let timer = null;
let flushing = null;
let readyHook = null;
let signedOutHook = null;

export function userId() { return me; }
export function currentProfile() { return profile; }
export function isAdmin() { return profile?.role === 'admin'; }

export async function getSupabase() {
  if (client) return client;
  try {
    const { createClient } = await import(CDN);
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    return client;
  } catch (err) {
    console.error(err);
    return null;
  }
}

function loadQueue() { return store.get(QUEUE_KEY, []); }
function saveQueue(q) { store.set(QUEUE_KEY, q); }

export function ensureRemote(e) {
  if (!e.remoteId) e.remoteId = crypto.randomUUID();
  if (!e.status) e.status = 'draft';
  if (me && !e.ownerId) e.ownerId = me;
  return e;
}

export function toRow(e, ownerId) {
  const t = totals(e);
  const row = {
    id: e.remoteId,
    owner_id: e.ownerId || ownerId,
    customer_name: e.customer?.name || '',
    customer_email: e.customer?.email || '',
    customer_phone: e.customer?.phone || '',
    customer_address: e.customer?.address || '',
    lines: e.lines || [],
    totals: { ...t, summary: summaryLines(t) },
    document: e,
    total_amount: t.total,
    status: e.status || 'draft',
    presented_at: e.presentedAt || null,
    signed_at: e.signedAt || null,
  };
  if (e.sentAt) row.sent_at = e.sentAt;
  if (e.sentTo) row.sent_to = e.sentTo;
  if (e.hubspotChoice === 'new') {
    row.hubspot_contact_id = null;
    row.hubspot_deal_id = null;
  } else if (e.hubspotChoice === 'existing') {
    row.hubspot_contact_id = e.hubspotContactId || null;
    row.hubspot_deal_id = e.hubspotDealId || null;
  } else {
    if (e.hubspotContactId) row.hubspot_contact_id = e.hubspotContactId;
    if (e.hubspotDealId) row.hubspot_deal_id = e.hubspotDealId;
  }
  return row;
}

export function fromRow(row) {
  const doc = row?.document;
  if (!doc || typeof doc !== 'object' || !doc.id) return null;
  const e = doc;
  e.remoteId = row.id;
  e.ownerId = row.owner_id;
  e.status = row.status || e.status || 'draft';
  if (row.hubspot_contact_id) e.hubspotContactId = row.hubspot_contact_id;
  if (row.hubspot_deal_id) e.hubspotDealId = row.hubspot_deal_id;
  if (row.presented_at) e.presentedAt = row.presented_at;
  if (row.signed_at) e.signedAt = row.signed_at;
  if (row.sent_at) e.sentAt = row.sent_at;
  if (row.sent_to) e.sentTo = row.sent_to;
  if (row.updated_at) e.updated = Date.parse(row.updated_at);
  const contracts = row.contracts || [];
  if (contracts.length && !e.contractRowId) {
    const latest = [...contracts].sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)))[0];
    e.contractRowId = latest.id;
  }
  return e;
}

export function toContract(e, ownerId) {
  const c = e.contract || {};
  return {
    estimate_id: e.remoteId,
    owner_id: e.ownerId || ownerId,
    agreement: {
      number: e.number,
      specifications: c.specifications || '',
      completionDate: c.completionDate || '',
      submittedBy: c.submittedBy || '',
      snapshot: c.snapshot || null,
      customer: e.customer || {},
    },
    signature_data: JSON.stringify({
      initials: c.initials || '',
      signatures: c.signatures || {},
      signedOn: c.signedOn || {},
    }),
    signer_name: e.customer?.name || '',
    signed_at: e.signedAt || new Date().toISOString(),
  };
}

function findByRemote(remoteId) {
  return Object.values(estimates.all()).find((e) => e.remoteId === remoteId) || null;
}

function addOps(remoteId, ops) {
  const q = loadQueue();
  let item = q.find((x) => x.remoteId === remoteId);
  if (!item) { item = { remoteId, ops: [] }; q.push(item); }
  if (ops.includes('delete')) item.ops = ['delete'];
  else if (!item.ops.includes('delete')) {
    for (const op of ops) if (!item.ops.includes(op)) item.ops.push(op);
  }
  saveQueue(q);
}

function setSyncState(mode) {
  const el = document.getElementById('sync-state');
  if (!el) return;
  el.className = 'syncdot' + (mode === 'ok' ? '' : ' ' + mode);
  el.title = mode === 'ok' ? 'Synced' : mode === 'wait' ? 'Waiting to sync' : 'Offline';
}

function rememberAccount(userId) {
  const prev = store.get('nwd.accountId', null);
  if (prev && prev !== userId) {
    store.set('nwd.estimates', {});
    store.set('nwd.currentId', null);
    store.set(QUEUE_KEY, []);
    estimates._cur = null;
  }
  store.set('nwd.accountId', userId);
}

const origSave = estimates.save.bind(estimates);
const origRemove = estimates.remove.bind(estimates);

function installSync() {
  if (estimates._synced) return;
  estimates._synced = true;
  estimates.save = (e) => {
    ensureRemote(e);
    origSave(e);
    addOps(e.remoteId, ['upsert']);
    scheduleFlush();
  };
  estimates.remove = (id) => {
    const e = estimates.all()[id];
    if (e?.remoteId) addOps(e.remoteId, ['delete']);
    origRemove(id);
    scheduleFlush();
  };
}

function scheduleFlush() {
  setSyncState(navigator.onLine ? 'wait' : 'off');
  clearTimeout(timer);
  timer = setTimeout(() => flush(), 700);
}

export function flush() {
  if (flushing) return flushing;
  flushing = doFlush().finally(() => { flushing = null; });
  return flushing;
}

async function flushFocused(remoteId) {
  focusRemote = remoteId;
  hubReport = null;
  await flush();
  const still = loadQueue().some((q) => q.remoteId === remoteId);
  if (still) await flush();
  return hubReport;
}

let focusRemote = null;
let hubReport = null;
let profileWarned = false;

function mergeQueue(remain, fresh) {
  const map = new Map();
  for (const item of [...remain, ...fresh]) {
    const prev = map.get(item.remoteId);
    if (!prev) map.set(item.remoteId, { remoteId: item.remoteId, ops: [...item.ops] });
    else if (item.ops.includes('delete') || prev.ops.includes('delete')) prev.ops = ['delete'];
    else for (const op of item.ops) if (!prev.ops.includes(op)) prev.ops.push(op);
  }
  return [...map.values()];
}

async function doFlush() {
  if (!navigator.onLine) { setSyncState('off'); return hubReport; }
  const sb = await getSupabase();
  if (!sb) { setSyncState('off'); return hubReport; }
  const { data: sessionData } = await sb.auth.getSession();
  const session = sessionData?.session;
  if (!session) { setSyncState('wait'); return hubReport; }
  me = session.user.id;
  const batch = loadQueue();
  saveQueue([]);
  const remain = [];
  try {
    for (const item of batch) {
      try {
        if (item.ops.includes('delete')) {
          const { error } = await sb.from('estimates').update({ deleted_at: new Date().toISOString() }).eq('id', item.remoteId);
          if (error) throw error;
          continue;
        }
        const e = findByRemote(item.remoteId);
        if (!e) continue;
        ensureRemote(e);
        const { error } = await sb.from('estimates').upsert(toRow(e, session.user.id));
        if (error) throw error;
        const left = [];
        if (item.ops.includes('contract') && !e.contractRowId) {
          const saved = await insertContract(sb, e, session.user.id);
          if (!saved) left.push('contract');
        }
        if (item.ops.includes('signed') || item.ops.includes('presented')) {
          const event = item.ops.includes('signed') ? 'signed' : 'presented';
          const hub = await syncHubspot(e, event, { quiet: true, followUp: item.ops.includes('followup') });
          if (item.remoteId === focusRemote) hubReport = hub;
          if (!hub.ok && !hub.skipped) left.push(event);
        }
        if (left.length) remain.push({ remoteId: item.remoteId, ops: ['upsert', ...left] });
      } catch (err) {
        const msg = String(err?.message || err);
        if (/foreign key|profiles/i.test(msg) && !profileWarned) {
          profileWarned = true;
          toast('This account has no profile yet. Apply the database migration, then sign in again.');
        }
        if (/signed estimate locked|only admin can reassign|hard delete is disabled/i.test(msg)) continue;
        remain.push(item);
      }
    }
    await pull(sb);
  } finally {
    saveQueue(mergeQueue(remain, loadQueue()));
  }
  const pending = loadQueue();
  setSyncState(pending.length ? 'wait' : 'ok');
  window.dispatchEvent(new Event('nwd-synced'));
  return hubReport;
}

async function insertContract(sb, e, ownerId) {
  const { data: existing, error: readErr } = await sb.from('contracts').select('id').eq('estimate_id', e.remoteId).limit(1);
  if (readErr) return false;
  if (existing?.length) {
    e.contractRowId = existing[0].id;
    origSave(e);
    return true;
  }
  const { data, error } = await sb.from('contracts').insert(toContract(e, ownerId)).select('id').single();
  if (error) return false;
  e.contractRowId = data.id;
  origSave(e);
  return true;
}

async function pull(sb) {
  const { data, error } = await sb.from('estimates').select('id, owner_id, status, document, hubspot_contact_id, hubspot_deal_id, presented_at, signed_at, sent_at, sent_to, updated_at, deleted_at, contracts(id, signed_at)').order('updated_at', { ascending: false });
  if (error || !data) return;
  const queued = new Set(loadQueue().map((q) => q.remoteId));
  const all = estimates.all();
  for (const row of data) {
    if (row.deleted_at || queued.has(row.id)) continue;
    const remote = fromRow(row);
    if (!remote) continue;
    if (estimates._cur?.id === remote.id) continue;
    const local = all[remote.id];
    if (!local || (remote.updated || 0) >= (local.updated || 0)) all[remote.id] = remote;
  }
  store.set('nwd.estimates', all);
}

export async function refreshEstimates() { await flush(); }

function hubspotChoice(e) {
  if (e?.hubspotChoice === 'new' && !e.hubspotContactId) return { createNew: true };
  if (e?.hubspotContactId || e?.hubspotChoice === 'existing') {
    return { contactId: e.hubspotContactId || null, dealId: e.hubspotDealId || null };
  }
  return null;
}

export async function syncHubspot(e, event, opts = {}) {
  const sb = await getSupabase();
  if (!sb || !e?.remoteId) return { ok: false, skipped: true };
  try {
    const body = { estimateId: e.remoteId, event };
    if (opts.followUp) body.followUp = true;
    const choice = hubspotChoice(e);
    if (choice) body.choice = choice;
    const { data, error } = await sb.functions.invoke('hubspot-sync', { body });
    if (error || !data?.ok) {
      if (!opts.quiet) toast('Saved. HubSpot sync is not available yet.');
      return { ok: false, skipped: true };
    }
    if (data.hubspot_contact_id) e.hubspotContactId = data.hubspot_contact_id;
    if (data.hubspot_deal_id) e.hubspotDealId = data.hubspot_deal_id;
    if (e.hubspotContactId) e.hubspotChoice = 'existing';
    if (Array.isArray(data.possible_matches) && data.possible_matches.length) e.hubspotPossibleMatch = data.possible_matches;
    else delete e.hubspotPossibleMatch;
    origSave(e);
    return { ok: true, data };
  } catch {
    if (!opts.quiet) toast('Saved. HubSpot sync is not available yet.');
    return { ok: false, skipped: true };
  }
}

export async function previewHubspot(e) {
  const sb = await getSupabase();
  if (!sb || !e?.remoteId) return { ok: false, skipped: true };
  try {
    const { data, error } = await sb.functions.invoke('hubspot-sync', {
      body: { estimateId: e.remoteId, event: 'presented', mode: 'preview' },
    });
    if (error || !data?.ok) return { ok: false, skipped: true };
    if (data.mode !== 'preview') {
      if (data.hubspot_contact_id) e.hubspotContactId = data.hubspot_contact_id;
      if (data.hubspot_deal_id) e.hubspotDealId = data.hubspot_deal_id;
      if (e.hubspotContactId) e.hubspotChoice = 'existing';
      return { ok: true, legacy: true, data };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, skipped: true };
  }
}

export function applyHubspotChoice(e, choice) {
  if (choice?.createNew) {
    e.hubspotChoice = 'new';
    delete e.hubspotContactId;
    delete e.hubspotDealId;
    e.hubspotPossibleMatch = (choice.matches || []).map((m) => ({
      id: m.id, name: m.name || '', phone: m.phone || '', email: m.email || '',
    }));
    return;
  }
  e.hubspotChoice = 'existing';
  e.hubspotContactId = choice.match.id;
  if (choice.match.deal?.id) e.hubspotDealId = choice.match.deal.id;
  else delete e.hubspotDealId;
  delete e.hubspotPossibleMatch;
}

export async function preparePresented(e) {
  if (!e.customer?.name && !(e.lines || []).length) {
    toast('Add a customer or a window first.');
    return { ok: false };
  }
  ensureRemote(e);
  if ((e.hubspotChoice === 'existing' || e.hubspotChoice === 'new') && (e.hubspotContactId || e.hubspotChoice === 'new')) {
    return { ok: true, ready: true };
  }
  estimates.save(e);
  await flush();
  const preview = await previewHubspot(e);
  if (!preview.ok) return { ok: true, ready: true, skipped: true };
  if (preview.legacy) return { ok: true, ready: true, legacy: true };
  const matches = preview.data?.matches || [];
  if (!matches.length) {
    e.hubspotChoice = 'new';
    return { ok: true, ready: true };
  }
  return { ok: true, ready: false, matches, autoId: preview.data?.autoId || null };
}

export async function markPresented(e, opts = {}) {
  if (!e.customer?.name && !(e.lines || []).length) { toast('Add a customer or a window first.'); return { ok: false }; }
  ensureRemote(e);
  if (e.status === 'signed') {
    estimates.save(e);
    return { ok: true, signed: true };
  }
  e.status = 'presented';
  e.presentedAt = e.presentedAt || new Date().toISOString();
  estimates.save(e);
  addOps(e.remoteId, opts.followUp ? ['presented', 'followup'] : ['presented']);
  const hub = await flushFocused(e.remoteId);
  if (!opts.quiet) {
    if (hub?.ok && hub.data?.task_error) toast('Marked presented. The follow-up task was not created.');
    else if (hub?.ok && hub.data?.note_error) toast('Marked presented. HubSpot deal updated, but the note was not attached.');
    else if (hub?.ok) toast('Marked presented. HubSpot deal updated.');
    else toast('Marked presented and saved. HubSpot sync is not available yet.');
  }
  return hub || { ok: false, skipped: true };
}

export async function sendEstimateEmail(e, pdfBase64) {
  if (browserOffline()) return { ok: false, error: OFFLINE_MESSAGE };
  const email = String(e.customer?.email || '').trim();
  if (!email || !email.includes('@')) return { ok: false, error: 'Enter the client email before sending.' };
  const sb = await getSupabase();
  if (!sb) return { ok: false, error: 'Sign in to email an estimate.' };
  ensureRemote(e);
  estimates.save(e);
  await flush();
  let data = null;
  let error = null;
  try {
    const result = await sb.functions.invoke('send-estimate', {
      body: { estimateId: e.remoteId, pdfBase64, filename: `Noble-estimate-${e.number || 'estimate'}.pdf` },
    });
    data = result.data;
    error = result.error;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Email failed. The estimate was not marked presented.' };
  }
  if (error || !data?.ok) {
    let message = data?.error;
    if (!message && error?.context?.json) {
      try { message = (await error.context.json())?.error; } catch { /* body already read */ }
    }
    return { ok: false, error: message || 'Email failed. The estimate was not marked presented.' };
  }
  e.sentAt = data.sent_at || new Date().toISOString();
  e.sentTo = data.sent_to || email;
  return { ok: true, data };
}

export async function recordSigned(e) {
  ensureRemote(e);
  e.status = 'signed';
  e.signedAt = e.signedAt || new Date().toISOString();
  estimates.save(e);
  addOps(e.remoteId, ['contract', 'signed']);
  if (browserOffline()) {
    toast(OFFLINE_MESSAGE);
    return { ok: false, offline: true };
  }
  const hub = await flushFocused(e.remoteId);
  if (!hub?.ok) toast('Agreement saved. HubSpot sync is not available yet.');
  return hub || { ok: false, skipped: true };
}

async function loadProfile(sb) {
  const { data } = await sb.from('profiles').select('id, email, full_name, role').eq('id', me).maybeSingle();
  profile = data || { id: me, role: 'sales', email: '', full_name: '' };
}

async function afterLogin(session) {
  me = session.user.id;
  rememberAccount(me);
  const sb = await getSupabase();
  if (sb) await loadProfile(sb);
  await flush();
  readyHook?.();
  mountAccount(document.getElementById('account'));
}

export function mountAccount(el) {
  if (!el) return;
  if (!me) { el.replaceChildren(); return; }
  const who = profile?.full_name || profile?.email || 'Signed in';
  el.replaceChildren(
    h('span', { class: 'syncdot', id: 'sync-state', title: 'Synced' }),
    h('span', { class: 'who' }, who),
    h('button', { type: 'button', class: 'btn sm', id: 'btn-signout', onclick: () => signOut() }, 'Sign out'));
}

export async function signOut() {
  const sb = await getSupabase();
  me = null;
  profile = null;
  if (sb) await sb.auth.signOut();
  mountAccount(document.getElementById('account'));
  signedOutHook?.();
}

export async function signIn(email, password) {
  const sb = await getSupabase();
  if (!sb) return { error: browserOffline() ? OFFLINE_MESSAGE : 'Sign-in needs a connection.' };
  const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) return { error: error.message };
  if (!data.session) return { error: 'Check your email to confirm the account, then sign in.' };
  await afterLogin(data.session);
  return { ok: true };
}

export async function signUp(email, password, fullName) {
  const sb = await getSupabase();
  if (!sb) return { error: browserOffline() ? OFFLINE_MESSAGE : 'Create account needs a connection.' };
  const known = nameForEmail(email);
  const { data, error } = await sb.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { full_name: known || fullName || '' } },
  });
  if (error) return { error: error.message };
  if (!data.session) return { error: 'Account created. Confirm the email, or turn off email confirmation in Supabase, then sign in.' };
  await afterLogin(data.session);
  return { ok: true };
}

export async function startAuth({ onReady, onSignedOut } = {}) {
  installSync();
  readyHook = onReady;
  signedOutHook = onSignedOut;
  window.addEventListener('online', () => flush());
  window.addEventListener('offline', () => setSyncState('off'));
  const sb = await getSupabase();
  if (!sb) {
    const cached = localStorage.getItem('sb-nmyatpcjqfokmfbssimc-auth-token');
    if (cached) { onReady?.(); return; }
    await showLogin('Sign-in needs a connection the first time. Estimates already on this device stay here.');
    return;
  }
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') { me = null; profile = null; }
    if (event === 'TOKEN_REFRESHED' && session) me = session.user.id;
  });
  const { data } = await sb.auth.getSession();
  if (!data.session) { await showLogin(''); return; }
  await afterLogin(data.session);
}

async function showLogin(message) {
  const { renderLogin } = await import('./pages/auth.js');
  renderLogin(document.getElementById('app'), { message, signIn, signUp });
}

export async function setUserRole(id, role) {
  const sb = await getSupabase();
  if (!sb) return { error: 'Offline' };
  const { error } = await sb.from('profiles').update({ role }).eq('id', id);
  if (error) return { error: error.message };
  if (id === me) await loadProfile(sb);
  return { ok: true };
}

export async function reassignEstimate(remoteId, ownerId) {
  const sb = await getSupabase();
  if (!sb) return { error: 'Offline' };
  const { error } = await sb.from('estimates').update({ owner_id: ownerId }).eq('id', remoteId);
  if (error) return { error: error.message };
  const local = findByRemote(remoteId);
  if (local) { local.ownerId = ownerId; origSave(local); }
  return { ok: true };
}

export async function loadAdmin() {
  const sb = await getSupabase();
  if (!sb) return { error: 'Offline' };
  const [people, rows] = await Promise.all([
    sb.from('profiles').select('id, email, full_name, role').order('full_name'),
    sb.from('estimates').select('id, owner_id, customer_name, customer_email, customer_phone, status, total_amount, updated_at, document, contracts(id, signer_name, signed_at)').order('updated_at', { ascending: false }),
  ]);
  if (people.error) return { error: people.error.message };
  if (rows.error) return { error: rows.error.message };
  return { people: people.data || [], estimates: rows.data || [] };
}

export async function loadSignatures(contractId) {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.from('contracts').select('signature_data, signer_name, signed_at').eq('id', contractId).maybeSingle();
  if (error || !data) return null;
  try { return { ...data, parsed: JSON.parse(data.signature_data || '{}') }; } catch { return { ...data, parsed: {} }; }
}
