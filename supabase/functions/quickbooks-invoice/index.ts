// One QuickBooks Online invoice per signed estimate, for the full quote.
// ACH only until Pay by card. Tokens stay in qbo_connection (service role).
// QBO_MOCK=true runs the same actions without calling Intuit.
// Do not send Invoice.Deposit. That field records money already received.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  addStageFee, applyFeeState, applyPaymentState, buildInvoice, cents, findFeeLine,
  invoicePayload, needsSendForLink, payFrom, paymentPayload, paymentView,
} from './invoice.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MINOR = '75';
const SCOPE = 'com.intuit.quickbooks.accounting';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const API_ROOT = 'https://quickbooks.api.intuit.com/v3/company';
const MOCK_COMPANY = 'Noble Windows & Doors LLC';

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function mockMode() {
  return String(Deno.env.get('QBO_MOCK') || '').trim().toLowerCase() === 'true';
}

function safeError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err || 'QuickBooks failed');
  return msg.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/refresh_token=\S+/gi, 'refresh_token=[redacted]').slice(0, 500);
}

function qboQuote(value: string) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function splitName(name: string) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { given: 'Customer', family: '' };
  if (parts.length === 1) return { given: parts[0].slice(0, 100), family: '' };
  return { given: parts[0].slice(0, 100), family: parts.slice(1).join(' ').slice(0, 100) };
}

function docNumberFor(number: string) {
  const clean = String(number || '').replace(/[^\w-]/g, '').slice(0, 21);
  return clean || '';
}

function allowedRedirect(uri: string) {
  let url: URL;
  try { url = new URL(uri); } catch { return false; }
  const pinned = String(Deno.env.get('QBO_REDIRECT_URI') || '').trim();
  if (pinned && uri === pinned) return true;
  if (url.pathname !== '/qbo-callback.html') return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return true;
  return false;
}

function storageError(message: string) {
  if (/qbo_connection|qbo_oauth_state|schema cache|does not exist/i.test(message)) {
    return 'QuickBooks storage is not set up. Run migration 004_quickbooks.sql in the Supabase SQL editor.';
  }
  return message;
}

async function caller(req: Request, admin: ReturnType<typeof createClient>) {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return { error: json(401, { ok: false, error: 'Sign in required' }) };
  const { data, error } = await admin.auth.getUser(jwt);
  const user = data?.user;
  if (error || !user) return { error: json(401, { ok: false, error: 'Sign in required' }) };
  const { data: profile } = await admin.from('profiles').select('role, email, full_name').eq('id', user.id).maybeSingle();
  return { user, profile };
}

async function loadEstimate(admin: ReturnType<typeof createClient>, id: string, user: { id: string }, profile: { role?: string } | null) {
  const { data, error } = await admin.from('estimates').select('*').eq('id', id).maybeSingle();
  if (error) return { error: json(500, { ok: false, error: storageError(error.message) }) };
  if (!data || data.deleted_at) return { error: json(404, { ok: false, error: 'Estimate not found' }) };
  if (data.owner_id !== user.id && profile?.role !== 'admin') return { error: json(403, { ok: false, error: 'Not your estimate' }) };
  return { estimate: data };
}

async function connectionRow(admin: ReturnType<typeof createClient>) {
  const { data, error } = await admin.from('qbo_connection').select('*').eq('id', 1).maybeSingle();
  if (error) return { error: json(500, { ok: false, error: storageError(error.message) }) };
  return { connection: data };
}

function notConnected() {
  return json(409, {
    ok: false,
    code: 'not_connected',
    error: 'QuickBooks is not connected. An admin must connect the Windows & Doors company before an invoice can be created.',
  });
}

async function saveTokens(admin: ReturnType<typeof createClient>, row: Record<string, unknown>) {
  const { error } = await admin.from('qbo_connection').upsert({ id: 1, ...row, updated_at: new Date().toISOString() });
  if (error) throw new Error(storageError(error.message));
}

async function intuitToken(body: URLSearchParams) {
  const clientId = Deno.env.get('INTUIT_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('INTUIT_CLIENT_SECRET') ?? '';
  if (!clientId || !clientSecret) throw new Error('INTUIT_CLIENT_ID and INTUIT_CLIENT_SECRET are not set');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(clientId + ':' + clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'QuickBooks authorization failed');
  }
  return data;
}

