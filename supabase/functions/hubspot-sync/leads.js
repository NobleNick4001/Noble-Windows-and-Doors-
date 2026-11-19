// Unassigned HubSpot leads, assignment, and the staff text that follows.
// The browser never sends a destination number or a message body.
// Customers are never texted.

import { plainEngagement } from './followup.js';
import { invalidHubspotCopy } from '../_shared/lead-invalid.js';
import { leadUpsertPlan } from '../_shared/lead-upsert.js';
import { assignmentText, overdueText, quoEnv, sendStaffText } from '../_shared/quo.js';

// Nick's rule: only leads created in HubSpot in the last 30 days.
export const LEAD_PULL_MAX_AGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const CONTACT_PROPS = ['firstname', 'lastname', 'phone', 'mobilephone', 'email', 'address', 'city', 'state', 'zip', 'hubspot_owner_id', 'hs_analytics_source', 'hs_latest_source', 'createdate'];
const DEAL_PROPS = ['dealname', 'dealstage', 'pipeline', 'hs_is_closed', 'hubspot_owner_id', 'createdate'];

async function hubspot(token, path, init = {}) {
  const res = await fetch('https://api.hubapi.com' + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(body?.message || res.statusText || 'HubSpot request failed');
  return body;
}

function closedStage(label, id) {
  const text = String(label || '');
  const key = String(id || '').toLowerCase();
  return /closed\s*won/i.test(text) || /closed\s*lost/i.test(text) || key === 'closedwon' || key === 'closedlost';
}

function lateStage(label, id) {
  const text = String(label || '');
  const key = String(id || '').toLowerCase();
  return closedStage(text, key) || /presentation|appointment/i.test(text) || key === 'presentationscheduled' || key === 'appointmentscheduled';
}

async function stageMap(token) {
  const pipelines = await hubspot(token, '/crm/v3/pipelines/deals');
  const byId = new Map();
  for (const pipeline of pipelines?.results || []) {
    for (const stage of pipeline.stages || []) byId.set(String(stage.id), String(stage.label || ''));
  }
  return byId;
}

function wantedStageIds(byId, label) {
  const want = String(label || '').trim().toLowerCase();
  if (!want) return null;
  const ids = [];
  for (const [id, name] of byId) {
    if (name.toLowerCase() === want || name.toLowerCase().includes(want)) ids.push(id);
  }
  return ids;
}

async function search(token, object, filterGroups, properties) {
  const found = await hubspot(token, `/crm/v3/objects/${object}/search`, {
    method: 'POST',
    body: JSON.stringify({ filterGroups, properties, limit: 100 }),
  });
  return found?.results || [];
}

function ownerFilters(inboxId) {
  const groups = [{ filters: [{ propertyName: 'hubspot_owner_id', operator: 'NOT_HAS_PROPERTY' }] }];
  const inbox = String(inboxId || '').trim();
  if (inbox) groups.push({ filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: inbox }] });
  return groups;
}

export function leadCreatedCutoffMs(now = Date.now()) {
  return now - LEAD_PULL_MAX_AGE_DAYS * DAY_MS;
}

// HubSpot ANDs filters inside a group and ORs the groups.
export function withCreatedSince(filterGroups, cutoffMs) {
  const value = String(Math.trunc(cutoffMs));
  return (filterGroups || []).map((group) => ({
    filters: [
      ...(group?.filters || []),
      { propertyName: 'createdate', operator: 'GTE', value },
    ],
  }));
}

export function unassignedSearchFilters(inboxOwnerId, now = Date.now()) {
  return withCreatedSince(ownerFilters(inboxOwnerId), leadCreatedCutoffMs(now));
}

