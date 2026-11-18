// Finds an existing HubSpot contact and open deal for an estimate, or creates one.
// Preview mode only searches. Sync links a confident match (or the rep's choice)
// and attaches an estimate note. Secret: HUBSPOT_TOKEN. The app still saves locally
// when this function is not deployed.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  customerQuery, normEmail, parseName, phoneFormats, rankCandidates, resolveContactChoice, pickDeal,
} from './match.js';
import { followUpDue, followUpTitle, matchOwner, presentedFollowUpNote, resolveTaskOwner, shouldCreateFollowUp } from './followup.js';
import { hubspotBodyAllowed, lostDealNote, snoozeDue } from '../_shared/assistant.js';
import { pullHubspot } from './pull.js';
import { backfillPresentedFollowUps } from './backfill-followups.js';
import { assignLead, loseLeadDeal, pullUnassigned, pushLeadAppointment, retryLeadText } from './leads.js';

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

async function recordAudit(admin: any, row: {
  actorId?: string | null; estimateId?: string | null; followUpId?: string | null;
  action: string; hubspotObject?: string | null; hubspotId?: string | null; detail?: Record<string, unknown>;
}) {
  try {
    const { error } = await admin.from('assistant_audit').insert({
      actor_id: row.actorId || null,
      estimate_id: row.estimateId || null,
      follow_up_id: row.followUpId || null,
      action: row.action,
      hubspot_object: row.hubspotObject || null,
      hubspot_id: row.hubspotId || null,
      detail: row.detail || {},
    });
    if (error) console.error('assistant_audit', error.message);
  } catch (err) {
    console.error('assistant_audit', err instanceof Error ? err.message : err);
  }
}

