// Finds an existing HubSpot contact and open deal for an estimate, or creates one.
// Preview mode only searches. Sync links a confident match (or the rep's choice)
// and attaches an estimate note. Secret: HUBSPOT_TOKEN. The app still saves locally
// when this function is not deployed.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  customerQuery, normEmail, parseName, phoneFormats, rankCandidates, resolveContactChoice, pickDeal,
} from './match.js';
import { followUpDue, followUpTitle, matchOwner } from './followup.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CONTACT_PROPS = ['email', 'phone', 'mobilephone', 'firstname', 'lastname', 'address', 'zip', 'city'];
const DEAL_PROPS = ['dealname', 'amount', 'dealstage', 'pipeline', 'hs_is_closed', 'hs_is_closed_won', 'hs_lastmodifieddate'];

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
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

function chunks<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function searchContacts(token: string, filterGroups: any[], limit = 20) {
  if (!filterGroups.length) return [];
  const found = await hubspot(token, '/crm/v3/objects/contacts/search', {
    method: 'POST',
    body: JSON.stringify({ filterGroups, properties: CONTACT_PROPS, limit }),
  });
  return found?.results || [];
}

async function gatherContacts(token: string, query: { name: string; email: string; phone: string; address: string }) {
  const map = new Map<string, any>();
  const add = (rows: any[]) => {
    for (const row of rows) if (row?.id && !map.has(String(row.id))) map.set(String(row.id), row);
  };
  const email = normEmail(query.email);
  if (email) {
    add(await searchContacts(token, [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }]));
  }
  for (const group of chunks(phoneFormats(query.phone), 5)) {
    add(await searchContacts(token, group.map((value) => ({ filters: [{ propertyName: 'phone', operator: 'EQ', value }] }))));
    add(await searchContacts(token, group.map((value) => ({ filters: [{ propertyName: 'mobilephone', operator: 'EQ', value }] }))));
  }
  const name = parseName(query.name);
  const lastNames = [...new Set([name.last, name.last ? name.last.replace(/\b\w/g, (c) => c.toUpperCase()) : ''].filter(Boolean))];
  for (const last of lastNames) {
    add(await searchContacts(token, [{ filters: [{ propertyName: 'lastname', operator: 'EQ', value: last }] }], 25));
  }
  return [...map.values()];
}

async function dealsForContact(token: string, contactId: string) {
  const assoc = await hubspot(token, `/crm/v4/objects/contacts/${contactId}/associations/deals`);
  const ids = (assoc?.results || []).map((r: any) => r.toObjectId || r.id).filter(Boolean).map(String);
  if (!ids.length) return [];
  const read = await hubspot(token, '/crm/v3/objects/deals/batch/read', {
    method: 'POST',
    body: JSON.stringify({
      properties: DEAL_PROPS,
      inputs: ids.slice(0, 50).map((id) => ({ id })),
    }),
  });
  return read?.results || [];
}

function openDealSummary(deals: any[]) {
  const pick = pickDeal({ deals });
  if (pick.action !== 'update') return null;
  const deal = deals.find((d) => String(d.id) === pick.dealId);
  const p = deal?.properties || {};
  return { id: pick.dealId, name: p.dealname || '', amount: p.amount || '', stage: p.dealstage || '' };
}

async function createContact(token: string, query: { name: string; email: string; phone: string; address: string }) {
  const name = parseName(query.name);
  const properties: Record<string, string> = {};
  const email = normEmail(query.email);
  if (email) properties.email = email;
  if (query.phone) properties.phone = String(query.phone).trim();
  if (name.first) properties.firstname = name.first;
  if (name.last) properties.lastname = name.last;
  if (query.address) properties.address = String(query.address).trim();
  if (!Object.keys(properties).length) properties.firstname = 'Customer';
  return hubspot(token, '/crm/v3/objects/contacts', {
    method: 'POST',
    body: JSON.stringify({ properties }),
  });
}