export function createdAtMs(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    if (!Number.isFinite(n)) return null;
    return n < 1e12 ? n * 1000 : n;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function createdWithinLeadWindow(value, now = Date.now()) {
  const ms = createdAtMs(value);
  if (ms == null) return false;
  return ms >= leadCreatedCutoffMs(now);
}

export function pickClosedLostStage(pipelines) {
  const list = pipelines?.results || pipelines || [];
  const pipeline = list.find((item) => item.id === 'default') || list[0];
  let stageId = 'closedlost';
  const pipelineId = pipeline?.id || 'default';
  if (pipeline) {
    const match = (pipeline.stages || []).find((stage) => closedStage(stage.label, stage.id) && /lost/i.test(String(stage.label || '') + stage.id));
    if (match) stageId = String(match.id);
  }
  return { stageId, pipelineId };
}

function contactAddress(props) {
  const street = String(props.address || '').trim();
  const city = [props.city, props.state].map((part) => String(part || '').trim()).filter(Boolean).join(', ');
  const zip = String(props.zip || '').trim();
  const tail = [city, zip].filter(Boolean).join(' ');
  return [street, tail].filter(Boolean).join(', ');
}

function contactName(props) {
  return [props.firstname, props.lastname].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
}

async function latestNote(token, contactId) {
  try {
    const assoc = await hubspot(token, `/crm/v4/objects/contacts/${contactId}/associations/notes`);
    const ids = (assoc?.results || []).map((row) => row.toObjectId || row.id).filter(Boolean).map(String).slice(0, 10);
    if (!ids.length) return '';
    const read = await hubspot(token, '/crm/v3/objects/notes/batch/read', {
      method: 'POST',
      body: JSON.stringify({
        properties: ['hs_note_body', 'hs_timestamp'],
        inputs: ids.map((id) => ({ id })),
      }),
    });
    const notes = (read?.results || [])
      .map((row) => ({ at: row.properties?.hs_timestamp || '', body: plainEngagement(row.properties?.hs_note_body) }))
      .filter((row) => row.body);
    notes.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return notes[0]?.body || '';
  } catch {
    return '';
  }
}

async function dealContactId(token, dealId) {
  try {
    const assoc = await hubspot(token, `/crm/v4/objects/deals/${dealId}/associations/contacts`);
    const id = (assoc?.results || []).map((row) => row.toObjectId || row.id).find(Boolean);
    return id ? String(id) : '';
  } catch {
    return '';
  }
}

// Reads HubSpot and upserts unassigned leads. Does not send a text.
export async function pullUnassigned({ admin, token, inboxOwnerId = '', stageLabel = '' }) {
  const summary = { imported: 0, updated: 0, error: '' };
  if (!token) return { ...summary, ok: false, error: 'HUBSPOT_TOKEN is not set' };
  try {
    const stages = await stageMap(token);
    const only = wantedStageIds(stages, stageLabel);
    const nowMs = Date.now();
    const fresh = (record) => createdWithinLeadWindow(record?.properties?.createdate, nowMs);
    const filters = unassignedSearchFilters(inboxOwnerId, nowMs);
    const contacts = (await search(token, 'contacts', filters, CONTACT_PROPS)).filter(fresh);
    let deals = (await search(token, 'deals', filters, DEAL_PROPS)).filter(fresh);
    deals = deals.filter((deal) => {
      const id = String(deal.properties?.dealstage || '');
      const label = stages.get(id) || '';
      if (deal.properties?.hs_is_closed === 'true' || closedStage(label, id)) return false;
      if (only) return only.includes(id);
      return !lateStage(label, id);
    });

    const rows = new Map();
    for (const contact of contacts.slice(0, 100)) {
      const props = contact.properties || {};
      const id = String(contact.id);
      rows.set('c:' + id, {
        hubspot_contact_id: id,
        hubspot_deal_id: null,
        name: contactName(props) || 'Contact',
        phone: props.phone || props.mobilephone || '',
        email: props.email || '',
        address: contactAddress(props),
        notes: '',
        source: props.hs_analytics_source || props.hs_latest_source || 'HubSpot',
      });
    }
    let lookups = 0;
    for (const deal of deals.slice(0, 100)) {
      if (rows.size >= 200) break;
      const contactId = lookups < 40 ? await dealContactId(token, deal.id) : '';
      lookups += 1;
      const key = contactId ? 'c:' + contactId : 'd:' + deal.id;
      const existing = rows.get(key);
      const props = deal.properties || {};
      if (existing) {
        existing.hubspot_deal_id = String(deal.id);
        if (!existing.name) existing.name = props.dealname || existing.name;
      } else if (!contactId) {
        rows.set(key, {
          hubspot_contact_id: null,
          hubspot_deal_id: String(deal.id),
          name: props.dealname || 'Deal',
          phone: '',
          email: '',
          address: '',
          notes: '',
          source: 'HubSpot',
        });
      }
    }
    let noted = 0;
    for (const row of rows.values()) {
      if (!row.hubspot_contact_id || noted >= 25) continue;
      row.notes = await latestNote(token, row.hubspot_contact_id);
      noted += 1;
    }
    for (const row of rows.values()) {
      const saved = await saveLead(admin, row);
      if (saved === 'inserted') summary.imported += 1;
      if (saved === 'updated') summary.updated += 1;
    }
    return { ok: true, ...summary };
  } catch (err) {
    return { ok: false, ...summary, error: err instanceof Error ? err.message : 'HubSpot pull failed' };
  }
}

async function saveLead(admin, row, allowRetry = true) {
  let existing = null;
  if (row.hubspot_contact_id) {
    const found = await admin.from('leads').select('id, owner_id, stage, notes, hubspot_contact_id, hubspot_deal_id').eq('hubspot_contact_id', row.hubspot_contact_id).is('deleted_at', null).maybeSingle();
    existing = found.data;
  }
  if (!existing && row.hubspot_deal_id) {
    const found = await admin.from('leads').select('id, owner_id, stage, notes, hubspot_contact_id, hubspot_deal_id').eq('hubspot_deal_id', row.hubspot_deal_id).is('deleted_at', null).maybeSingle();
    existing = found.data;
  }
  const now = new Date().toISOString();
  const plan = leadUpsertPlan(existing, row, now);
  if (plan.action === 'skip') return 'skipped';
  if (plan.action === 'insert') {
    const { error } = await admin.from('leads').insert(plan.values);
    if (error?.code === '23505' && allowRetry) return saveLead(admin, row, false);
    if (error) throw new Error(error.message);
    return 'inserted';
  }
  const { data, error } = await admin.from('leads').update(plan.values).eq('id', plan.id).is('owner_id', null).neq('stage', 'invalid').select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) return 'skipped';
  return 'updated';
}