async function accessToken(admin: ReturnType<typeof createClient>, connection: Record<string, string>) {
  if (mockMode()) return 'mock-access-token';
  const exp = connection.access_expires_at ? Date.parse(connection.access_expires_at) : 0;
  if (connection.access_token && exp > Date.now() + 60_000) return connection.access_token;
  const data = await intuitToken(new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: connection.refresh_token,
  }));
  const next: Record<string, string> = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || connection.refresh_token,
    access_expires_at: new Date(Date.now() + (Number(data.expires_in) || 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (data.x_refresh_token_expires_in) {
    next.refresh_expires_at = new Date(Date.now() + Number(data.x_refresh_token_expires_in) * 1000).toISOString();
  }
  const { error } = await admin.from('qbo_connection').update(next).eq('id', 1);
  if (error) throw new Error(storageError(error.message));
  connection.access_token = next.access_token;
  connection.refresh_token = next.refresh_token;
  return next.access_token;
}

async function qboFetch(token: string, realm: string, path: string, init: RequestInit = {}) {
  const url = path.startsWith('http') ? path : `${API_ROOT}/${encodeURIComponent(realm)}${path}`;
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', 'Bearer ' + token);
  headers.set('Accept', 'application/json');
  if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!res.ok) {
    const message = body?.Fault?.Error?.[0]?.Message || body?.Fault?.Error?.[0]?.Detail || body?.message || res.statusText;
    const code = body?.Fault?.Error?.[0]?.code || '';
    const err = new Error(`QuickBooks ${res.status}: ${message}`);
    (err as any).qboCode = String(code || '');
    throw err;
  }
  return body;
}

async function queryOne(token: string, realm: string, sql: string) {
  const body = await qboFetch(token, realm, `/query?query=${encodeURIComponent(sql)}&minorversion=${MINOR}`);
  const key = Object.keys(body?.QueryResponse || {}).find((name) => name !== 'startPosition' && name !== 'maxResults' && name !== 'totalCount');
  const rows = key ? body.QueryResponse[key] : [];
  return Array.isArray(rows) ? rows[0] : rows || null;
}

async function companyInfo(token: string, realm: string) {
  if (mockMode()) return { companyName: MOCK_COMPANY, realmId: realm };
  const body = await qboFetch(token, realm, `/companyinfo/${encodeURIComponent(realm)}?minorversion=${MINOR}`);
  const info = body?.CompanyInfo || {};
  return { companyName: info.CompanyName || '', realmId: realm };
}

async function resolveItem(token: string, realm: string, idEnv: string, nameEnv: string, fallbackName: string, label: string) {
  const id = String(Deno.env.get(idEnv) || '').trim();
  if (id) return { id, name: String(Deno.env.get(nameEnv) || fallbackName) };
  const name = String(Deno.env.get(nameEnv) || fallbackName).trim();
  const found = await queryOne(token, realm, `select Id, Name from Item where Name = '${qboQuote(name)}'`);
  if (!found?.Id) {
    throw new Error(`QuickBooks is missing the ${label} item "${name}". Create that Service item in the Windows & Doors company, or set ${idEnv} / ${nameEnv}.`);
  }
  return { id: String(found.Id), name: found.Name || name };
}

async function itemRefs(token: string, realm: string) {
  if (mockMode()) {
    return {
      sales: { id: 'mock-sales', name: 'Windows and doors' },
      fee: { id: 'mock-fee', name: 'Card processing fee' },
      tax: { id: 'mock-tax', name: 'Sales tax' },
    };
  }
  const [sales, fee, tax] = await Promise.all([
    resolveItem(token, realm, 'QBO_ITEM_SALES_ID', 'QBO_ITEM_SALES_NAME', 'Windows and doors', 'window-and-door sales'),
    resolveItem(token, realm, 'QBO_ITEM_FEE_ID', 'QBO_ITEM_FEE_NAME', 'Card processing fee', 'processing fee'),
    resolveItem(token, realm, 'QBO_ITEM_TAX_ID', 'QBO_ITEM_TAX_NAME', 'Sales tax', 'sales tax'),
  ]);
  return { sales, fee, tax };
}

function taxCode() {
  return String(Deno.env.get('QBO_TAX_CODE') || 'NON').trim() || 'NON';
}

function quoteModel(estimate: any) {
  const doc = estimate.document || {};
  const totals = estimate.totals || {};
  const snap = doc.contract?.snapshot || null;
  const depositPct = Number(snap?.depositPct) || 60;
  const pay = payFrom(totals.total != null ? totals.total : estimate.total_amount, depositPct, snap);
  const built = buildInvoice({
    lines: doc.lines || [],
    extras: doc.extras || [],
    totals,
    pay,
    depositPct,
    descriptions: snap?.lineDescriptions || [],
  });
  return { doc, totals, pay, built, depositPct };
}

