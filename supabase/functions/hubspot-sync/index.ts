// Finds or creates a HubSpot contact, then creates or updates the deal for one estimate.
// Secret: HUBSPOT_TOKEN (a private-app token). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// are injected by Supabase. The app keeps working when this function is not deployed.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function digits(value: string) {
  return String(value || '').replace(/\D/g, '');
}

async function hubspot(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch('https://api.hubapi.com' + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!res.ok) {
    const message = body?.message || body?.raw || res.statusText;
    throw new Error(`HubSpot ${res.status}: ${message}`);
  }
  return body;
}

async function searchContact(token: string, property: string, value: string) {
  const found = await hubspot(token, '/crm/v3/objects/contacts/search', {
    method: 'POST',
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: property, operator: 'EQ', value }] }],
      properties: ['email', 'phone', 'firstname', 'lastname'],
      limit: 1,
    }),
  });
  return found?.results?.[0] || null;
}

async function findOrCreateContact(token: string, estimate: any) {
  const email = String(estimate.customer_email || '').trim();
  const phone = String(estimate.customer_phone || '').trim();
  const name = String(estimate.customer_name || '').trim();
  let contact = email ? await searchContact(token, 'email', email) : null;
  if (!contact && phone) contact = await searchContact(token, 'phone', phone);
  if (!contact && digits(phone).length >= 10) {
    const d = digits(phone);
    contact = await searchContact(token, 'phone', d.length === 10 ? `+1${d}` : `+${d}`);
  }
  if (contact) return contact;
  const parts = name.split(/\s+/).filter(Boolean);
  const properties: Record<string, string> = {};
  if (email) properties.email = email;
  if (phone) properties.phone = phone;
  if (parts[0]) properties.firstname = parts[0];
  if (parts.length > 1) properties.lastname = parts.slice(1).join(' ');
  if (estimate.customer_address) properties.address = String(estimate.customer_address);
  if (!Object.keys(properties).length) properties.firstname = 'Customer';
  return hubspot(token, '/crm/v3/objects/contacts', {
    method: 'POST',
    body: JSON.stringify({ properties }),
  });
}

async function dealStage(token: string, event: string) {
  const pipelines = await hubspot(token, '/crm/v3/pipelines/deals');
  const list = pipelines?.results || [];
  const pipeline = list.find((p: any) => p.id === 'default') || list[0];
  const stages = pipeline?.stages || [];
  const label = (s: any) => String(s.label || '');
  let stage = null;
  if (event === 'signed') {
    stage = stages.find((s: any) => /closed\s*won/i.test(label(s)) || s.id === 'closedwon');
  } else {
    stage = stages.find((s: any) => /presentation/i.test(label(s)))
      || stages.find((s: any) => /appointment/i.test(label(s)))
      || stages.find((s: any) => s.id === 'presentationscheduled' || s.id === 'appointmentscheduled');
  }
  return {
    pipelineId: pipeline?.id || 'default',
    stageId: stage?.id || (event === 'signed' ? 'closedwon' : 'presentationscheduled'),
    stageLabel: stage?.label || (event === 'signed' ? 'Closed Won' : 'Presentation Scheduled'),
  };
}

async function upsertDeal(token: string, estimate: any, event: string, contactId: string | null) {
  const stage = await dealStage(token, event);
  const doc = estimate.document || {};
  const number = doc.number || estimate.id;
  const who = estimate.customer_name || 'Customer';
  const amount = estimate.total_amount == null ? '0' : String(estimate.total_amount);
  const properties: Record<string, string> = {
    dealname: `${who} — ${number}`,
    amount,
    pipeline: stage.pipelineId,
    dealstage: stage.stageId,
  };
  let dealId = estimate.hubspot_deal_id || null;
  if (dealId) {
    await hubspot(token, `/crm/v3/objects/deals/${dealId}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties }),
    });
  } else {
    const created = await hubspot(token, '/crm/v3/objects/deals', {
      method: 'POST',
      body: JSON.stringify({ properties }),
    });
    dealId = created.id;
  }
  if (contactId && dealId) {
    await hubspot(token, `/crm/v4/objects/deals/${dealId}/associations/default/contacts/${contactId}`, {
      method: 'PUT',
      body: '{}',
    });
  }
  return { dealId, ...stage };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only' });

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const token = Deno.env.get('HUBSPOT_TOKEN') ?? '';
  if (!url || !serviceKey) return json(500, { ok: false, error: 'Supabase service role is not available' });
  if (!token) return json(500, { ok: false, error: 'HUBSPOT_TOKEN is not set' });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { ok: false, error: 'Sign in required' });
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  const user = userData?.user;
  if (userErr || !user) return json(401, { ok: false, error: 'Sign in required' });

  let payload: any = {};
  try { payload = await req.json(); } catch { return json(400, { ok: false, error: 'Expected JSON' }); }
  const estimateId = String(payload.estimateId || '');
  const event = payload.event === 'signed' ? 'signed' : payload.event === 'presented' ? 'presented' : '';
  if (!estimateId || !event) return json(400, { ok: false, error: 'estimateId and event are required' });

  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
  const { data: estimate, error: estErr } = await admin.from('estimates').select('*').eq('id', estimateId).maybeSingle();
  if (estErr) return json(500, { ok: false, error: estErr.message });
  if (!estimate || estimate.deleted_at) return json(404, { ok: false, error: 'Estimate not found' });
  if (estimate.owner_id !== user.id && profile?.role !== 'admin') return json(403, { ok: false, error: 'Not your estimate' });

  try {
    const contact = await findOrCreateContact(token, estimate);
    const deal = await upsertDeal(token, estimate, event, contact?.id || null);
    const { error: saveErr } = await admin.from('estimates').update({
      hubspot_contact_id: contact?.id || estimate.hubspot_contact_id || null,
      hubspot_deal_id: deal.dealId,
    }).eq('id', estimateId);
    if (saveErr) return json(500, { ok: false, error: saveErr.message });
    return json(200, {
      ok: true,
      event,
      hubspot_contact_id: contact?.id || null,
      hubspot_deal_id: deal.dealId,
      stage: deal.stageLabel,
    });
  } catch (err) {
    return json(502, { ok: false, error: err instanceof Error ? err.message : 'HubSpot request failed' });
  }
});
