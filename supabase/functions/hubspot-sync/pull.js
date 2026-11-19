// Pull HubSpot deals, tasks, meetings, and uncontacted leads into the app tables.
// The browser never sees HUBSPOT_TOKEN. Callers pass the token in.

import {
  hubspotBodyAllowed, isUncontactedLead, stageToStatus, syncDecision,
} from '../_shared/assistant.js';
import { hubspotAppointmentRows } from '../_shared/assistant.js';

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

async function searchOwned(token, object, ownerId, properties) {
  const body = {
    filterGroups: [{ filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: String(ownerId) }] }],
    properties,
    limit: 100,
  };
  if (!hubspotBodyAllowed(body)) throw new Error('Refusing to send cost data to HubSpot');
  const found = await hubspot(token, `/crm/v3/objects/${object}/search`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return found?.results || [];
}

async function engagementCounts(token, objectType, id) {
  const counts = { calls: 0, emails: 0, notes: 0, meetings: 0 };
  for (const kind of Object.keys(counts)) {
    const assoc = await hubspot(token, `/crm/v4/objects/${objectType}/${id}/associations/${kind}`);
    counts[kind] = (assoc?.results || []).length;
  }
  return counts;
}

function closedDeal(deal) {
  const p = deal?.properties || {};
  const status = stageToStatus('', p.dealstage);
  return p.hs_is_closed === 'true' || status === 'won' || status === 'lost';
}