function publicState(estimate: any, extra: Record<string, unknown> = {}) {
  const view = paymentView({
    paidCents: estimate.qbo_paid_cents,
    depositCents: estimate.qbo_deposit_cents,
    amountDueCents: estimate.qbo_amount_due_cents,
  });
  return {
    ok: true,
    mock: mockMode(),
    customerId: estimate.qbo_customer_id || '',
    invoiceId: estimate.qbo_invoice_id || '',
    docNumber: estimate.qbo_doc_number || '',
    paymentLink: estimate.qbo_payment_link || '',
    state: estimate.qbo_invoice_state || '',
    notice: estimate.qbo_notice || '',
    depositCents: estimate.qbo_deposit_cents,
    balanceCents: estimate.qbo_balance_cents,
    totalCents: estimate.qbo_total_cents,
    amountDueCents: estimate.qbo_amount_due_cents,
    paidCents: estimate.qbo_paid_cents,
    feeDepositCents: estimate.qbo_fee_deposit_cents,
    feeFinalCents: estimate.qbo_fee_final_cents,
    cardOn: estimate.qbo_card_on === true,
    offlinePaymentId: estimate.qbo_offline_payment_id || '',
    offlineFinalPaymentId: estimate.qbo_offline_final_payment_id || '',
    depositReceived: view.depositReceived,
    ...extra,
  };
}

async function patchEstimate(admin: ReturnType<typeof createClient>, id: string, patch: Record<string, unknown>) {
  const { data, error } = await admin.from('estimates').update({ ...patch, qbo_synced_at: new Date().toISOString() }).eq('id', id).select('*').single();
  if (error) throw new Error(storageError(error.message));
  return data;
}

async function markError(admin: ReturnType<typeof createClient>, id: string, message: string) {
  try {
    await admin.from('estimates').update({
      qbo_invoice_state: 'error',
      qbo_invoice_error: message.slice(0, 500),
      qbo_synced_at: new Date().toISOString(),
    }).eq('id', id);
  } catch { /* the response still carries the error */ }
}

async function findOrCreateCustomer(token: string, realm: string, estimate: any) {
  const doc = estimate.document || {};
  const customer = doc.customer || {};
  const email = String(estimate.customer_email || customer.email || '').trim();
  const name = String(estimate.customer_name || customer.name || '').trim();
  const phone = String(estimate.customer_phone || customer.phone || '').trim();
  const address = String(estimate.customer_address || customer.address || '').trim();
  if (estimate.qbo_customer_id) return String(estimate.qbo_customer_id);
  if (mockMode()) {
    const key = (email || name || estimate.id).toLowerCase().replace(/[^\w]+/g, '').slice(0, 24);
    return 'mock-cust-' + (key || 'customer');
  }
  if (email) {
    const found = await queryOne(token, realm, `select * from Customer where PrimaryEmailAddr = '${qboQuote(email)}'`);
    if (found?.Id) return String(found.Id);
  }
  const who = splitName(name);
  const display = (name || email || 'Customer').slice(0, 500);
  const payload: Record<string, unknown> = {
    DisplayName: display,
    GivenName: who.given,
  };
  if (who.family) payload.FamilyName = who.family;
  if (email) payload.PrimaryEmailAddr = { Address: email };
  if (phone) payload.PrimaryPhone = { FreeFormNumber: phone.slice(0, 30) };
  if (address) payload.BillAddr = { Line1: address.slice(0, 500) };
  try {
    const created = await qboFetch(token, realm, `/customer?minorversion=${MINOR}`, { method: 'POST', body: JSON.stringify(payload) });
    return String(created.Customer.Id);
  } catch (err) {
    const code = (err as any).qboCode;
    if (code === '6240' && email) {
      payload.DisplayName = `${display} (${email})`.slice(0, 500);
      const created = await qboFetch(token, realm, `/customer?minorversion=${MINOR}`, { method: 'POST', body: JSON.stringify(payload) });
      return String(created.Customer.Id);
    }
    throw err;
  }
}

async function getInvoice(token: string, realm: string, id: string) {
  if (mockMode()) return null;
  return qboFetch(token, realm, `/invoice/${encodeURIComponent(id)}?include=invoiceLink&minorversion=${MINOR}`);
}

async function sendInvoiceEmail(token: string, realm: string, id: string, email: string) {
  const path = `/invoice/${encodeURIComponent(id)}/send?sendTo=${encodeURIComponent(email)}&minorversion=${MINOR}`;
  await qboFetch(token, realm, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: '',
  });
}

async function ensureLink(token: string, realm: string, invoiceId: string, email: string, currentLink = '') {
  if (mockMode()) {
    return {
      link: currentLink || `https://invoice.noblewandd.test/pay/${invoiceId}`,
      emailed: false,
      linkNote: '',
    };
  }
  let body = await getInvoice(token, realm, invoiceId);
  let invoice = body?.Invoice || body;
  let link = String(invoice?.InvoiceLink || '').trim();
  let emailed = false;
  let linkNote = '';
  if (needsSendForLink(invoice) && email) {
    // An unsent invoice often has no InvoiceLink. The send endpoint emails the
    // customer on file, which is what makes QuickBooks publish the pay link.
    await sendInvoiceEmail(token, realm, invoiceId, email);
    emailed = true;
    body = await getInvoice(token, realm, invoiceId);
    invoice = body?.Invoice || body;
    link = String(invoice?.InvoiceLink || '').trim();
    linkNote = emailed
      ? 'QuickBooks had no payment link on the unsent invoice, so the function emailed the invoice to the customer on file and read the link again.'
      : '';
  }
  return { link, emailed, linkNote, invoice };
}

