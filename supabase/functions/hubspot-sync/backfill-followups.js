// Create missing follow-ups for presented estimates and store the latest interaction.
// Reads HubSpot notes, calls, and emails. Does not create or edit anything in HubSpot.
// The note falls back to the estimate when HubSpot has nothing newer.

import { engagementBody, followUpDue, pickLatestEngagement, planFollowUpBackfill } from './followup.js';

const KINDS = [
  { name: 'notes', properties: 'hs_note_body,hs_timestamp' },
  { name: 'calls', properties: 'hs_call_body,hs_call_title,hs_timestamp' },
  { name: 'emails', properties: 'hs_email_subject,hs_email_text,hs_timestamp' },
];

async function engagementsFor(get, objectType, objectId) {
  const items = [];
  for (const kind of KINDS) {
    let assoc = null;
    try {
      assoc = await get(`/crm/v4/objects/${objectType}/${objectId}/associations/${kind.name}`);
    } catch {
      continue;
    }
    const ids = (assoc?.results || []).map((row) => row.toObjectId).filter((id) => id != null).slice(0, 8);
    for (const id of ids) {
      try {
        const row = await get(`/crm/v3/objects/${kind.name}/${id}?properties=${encodeURIComponent(kind.properties)}`);
        const body = engagementBody(kind.name, row?.properties);
        if (!body) continue;
        items.push({ kind: kind.name, body, at: row?.properties?.hs_timestamp || '' });
      } catch {
        /* one missing engagement does not block the follow-up */
      }
    }
  }
  return items;
}

export async function readLatestEngagement(get, estimate) {
  if (!get) return null;
  const targets = [];
  if (estimate?.hubspot_deal_id) targets.push(['deals', estimate.hubspot_deal_id]);
  if (estimate?.hubspot_contact_id) targets.push(['contacts', estimate.hubspot_contact_id]);
  const items = [];
  for (const [type, id] of targets) {
    items.push(...await engagementsFor(get, type, id));
  }
  return pickLatestEngagement(items);
}

export async function backfillPresentedFollowUps({ admin, profiles, get }) {
  const summary = { created: 0, updated: 0, error: '' };
  const ownerIds = new Set((profiles || []).map((row) => row?.id).filter(Boolean));
  if (!ownerIds.size) return summary;
  const { data: estimates, error } = await admin.from('estimates')
    .select('id, owner_id, status, total_amount, presented_at, deleted_at, won_at, lost_at, hubspot_deal_id, hubspot_contact_id, document')
    .eq('status', 'presented')
    .is('deleted_at', null);
  if (error) return { ...summary, error: error.message };
  const mine = (estimates || []).filter((row) => ownerIds.has(row.owner_id) && !row.won_at && !row.lost_at);
  const ids = mine.map((row) => row.id);
  let openFollowUps = [];
  if (ids.length) {
    const existing = await admin.from('follow_ups').select('id, estimate_id, status, note').eq('status', 'open').in('estimate_id', ids);
    if (existing.error) return { ...summary, error: existing.error.message };
    openFollowUps = existing.data || [];
  }
  const engagementByEstimateId = {};
  for (const estimate of mine) {
    try {
      engagementByEstimateId[estimate.id] = await readLatestEngagement(get, estimate);
    } catch {
      engagementByEstimateId[estimate.id] = null;
    }
  }
  const due = followUpDue(new Date(), 2);
  for (const plan of planFollowUpBackfill({ estimates: mine, openFollowUps, engagementByEstimateId })) {
    if (plan.action === 'insert') {
      const saved = await admin.from('follow_ups').insert({
        estimate_id: plan.estimateId,
        owner_id: plan.ownerId,
        due_at: due,
        status: 'open',
        note: plan.note,
      });
      if (saved.error) return { ...summary, error: saved.error.message };
      summary.created += 1;
      continue;
    }
    const saved = await admin.from('follow_ups').update({ note: plan.note }).eq('id', plan.id);
    if (saved.error) return { ...summary, error: saved.error.message };
    summary.updated += 1;
  }
  return summary;
}