async function dealStage(token: string, event: string, pipelineHint?: string) {
  const pipelines = await hubspot(token, '/crm/v3/pipelines/deals');
  const list = pipelines?.results || [];
  const pipeline = list.find((p: any) => p.id === pipelineHint)
    || list.find((p: any) => p.id === 'default')
    || list[0];
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

function noteBody(estimate: any, event: string, flag: any[]) {
  const doc = estimate.document || {};
  const lines = doc.lines || [];
  const windows = lines.reduce((n: number, line: any) => n + (Number(line?.qty) > 0 ? Number(line.qty) : 1), 0);
  const totalNum = Number(estimate.total_amount);
  const total = Number.isFinite(totalNum) ? `$${totalNum.toFixed(2)}` : '';
  const cents = Number.isFinite(totalNum) ? Math.round(totalNum * 100) : null;
  const depositCents = cents == null ? null : Math.round(cents * 60 / 100);
  const linesOut = [
    `Estimate ${doc.number || estimate.id} ${event}`,
    `Customer: ${estimate.customer_name || ''}`,
    `Phone: ${estimate.customer_phone || ''}`,
    `Email: ${estimate.customer_email || ''}`,
    `Address: ${estimate.customer_address || ''}`,
    `Windows: ${windows}`,
    `Total: ${total}`,
  ];
  if (depositCents != null && cents != null) {
    linesOut.push(`Deposit (60%): $${(depositCents / 100).toFixed(2)}`);
    linesOut.push(`Final (40%): $${((cents - depositCents) / 100).toFixed(2)}`);
  }
  const extraPct = Number(doc.percentDiscount);
  if (extraPct > 0) linesOut.push(`Additional materials discount: ${Math.min(extraPct, 10)}%`);
  if (flag?.length) {
    linesOut.push('Possible matching contacts were not linked:');
    for (const match of flag) linesOut.push(`- ${match.name || 'Unnamed'} · ${match.phone || ''} · ${match.email || ''}`);
  }
  return linesOut.join('\n');
}

async function attachNote(token: string, dealId: string, body: string) {
  const note = await hubspot(token, '/crm/v3/objects/notes', {
    method: 'POST',
    body: JSON.stringify({
      properties: { hs_timestamp: new Date().toISOString(), hs_note_body: body },
    }),
  });
  if (note?.id) {
    await hubspot(token, `/crm/v4/objects/notes/${note.id}/associations/default/deals/${dealId}`, {
      method: 'PUT',
      body: '{}',
    });
  }
  return note?.id || null;
}

async function createFollowUp(token: string, { contactId, dealId, title, due, ownerEmail }: {
  contactId: string; dealId: string; title: string; due: string; ownerEmail: string;
}) {
  let ownerId: string | null = null;
  if (ownerEmail) {
    const found = await hubspot(token, '/crm/v3/owners/?email=' + encodeURIComponent(ownerEmail) + '&limit=10');
    const owner = matchOwner(found?.results || [], ownerEmail);
    ownerId = owner?.id ? String(owner.id) : null;
  }
  const properties: Record<string, string> = {
    hs_task_subject: title,
    hs_task_status: 'NOT_STARTED',
    hs_task_priority: 'MEDIUM',
    hs_task_type: 'TODO',
    hs_timestamp: due,
  };
  if (ownerId) properties.hubspot_owner_id = ownerId;
  const task = await hubspot(token, '/crm/v3/objects/tasks', {
    method: 'POST',
    body: JSON.stringify({ properties }),
  });
  const taskId = task?.id ? String(task.id) : '';
  if (taskId && contactId) {
    await hubspot(token, `/crm/v4/objects/tasks/${taskId}/associations/default/contacts/${contactId}`, {
      method: 'PUT',
      body: '{}',
    });
  }
  if (taskId && dealId) {
    await hubspot(token, `/crm/v4/objects/tasks/${taskId}/associations/default/deals/${dealId}`, {
      method: 'PUT',
      body: '{}',
    });
  }
  return { id: taskId || null, ownerId };
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
  const mode = payload.mode === 'preview' ? 'preview' : 'sync';
  const event = payload.event === 'signed' ? 'signed' : payload.event === 'presented' ? 'presented' : '';
  if (!estimateId) return json(400, { ok: false, error: 'estimateId is required' });
  if (mode === 'sync' && !event) return json(400, { ok: false, error: 'estimateId and event are required' });

  const { data: profile } = await admin.from('profiles').select('role, email, full_name').eq('id', user.id).maybeSingle();
  const { data: estimate, error: estErr } = await admin.from('estimates').select('*').eq('id', estimateId).maybeSingle();
  if (estErr) return json(500, { ok: false, error: estErr.message });
  if (!estimate || estimate.deleted_at) return json(404, { ok: false, error: 'Estimate not found' });
  if (estimate.owner_id !== user.id && profile?.role !== 'admin') return json(403, { ok: false, error: 'Not your estimate' });

  try {
    const query = customerQuery(estimate);
    const ranked = rankCandidates(query, await gatherContacts(token, query));
    const shown = ranked.matches.slice(0, 8);

    if (mode === 'preview') {
      const matches = [];
      for (const match of shown) {
        const deals = await dealsForContact(token, match.id);
        matches.push({ ...match, deal: openDealSummary(deals) });
      }
      return json(200, { ok: true, mode: 'preview', matches, autoId: ranked.auto?.id || null });
    }

    const choice = payload.choice && typeof payload.choice === 'object' ? payload.choice : null;
    const decision = resolveContactChoice(choice, shown);
    let contactId = decision.contactId;
    if (decision.action === 'create') {
      const created = await createContact(token, query);
      contactId = created?.id ? String(created.id) : null;
    }
    if (!contactId) return json(502, { ok: false, error: 'HubSpot contact was not created' });

    const createNew = decision.action === 'create';
    const deals = createNew ? [] : await dealsForContact(token, contactId);
    const explicitChoice = Boolean(choice && Object.prototype.hasOwnProperty.call(choice, 'dealId') && !choice.createNew);
    const picked = pickDeal({
      createNew,
      estimateDealId: estimate.hubspot_deal_id || null,
      chosenDealId: choice?.dealId || null,
      explicitChoice,
      deals,
    });

    let pipelineHint: string | undefined;
    if (picked.action === 'update' && picked.dealId) {
      const existing = deals.find((d: any) => String(d.id) === String(picked.dealId));
      pipelineHint = existing?.properties?.pipeline;
      if (!pipelineHint) {
        const read = await hubspot(token, `/crm/v3/objects/deals/${picked.dealId}?properties=pipeline,dealstage`);
        pipelineHint = read?.properties?.pipeline;
      }
    }
    const stage = await dealStage(token, event, pipelineHint);
    const doc = estimate.document || {};
    const properties: Record<string, string> = {
      dealname: `${estimate.customer_name || 'Customer'} — ${doc.number || estimate.id}`,
      amount: estimate.total_amount == null ? '0' : String(estimate.total_amount),
      pipeline: stage.pipelineId,
      dealstage: stage.stageId,
    };
    let dealId = picked.dealId;
    let createdDeal = false;
    if (picked.action === 'update' && dealId) {
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
      createdDeal = true;
    }
    await hubspot(token, `/crm/v4/objects/deals/${dealId}/associations/default/contacts/${contactId}`, {
      method: 'PUT',
      body: '{}',
    });

    const { error: saveErr } = await admin.from('estimates').update({
      hubspot_contact_id: contactId,
      hubspot_deal_id: dealId,
    }).eq('id', estimateId);
    if (saveErr) return json(500, { ok: false, error: saveErr.message });

    let noteError: string | null = null;
    try {
      await attachNote(token, String(dealId), noteBody(estimate, event, decision.flag));
    } catch (err) {
      noteError = err instanceof Error ? err.message : 'Note was not attached';
    }

    let taskId: string | null = null;
    let taskDue: string | null = null;
    let taskError: string | null = null;
    if (payload.followUp && event === 'presented') {
      taskDue = followUpDue(new Date(), 2);
      const title = followUpTitle(estimate.customer_name, estimate.total_amount);
      try {
        const task = await createFollowUp(token, {
          contactId: String(contactId),
          dealId: String(dealId),
          title,
          due: taskDue,
          ownerEmail: profile?.email || user.email || '',
        });
        taskId = task.id;
      } catch (err) {
        taskError = err instanceof Error ? err.message : 'Follow-up task was not created';
      }
    }

    return json(200, {
      ok: true,
      mode: 'sync',
      event,
      hubspot_contact_id: contactId,
      hubspot_deal_id: dealId,
      stage: stage.stageLabel,
      created_contact: decision.action === 'create',
      created_deal: createdDeal,
      possible_matches: decision.flag,
      note_error: noteError,
      task_id: taskId,
      task_due: taskDue,
      task_error: taskError,
    });
  } catch (err) {
    return json(502, { ok: false, error: err instanceof Error ? err.message : 'HubSpot request failed' });
  }
});