function decodePdf(pdfBase64: string) {
  const clean = String(pdfBase64 || '').replace(/^data:application\/pdf;base64,/i, '').replace(/\s/g, '');
  if (!clean) return null;
  let bin = '';
  try { bin = atob(clean); } catch { return { error: 'The contract PDF could not be read' }; }
  if (!bin.startsWith('%PDF-')) return { error: 'A PDF attachment is required' };
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes };
}

async function attachPdf(token: string, realm: string, invoiceId: string, bytes: Uint8Array, filename: string) {
  if (mockMode()) return 'mock-attachment';
  const boundary = 'nwd' + crypto.randomUUID().replace(/-/g, '');
  const meta = JSON.stringify({
    FileName: filename,
    ContentType: 'application/pdf',
    AttachableRef: [{ EntityRef: { type: 'Invoice', value: String(invoiceId) } }],
  });
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file_metadata_01"; filename="attachment.json"\r\nContent-Type: application/json\r\n\r\n${meta}\r\n`;
  const mid = `--${boundary}\r\nContent-Disposition: form-data; name="file_content_01"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const encoder = new TextEncoder();
  const body = new Uint8Array(encoder.encode(head).length + encoder.encode(mid).length + bytes.length + encoder.encode(tail).length);
  let offset = 0;
  for (const part of [encoder.encode(head), encoder.encode(mid), bytes, encoder.encode(tail)]) {
    body.set(part, offset);
    offset += part.length;
  }
  const res = await fetch(`${API_ROOT}/${encodeURIComponent(realm)}/upload?minorversion=${MINOR}`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
    },
    body,
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  if (!res.ok) {
    const message = parsed?.Fault?.Error?.[0]?.Message || res.statusText;
    throw new Error('Could not attach the signed contract: ' + message);
  }
  const id = parsed?.AttachableResponse?.[0]?.Attachable?.Id || parsed?.Attachable?.Id || '';
  return String(id || 'attached');
}

async function createInvoice(admin: ReturnType<typeof createClient>, estimate: any, pdfBase64: string) {
  if (estimate.status !== 'signed') return json(400, { ok: false, error: 'Sign the agreement before creating the invoice.' });
  const conn = await connectionRow(admin);
  if (conn.error) return conn.error;
  if (!conn.connection?.realm_id) return notConnected();
  const connection = conn.connection;
  const token = await accessToken(admin, connection);
  const realm = String(connection.realm_id);
  const { doc, built } = quoteModel(estimate);
  const email = String(estimate.customer_email || doc.customer?.email || '').trim();

    if (estimate.qbo_invoice_id) {
    let attachmentId = estimate.qbo_attachment_id || '';
    let attachmentError = '';
    const pdf = decodePdf(pdfBase64);
    if (pdf && 'error' in pdf) attachmentError = pdf.error;
    else if (pdf && !attachmentId) {
      try {
        attachmentId = await attachPdf(token, realm, estimate.qbo_invoice_id, pdf.bytes, `Noble-contract-${docNumberFor(doc.number || 'contract')}.pdf`);
      } catch (err) {
        attachmentError = safeError(err);
      }
    }
    const linked = await ensureLink(token, realm, estimate.qbo_invoice_id, email, estimate.qbo_payment_link || '');
    const saved = await patchEstimate(admin, estimate.id, {
      qbo_attachment_id: attachmentId || estimate.qbo_attachment_id || null,
      qbo_payment_link: linked.link || estimate.qbo_payment_link || null,
      qbo_invoice_state: 'created',
      qbo_invoice_error: null,
    });
    return json(200, publicState(saved, {
      attached: Boolean(attachmentId),
      attachmentError,
      linkNote: linked.linkNote || '',
      reused: true,
    }));
  }

  const items = await itemRefs(token, realm);
  const customerId = await findOrCreateCustomer(token, realm, estimate);
  const number = doc.number || '';
  const payload = invoicePayload({
    built,
    customerId,
    email,
    docNumber: docNumberFor(number),
    items,
    taxCode: taxCode(),
  });
  let invoiceId = '';
  let docNumber = payload.DocNumber || '';
  if (mockMode()) {
    invoiceId = 'mock-inv-' + String(estimate.id).replace(/-/g, '').slice(0, 12);
    docNumber = docNumber || invoiceId;
  } else {
    let created: any;
    try {
      created = await qboFetch(token, realm, `/invoice?minorversion=${MINOR}`, { method: 'POST', body: JSON.stringify(payload) });
    } catch (err) {
      const code = (err as any).qboCode;
      if (payload.DocNumber && (code === '6140' || /duplicate|doc number/i.test(String((err as Error).message)))) {
        delete payload.DocNumber;
        created = await qboFetch(token, realm, `/invoice?minorversion=${MINOR}`, { method: 'POST', body: JSON.stringify(payload) });
      } else throw err;
    }
    invoiceId = String(created.Invoice.Id);
    docNumber = created.Invoice.DocNumber || docNumber;
  }

  await patchEstimate(admin, estimate.id, {
    qbo_customer_id: customerId,
    qbo_invoice_id: invoiceId,
    qbo_doc_number: docNumber,
    qbo_invoice_state: 'created',
    qbo_invoice_error: null,
    qbo_notice: built.notice,
    qbo_deposit_cents: built.depositCents,
    qbo_balance_cents: built.balanceCents,
    qbo_total_cents: built.totalCents,
    qbo_amount_due_cents: built.totalCents,
    qbo_paid_cents: 0,
    qbo_card_on: false,
  });

  let attachmentId = '';
  let attachmentError = '';
  const pdf = decodePdf(pdfBase64);
  if (pdf && 'error' in pdf) {
    attachmentError = pdf.error;
  } else if (pdf) {
    try {
      attachmentId = await attachPdf(token, realm, invoiceId, pdf.bytes, `Noble-contract-${docNumberFor(number || invoiceId)}.pdf`);
    } catch (err) {
      attachmentError = safeError(err);
    }
  }
  const linked = await ensureLink(token, realm, invoiceId, email, '');
  const saved = await patchEstimate(admin, estimate.id, {
    qbo_customer_id: customerId,
    qbo_invoice_id: invoiceId,
    qbo_doc_number: docNumber,
    qbo_payment_link: linked.link || null,
    qbo_invoice_state: 'created',
    qbo_invoice_error: null,
    qbo_notice: built.notice,
    qbo_deposit_cents: built.depositCents,
    qbo_balance_cents: built.balanceCents,
    qbo_total_cents: built.totalCents,
    qbo_amount_due_cents: built.totalCents,
    qbo_paid_cents: 0,
    qbo_card_on: false,
    qbo_attachment_id: attachmentId || null,
  });
  return json(200, publicState(saved, {
    attached: Boolean(attachmentId),
    attachmentError,
    linkNote: linked.linkNote || '',
    reused: false,
  }));
}

function feeBase(estimate: any, stage: string, liveBalanceCents: number | null) {
  if (stage === 'deposit') return estimate.qbo_deposit_cents;
  if (stage === 'final') return liveBalanceCents != null ? liveBalanceCents : estimate.qbo_amount_due_cents;
  return null;
}

async function enableCard(admin: ReturnType<typeof createClient>, estimate: any, stage: string) {
  if (stage !== 'deposit' && stage !== 'final') return json(400, { ok: false, error: 'stage must be deposit or final' });
  if (!estimate.qbo_invoice_id) return json(409, { ok: false, error: 'Create the QuickBooks invoice before turning on card payments.' });
  const conn = await connectionRow(admin);
  if (conn.error) return conn.error;
  if (!conn.connection?.realm_id) return notConnected();
  const column = stage === 'deposit' ? estimate.qbo_fee_deposit_cents : estimate.qbo_fee_final_cents;
  const token = await accessToken(admin, conn.connection);
  const realm = String(conn.connection.realm_id);
  const items = await itemRefs(token, realm);
  const code = taxCode();

  if (mockMode()) {
    if (column != null) {
      const saved = await patchEstimate(admin, estimate.id, { qbo_card_on: true, qbo_invoice_state: 'created', qbo_invoice_error: null });
      return json(200, publicState(saved, { added: false, stage }));
    }
    const base = feeBase(estimate, stage, null);
    if (base == null) return json(409, { ok: false, error: 'The invoice has no amount for this payment yet.' });
    if (base < 0) return json(409, { ok: false, error: 'Nothing is due on this invoice.' });
    const applied = applyFeeState({
      lines: [],
      depositCents: estimate.qbo_deposit_cents,
      amountDueCents: stage === 'final' ? base : estimate.qbo_amount_due_cents,
      totalCents: estimate.qbo_total_cents,
      feeDepositCents: estimate.qbo_fee_deposit_cents,
      feeFinalCents: estimate.qbo_fee_final_cents,
    }, stage);
    const saved = await patchEstimate(admin, estimate.id, {
      qbo_fee_deposit_cents: applied.state.feeDepositCents,
      qbo_fee_final_cents: applied.state.feeFinalCents,
      qbo_total_cents: applied.state.totalCents,
      qbo_amount_due_cents: applied.state.amountDueCents,
      qbo_card_on: true,
      qbo_invoice_state: 'created',
      qbo_invoice_error: null,
    });
    return json(200, publicState(saved, { added: applied.added, stage, feeCents: applied.feeCents, baseCents: applied.baseCents }));
  }

  const body = await getInvoice(token, realm, estimate.qbo_invoice_id);
  const invoice = body?.Invoice;
  if (!invoice) return json(502, { ok: false, error: 'QuickBooks did not return the invoice.' });
  const existingFee = findFeeLine(invoice.Line || [], stage);
  if (existingFee || column != null) {
    const feeCents = existingFee ? cents(existingFee.Amount) : column;
    const saved = await patchEstimate(admin, estimate.id, {
      ...(stage === 'deposit' ? { qbo_fee_deposit_cents: feeCents } : { qbo_fee_final_cents: feeCents }),
      qbo_card_on: true,
      qbo_invoice_state: 'created',
      qbo_invoice_error: null,
      qbo_amount_due_cents: cents(invoice.Balance),
      qbo_total_cents: cents(invoice.TotalAmt),
    });
    return json(200, publicState(saved, { added: false, stage, feeCents }));
  }
  const liveBalance = cents(invoice.Balance);
  const base = feeBase(estimate, stage, liveBalance);
  if (base == null) return json(409, { ok: false, error: 'The invoice has no amount for this payment yet.' });
  if (base <= 0) return json(409, { ok: false, error: 'Nothing is due on this invoice.' });
  const fee = addStageFee([], stage, base);
  const keep = (invoice.Line || []).filter((line: any) => line.DetailType === 'SalesItemLineDetail' || line.DetailType === 'DescriptionOnly' || line.DetailType === 'DiscountLineDetail');
  const updated = await qboFetch(token, realm, `/invoice?minorversion=${MINOR}`, {
    method: 'POST',
    body: JSON.stringify({
      Id: invoice.Id,
      SyncToken: invoice.SyncToken,
      sparse: true,
      AllowOnlineACHPayment: true,
      AllowOnlineCreditCardPayment: true,
      Line: [...keep, ...invoicePayload({
        built: { notice: '', lines: [fee.lines[0]] },
        customerId: estimate.qbo_customer_id,
        email: '',
        docNumber: '',
        items,
        taxCode: code,
      }).Line.filter((line) => line.DetailType === 'SalesItemLineDetail')],
    }),
  });
  const next = updated.Invoice;
  const saved = await patchEstimate(admin, estimate.id, {
    ...(stage === 'deposit' ? { qbo_fee_deposit_cents: fee.feeCents } : { qbo_fee_final_cents: fee.feeCents }),
    qbo_card_on: true,
    qbo_total_cents: cents(next?.TotalAmt),
    qbo_amount_due_cents: cents(next?.Balance),
    qbo_invoice_state: 'created',
    qbo_invoice_error: null,
  });
  return json(200, publicState(saved, { added: true, stage, feeCents: fee.feeCents, baseCents: fee.baseCents }));
}

async function refreshInvoice(admin: ReturnType<typeof createClient>, estimate: any) {
  if (!estimate.qbo_invoice_id) return json(409, { ok: false, error: 'This estimate has no QuickBooks invoice yet.' });
  const conn = await connectionRow(admin);
  if (conn.error) return conn.error;
  if (!conn.connection?.realm_id) return notConnected();
  if (mockMode()) {
    const saved = await patchEstimate(admin, estimate.id, { qbo_invoice_state: 'created', qbo_invoice_error: null });
    return json(200, publicState(saved, { refreshed: true }));
  }
  const token = await accessToken(admin, conn.connection);
  const body = await getInvoice(token, String(conn.connection.realm_id), estimate.qbo_invoice_id);
  const invoice = body?.Invoice;
  if (!invoice) return json(502, { ok: false, error: 'QuickBooks did not return the invoice.' });
  const total = cents(invoice.TotalAmt);
  const due = cents(invoice.Balance);
  const saved = await patchEstimate(admin, estimate.id, {
    qbo_total_cents: total,
    qbo_amount_due_cents: due,
    qbo_paid_cents: total - due,
    qbo_payment_link: invoice.InvoiceLink || estimate.qbo_payment_link || null,
    qbo_doc_number: invoice.DocNumber || estimate.qbo_doc_number || null,
    qbo_card_on: invoice.AllowOnlineCreditCardPayment === true || estimate.qbo_card_on === true,
    qbo_invoice_state: 'created',
    qbo_invoice_error: null,
  });
  return json(200, publicState(saved, { refreshed: true }));
}

async function recordPayment(admin: ReturnType<typeof createClient>, estimate: any, purpose: string, amountCents: number | null) {
  if (purpose !== 'deposit' && purpose !== 'final') return json(400, { ok: false, error: 'purpose must be deposit or final' });
  if (!estimate.qbo_invoice_id || !estimate.qbo_customer_id) return json(409, { ok: false, error: 'Create the QuickBooks invoice first.' });
  const column = purpose === 'deposit' ? 'qbo_offline_payment_id' : 'qbo_offline_final_payment_id';
  if (estimate[column]) {
    return json(200, publicState(estimate, { paymentId: estimate[column], reused: true, purpose }));
  }
  const conn = await connectionRow(admin);
  if (conn.error) return conn.error;
  if (!conn.connection?.realm_id) return notConnected();
  const amount = amountCents != null ? amountCents : (purpose === 'deposit' ? estimate.qbo_deposit_cents : estimate.qbo_amount_due_cents);
  if (amount == null || amount <= 0) return json(400, { ok: false, error: 'Enter an amount greater than zero.' });
  let paymentId = '';
  if (mockMode()) {
    paymentId = 'mock-pay-' + purpose + '-' + String(estimate.id).replace(/-/g, '').slice(0, 10);
    const next = applyPaymentState({
      paidCents: estimate.qbo_paid_cents || 0,
      totalCents: estimate.qbo_total_cents || 0,
    }, amount);
    const saved = await patchEstimate(admin, estimate.id, {
      [column]: paymentId,
      qbo_paid_cents: next.paidCents,
      qbo_amount_due_cents: next.amountDueCents,
      qbo_invoice_state: 'created',
      qbo_invoice_error: null,
    });
    return json(200, publicState(saved, { paymentId, purpose, amountCents: amount, reused: false }));
  }
  const token = await accessToken(admin, conn.connection);
  const payload = paymentPayload({
    customerId: estimate.qbo_customer_id,
    invoiceId: estimate.qbo_invoice_id,
    amountCents: amount,
  });
  const created = await qboFetch(token, String(conn.connection.realm_id), `/payment?minorversion=${MINOR}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  paymentId = String(created?.Payment?.Id || '');
  const refreshed = await getInvoice(token, String(conn.connection.realm_id), estimate.qbo_invoice_id);
  const invoice = refreshed?.Invoice;
  const total = invoice ? cents(invoice.TotalAmt) : estimate.qbo_total_cents;
  const due = invoice ? cents(invoice.Balance) : (estimate.qbo_amount_due_cents || 0) - amount;
  const saved = await patchEstimate(admin, estimate.id, {
    [column]: paymentId,
    qbo_total_cents: total,
    qbo_amount_due_cents: due,
    qbo_paid_cents: total != null && due != null ? total - due : (estimate.qbo_paid_cents || 0) + amount,
    qbo_invoice_state: 'created',
    qbo_invoice_error: null,
  });
  return json(200, publicState(saved, { paymentId, purpose, amountCents: amount, reused: false }));
}