async function loggedWrite(admin: any, token: string, path: string, init: RequestInit, meta: {
  actorId?: string | null; estimateId?: string | null; followUpId?: string | null;
  action: string; hubspotObject?: string | null; hubspotId?: string | null; detail?: Record<string, unknown>;
}) {
  const method = String(init?.method || 'GET').toUpperCase();
  if (init?.body && !hubspotBodyAllowed(JSON.parse(String(init.body)))) {
    throw new Error('Refusing to send cost data to HubSpot');
  }
  try {
    const body = await hubspot(token, path, init);
    if (method !== 'GET') {
      await recordAudit(admin, {
        ...meta,
        hubspotId: meta.hubspotId || (body?.id ? String(body.id) : null),
        detail: { ...(meta.detail || {}), method, path, ok: true },
      });
    }
    return body;
  } catch (err) {
    if (method !== 'GET') {
      await recordAudit(admin, {
        ...meta,
        detail: {
          ...(meta.detail || {}),
          method,
          path,
          ok: false,
          error: err instanceof Error ? err.message : 'HubSpot write failed',
        },
      });
    }
    throw err;
  }
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

async function createContact(token: string, query: { name: string; email: string; phone: string; address: string }, audit: any) {
  const name = parseName(query.name);
  const properties: Record<string, string> = {};
  const email = normEmail(query.email);
  if (email) properties.email = email;
  if (query.phone) properties.phone = String(query.phone).trim();
  if (name.first) properties.firstname = name.first;
  if (name.last) properties.lastname = name.last;
  if (query.address) properties.address = String(query.address).trim();
  if (!Object.keys(properties).length) properties.firstname = 'Customer';
  return loggedWrite(audit.admin, token, '/crm/v3/objects/contacts', {
    method: 'POST',
    body: JSON.stringify({ properties }),
  }, { ...audit, action: 'contact.create', hubspotObject: 'contact' });
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
  if (event === 'signed' || event === 'won') {
    stage = stages.find((s: any) => /closed\s*won/i.test(label(s)) || s.id === 'closedwon');
  } else if (event === 'lost') {
    stage = stages.find((s: any) => /closed\s*lost/i.test(label(s)) || s.id === 'closedlost');
  } else {
    stage = stages.find((s: any) => /presentation/i.test(label(s)))
      || stages.find((s: any) => /appointment/i.test(label(s)))
      || stages.find((s: any) => s.id === 'presentationscheduled' || s.id === 'appointmentscheduled');
  }
  const fallbackId = event === 'signed' || event === 'won' ? 'closedwon' : event === 'lost' ? 'closedlost' : 'presentationscheduled';
  const fallbackLabel = event === 'signed' || event === 'won' ? 'Closed Won' : event === 'lost' ? 'Closed Lost' : 'Presentation Scheduled';
  return {
    pipelineId: pipeline?.id || 'default',
    stageId: stage?.id || fallbackId,
    stageLabel: stage?.label || fallbackLabel,
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

async function attachNote(token: string, dealId: string, body: string, audit: any) {
  const note = await loggedWrite(audit.admin, token, '/crm/v3/objects/notes', {
    method: 'POST',
    body: JSON.stringify({
      properties: { hs_timestamp: new Date().toISOString(), hs_note_body: body },
    }),
  }, { ...audit, action: 'note.create', hubspotObject: 'note' });
  if (note?.id) {
    await loggedWrite(audit.admin, token, `/crm/v4/objects/notes/${note.id}/associations/default/deals/${dealId}`, {
      method: 'PUT',
      body: '{}',
    }, { ...audit, action: 'association.write', hubspotObject: 'note', hubspotId: String(note.id), detail: { dealId } });
  }
  return note?.id || null;
}

async function createFollowUp(token: string, { contactId, dealId, title, due, ownerId, ownerEmail }: {
  contactId: string; dealId: string; title: string; due: string; ownerId?: string | null; ownerEmail: string;
}, audit: any) {
  let resolved = String(ownerId || '').trim() || null;
  if (!resolved && ownerEmail) {
    const found = await hubspot(token, '/crm/v3/owners/?email=' + encodeURIComponent(ownerEmail) + '&limit=10');
    const owner = matchOwner(found?.results || [], ownerEmail);
    resolved = owner?.id ? String(owner.id) : null;
  }
  const properties: Record<string, string> = {
    hs_task_subject: title,
    hs_task_status: 'NOT_STARTED',
    hs_task_priority: 'MEDIUM',
    hs_task_type: 'TODO',
    hs_timestamp: due,
  };
  if (resolved) properties.hubspot_owner_id = resolved;
  const task = await loggedWrite(audit.admin, token, '/crm/v3/objects/tasks', {
    method: 'POST',
    body: JSON.stringify({ properties }),
  }, { ...audit, action: 'task.create', hubspotObject: 'task', detail: { ownerSource: ownerId ? 'profile' : 'email' } });
  const taskId = task?.id ? String(task.id) : '';
  if (taskId && contactId) {
    await loggedWrite(audit.admin, token, `/crm/v4/objects/tasks/${taskId}/associations/default/contacts/${contactId}`, {
      method: 'PUT',
      body: '{}',
    }, { ...audit, action: 'association.write', hubspotObject: 'task', hubspotId: taskId, detail: { contactId } });
  }
  if (taskId && dealId) {
    await loggedWrite(audit.admin, token, `/crm/v4/objects/tasks/${taskId}/associations/default/deals/${dealId}`, {
      method: 'PUT',
      body: '{}',
    }, { ...audit, action: 'association.write', hubspotObject: 'task', hubspotId: taskId, detail: { dealId } });
  }
  return { id: taskId || null, ownerId: resolved };
}

async function taskOwnerFor(token: string, admin: any, ownerProfileId: string) {
  const { data: owner } = await admin.from('profiles').select('email, hubspot_owner_id').eq('id', ownerProfileId).maybeSingle();
  let owners: any[] = [];
  const stored = String(owner?.hubspot_owner_id || '').trim();
  if (!stored && owner?.email) {
    const found = await hubspot(token, '/crm/v3/owners/?email=' + encodeURIComponent(owner.email) + '&limit=10');
    owners = found?.results || [];
  }
  return {
    email: owner?.email || '',
    resolved: resolveTaskOwner({ hubspotOwnerId: owner?.hubspot_owner_id, owners, email: owner?.email || '' }),
  };
}

async function ensureFollowUp(admin: any, token: string, estimate: any, contactId: string, dealId: string, actorId: string) {
  const { data: existing, error: readErr } = await admin.from('follow_ups')
    .select('id, hubspot_task_id, due_at, status, note')
    .eq('estimate_id', estimate.id)
    .eq('status', 'open')
    .maybeSingle();
  if (readErr) return { taskId: null, taskDue: null, taskError: readErr.message, existing: false };
  if (existing && !shouldCreateFollowUp(existing)) {
    return { taskId: existing.hubspot_task_id, taskDue: existing.due_at, taskError: null, existing: true };
  }
  const taskDue = followUpDue(new Date(), 2);
  const title = followUpTitle(estimate.customer_name, estimate.total_amount);
  const owner = await taskOwnerFor(token, admin, estimate.owner_id);
  const audit = { admin, actorId, estimateId: estimate.id };
  try {
    const task = await createFollowUp(token, {
      contactId: String(contactId),
      dealId: String(dealId),
      title,
      due: taskDue,
      ownerId: owner.resolved.ownerId,
      ownerEmail: owner.email,
    }, audit);
    const note = presentedFollowUpNote(estimate);
    const row = {
      estimate_id: estimate.id,
      owner_id: estimate.owner_id,
      hubspot_task_id: task.id,
      due_at: taskDue,
      status: 'open',
      note,
    };
    const saved = existing
      ? await admin.from('follow_ups').update({
        hubspot_task_id: task.id,
        due_at: taskDue,
        ...(String(existing.note || '').trim() ? {} : { note }),
      }).eq('id', existing.id)
      : await admin.from('follow_ups').insert(row);
    if (saved.error) return { taskId: task.id, taskDue, taskError: saved.error.message, existing: false };
    return { taskId: task.id, taskDue, taskError: null, existing: false };
  } catch (err) {
    return { taskId: null, taskDue, taskError: err instanceof Error ? err.message : 'Follow-up task was not created', existing: false };
  }
}

async function completeFollowUp(admin: any, token: string, user: any, profile: any, payload: any) {
  const id = String(payload.followUpId || '');
  if (!id) return json(400, { ok: false, error: 'followUpId is required' });
  const { data: row, error } = await admin.from('follow_ups').select('*').eq('id', id).maybeSingle();
  if (error) return json(500, { ok: false, error: error.message });
  if (!row) return json(404, { ok: false, error: 'Follow-up not found' });
  if (row.owner_id !== user.id && profile?.role !== 'admin') return json(403, { ok: false, error: 'Not your follow-up' });
  if (row.status !== 'open') return json(200, { ok: true, already: true, status: row.status });
  const audit = { admin, actorId: user.id, estimateId: row.estimate_id, followUpId: row.id };
  if (row.hubspot_task_id) {
    try {
      await loggedWrite(admin, token, `/crm/v3/objects/tasks/${row.hubspot_task_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ properties: { hs_task_status: 'COMPLETED' } }),
      }, { ...audit, action: 'task.complete', hubspotObject: 'task', hubspotId: String(row.hubspot_task_id) });
    } catch (err) {
      return json(502, { ok: false, error: err instanceof Error ? err.message : 'HubSpot task was not completed' });
    }
  } else {
    await recordAudit(admin, { ...audit, action: 'task.complete', detail: { hubspot: 'none', ok: true } });
  }
  const completedAt = new Date().toISOString();
  const { error: saveErr } = await admin.from('follow_ups').update({ status: 'done', completed_at: completedAt }).eq('id', row.id);
  if (saveErr) return json(500, { ok: false, error: saveErr.message });
  return json(200, { ok: true, status: 'done', completed_at: completedAt });
}

async function loseEstimate(admin: any, token: string, user: any, estimate: any) {
  const audit = { admin, actorId: user.id, estimateId: estimate.id };
  let stageLabel: string | null = null;
  if (estimate.hubspot_deal_id) {
    try {
      const read = await hubspot(token, `/crm/v3/objects/deals/${estimate.hubspot_deal_id}?properties=pipeline,dealstage`);
      const stage = await dealStage(token, 'lost', read?.properties?.pipeline);
      await loggedWrite(admin, token, `/crm/v3/objects/deals/${estimate.hubspot_deal_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ properties: { pipeline: stage.pipelineId, dealstage: stage.stageId } }),
      }, { ...audit, action: 'deal.lost', hubspotObject: 'deal', hubspotId: String(estimate.hubspot_deal_id), detail: { stage: stage.stageLabel } });
      stageLabel = stage.stageLabel;
    } catch (err) {
      return json(502, { ok: false, error: err instanceof Error ? err.message : 'HubSpot deal was not moved' });
    }
  } else {
    await recordAudit(admin, { ...audit, action: 'deal.lost', hubspotObject: 'deal', detail: { skipped: 'no deal', ok: true } });
  }
  if (estimate.hubspot_deal_id) {
    try {
      const { data: owner } = await admin.from('profiles').select('full_name, email').eq('id', estimate.owner_id).maybeSingle();
      const doc = estimate.document || {};
      const note = lostDealNote({
        repName: owner?.full_name || owner?.email || '',
        presentedAt: estimate.presented_at,
        total: estimate.total_amount,
        lines: doc.lines || estimate.lines || [],
      });
      await attachNote(token, String(estimate.hubspot_deal_id), note, audit);
    } catch {
      // The stage change already succeeded. The note error is in assistant_audit.
    }
  }
  const lostAt = new Date().toISOString();
  const { error: saveErr } = await admin.from('estimates').update({ status: 'lost', lost_at: lostAt }).eq('id', estimate.id);
  if (saveErr) return json(500, { ok: false, error: saveErr.message });
  const { data: openRows } = await admin.from('follow_ups').select('id, hubspot_task_id').eq('estimate_id', estimate.id).eq('status', 'open');
  for (const row of openRows || []) {
    if (row.hubspot_task_id) {
      try {
        await loggedWrite(admin, token, `/crm/v3/objects/tasks/${row.hubspot_task_id}`, {
          method: 'PATCH',
          body: JSON.stringify({ properties: { hs_task_status: 'COMPLETED' } }),
        }, { ...audit, followUpId: row.id, action: 'task.complete', hubspotObject: 'task', hubspotId: String(row.hubspot_task_id), detail: { reason: 'lost' } });
      } catch {
        // loggedWrite already stored the failed HubSpot write. The follow-up is still closed locally.
      }
    }
    await admin.from('follow_ups').update({ status: 'canceled' }).eq('id', row.id);
    await recordAudit(admin, { ...audit, followUpId: row.id, action: 'followup.cancel', detail: { reason: 'lost', ok: true } });
  }
  return json(200, { ok: true, event: 'lost', stage: stageLabel, lost_at: lostAt });
}

async function moveDeal(admin, token, user, estimate, event) {
  const audit = { admin, actorId: user.id, estimateId: estimate.id };
  if (!estimate.hubspot_deal_id) {
    await recordAudit(admin, { ...audit, action: event === 'won' ? 'deal.won' : 'deal.reopen', detail: { skipped: 'no deal', ok: true } });
    return { stageLabel: null };
  }
  const read = await hubspot(token, `/crm/v3/objects/deals/${estimate.hubspot_deal_id}?properties=pipeline,dealstage`);
  const stage = await dealStage(token, event, read?.properties?.pipeline);
  await loggedWrite(admin, token, `/crm/v3/objects/deals/${estimate.hubspot_deal_id}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: { pipeline: stage.pipelineId, dealstage: stage.stageId } }),
  }, { ...audit, action: event === 'won' ? 'deal.won' : 'deal.reopen', hubspotObject: 'deal', hubspotId: String(estimate.hubspot_deal_id), detail: { stage: stage.stageLabel } });
  return { stageLabel: stage.stageLabel };
}

async function winEstimate(admin, token, user, estimate) {
  let stageLabel = null;
  try {
    const moved = await moveDeal(admin, token, user, estimate, 'won');
    stageLabel = moved.stageLabel;
  } catch (err) {
    return json(502, { ok: false, error: err instanceof Error ? err.message : 'HubSpot deal was not moved' });
  }
  const wonAt = new Date().toISOString();
  const { error } = await admin.from('estimates').update({ status: 'won', won_at: wonAt }).eq('id', estimate.id);
  if (error) return json(500, { ok: false, error: error.message });
  return json(200, { ok: true, event: 'won', stage: stageLabel, won_at: wonAt });
}

async function reopenEstimate(admin, token, user, profile, estimate) {
  if (profile?.role !== 'admin') return json(403, { ok: false, error: 'Only an admin can reopen an estimate' });
  let stageLabel = null;
  try {
    const moved = await moveDeal(admin, token, user, estimate, 'presented');
    stageLabel = moved.stageLabel;
  } catch (err) {
    return json(502, { ok: false, error: err instanceof Error ? err.message : 'HubSpot deal was not moved' });
  }
  const { error } = await admin.from('estimates').update({ status: 'presented', won_at: null, lost_at: null }).eq('id', estimate.id);
  if (error) return json(500, { ok: false, error: error.message });
  return json(200, { ok: true, event: 'reopen', stage: stageLabel });
}

async function snoozeFollowUp(admin, token, user, profile, payload) {
  const id = String(payload.followUpId || '');
  if (!id) return json(400, { ok: false, error: 'followUpId is required' });
  const { data: row, error } = await admin.from('follow_ups').select('*').eq('id', id).maybeSingle();
  if (error) return json(500, { ok: false, error: error.message });
  if (!row) return json(404, { ok: false, error: 'Follow-up not found' });
  if (row.owner_id !== user.id && profile?.role !== 'admin') return json(403, { ok: false, error: 'Not your follow-up' });
  const due = snoozeDue(new Date());
  if (row.hubspot_task_id) {
    await loggedWrite(admin, token, `/crm/v3/objects/tasks/${row.hubspot_task_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties: { hs_timestamp: due } }),
    }, { admin, actorId: user.id, estimateId: row.estimate_id, followUpId: row.id, action: 'task.snooze', hubspotObject: 'task', hubspotId: String(row.hubspot_task_id) });
  }
  const { error: saveErr } = await admin.from('follow_ups').update({ due_at: due }).eq('id', row.id);
  if (saveErr) return json(500, { ok: false, error: saveErr.message });
  return json(200, { ok: true, due_at: due });
}