export async function pullHubspot({ admin, token, profiles }) {
  const summary = { owners: 0, conflicts: 0, leads: 0, error: '' };
  if (!token) return { ...summary, error: 'HUBSPOT_TOKEN is not set' };
  const targets = (profiles || []).filter((p) => String(p.hubspot_owner_id || '').trim());
  const { data: quietRows, error: quietErr } = await admin.from('leads')
    .select('hubspot_contact_id, hubspot_deal_id, stage')
    .in('stage', ['invalid', 'dismissed'])
    .is('deleted_at', null);
  if (quietErr) return { ...summary, error: quietErr.message };
  const invalidRows = (quietRows || []).filter((row) => row.stage === 'invalid');
  const dismissedRows = (quietRows || []).filter((row) => row.stage === 'dismissed');
  const idsOf = (rows, key) => new Set(rows.map((row) => row[key]).filter(Boolean).map(String));
  const invalidContacts = idsOf(invalidRows, 'hubspot_contact_id');
  const invalidDeals = idsOf(invalidRows, 'hubspot_deal_id');
  const dismissedContacts = idsOf(dismissedRows, 'hubspot_contact_id');
  const dismissedDeals = idsOf(dismissedRows, 'hubspot_deal_id');
  for (const profile of targets) {
    const ownerHubspotId = String(profile.hubspot_owner_id).trim();
    const { data: state } = await admin.from('hubspot_sync_state').select('last_synced_at').eq('owner_id', profile.id).maybeSingle();
    const lastSyncedAt = state?.last_synced_at || null;
    try {
      const deals = await searchOwned(token, 'deals', ownerHubspotId, ['dealstage', 'dealname', 'amount', 'hs_lastmodifieddate', 'hs_is_closed', 'pipeline']);
      const { data: estimates } = await admin.from('estimates').select('id, owner_id, status, updated_at, hubspot_deal_id, deleted_at, won_at, lost_at').eq('owner_id', profile.id);
      const byDeal = new Map((estimates || []).filter((row) => row.hubspot_deal_id).map((row) => [String(row.hubspot_deal_id), row]));
      for (const deal of deals) {
        if (invalidDeals.has(String(deal.id))) continue;
        const local = byDeal.get(String(deal.id));
        if (!local || local.deleted_at) continue;
        const next = stageToStatus('', deal.properties?.dealstage);
        if (!next || next === local.status) continue;
        const decision = syncDecision({
          appUpdatedAt: local.updated_at,
          hubspotUpdatedAt: deal.properties?.hs_lastmodifieddate,
          lastSyncedAt,
        });
        if (decision === 'conflict') {
          summary.conflicts += 1;
          await admin.from('hubspot_conflicts').insert({
            owner_id: profile.id,
            estimate_id: local.id,
            hubspot_object: 'deal',
            hubspot_id: String(deal.id),
            field: 'status',
            app_value: local.status,
            hubspot_value: next,
          });
          continue;
        }
        if (decision === 'take-hubspot') {
          const patch = { status: next };
          const when = deal.properties?.hs_lastmodifieddate || new Date().toISOString();
          if (next === 'won' && !local.won_at) patch.won_at = when;
          if (next === 'lost' && !local.lost_at) patch.lost_at = when;
          await admin.from('estimates').update(patch).eq('id', local.id);
        }
      }

      const meetings = await searchOwned(token, 'meetings', ownerHubspotId, ['hs_meeting_start_time', 'hubspot_owner_id', 'hs_meeting_title']);
      const rows = hubspotAppointmentRows(meetings, [profile]).rows;
      for (const row of rows) {
        await admin.from('appointments').upsert(row, { onConflict: 'hubspot_meeting_id' });
      }

      const tasks = await searchOwned(token, 'tasks', ownerHubspotId, ['hs_task_subject', 'hs_task_status', 'hs_timestamp', 'hubspot_owner_id']);
      for (const task of tasks.slice(0, 100)) {
        const status = String(task.properties?.hs_task_status || '').toUpperCase() === 'COMPLETED' ? 'done' : 'open';
        const { data: existing } = await admin.from('follow_ups').select('id, status').eq('hubspot_task_id', String(task.id)).maybeSingle();
        if (!existing) continue;
        const patch = {};
        if (task.properties?.hs_timestamp) patch.due_at = task.properties.hs_timestamp;
        if (status === 'done' && existing.status === 'open') {
          patch.status = 'done';
          patch.completed_at = new Date().toISOString();
        }
        if (Object.keys(patch).length) await admin.from('follow_ups').update(patch).eq('id', existing.id);
      }

      const contacts = await searchOwned(token, 'contacts', ownerHubspotId, ['firstname', 'lastname', 'phone', 'email', 'hubspot_owner_id']);
      const openDeals = deals.filter((deal) => !closedDeal(deal)).slice(0, 20);
      const leadRows = [];
      for (const contact of contacts.slice(0, 20)) {
        const engagements = await engagementCounts(token, 'contacts', contact.id);
        const name = [contact.properties?.firstname, contact.properties?.lastname].filter(Boolean).join(' ');
        const contactId = String(contact.id);
        leadRows.push({
          owner_id: profile.id,
          hubspot_object: 'contact',
          hubspot_id: contactId,
          name: name || 'Contact',
          phone: contact.properties?.phone || '',
          email: contact.properties?.email || '',
          hubspot_owner_id: ownerHubspotId,
          uncontacted: !invalidContacts.has(contactId) && !dismissedContacts.has(contactId) && isUncontactedLead({ hubspot_owner_id: ownerHubspotId, closed: false, engagements }, ownerHubspotId),
          synced_at: new Date().toISOString(),
        });
      }
      for (const deal of openDeals) {
        const engagements = await engagementCounts(token, 'deals', deal.id);
        const dealId = String(deal.id);
        leadRows.push({
          owner_id: profile.id,
          hubspot_object: 'deal',
          hubspot_id: dealId,
          name: deal.properties?.dealname || 'Deal',
          phone: '',
          email: '',
          hubspot_owner_id: ownerHubspotId,
          uncontacted: !invalidDeals.has(dealId) && !dismissedDeals.has(dealId) && isUncontactedLead({ hubspot_owner_id: ownerHubspotId, closed: false, engagements }, ownerHubspotId),
          synced_at: new Date().toISOString(),
        });
      }
      if (leadRows.length) {
        await admin.from('hubspot_leads').upsert(leadRows, { onConflict: 'owner_id,hubspot_object,hubspot_id' });
        summary.leads += leadRows.filter((row) => row.uncontacted).length;
      }
      await admin.from('hubspot_sync_state').upsert({
        owner_id: profile.id,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      summary.owners += 1;
    } catch (err) {
      summary.error = err instanceof Error ? err.message : 'HubSpot pull failed';
    }
  }
  return summary;
}