async function audit(admin, row) {
  await admin.from('assistant_audit').insert({
    actor_id: row.actorId || null,
    action: row.action,
    hubspot_object: row.hubspotObject || null,
    hubspot_id: row.hubspotId || null,
    detail: row.detail || {},
  });
}

async function patchOwner(token, object, id, ownerId) {
  await hubspot(token, `/crm/v3/objects/${object}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: { hubspot_owner_id: String(ownerId) } }),
  });
}

export async function assignLead({ admin, token, actor, leadId, repId, env }) {
  if (actor?.role !== 'admin') return { ok: false, status: 403, error: 'Only an admin can assign a lead.' };
  const { data: lead, error: leadErr } = await admin.from('leads').select('*').eq('id', leadId).is('deleted_at', null).maybeSingle();
  if (leadErr) return { ok: false, status: 500, error: leadErr.message };
  if (!lead) return { ok: false, status: 404, error: 'Lead not found.' };
  if (lead.owner_id) return { ok: false, status: 409, error: 'This lead is already assigned.' };
  const { data: rep, error: repErr } = await admin.from('profiles').select('id, full_name, email, role, hubspot_owner_id, phone').eq('id', repId).maybeSingle();
  if (repErr) return { ok: false, status: 500, error: repErr.message };
  if (!rep || (rep.role !== 'sales' && rep.role !== 'admin')) return { ok: false, status: 400, error: 'Choose a rep.' };
  if (!String(rep.hubspot_owner_id || '').trim()) return { ok: false, status: 400, error: 'Set this person’s HubSpot owner id on Accounts first.' };
  if (!String(rep.phone || '').trim()) return { ok: false, status: 400, error: 'Add this person’s mobile on Accounts before assigning.' };

  const previous = [];
  try {
    if (lead.hubspot_contact_id) {
      await patchOwner(token, 'contacts', lead.hubspot_contact_id, rep.hubspot_owner_id);
      previous.push(['contacts', lead.hubspot_contact_id]);
    }
    if (lead.hubspot_deal_id) {
      await patchOwner(token, 'deals', lead.hubspot_deal_id, rep.hubspot_owner_id);
      previous.push(['deals', lead.hubspot_deal_id]);
    }
  } catch (err) {
    for (const [object, id] of previous) {
      try { await patchOwner(token, object, id, ''); } catch { /* leave the audit below */ }
    }
    return { ok: false, status: 502, error: err instanceof Error ? err.message : 'HubSpot owner was not changed.' };
  }

  const assignedAt = new Date().toISOString();
  const { data: plan, error: planErr } = await admin.rpc('lead_call_plan', { p_from: assignedAt });
  if (planErr || !plan?.due_at) {
    return { ok: false, status: 500, error: planErr?.message || 'The call deadline was not calculated.' };
  }
  const { error: saveErr } = await admin.from('leads').update({
    owner_id: rep.id,
    assigned_at: assignedAt,
    call_due_at: plan.due_at,
    call_window: plan.call_window,
    stage: 'new',
    called_at: null,
    rep_text_at: null,
    rep_text_id: null,
    rep_text_error: null,
    admin_alert_at: null,
    admin_alert_attempts: 0,
  }).eq('id', lead.id).is('owner_id', null);
  if (saveErr) return { ok: false, status: 500, error: saveErr.message };

  const content = assignmentText({
    name: lead.name,
    phone: lead.phone,
    address: lead.address,
    note: lead.notes,
    callWindow: plan.call_window,
  });
  let textError = '';
  let textId = null;
  try {
    const sent = await sendStaffText({ env: quoEnv((key) => env?.[key] || ''), profile: rep, lead, content });
    textId = sent.id;
    await admin.from('leads').update({ rep_text_at: new Date().toISOString(), rep_text_id: textId, rep_text_error: null }).eq('id', lead.id);
  } catch (err) {
    textError = err instanceof Error ? err.message : 'The text did not send.';
    await admin.from('leads').update({ rep_text_error: textError }).eq('id', lead.id);
  }
  await audit(admin, {
    actorId: actor.id,
    action: 'lead.assign',
    detail: { lead_id: lead.id, rep_id: rep.id, call_due_at: plan.due_at, call_window: plan.call_window, text: textId ? 'sent' : 'failed' },
  });
  return { ok: true, status: 200, call_due_at: plan.due_at, call_window: plan.call_window, text_error: textError };
}

export async function retryLeadText({ admin, actor, leadId, env }) {
  if (actor?.role !== 'admin') return { ok: false, status: 403, error: 'Only an admin can resend a lead text.' };
  const { data: lead } = await admin.from('leads').select('*').eq('id', leadId).is('deleted_at', null).maybeSingle();
  if (!lead?.owner_id) return { ok: false, status: 404, error: 'Lead not found.' };
  if (lead.rep_text_at) return { ok: true, status: 200, already: true };
  const { data: rep } = await admin.from('profiles').select('id, full_name, role, phone').eq('id', lead.owner_id).maybeSingle();
  try {
    const sent = await sendStaffText({
      env: quoEnv((key) => env?.[key] || ''),
      profile: rep,
      lead,
      content: assignmentText({
        name: lead.name, phone: lead.phone, address: lead.address, note: lead.notes, callWindow: lead.call_window,
      }),
    });
    await admin.from('leads').update({ rep_text_at: new Date().toISOString(), rep_text_id: sent.id, rep_text_error: null }).eq('id', lead.id);
    return { ok: true, status: 200 };
  } catch (err) {
    const textError = err instanceof Error ? err.message : 'The text did not send.';
    await admin.from('leads').update({ rep_text_error: textError }).eq('id', lead.id);
    return { ok: false, status: 502, error: textError };
  }
}

export async function pushLeadAppointment({ admin, token, actor, leadId }) {
  const { data: lead } = await admin.from('leads').select('*').eq('id', leadId).is('deleted_at', null).maybeSingle();
  if (!lead) return { ok: false, status: 404, error: 'Lead not found.' };
  if (actor?.role !== 'admin' && actor?.id !== lead.owner_id) return { ok: false, status: 403, error: 'Not your lead.' };
  if (!lead.appointment_at) return { ok: false, status: 400, error: 'Set the appointment first.' };
  const { data: owner } = await admin.from('profiles').select('hubspot_owner_id').eq('id', lead.owner_id).maybeSingle();
  const start = new Date(lead.appointment_at).toISOString();
  const properties = {
    hs_meeting_title: `Appointment: ${lead.name || 'Customer'}`,
    hs_meeting_start_time: start,
    hs_timestamp: start,
  };
  if (owner?.hubspot_owner_id) properties.hubspot_owner_id = String(owner.hubspot_owner_id);
  const meeting = await hubspot(token, '/crm/v3/objects/meetings', {
    method: 'POST',
    body: JSON.stringify({ properties }),
  });
  const meetingId = meeting?.id ? String(meeting.id) : '';
  if (meetingId && lead.hubspot_contact_id) {
    await hubspot(token, `/crm/v4/objects/meetings/${meetingId}/associations/default/contacts/${lead.hubspot_contact_id}`, { method: 'PUT', body: '{}' });
  }
  if (meetingId && lead.hubspot_deal_id) {
    await hubspot(token, `/crm/v4/objects/meetings/${meetingId}/associations/default/deals/${lead.hubspot_deal_id}`, { method: 'PUT', body: '{}' });
  }
  if (meetingId) {
    await admin.from('appointments').update({ hubspot_meeting_id: meetingId }).eq('lead_id', lead.id).is('hubspot_meeting_id', null);
  }
  await audit(admin, { actorId: actor.id, action: 'meeting.create', hubspotObject: 'meeting', hubspotId: meetingId, detail: { lead_id: lead.id } });
  return { ok: true, status: 200, hubspot_meeting_id: meetingId || null };
}

async function closedLostTarget(token) {
  const pipelines = await hubspot(token, '/crm/v3/pipelines/deals');
  return pickClosedLostStage(pipelines);
}

export async function loseLeadDeal({ admin, token, actor, leadId }) {
  const { data: lead } = await admin.from('leads').select('id, owner_id, hubspot_deal_id, stage').eq('id', leadId).maybeSingle();
  if (!lead) return { ok: false, status: 404, error: 'Lead not found.' };
  if (actor?.role !== 'admin' && actor?.id !== lead.owner_id) return { ok: false, status: 403, error: 'Not your lead.' };
  if (!lead.hubspot_deal_id) return { ok: true, status: 200, skipped: true };
  const { stageId, pipelineId } = await closedLostTarget(token);
  await hubspot(token, `/crm/v3/objects/deals/${lead.hubspot_deal_id}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: { pipeline: pipelineId, dealstage: stageId } }),
  });
  await audit(admin, { actorId: actor?.id, action: 'deal.update', hubspotObject: 'deal', hubspotId: lead.hubspot_deal_id, detail: { lead_id: lead.id, stage: 'Closed Lost' } });
  return { ok: true, status: 200 };
}