async function logNote(admin, token, user, profile, payload) {
  const text = String(payload.note || '').trim();
  if (!text) return json(400, { ok: false, error: 'A note is required' });
  const estimateId = String(payload.estimateId || '');
  let dealId = String(payload.hubspotId || '');
  let object = String(payload.hubspotObject || 'deal');
  let ownerId = user.id;
  if (estimateId) {
    const { data: estimate, error } = await admin.from('estimates').select('id, owner_id, hubspot_deal_id, deleted_at').eq('id', estimateId).maybeSingle();
    if (error) return json(500, { ok: false, error: error.message });
    if (!estimate || estimate.deleted_at) return json(404, { ok: false, error: 'Estimate not found' });
    if (estimate.owner_id !== user.id && profile?.role !== 'admin') return json(403, { ok: false, error: 'Not your estimate' });
    dealId = String(estimate.hubspot_deal_id || '');
    object = 'deal';
    ownerId = estimate.owner_id;
  } else if (profile?.role !== 'admin' && payload.ownerId && payload.ownerId !== user.id) {
    return json(403, { ok: false, error: 'Not your lead' });
  }
  if (!dealId) return json(400, { ok: false, error: 'There is no HubSpot record to attach this note to' });
  const audit = { admin, actorId: user.id, estimateId: estimateId || null };
  if (object === 'deal') await attachNote(token, dealId, text, audit);
  else {
    await loggedWrite(admin, token, '/crm/v3/objects/notes', {
      method: 'POST',
      body: JSON.stringify({ properties: { hs_timestamp: new Date().toISOString(), hs_note_body: text } }),
    }, { ...audit, action: 'note.create', hubspotObject: 'note', detail: { ownerId } });
  }
  return json(200, { ok: true });
}