async function oauthStart(admin: ReturnType<typeof createClient>, userId: string, redirectUri: string) {
  if (!allowedRedirect(redirectUri)) return json(400, { ok: false, error: 'Redirect address must be the app qbo-callback.html page.' });
  const state = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const { error } = await admin.from('qbo_oauth_state').insert({ state, user_id: userId });
  if (error) return json(500, { ok: false, error: storageError(error.message) });
  if (mockMode()) {
    const url = new URL(redirectUri);
    url.searchParams.set('code', 'mock-code');
    url.searchParams.set('state', state);
    url.searchParams.set('realmId', 'mock-wnd');
    return json(200, { ok: true, url: url.toString(), mock: true });
  }
  const clientId = Deno.env.get('INTUIT_CLIENT_ID') ?? '';
  if (!clientId || !(Deno.env.get('INTUIT_CLIENT_SECRET') ?? '')) {
    return json(500, { ok: false, error: 'INTUIT_CLIENT_ID and INTUIT_CLIENT_SECRET are not set' });
  }
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: SCOPE,
    redirect_uri: redirectUri,
    state,
  });
  return json(200, { ok: true, url: AUTH_URL + '?' + params.toString(), mock: false });
}

async function oauthCallback(admin: ReturnType<typeof createClient>, userId: string, code: string, state: string, realmId: string, redirectUri: string) {
  if (!code || !state || !realmId) return json(400, { ok: false, error: 'QuickBooks did not return a code, state, and company id.' });
  if (!allowedRedirect(redirectUri)) return json(400, { ok: false, error: 'Redirect address must be the app qbo-callback.html page.' });
  const { data: row, error } = await admin.from('qbo_oauth_state').select('*').eq('state', state).maybeSingle();
  if (error) return json(500, { ok: false, error: storageError(error.message) });
  if (!row || row.used_at || row.user_id !== userId) return json(400, { ok: false, error: 'This QuickBooks connection link has expired. Start it again from Admin.' });
  if (Date.now() - Date.parse(row.created_at) > 15 * 60 * 1000) return json(400, { ok: false, error: 'This QuickBooks connection link has expired. Start it again from Admin.' });
  await admin.from('qbo_oauth_state').update({ used_at: new Date().toISOString() }).eq('state', state);
  let access = 'mock-access-token';
  let refresh = 'mock-refresh-token';
  let accessExpires = new Date(Date.now() + 3600 * 1000).toISOString();
  let refreshExpires = new Date(Date.now() + 100 * 86400 * 1000).toISOString();
  let companyName = MOCK_COMPANY;
  if (!mockMode()) {
    const data = await intuitToken(new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }));
    access = data.access_token;
    refresh = data.refresh_token || refresh;
    accessExpires = new Date(Date.now() + (Number(data.expires_in) || 3600) * 1000).toISOString();
    if (data.x_refresh_token_expires_in) {
      refreshExpires = new Date(Date.now() + Number(data.x_refresh_token_expires_in) * 1000).toISOString();
    }
    const info = await companyInfo(access, realmId);
    companyName = info.companyName || '';
  }
  await saveTokens(admin, {
    realm_id: realmId,
    company_name: companyName,
    access_token: access,
    refresh_token: refresh,
    access_expires_at: accessExpires,
    refresh_expires_at: refreshExpires,
    connected_by: userId,
  });
  return json(200, { ok: true, connected: true, companyName, realmId, mock: mockMode() });
}