function canMarkInvalid(actor, lead) {
  if (!actor?.id) return false;
  if (actor.role === 'admin') return true;
  return !!lead?.owner_id && actor.id === lead.owner_id;
}

async function closeDealAsInvalid(token, dealId, marker) {
  const { stageId, pipelineId } = await closedLostTarget(token);
  const stage = { pipeline: pipelineId, dealstage: stageId };
  try {
    await hubspot(token, `/crm/v3/objects/deals/${dealId}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties: { ...stage, closed_lost_reason: marker } }),
    });
    return { reasonSet: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'HubSpot deal was not closed.';
    if (!/closed_lost_reason/i.test(message)) throw err;
    await hubspot(token, `/crm/v3/objects/deals/${dealId}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties: stage }),
    });
    return { reasonSet: false, reasonError: message };
  }
}

async function writeInvalidNote(token, { dealId, contactId, body }) {
  const note = await hubspot(token, '/crm/v3/objects/notes', {
    method: 'POST',
    body: JSON.stringify({
      properties: { hs_timestamp: new Date().toISOString(), hs_note_body: body },
    }),
  });
  const noteId = note?.id ? String(note.id) : '';
  if (!noteId) return '';
  if (dealId) {
    await hubspot(token, `/crm/v4/objects/notes/${noteId}/associations/default/deals/${dealId}`, { method: 'PUT', body: '{}' });
  }
  if (contactId) {
    await hubspot(token, `/crm/v4/objects/notes/${noteId}/associations/default/contacts/${contactId}`, { method: 'PUT', body: '{}' });
  }
  return noteId;
}