async function pushAppointment(admin, token, user, profile, payload) {
  const estimateId = String(payload.estimateId || '');
  const { data: estimate, error } = await admin.from('estimates').select('*').eq('id', estimateId).maybeSingle();
  if (error) return json(500, { ok: false, error: error.message });
  if (!estimate || estimate.deleted_at) return json(404, { ok: false, error: 'Estimate not found' });
  if (estimate.owner_id !== user.id && profile?.role !== 'admin') return json(403, { ok: false, error: 'Not your estimate' });
  const { data: owner } = await admin.from('profiles').select('hubspot_owner_id').eq('id', estimate.owner_id).maybeSingle();
  const start = new Date().toISOString();
  const properties = {
    hs_meeting_title: `Appointment: ${estimate.customer_name || 'Customer'}`,
    hs_meeting_start_time: start,
    hs_timestamp: start,
  };
  if (owner?.hubspot_owner_id) properties.hubspot_owner_id = String(owner.hubspot_owner_id);
  const meeting = await loggedWrite(admin, token, '/crm/v3/objects/meetings', {
    method: 'POST',
    body: JSON.stringify({ properties }),
  }, { admin, actorId: user.id, estimateId, action: 'meeting.create', hubspotObject: 'meeting' });
  const meetingId = meeting?.id ? String(meeting.id) : null;
  if (meetingId && estimate.hubspot_deal_id) {
    await loggedWrite(admin, token, `/crm/v4/objects/meetings/${meetingId}/associations/default/deals/${estimate.hubspot_deal_id}`, {
      method: 'PUT',
      body: '{}',
    }, { admin, actorId: user.id, estimateId, action: 'association.write', hubspotObject: 'meeting', hubspotId: meetingId });
  }
  if (meetingId) {
    await admin.from('appointments').update({ hubspot_meeting_id: meetingId }).eq('estimate_id', estimateId).eq('source', 'app').is('hubspot_meeting_id', null);
  }
  return json(200, { ok: true, hubspot_meeting_id: meetingId });
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
  const { data: profile } = await admin.from('profiles').select('id, role, email, full_name, hubspot_owner_id').eq('id', user.id).maybeSingle();
  if (payload.action === 'complete-followup') return completeFollowUp(admin, token, user, profile, payload);
  if (payload.action === 'snooze-followup') return snoozeFollowUp(admin, token, user, profile, payload);
  if (payload.action === 'log-note') return logNote(admin, token, user, profile, payload);
  if (payload.action === 'push-appointment') return pushAppointment(admin, token, user, profile, payload);
  if (payload.action === 'pull-unassigned' || payload.action === 'assign-lead' || payload.action === 'retry-lead-text' || payload.action === 'lead-appointment' || payload.action === 'lead-lost') {
    const env = {
      QUO_API_KEY: Deno.env.get('QUO_API_KEY') ?? '',
      QUO_FROM_NUMBER: Deno.env.get('QUO_FROM_NUMBER') ?? '',
    };
    try {
      if (payload.action === 'pull-unassigned') {
        if (profile?.role !== 'admin') return json(403, { ok: false, error: 'Only an admin can refresh leads.' });
        const summary = await pullUnassigned({
          admin,
          token,
          inboxOwnerId: Deno.env.get('HUBSPOT_INBOX_OWNER_ID') ?? '',
          stageLabel: Deno.env.get('HUBSPOT_INBOX_STAGE_LABEL') ?? '',
        });
        return json(summary.ok ? 200 : 502, summary);
      }
      if (payload.action === 'assign-lead') {
        const result = await assignLead({ admin, token, actor: profile, leadId: String(payload.leadId || ''), repId: String(payload.repId || ''), env });
        return json(result.status || 200, result);
      }
      if (payload.action === 'retry-lead-text') {
        const result = await retryLeadText({ admin, actor: profile, leadId: String(payload.leadId || ''), env });
        return json(result.status || 200, result);
      }
      if (payload.action === 'lead-appointment') {
        const result = await pushLeadAppointment({ admin, token, actor: profile, leadId: String(payload.leadId || '') });
        return json(result.status || 200, result);
      }
      const result = await loseLeadDeal({ admin, token, actor: profile, leadId: String(payload.leadId || '') });
      return json(result.status || 200, result);
    } catch (err) {
      return json(502, { ok: false, error: err instanceof Error ? err.message : 'Lead request failed' });
    }
  }
  if (payload.action === 'pull') {
    const profiles = profile?.role === 'admin'
      ? (await admin.from('profiles').select('id, full_name, email, role, hubspot_owner_id')).data || []
      : [profile].filter(Boolean);
    const summary = await pullHubspot({ admin, token, profiles });
    return json(200, { ok: !summary.error, ...summary, last_synced_at: new Date().toISOString() });
  }
  if (payload.action === 'backfill-followups') {
    const profiles = profile?.role === 'admin'
      ? (await admin.from('profiles').select('id, full_name, email, role, hubspot_owner_id')).data || []
      : [profile].filter(Boolean);
    const summary = await backfillPresentedFollowUps({
      admin,
      profiles,
      get: (path: string) => hubspot(token, path),
    });
    return json(200, { ok: !summary.error, ...summary });
  }

  const estimateId = String(payload.estimateId || '');
  const mode = payload.mode === 'preview' ? 'preview' : 'sync';
  const event = payload.event === 'signed' ? 'signed' : payload.event === 'presented' ? 'presented' : payload.event === 'lost' ? 'lost' : payload.event === 'won' ? 'won' : payload.event === 'reopen' ? 'reopen' : '';
  if (!estimateId) return json(400, { ok: false, error: 'estimateId is required' });
  if (mode === 'sync' && !event) return json(400, { ok: false, error: 'estimateId and event are required' });

  const { data: estimate, error: estErr } = await admin.from('estimates').select('*').eq('id', estimateId).maybeSingle();
  if (estErr) return json(500, { ok: false, error: estErr.message });
  if (!estimate || estimate.deleted_at) return json(404, { ok: false, error: 'Estimate not found' });
  if (estimate.owner_id !== user.id && profile?.role !== 'admin') return json(403, { ok: false, error: 'Not your estimate' });
  if (event === 'lost') return loseEstimate(admin, token, user, estimate);
  if (event === 'won') return winEstimate(admin, token, user, estimate);
  if (event === 'reopen') return reopenEstimate(admin, token, user, profile, estimate);

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
    const audit = { admin, actorId: user.id, estimateId: estimate.id };
    let contactId = decision.contactId;
    if (decision.action === 'create') {
      const created = await createContact(token, query, audit);
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
      await loggedWrite(admin, token, `/crm/v3/objects/deals/${dealId}`, {
        method: 'PATCH',
        body: JSON.stringify({ properties }),
      }, { ...audit, action: 'deal.update', hubspotObject: 'deal', hubspotId: String(dealId), detail: { stage: stage.stageLabel } });
    } else {
      const created = await loggedWrite(admin, token, '/crm/v3/objects/deals', {
        method: 'POST',
        body: JSON.stringify({ properties }),
      }, { ...audit, action: 'deal.create', hubspotObject: 'deal', detail: { stage: stage.stageLabel } });
      dealId = created.id;
      createdDeal = true;
    }
    await loggedWrite(admin, token, `/crm/v4/objects/deals/${dealId}/associations/default/contacts/${contactId}`, {
      method: 'PUT',
      body: '{}',
    }, { ...audit, action: 'association.write', hubspotObject: 'deal', hubspotId: String(dealId), detail: { contactId } });

    const { error: saveErr } = await admin.from('estimates').update({
      hubspot_contact_id: contactId,
      hubspot_deal_id: dealId,
    }).eq('id', estimateId);
    if (saveErr) return json(500, { ok: false, error: saveErr.message });

    let noteError: string | null = null;
    try {
      await attachNote(token, String(dealId), noteBody(estimate, event, decision.flag), audit);
    } catch (err) {
      noteError = err instanceof Error ? err.message : 'Note was not attached';
    }

    let taskId: string | null = null;
    let taskDue: string | null = null;
    let taskError: string | null = null;
    let taskExisting = false;
    if (event === 'presented') {
      const task = await ensureFollowUp(admin, token, estimate, String(contactId), String(dealId), user.id);
      taskId = task.taskId;
      taskDue = task.taskDue;
      taskError = task.taskError;
      taskExisting = task.existing;
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
      task_existing: taskExisting,
    });
  } catch (err) {
    return json(502, { ok: false, error: err instanceof Error ? err.message : 'HubSpot request failed' });
  }
});