async function status(admin: ReturnType<typeof createClient>, isAdmin: boolean) {
  const conn = await connectionRow(admin);
  if (conn.error) return conn.error;
  const row = conn.connection;
  if (!row?.realm_id) return json(200, { ok: true, connected: false, companyName: '', mock: mockMode() });
  let companyName = row.company_name || '';
  if (!mockMode()) {
    try {
      const token = await accessToken(admin, row);
      const info = await companyInfo(token, String(row.realm_id));
      if (info.companyName && info.companyName !== companyName) {
        companyName = info.companyName;
        await admin.from('qbo_connection').update({ company_name: companyName, updated_at: new Date().toISOString() }).eq('id', 1);
      }
    } catch (err) {
      return json(200, {
        ok: true,
        connected: true,
        companyName,
        realmId: isAdmin ? row.realm_id : undefined,
        mock: false,
        warning: safeError(err),
      });
    }
  }
  return json(200, {
    ok: true,
    connected: true,
    companyName,
    realmId: isAdmin ? row.realm_id : undefined,
    mock: mockMode(),
  });
}

async function disconnect(admin: ReturnType<typeof createClient>) {
  const { error } = await admin.from('qbo_connection').delete().eq('id', 1);
  if (error) return json(500, { ok: false, error: storageError(error.message) });
  return json(200, { ok: true, connected: false });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only' });
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !serviceKey) return json(500, { ok: false, error: 'Supabase service role is not available' });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const who = await caller(req, admin);
  if (who.error) return who.error;
  const isAdmin = who.profile?.role === 'admin';

  let payload: any = {};
  try { payload = await req.json(); } catch { return json(400, { ok: false, error: 'Expected JSON' }); }
  const action = String(payload.action || 'create');

  try {
    if (action === 'status') return await status(admin, isAdmin);
    if (action === 'oauth-start' || action === 'oauth-callback' || action === 'disconnect') {
      if (!isAdmin) return json(403, { ok: false, error: 'Only an admin can connect QuickBooks.' });
      if (action === 'disconnect') return await disconnect(admin);
      if (action === 'oauth-start') return await oauthStart(admin, who.user.id, String(payload.redirectUri || ''));
      return await oauthCallback(
        admin,
        who.user.id,
        String(payload.code || ''),
        String(payload.state || ''),
        String(payload.realmId || ''),
        String(payload.redirectUri || ''),
      );
    }

    const estimateId = String(payload.estimateId || '');
    if (!estimateId) return json(400, { ok: false, error: 'estimateId is required' });
    const loaded = await loadEstimate(admin, estimateId, who.user, who.profile);
    if (loaded.error) return loaded.error;
    const estimate = loaded.estimate;

    if (action === 'create') return await createInvoice(admin, estimate, String(payload.pdfBase64 || ''));
    if (action === 'enable-card') return await enableCard(admin, estimate, String(payload.stage || 'deposit'));
    if (action === 'refresh') return await refreshInvoice(admin, estimate);
    if (action === 'record-payment') {
      let amountCents: number | null = null;
      if (payload.amountCents != null && payload.amountCents !== '') {
        const n = Number(payload.amountCents);
        if (!Number.isFinite(n)) return json(400, { ok: false, error: 'amountCents must be whole cents.' });
        amountCents = Math.round(n);
      }
      return await recordPayment(admin, estimate, String(payload.purpose || 'deposit'), amountCents);
    }
    return json(400, { ok: false, error: 'Unknown action' });
  } catch (err) {
    const message = safeError(err);
    const estimateId = String(payload.estimateId || '');
    if (estimateId && (action === 'create' || action === 'enable-card' || action === 'refresh' || action === 'record-payment')) {
      await markError(admin, estimateId, message);
    }
    console.error(message);
    return json(502, { ok: false, error: message });
  }
});