// Marks a lead invalid. Does not text anyone.
// Admin, or the assigned rep. Same rule as public.lead_mark_invalid.
export async function invalidateLead({ admin, token, actor, leadId, reason }) {
  const copy = invalidHubspotCopy(reason);
  if (!copy) return { ok: false, status: 400, error: 'Choose a reason from the list, or leave it blank.' };
  const { data: lead, error: leadErr } = await admin.from('leads').select('*').eq('id', leadId).is('deleted_at', null).maybeSingle();
  if (leadErr) return { ok: false, status: 500, error: leadErr.message };
  if (!lead) return { ok: false, status: 404, error: 'Lead not found.' };
  if (!canMarkInvalid(actor, lead)) return { ok: false, status: 403, error: 'Not your lead.' };

  const now = new Date().toISOString();
  if (lead.stage !== 'invalid') {
    const { error: saveErr } = await admin.from('leads').update({
      stage: 'invalid',
      invalid_reason: copy.reason || null,
      invalid_at: now,
      invalid_by: actor.id,
    }).eq('id', lead.id).is('deleted_at', null).neq('stage', 'invalid');
    if (saveErr) return { ok: false, status: 500, error: saveErr.message };
  }

  let reasonSet = false;
  let reasonError = '';
  let noteError = '';
  let leadStatus = 'skipped';
  let leadStatusError = '';
  try {
    if (lead.hubspot_deal_id) {
      const closed = await closeDealAsInvalid(token, lead.hubspot_deal_id, copy.marker);
      reasonSet = closed.reasonSet;
      reasonError = closed.reasonError || '';
    }
    if (lead.hubspot_deal_id || lead.hubspot_contact_id) {
      try {
        await writeInvalidNote(token, {
          dealId: lead.hubspot_deal_id || '',
          contactId: lead.hubspot_contact_id || '',
          body: copy.note,
        });
      } catch (err) {
        noteError = err instanceof Error ? err.message : 'The HubSpot note was not saved.';
      }
    }
    if (lead.hubspot_contact_id) {
      try {
        await hubspot(token, `/crm/v3/objects/contacts/${lead.hubspot_contact_id}`, {
          method: 'PATCH',
          body: JSON.stringify({ properties: { hs_lead_status: 'UNQUALIFIED' } }),
        });
        leadStatus = 'UNQUALIFIED';
      } catch (err) {
        leadStatus = 'unavailable';
        leadStatusError = err instanceof Error ? err.message : 'Lead status was not set.';
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'HubSpot was not updated.';
    await audit(admin, {
      actorId: actor.id,
      action: 'lead.invalid',
      hubspotObject: lead.hubspot_deal_id ? 'deal' : 'contact',
      hubspotId: lead.hubspot_deal_id || lead.hubspot_contact_id || null,
      detail: { lead_id: lead.id, reason: copy.reason || null, hubspot: 'failed', error: message },
    });
    return { ok: false, status: 502, error: message, invalid: true };
  }

  await audit(admin, {
    actorId: actor.id,
    action: 'lead.invalid',
    hubspotObject: lead.hubspot_deal_id ? 'deal' : 'contact',
    hubspotId: lead.hubspot_deal_id || lead.hubspot_contact_id || null,
    detail: {
      lead_id: lead.id,
      reason: copy.reason || null,
      closed_lost_reason: reasonSet ? copy.marker : null,
      lead_status: leadStatus,
      note: noteError ? 'failed' : 'saved',
    },
  });
  return {
    ok: true,
    status: 200,
    invalid: true,
    reason: copy.reason || null,
    closed_lost_reason: reasonSet ? copy.marker : null,
    reason_error: reasonError,
    note_error: noteError,
    lead_status: leadStatus,
    lead_status_error: leadStatusError,
  };
}

export async function textOverdueAdmins({ admin, env }) {
  const now = new Date().toISOString();
  const { data: leads, error } = await admin.from('leads')
    .select('id, owner_id, name, phone, address, call_window, call_due_at, admin_alert_attempts')
    .is('deleted_at', null)
    .eq('stage', 'new')
    .is('called_at', null)
    .is('admin_alert_at', null)
    .lt('call_due_at', now)
    .lt('admin_alert_attempts', 3);
  if (error) return { ok: false, error: error.message, sent: 0 };
  const { data: people } = await admin.from('profiles').select('id, full_name, role, phone');
  const admins = (people || []).filter((person) => person.role === 'admin' && String(person.phone || '').trim());
  const names = new Map((people || []).map((person) => [person.id, person.full_name || '']));
  let sent = 0;
  for (const lead of leads || []) {
    if (!admins.length) {
      await admin.from('leads').update({
        admin_alert_attempts: Number(lead.admin_alert_attempts || 0) + 1,
        admin_alert_error: 'No admin mobile is set.',
      }).eq('id', lead.id);
      continue;
    }
    let okId = '';
    let failure = '';
    for (const person of admins) {
      try {
        const result = await sendStaffText({
          env,
          profile: person,
          lead,
          content: overdueText({
            name: lead.name,
            phone: lead.phone,
            address: lead.address,
            repName: names.get(lead.owner_id),
            callWindow: lead.call_window,
          }),
        });
        okId = okId || result.id || '';
      } catch (err) {
        failure = err instanceof Error ? err.message : 'The text did not send.';
      }
    }
    if (okId || !failure) {
      await admin.from('leads').update({
        admin_alert_at: new Date().toISOString(),
        admin_alert_id: okId || null,
        admin_alert_error: failure || null,
      }).eq('id', lead.id);
      sent += 1;
      await audit(admin, { action: 'lead.overdue', detail: { lead_id: lead.id, text: 'sent' } });
    } else {
      await admin.from('leads').update({
        admin_alert_attempts: Number(lead.admin_alert_attempts || 0) + 1,
        admin_alert_error: failure,
      }).eq('id', lead.id);
    }
  }
  return { ok: true, sent, checked: (leads || []).length };
}
